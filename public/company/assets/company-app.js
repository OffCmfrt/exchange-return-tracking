/* ==========================================================================
   Company Ops — shared runtime for admin.html and portal.html
   Inline SVG icon set, API client (Bearer + mock fallback), realtime chat
   client (ws with reconnect/replay, REST fallback), toasts, small helpers.
   In mock mode (no server / ?mock=1) every call resolves from MOCK data so
   the pages preview over a plain static server.
   ========================================================================== */
(function (global) {
    'use strict';

    // ---- icons: 24x24 stroke grid, drawn at 1.5 ---------------------------
    const P = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${d}</svg>`;
    const ICONS = {
        overview: P('<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'),
        board: P('<rect x="3" y="4" width="5" height="16"/><rect x="10" y="4" width="5" height="11"/><rect x="17" y="4" width="4" height="7"/>'),
        list: P('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
        dept: P('<rect x="3" y="9" width="8" height="12"/><rect x="13" y="4" width="8" height="17"/><line x1="6" y1="13" x2="8" y2="13"/><line x1="6" y1="17" x2="8" y2="17"/><line x1="16" y1="8" x2="18" y2="8"/><line x1="16" y1="12" x2="18" y2="12"/>'),
        people: P('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16.5 15.2c2.6.2 4.3 1.7 5 4.3"/>'),
        chat: P('<path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/>'),
        kanban: P('<rect x="3" y="3" width="18" height="18"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>'),
        star: P('<path d="M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.8-5.1 2.8 1-5.7-4.1-4 5.7-.8z"/>'),
        target: P('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>'),
        flag: P('<path d="M5 21V4"/><path d="M5 4h13l-2.5 4L18 12H5"/>'),
        calendar: P('<rect x="3" y="5" width="18" height="16"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>'),
        doc: P('<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v5h5"/><line x1="9" y1="12" x2="16" y2="12"/><line x1="9" y1="16" x2="16" y2="16"/>'),
        chart: P('<line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="11" width="3" height="7"/><rect x="11" y="6" width="3" height="12"/><rect x="16" y="14" width="3" height="4"/>'),
        cog: P('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9"/>'),
        logout: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><line x1="21" y1="12" x2="9" y2="12"/>'),
        plus: P('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
        search: P('<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>'),
        x: P('<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>'),
        check: P('<path d="M4 12.5l5 5L20 6.5"/>'),
        send: P('<path d="M21 3L3 10.5l7 3 3 7z"/><path d="M21 3l-11 11.5"/>'),
        pin: P('<path d="M12 17v5"/><path d="M8.5 3h7l-1 6 3 3.5H6.5l3-3.5z"/>'),
        clock: P('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>'),
        msg: P('<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
        edit: P('<path d="M4 20h4L20 8l-4-4L4 16z"/><line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/>'),
        trash: P('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>'),
        reply: P('<path d="M9 10L4 15l5 5"/><path d="M4 15h10a6 6 0 0 0 6-6V4"/>'),
        bolt: P('<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>'),
        link: P('<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>'),
        folders: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>')
    };
    const icon = (name, cls) => `<span class="ic ${cls || ''}" style="display:inline-flex;width:15px;height:15px">${ICONS[name] || ''}</span>`;

    // ---- helpers -----------------------------------------------------------
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const dayKey = (d) => new Date(d).toDateString();
    const isLate = (t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date();
    const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const avatar = (name, url, online, lg) =>
        `<span class="av ${lg ? 'lg' : ''} ${online ? 'online' : ''}">${esc(initials(name))}${url ? `<img src="${esc(url)}" alt="" onerror="this.remove()">` : ''}<i class="on"></i></span>`;

    let toastSeq = 0;
    function toast(text, kind) {
        let host = document.querySelector('.toasts');
        if (!host) { host = document.createElement('div'); host.className = 'toasts'; document.body.appendChild(host); }
        const el = document.createElement('div');
        el.className = 'toast ' + (kind || '');
        el.textContent = text;
        host.appendChild(el);
        const n = ++toastSeq;
        setTimeout(() => { el.remove(); void n; }, 4200);
    }

    // ---- mock mode ---------------------------------------------------------
    // The pages only fetch mock-data.js when the URL carries ?mock=1, so the
    // fake dataset never reaches a real session: no token + no mock flag means
    // the login form shows, never placeholder staff.
    const MOCK = global.CompanyMock || null;
    let useMock = !!MOCK && new URLSearchParams(location.search).has('mock');

    const TOKEN_KEY = 'company_token';
    const ME_KEY = 'company_me';

    const api = {
        get token() { return useMock ? 'mock' : localStorage.getItem(TOKEN_KEY); },
        setSession(token, me) {
            if (useMock) return;            // never poison a real session from the preview
            localStorage.setItem(TOKEN_KEY, token);
            localStorage.setItem(ME_KEY, JSON.stringify(me));
        },
        get me() { try { return JSON.parse(localStorage.getItem(ME_KEY)); } catch (e) { return null; } },
        clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(ME_KEY); },

        async req(method, url, body) {
            if (useMock) return MOCK.handle(method, url, body);
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
                body: body ? JSON.stringify(body) : undefined
            });
            let json = {};
            try { json = await res.json(); } catch (e) {}
            if (!res.ok) {
                if (res.status === 401) { this.clear(); location.reload(); }
                throw Object.assign(new Error(json.error || res.statusText), { status: res.status });
            }
            return json;
        },
        get(u) { return this.req('GET', u); },
        post(u, b) { return this.req('POST', u, b); },
        put(u, b) { return this.req('PUT', u, b); },
        del(u) { return this.req('DELETE', u); }
    };

    // ---- realtime chat client ----------------------------------------------
    // Frames mirror services/company-ops/ChatHub.js exactly:
    //   in:  {t:'sub',c,lastSeen} {t:'send',id,c,text,replyTo} {t:'typing',c}
    //        {t:'read',c} {t:'react',m,e} {t:'edit',m,text} {t:'del',m,c}
    //   out: hello{me,name} sub:ok{c,messages,backfill} msg{message}
    //        ack{id,ok,message} typing{c,from,name} presence{on[]} read{c,by}
    //        reaction{m,e,users} edited{m,text} deleted{m} mention{c,from}
    //        err{m}
    class ChatClient {
        constructor({ on }) {
            this.on = on;               // { event, ...payload } -> page handler
            this.lastSeen = {};         // channelId -> iso ts
            this.pending = new Map();   // localId -> resolve
            this.queue = [];
            this.retries = 0;
            this.closed = false;
        }
        connect() {
            if (useMock) { this.mock = true; return; }
            const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const url = `${proto}//${location.host}/company-chat?t=${encodeURIComponent(api.token || '')}`;
            let ws;
            try { ws = new WebSocket(url); } catch (e) { return this._retry(); }
            this.ws = ws;
            ws.onopen = () => { this.retries = 0; };
            ws.onmessage = (ev) => {
                let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
                if (m.t === 'msg' && m.message) this.lastSeen[m.message.channelId] = m.message.createdAt;
                if (m.t === 'sub:ok') {
                    const list = m.messages || [];
                    if (list.length) this.lastSeen[m.c] = list[list.length - 1].createdAt;
                }
                this.on(m);
            };
            ws.onclose = () => { if (!this.closed) this._retry(); };
            ws.onerror = () => { try { ws.close(); } catch (e) {} };
        }
        _retry() {
            if (this.closed || this.retries >= 6) { this.on({ t: 'down' }); return; }
            this.retries++;
            setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retries, 15000));
        }
        _raw(obj) {
            if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); return true; }
            return false;
        }
        sub(channelId) { this._raw({ t: 'sub', c: channelId, lastSeen: this.lastSeen[channelId] || null }); }
        unsub(channelId) { this._raw({ t: 'unsub', c: channelId }); }
        typing(channelId) { this._raw({ t: 'typing', c: channelId }); }
        read(channelId) { this._raw({ t: 'read', c: channelId }); }
        react(messageId, emoji) {
            if (this._raw({ t: 'react', m: messageId, e: emoji })) return Promise.resolve(null);
            if (useMock) return Promise.resolve(MOCK.wsReact(messageId, emoji));
            return api.post(`/api/company/chat/messages/${messageId}/react`, { emoji })
                .then((r) => r.message)
                .catch(() => { toast('Reaction did not save', 'bad'); });
        }
        edit(messageId, text) {
            if (this._raw({ t: 'edit', m: messageId, text })) return Promise.resolve(null);
            if (useMock) return Promise.resolve(MOCK.wsEdit(messageId, text));
            return api.put(`/api/company/chat/messages/${messageId}`, { text })
                .then((r) => r.message)
                .catch((e) => toast(e.message || 'Could not edit message', 'bad'));
        }
        del(channelId, messageId) {
            if (this._raw({ t: 'del', m: messageId, c: channelId })) return Promise.resolve(null);
            if (useMock) return Promise.resolve(MOCK.wsDelete(messageId));
            return api.del(`/api/company/chat/messages/${messageId}`)
                .catch((e) => toast(e.message || 'Could not delete message', 'bad'));
        }
        send(channelId, text, replyTo) {
            const id = 'l' + Date.now() + Math.random().toString(36).slice(2, 7);
            if (useMock) {
                return MOCK.wsSend(id, channelId, text, replyTo, (msg) => this.on({ t: 'msg', message: msg }));
            }
            const ok = this._raw({ t: 'send', id, c: channelId, text, replyTo: replyTo || null });
            if (!ok) {
                // REST fallback keeps chat usable while the socket is down
                return api.post(`/api/company/chat/channels/${channelId}/messages`, { text, replyTo })
                    .then((r) => { this.on({ t: 'msg', message: r.message }); return r.message; });
            }
            return new Promise((resolve) => {
                this.pending.set(id, resolve);
                setTimeout(() => {
                    if (this.pending.has(id)) { this.pending.delete(id); resolve(null); }
                }, 8000);
            });
        }
        ackFrame(m) {
            if (m.t === 'ack' && m.ok && this.pending.has(m.id)) {
                this.pending.get(m.id)(m.message);
                this.pending.delete(m.id);
            }
        }
        close() { this.closed = true; try { this.ws && this.ws.close(); } catch (e) {} }
    }

    global.CompanyApp = { ICONS, icon, esc, fmtDay, fmtTime, dayKey, isLate, initials, avatar, toast, api, ChatClient, useMock: () => useMock };
})(window);
