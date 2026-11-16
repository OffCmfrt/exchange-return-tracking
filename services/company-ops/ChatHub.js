// ============================================================================
// Company Ops ChatHub — realtime department chat (WebSocket on /company-chat)
//
//   - auth:     ?t=<jwt> on the upgrade URL, same convention as RaceHub
//   - channels: a socket only ever receives frames for channels it is a
//               verified member of (membership checked server-side on sub)
//   - events:   msg / ack / typing / presence / read / reaction / sys
//   - replay:   client sends its lastSeen ts per channel; server backfills
//               everything newer in one batch so a reconnect never drops chat
//   - presence: online set lives in memory only, derived from live sockets
// State is in-memory by design — a single Render instance; messages persist
// through company-ops-db.
// ============================================================================

const { WebSocketServer } = require('ws');

const PATH = '/company-chat';
const MAX_PAYLOAD = 8192;
const MSG_RATE_WINDOW = 10000; // 10s
const MSG_RATE_LIMIT = 12;     // sends per window per socket
const TYPING_THROTTLE = 3000;

let api = null; // singleton for pushTaskEvent from HTTP routes

function createHub({ verifyToken, db }) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
    const staffSockets = new Map(); // staffId -> Set<ws>
    const admins = new Set();       // admin sockets (platform-wide inbox)
    let presenceTimer = null;
    let presenceDirty = false;

    const now = () => Date.now();
    const sendRaw = (ws, str) => {
        if (ws && ws.readyState === 1) {
            try { ws.send(str); } catch (e) {}
        }
    };
    const send = (ws, obj) => sendRaw(ws, typeof obj === 'string' ? obj : JSON.stringify(obj));

    function presencePayload() {
        return JSON.stringify({ t: 'presence', on: [...staffSockets.keys()].map(String) });
    }
    function schedulePresence() {
        presenceDirty = true;
        if (presenceTimer) return;
        presenceTimer = setTimeout(() => {
            presenceTimer = null;
            if (!presenceDirty) return;
            presenceDirty = false;
            const msg = presencePayload();
            for (const set of staffSockets.values()) for (const ws of set) sendRaw(ws, msg);
            for (const ws of admins) sendRaw(ws, msg);
        }, 500);
    }

    // Broadcast to every socket subscribed to a channel (+ platform admins
    // when the admin browser is viewing it).
    function broadcastChannel(channelId, obj, exceptWs = null) {
        const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
        for (const set of staffSockets.values()) {
            for (const ws of set) {
                if (ws !== exceptWs && ws.subs && ws.subs.has(channelId)) sendRaw(ws, s);
            }
        }
        for (const ws of admins) {
            if (ws !== exceptWs && ws.subs && ws.subs.has(channelId)) sendRaw(ws, s);
        }
    }

    // Staff lookup for @mention resolution, cached briefly: mentions are parsed
    // server-side from the message text, so a client cannot forge or omit them.
    let staffCache = { at: 0, map: new Map() };
    async function staffLookup() {
        if (staffCache.map.size && Date.now() - staffCache.at < 60000) return staffCache.map;
        const map = new Map();
        try {
            for (const s of await db.listStaff({ all: true })) {
                map.set(String(s.id), {
                    id: s.id,
                    name: s.fullName || s.name || '',
                    username: s.username || ''
                });
            }
            staffCache = { at: Date.now(), map };
        } catch (e) { /* keep the previous cache on a transient failure */ }
        return staffCache.map;
    }

    async function resolveMentions(text, memberIds) {
        const tokens = [...new Set([...String(text || '').matchAll(/@([a-z0-9_.-]+)/gi)].map((m) => m[1].toLowerCase()))];
        if (!tokens.length) return [];
        const all = await staffLookup();
        const hits = [];
        for (const id of memberIds) {
            const s = all.get(String(id));
            if (!s) continue;
            const first = String(s.name).split(/\s+/)[0].toLowerCase();
            if ((s.username && tokens.includes(s.username.toLowerCase())) || (first && tokens.includes(first))) hits.push(String(id));
        }
        return hits;
    }

    async function deliverFrame(ws, msg) {
        const t = msg && msg.t;
        if (!t || typeof t !== 'string') return;

        // ---- subscribe to a channel (membership is server-authoritative) ----
        if (t === 'sub') {
            const channelId = String(msg.c || '');
            if (!channelId) return send(ws, { t: 'err', m: 'sub needs channel' });
            let ok = ws.actor.platformAdmin;
            if (!ok && ws.actor.staffId) {
                try { ok = await db.isChannelMember(channelId, ws.actor.staffId); } catch (e) { ok = false; }
            }
            if (!ok) return send(ws, { t: 'err', m: 'not a member of that channel' });
            ws.subs.add(channelId);
            try {
                const page = await db.listMessages(channelId, { limit: 50 });
                // Reconnect replay: everything newer than the client's cursor,
                // independent of page boundaries.
                let backfill = [];
                if (msg.lastSeen) {
                    backfill = await db.listMessagesSince(channelId, msg.lastSeen, 100);
                }
                send(ws, { t: 'sub:ok', c: channelId, messages: page, backfill });
            } catch (e) {
                send(ws, { t: 'err', m: 'history load failed' });
            }
            return;
        }

        if (t === 'unsub') { ws.subs.delete(String(msg.c || '')); return; }

        // ---- send a message ----
        if (t === 'send') {
            if (!ws.canSend()) return send(ws, { t: 'err', m: 'rate limited, slow down' });
            const channelId = String(msg.c || '');
            if (!ws.subs.has(channelId) && !ws.actor.platformAdmin) {
                return send(ws, { t: 'err', m: 'subscribe first' });
            }
            const text = String(msg.text || '').trim();
            if (!text && !(msg.attachments || []).length) return send(ws, { t: 'ack', id: msg.id, ok: false, why: 'empty' });
            try {
                // resolve @mentions against channel members (server-side truth)
                const members = await db.getChannelMembers(channelId);
                const memberIds = new Set(members.map((m) => String(m.staffId)));
                const parsed = await resolveMentions(text, memberIds);
                const mentions = [...new Set(parsed.concat((msg.mentions || []).map(String).filter((x) => memberIds.has(x))))];
                const message = await db.sendMessage({
                    channelId,
                    senderId: ws.actor.staffId || null,
                    senderName: ws.actor.name || 'Admin',
                    text,
                    replyTo: msg.replyTo || null,
                    attachments: (msg.attachments || []).slice(0, 5),
                    mentions
                });
                send(ws, { t: 'ack', id: msg.id, ok: true, message });
                broadcastChannel(channelId, { t: 'msg', message });
                for (const mid of mentions) {
                    for (const ws2 of (staffSockets.get(mid) || staffSockets.get(String(mid)) || [])) {
                        send(ws2, { t: 'mention', c: channelId, from: ws.actor.name, messageId: message.id });
                    }
                }
            } catch (e) {
                send(ws, { t: 'ack', id: msg.id, ok: false, why: e.message });
            }
            return;
        }

        // ---- typing (throttled) ----
        if (t === 'typing') {
            const channelId = String(msg.c || '');
            if (!ws.subs.has(channelId)) return;
            if (ws.lastTyping && now() - ws.lastTyping < TYPING_THROTTLE) return;
            ws.lastTyping = now();
            broadcastChannel(channelId, { t: 'typing', c: channelId, from: ws.actor.staffId || 'admin', name: ws.actor.name }, ws);
            return;
        }

        // ---- read receipt ----
        if (t === 'read') {
            const channelId = String(msg.c || '');
            if (!ws.actor.staffId || !ws.subs.has(channelId)) return;
            await db.markRead(channelId, ws.actor.staffId).catch(() => {});
            broadcastChannel(channelId, { t: 'read', c: channelId, by: ws.actor.staffId });
            return;
        }

        // ---- reaction ----
        if (t === 'react') {
            const messageId = String(msg.m || '');
            const emoji = String(msg.e || '').slice(0, 16);
            if (!messageId || !emoji) return;
            try {
                const updated = await db.toggleReaction(messageId, ws.actor.staffId || 'admin', emoji);
                if (updated) broadcastChannel(updated.channelId, { t: 'reaction', m: messageId, e: emoji, users: (updated.reactions || {})[emoji] || [] });
            } catch (e) {}
            return;
        }

        // ---- edit / delete own message ----
        if (t === 'edit') {
            try {
                const updated = await db.editMessage(String(msg.m || ''), ws.actor.staffId, msg.text);
                broadcastChannel(updated.channelId, { t: 'edited', m: updated.id, text: updated.text, editedAt: updated.editedAt });
            } catch (e) { send(ws, { t: 'err', m: e.message }); }
            return;
        }
        if (t === 'del') {
            try {
                // channelId comes back from the row, not from the client frame.
                const channelId = await db.deleteMessage(String(msg.m || ''), { moderator: !!ws.actor.platformAdmin, staffId: ws.actor.staffId });
                broadcastChannel(channelId, { t: 'deleted', m: msg.m });
            } catch (e) { send(ws, { t: 'err', m: e.message }); }
            return;
        }
    }

    wss.on('connection', (ws, req, actor) => {
        ws.actor = actor;
        ws.subs = new Set();
        ws.sent = [];
        ws.lastTyping = 0;
        ws.alive = true;
        ws.canSend = () => {
            const cutoff = now() - MSG_RATE_WINDOW;
            ws.sent = ws.sent.filter((x) => x > cutoff);
            if (ws.sent.length >= MSG_RATE_LIMIT) return false;
            ws.sent.push(now());
            return true;
        };

        if (actor.platformAdmin) {
            admins.add(ws);
        } else {
            const key = String(actor.staffId);
            if (!staffSockets.has(key)) staffSockets.set(key, new Set());
            staffSockets.get(key).add(ws);
        }
        send(ws, { t: 'hello', me: actor.staffId || 'admin', name: actor.name });
        schedulePresence();

        ws.on('message', (buf) => {
            let msg = null;
            try { msg = JSON.parse(buf.toString('utf8')); } catch (e) { return; }
            deliverFrame(ws, msg).catch(() => {});
        });
        ws.on('pong', () => { ws.alive = true; });
        ws.on('close', () => {
            if (actor.platformAdmin) admins.delete(ws);
            const set = staffSockets.get(String(actor.staffId));
            if (set) {
                set.delete(ws);
                if (set.size === 0) staffSockets.delete(String(actor.staffId));
            }
            schedulePresence();
        });
    });

    // Heartbeat: drop dead sockets so presence stays honest.
    const beat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.alive) { ws.terminate(); continue; }
            ws.alive = false;
            try { ws.ping(); } catch (e) {}
        }
    }, 25000);
    beat.unref?.();

    function attach(server) {
        server.on('upgrade', (req, socket, head) => {
            let url;
            try { url = new URL(req.url, 'http://localhost'); } catch (e) { return; }
            if (url.pathname !== PATH) return; // not ours — RaceHub leaves it too
            const token = url.searchParams.get('t');
            const claims = token ? verifyToken(token) : null;
            let actor = null;
            if (claims && claims.role === 'company_staff' && claims.staffId) {
                actor = { staffId: claims.staffId, name: claims.name || claims.username, platformAdmin: false };
            } else if (claims && (claims.role === 'admin' || claims.role === 'operator')) {
                actor = { staffId: null, name: claims.username || 'Admin', platformAdmin: true };
            }
            if (!actor) {
                socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }
            wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, actor));
        });
        console.log(`💬 CompanyChat live on ${PATH}`);
        return api;
    }
    api = {
        attach,
        // Push a system event into a task's thread channel (called by HTTP routes).
        async pushTaskEvent(taskId, text) {
            try {
                const { data: ch } = await require('../../config/supabase')
                    .from('company_chat_channels')
                    .select('id')
                    .eq('type', 'task')
                    .eq('task_id', taskId)
                    .maybeSingle();
                if (!ch) return;
                const message = await db.sendMessage({ channelId: ch.id, senderId: null, senderName: 'System', text });
                broadcastChannel(ch.id, { t: 'msg', message });
            } catch (e) {}
        },
        stats: () => ({ staff: staffSockets.size, admins: admins.size, sockets: wss.clients.size }),
        // Fan out a frame produced by an HTTP (REST-fallback / moderation) route
        // so live sockets stay in sync with the write.
        broadcast(channelId, obj) { if (channelId) broadcastChannel(String(channelId), obj); }
    };
    return api;
}

module.exports = { createHub, PATH };
