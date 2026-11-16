/* ==========================================================================
   Company Ops — chat pane component (used by portal Chat view, the admin
   Messages view, and the task drawer thread). Owns rail + message pane DOM;
   pages feed it a ChatClient and data loaders.
   ========================================================================== */
(function (global) {
    'use strict';
    const A = global.CompanyApp;
    const { esc, icon, avatar, fmtTime, dayKey, toast } = A;

    const REACTIONS = ['+1', 'ok', 'fire', 'eye']; // mapped to glyphs via label, stored as short codes
    const GLYPH = { '+1': '▲', 'ok': '✓', 'fire': '◆', 'eye': '◉' };

    /**
     * mountChat(rootEl, {
     *   client, me, channels: () => Promise<{channels, members, unread}>,
     *   compact: bool          -> single-channel mode (task thread), no rail
     *   onChannelSwitch(ch)
     * })
     */
    function mountChat(root, opts) {
        const { client, me, compact = false } = opts;
        let channels = [];
        let unread = {};
        let directory = [];
        let current = null;
        let messages = [];        // rendered window (asc)
        let typingUsers = {};     // staffId -> expiry ts
        let replyTo = null;
        let presence = new Set();
        let loadingOlder = false;   // older-page fetch in flight
        let olderExhausted = false; // server said there is nothing before this
        let typingSentAt = 0;
        let mxOpen = false, mxSel = 0, mxItems = [];
        let editingId = null;       // message id showing the inline editor
        let confirmingId = null;    // message id awaiting delete confirmation
        let creating = false;       // rail is in "new channel" mode
        let creatingBusy = false;
        let picks = new Set();      // staffIds chosen for a new group
        let peopleQuery = '';
        let nameDraft = '';

        root.innerHTML = `
            <div class="chat">
                ${compact ? '' : `
                <div class="rail">
                    <div class="rail-head">
                        <span class="mlabel">Channels</span>
                        <button class="btn btn-ghost btn-sm ch-new" title="New group or DM">${icon('plus')}</button>
                    </div>
                    <div class="search" style="padding:8px 10px">
                        ${icon('search')}<input class="ch-filter" placeholder="Filter channels" style="font-size:12px">
                    </div>
                    <div class="list"></div>
                </div>`}
                <div class="pane">
                    <div class="pane-head"></div>
                    <div class="pins hidden"></div>
                    <div class="msgs"></div>
                    <div class="typing"></div>
                    <div class="replying hidden"><span class="dim"></span><button class="btn btn-ghost btn-sm rp-x">${icon('x')}</button></div>
                    <div class="composer">
                        <textarea rows="1" placeholder="Message — @ to mention"></textarea>
                        <button class="btn btn-primary btn-sm cp-send">${icon('send')}</button>
                    </div>
                </div>
            </div>`;

        const $ = (s) => root.querySelector(s);
        const railList = $('.rail .list');
        const msgsEl = $('.msgs');
        const paneHead = $('.pane-head');

        // ---- rail ----------------------------------------------------------
        async function reloadChannels() {
            const d = await opts.channels();
            channels = d.channels; unread = d.unread || {}; directory = d.directory || [];
            if (!current && channels.length) openChannel(channels[0]);
            else if (current && !channels.find((c) => c.id === current.id)) current = null;
            renderRail();
        }

        function channelLabel(ch) {
            if (ch.type === 'direct') {
                const other = (ch.memberStaffIds || []).map(String).find((id) => id !== String(me.id));
                const s = directory.find((x) => String(x.id) === String(other));
                return s ? s.name : (ch.name || 'Direct');
            }
            if (ch.type === 'dept') return (ch.name || ch.department || 'department').replace(/_/g, ' ');
            if (ch.type === 'task') return ch.name || 'Task thread';
            return ch.name || 'Group';
        }

        function renderRail() {
            if (compact || !railList || creating) return;
            const filter = ($('.ch-filter') || {}).value || '';
            const f = filter.trim().toLowerCase();
            const shown = channels.filter((c) => !f || channelLabel(c).toLowerCase().includes(f));
            const groups = [['dept', 'Departments'], ['task', 'Task threads'], ['group', 'Groups'], ['direct', 'Direct messages']];
            railList.innerHTML = groups.map(([type, label]) => {
                const list = shown.filter((c) => c.type === type);
                if (!list.length) return '';
                return `<div class="sect-label mlabel">${label}</div>` + list.map((c) => {
                    const n = unread[c.id] || 0;
                    const isDirect = c.type === 'direct';
                    const other = isDirect ? directory.find((x) => (c.memberStaffIds || []).map(String).includes(String(x.id))) : null;
                    return `<button class="ch-item ${current && current.id === c.id ? 'active' : ''}" data-id="${esc(c.id)}">
                        ${isDirect
                            ? avatar(other ? other.name : '?', other && other.avatarUrl, other && presence.has(String(other.id)))
                            : `<span style="width:26px;display:inline-flex;justify-content:center;color:var(--faint)">${icon(type === 'task' ? 'link' : type === 'dept' ? 'dept' : 'folders')}</span>`}
                        <span class="nm">${esc(channelLabel(c))}</span>
                        ${n ? `<span class="unread num">${n > 99 ? '99+' : n}</span>` : ''}
                    </button>`;
                }).join('');
            }).join('') || '<div class="empty" style="padding:20px">No channels</div>';
            railList.querySelectorAll('.ch-item').forEach((b) => {
                b.onclick = () => {
                    const ch = channels.find((c) => c.id === b.dataset.id);
                    if (ch) openChannel(ch);
                };
            });
        }

        // ---- channel history: pagination + live merge ------------------------
        async function openChannel(ch) {
            if (current && current.id !== ch.id) client.unsub(current.id);
            current = ch;
            replyTo = null;
            messages = [];
            editingId = null;
            confirmingId = null;
            olderExhausted = false;
            renderRail();
            renderPaneHead();
            showTyping();
            msgsEl.innerHTML = '<div class="empty">Loading…</div>';
            try {
                const r = await A.api.get(`/api/company/chat/channels/${ch.id}/messages?limit=50`);
                messages = r.messages || [];
            } catch (e) {
                messages = (opts.mockMessages && opts.mockMessages(ch.id)) || [];
            }
            client.sub(ch.id);
            client.read(ch.id);
            delete unread[ch.id];
            renderRail();
            renderMessages(true);
            if (opts.onChannelSwitch) opts.onChannelSwitch(ch);
        }

        function renderPaneHead() {
            if (!current) { paneHead.innerHTML = ''; return; }
            const label = channelLabel(current);
            paneHead.innerHTML = `
                <span style="font-size:13px;font-weight:600">${esc(label)}</span>
                ${current.type === 'dept' ? `<span class="chip"><span class="dot"></span>${esc((current.department || '').replace(/_/g, ' '))}</span>` : ''}
                <span class="right hstack" style="gap:6px">
                    <span class="mlabel mem-count"></span>
                </span>`;
            loadMembersIntoHead();
            renderPins();
        }

        async function loadMembersIntoHead() {
            try {
                const r = await A.api.get(`/api/company/chat/channels/${current.id}/members`);
                current.members = r.members || [];
            } catch (e) { current.members = opts.mockMembers ? opts.mockMembers(current.id) : []; }
            const el = $('.mem-count');
            if (el) el.textContent = (current.members.length || 0) + ' members';
        }

        function renderPins() {
            const pins = $('.pins');
            const ids = (current && current.pinnedMessageIds) || [];
            const pinned = messages.filter((m) => ids.includes(m.id));
            if (!pinned.length) { pins.classList.add('hidden'); return; }
            pins.classList.remove('hidden');
            pins.innerHTML = `${icon('pin')}<span>${pinned.map((m) => esc((m.senderName || '') + ': ' + m.text.slice(0, 60))).join(' · ')}</span>`;
        }

        // ---- messages --------------------------------------------------------
        function msgById(id) { return messages.find((m) => m.id === id); }

        function renderMessages(scrollBottom) {
            const prevTop = msgsEl.scrollTop;
            if (!current) { msgsEl.innerHTML = '<div class="empty">Select a channel</div>'; return; }
            if (!messages.length) { msgsEl.innerHTML = '<div class="empty">No messages yet</div>'; renderPins(); return; }
            let html = '';
            let lastDay = '';
            for (const m of messages) {
                const dk = dayKey(m.createdAt);
                if (dk !== lastDay) {
                    lastDay = dk;
                    const today = dayKey(new Date());
                    html += `<div class="day mlabel">${dk === today ? 'Today' : new Date(m.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>`;
                }
                html += msgHtml(m);
            }
            msgsEl.innerHTML = html;
            wireMessageEvents();
            if (scrollBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
            else msgsEl.scrollTop = prevTop;
            renderPins();
        }

        function msgHtml(m) {
            const mine = String(m.senderId) === String(me.id);
            const sender = directory.find((d) => String(d.id) === String(m.senderId));
            const name = m.senderName || (sender ? sender.name : 'Unknown');
            const reply = m.replyTo ? msgById(m.replyTo) : null;
            const rx = m.reactions && typeof m.reactions === 'object' ? m.reactions : {};
            const rxHtml = Object.entries(rx)
                .filter(([, users]) => (users || []).length)
                .map(([e, users]) => {
                    const inIt = (users || []).map(String).includes(String(me.id));
                    const label = /^[a-z+]+$/.test(e) && GLYPH[e] ? GLYPH[e] + ' ' + e : e;
                    return `<button data-react="${esc(m.id)}" data-e="${esc(e)}" class="${inIt ? 'mine' : ''} num">${esc(label)} ${users.length}</button>`;
                }).join('');
            const editing = editingId === m.id;
            const confirming = confirmingId === m.id;
            // Editing happens in place: a native dialog would throw away the
            // design system and is blocked outright in embedded webviews.
            const textBlock = editing
                ? `<div class="edit-row">
                        <textarea class="edit-in" rows="2">${esc(m.text)}</textarea>
                        <div class="hstack mt8">
                            <button class="btn btn-sm btn-primary" data-editsave="${esc(m.id)}">save</button>
                            <button class="btn btn-sm" data-editcancel="1">cancel</button>
                            <span class="faint small">esc to cancel</span>
                        </div>
                    </div>`
                : `<div class="txt">${linkifyMentions(esc(m.text))}</div>`;
            const delTool = confirming
                ? `<button data-delyes="${esc(m.id)}" class="danger">confirm delete</button><button data-delno="1">keep</button>`
                : (mine ? `<button data-del="${esc(m.id)}">${icon('trash')}</button>` : '');
            return `<div class="msg ${mine ? 'mine' : ''} ${m.pending ? 'pending' : ''} ${editing ? 'editing' : ''} ${confirming ? 'confirming' : ''}" data-mid="${esc(m.id)}">
                ${avatar(name, sender && sender.avatarUrl, presence.has(String(m.senderId)))}
                <div class="body">
                    <div class="who"><b>${esc(name)}</b><time>${esc(fmtTime(m.createdAt))}</time>${m.editedAt && !editing ? '<time>(edited)</time>' : ''}</div>
                    ${reply ? `<div class="s faint" style="font-size:11.5px;border-left:1px solid var(--line);padding-left:8px;margin-bottom:2px">↳ ${esc(reply.senderName || '')}: ${esc(String(reply.text).slice(0, 80))}</div>` : ''}
                    ${textBlock}
                    ${(m.attachments || []).length ? `<div class="hstack mt8" style="flex-wrap:wrap">${m.attachments.map((a) => `<span class="tag">${esc(a.name || 'file')}</span>`).join('')}</div>` : ''}
                    <div class="reacts">${rxHtml}</div>
                    <div class="tools">
                        <button data-reply="${esc(m.id)}">${icon('reply')} reply</button>
                        ${REACTIONS.map((e) => `<button data-react="${esc(m.id)}" data-e="${e}">${GLYPH[e] || e}</button>`).join('')}
                        <button data-pin="${esc(m.id)}">${icon('pin')} pin</button>
                        ${mine && !editing ? `<button data-edit="${esc(m.id)}">${icon('edit')}</button>` : ''}
                        ${delTool}
                    </div>
                </div>
            </div>`;
        }

        function linkifyMentions(safeHtml) {
            return safeHtml.replace(/@([a-z0-9_.]+)/gi, '<span class="tag" style="color:var(--text)">@$1</span>');
        }

        function wireMessageEvents() {
            msgsEl.querySelectorAll('[data-reply]').forEach((b) => {
                b.onclick = () => {
                    replyTo = msgById(b.dataset.reply);
                    const rp = $('.replying');
                    rp.classList.remove('hidden');
                    rp.querySelector('span').textContent = 'Replying to ' + (replyTo.senderName || 'message');
                    $('.composer textarea').focus();
                };
            });
            msgsEl.querySelectorAll('[data-react]').forEach((b) => {
                b.onclick = () => {
                    const mid = b.dataset.react, e = b.dataset.e;
                    const m = msgById(mid);
                    if (m) { // optimistic flip
                        m.reactions = m.reactions || {};
                        const users = (m.reactions[e] || []).map(String);
                        const i = users.indexOf(String(me.id));
                        if (i >= 0) users.splice(i, 1); else users.push(String(me.id));
                        m.reactions[e] = users;
                        renderMessages(false);
                    }
                    client.react(mid, e);
                };
            });
            msgsEl.querySelectorAll('[data-pin]').forEach((b) => {
                b.onclick = async () => {
                    const ids = new Set((current.pinnedMessageIds || []).concat([b.dataset.pin]));
                    current.pinnedMessageIds = [...ids];
                    renderPins();
                    try { await A.api.post(`/api/company/chat/channels/${current.id}/pin`, { messageIds: current.pinnedMessageIds }); } catch (e) {}
                };
            });
            msgsEl.querySelectorAll('[data-edit]').forEach((b) => {
                b.onclick = () => {
                    const m = msgById(b.dataset.edit);
                    if (!m || m.pending) return;
                    editingId = m.id;
                    confirmingId = null;
                    renderMessages(false);
                    const field = msgsEl.querySelector('.edit-in');
                    if (field) {
                        field.style.height = Math.min(field.scrollHeight, 200) + 'px';
                        field.focus();
                        field.selectionStart = field.value.length;
                    }
                };
            });
            const field = msgsEl.querySelector('.edit-in');
            if (field) {
                field.oninput = () => { field.style.height = 'auto'; field.style.height = Math.min(field.scrollHeight, 200) + 'px'; };
                field.onkeydown = (ev) => {
                    if (ev.key === 'Escape') { ev.preventDefault(); editingId = null; renderMessages(false); }
                    else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commitEdit(field); }
                };
            }
            msgsEl.querySelectorAll('[data-editsave]').forEach((b) => {
                b.onclick = () => commitEdit(msgsEl.querySelector('.edit-in'));
            });
            msgsEl.querySelectorAll('[data-editcancel]').forEach((b) => {
                b.onclick = () => { editingId = null; renderMessages(false); };
            });
            msgsEl.querySelectorAll('[data-del]').forEach((b) => {
                b.onclick = () => { confirmingId = b.dataset.del; editingId = null; renderMessages(false); };
            });
            msgsEl.querySelectorAll('[data-delno]').forEach((b) => {
                b.onclick = () => { confirmingId = null; renderMessages(false); };
            });
            msgsEl.querySelectorAll('[data-delyes]').forEach((b) => {
                b.onclick = () => {
                    const m = msgById(b.dataset.delyes);
                    if (!m) return;
                    messages = messages.filter((x) => x.id !== m.id);
                    confirmingId = null;
                    renderMessages(nearBottom());
                    client.del(current.id, m.id);
                };
            });
        }

        function commitEdit(field) {
            const m = msgById(editingId);
            editingId = null;
            if (!field || !m) { renderMessages(false); return; }
            const clean = field.value.trim();
            if (!clean) { renderMessages(false); toast('A message cannot be empty', 'bad'); return; }
            if (clean === m.text) { renderMessages(false); return; }
            m.text = clean;
            m.editedAt = new Date().toISOString();
            renderMessages(false);
            client.edit(m.id, clean);
        }

        // older-page loading on scroll-up (only one page in flight, and we stop
        // asking once the server stops returning anything new)
        msgsEl.addEventListener('scroll', async () => {
            if (loadingOlder || olderExhausted || !current || !messages.length) return;
            if (msgsEl.scrollTop > 24) return;
            loadingOlder = true;
            const first = messages[0];
            const h0 = msgsEl.scrollHeight;
            try {
                const r = await A.api.get(`/api/company/chat/channels/${current.id}/messages?limit=50&beforeId=${first.id}`);
                const older = (r.messages || []).filter((m) => !messages.find((x) => x.id === m.id));
                if (!older.length) { olderExhausted = true; return; }
                messages = older.concat(messages);
                renderMessages(false);
                msgsEl.scrollTop = msgsEl.scrollHeight - h0 + 30;
            } catch (e) { olderExhausted = true; }
            finally { loadingOlder = false; }
        });

        // ---- composer + mentions --------------------------------------------
        const ta = $('.composer textarea');
        const sendBtn = $('.cp-send');

        function currentWord() {
            const v = ta.value, pos = ta.selectionStart;
            const m = /(^|\s)@([\w.]*)$/.exec(v.slice(0, pos));
            return m ? m[2].toLowerCase() : null;
        }
        function mentionCandidates(q) {
            const pool = current && current.members ? current.members.map((mm) => directory.find((d) => String(d.id) === String(mm.staffId))).filter(Boolean) : directory;
            return pool.filter((d) => !q || d.name.toLowerCase().includes(q) || String(d.username || '').toLowerCase().includes(q)).slice(0, 6);
        }
        function closeMx() { const el = $('.mx-pop'); if (el) el.remove(); mxOpen = false; }
        function openMx(q) {
            mxItems = mentionCandidates(q);
            closeMx();
            if (!mxItems.length) return;
            mxOpen = true; mxSel = 0;
            const pop = document.createElement('div');
            pop.className = 'mx-pop';
            const rect = ta.getBoundingClientRect(), rootRect = root.getBoundingClientRect();
            pop.style.left = (rect.left - rootRect.left + 8) + 'px';
            pop.style.bottom = (rootRect.bottom - rect.top + 6) + 'px';
            pop.innerHTML = mxItems.map((d, i) => `<button data-i="${i}" class="${i === 0 ? 'sel' : ''}">${avatar(d.name, d.avatarUrl)}<span>${esc(d.name)}</span><span class="faint" style="margin-left:auto;font:10px var(--mono)">${esc((d.department || '').replace(/_/g, ' '))}</span></button>`).join('');
            root.appendChild(pop);
            pop.querySelectorAll('button').forEach((b) => { b.onmousedown = (ev) => { ev.preventDefault(); pickMention(mxItems[+b.dataset.i]); }; });
        }
        function pickMention(d) {
            const v = ta.value, pos = ta.selectionStart;
            ta.value = v.slice(0, pos).replace(/@([\w.]*)$/, '@' + String(d.username || d.name.split(' ')[0]).toLowerCase() + ' ') + v.slice(pos);
            closeMx();
            ta.focus();
        }
        ta.addEventListener('input', () => {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
            const q = currentWord();
            if (q !== null) openMx(q); else closeMx();
            if (current && Date.now() - typingSentAt > 3000) { typingSentAt = Date.now(); client.typing(current.id); }
        });
        ta.addEventListener('keydown', (ev) => {
            if (mxOpen) {
                if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                    ev.preventDefault();
                    mxSel = (mxSel + (ev.key === 'ArrowDown' ? 1 : -1) + mxItems.length) % mxItems.length;
                    root.querySelectorAll('.mx-pop button').forEach((b, i) => b.classList.toggle('sel', i === mxSel));
                    return;
                }
                if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); pickMention(mxItems[mxSel]); return; }
                if (ev.key === 'Escape') { closeMx(); return; }
            }
            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); doSend(); }
        });
        $('.rp-x').onclick = () => { replyTo = null; $('.replying').classList.add('hidden'); };
        sendBtn.onclick = doSend;

        async function doSend() {
            const text = ta.value.trim();
            if (!text || !current) return;
            ta.value = ''; ta.style.height = 'auto';
            closeMx();
            const local = {
                id: 'tmp_' + Date.now(), channelId: current.id, senderId: me.id,
                senderName: me.name || me.fullName, text, replyTo: replyTo ? replyTo.id : null,
                reactions: {}, attachments: [], createdAt: new Date().toISOString(), pending: true
            };
            messages.push(local);
            replyTo = null; $('.replying').classList.add('hidden');
            renderMessages(true);
            const sent = await client.send(current.id, local.text, local.replyTo);
            const i = messages.findIndex((x) => x.id === local.id);
            if (sent && sent.id && i >= 0) messages[i] = sent;
            else if (i >= 0) messages.splice(i, 1);
            else if (sent && sent.id) messages.push(sent);
            if (!sent) toast('Message failed to send', 'bad');
            renderMessages(false);
            msgsEl.scrollTop = msgsEl.scrollHeight;
        }

        // ---- typing indicator --------------------------------------------------
        let typingTimer = null;
        function showTyping() {
            clearInterval(typingTimer);
            typingTimer = setInterval(() => {
                const el = $('.typing');
                if (!el) return;
                const nowT = Date.now();
                const names = Object.entries(typingUsers).filter(([, exp]) => exp > nowT).map(([id]) => {
                    const d = directory.find((x) => String(x.id) === id);
                    return d ? d.name.split(' ')[0] : null;
                }).filter(Boolean);
                el.textContent = names.length ? names.slice(0, 3).join(', ') + (names.length > 1 ? ' are typing' : ' is typing') + '…' : '';
            }, 900);
        }

        // ---- live frame handler (pages pipe every ws frame here) --------------
        function handleFrame(m) {
            if (m.t === 'presence') {
                presence = new Set((m.on || []).map(String));
                renderMessages(false);
                renderRail();
                return;
            }
            if (m.t === 'mention' && current && m.c !== current.id) {
                toast((m.from || 'Someone') + ' mentioned you', '');
                reloadChannels();
                return;
            }
            if (m.t === 'down') { toast('Chat socket unavailable — messages send via fallback', 'bad'); return; }
            if (!current) return;
            if (m.t === 'msg' && m.message && String(m.message.channelId) === String(current.id)) {
                if (!messages.find((x) => x.id === m.message.id)) {
                    const isMineTmp = messages.some((x) => x.pending && x.text === m.message.text && String(x.senderId) === String(m.message.senderId));
                    if (isMineTmp) messages = messages.map((x) => (x.text === m.message.text && x.pending ? m.message : x));
                    else messages.push(m.message);
                    renderMessages(m.message.senderId && String(m.message.senderId) === String(me.id) ? true : nearBottom());
                    if (nearBottom()) client.read(current.id);
                }
            } else if (m.t === 'msg') {
                unread[m.message.channelId] = (unread[m.message.channelId] || 0) + 1;
                renderRail();
            } else if (m.t === 'typing' && m.c === current.id && String(m.from) !== String(me.id)) {
                typingUsers[m.from] = Date.now() + 4000;
            } else if (m.t === 'sub:ok' && m.c === current.id) {
                const merged = new Map(messages.map((x) => [x.id, x]));
                (m.messages || []).forEach((x) => merged.set(x.id, x));
                (m.backfill || []).forEach((x) => merged.set(x.id, x));
                messages = [...merged.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                renderMessages(true);
            } else if (m.t === 'reaction' && m.m) {
                const msg = msgById(m.m);
                if (msg) { msg.reactions = msg.reactions || {}; if ((m.users || []).length) msg.reactions[m.e] = m.users; else delete msg.reactions[m.e]; renderMessages(nearBottom()); }
            } else if (m.t === 'edited') {
                const msg = msgById(m.m);
                if (msg) { msg.text = m.text; msg.editedAt = m.editedAt || new Date().toISOString(); renderMessages(nearBottom()); }
            } else if (m.t === 'deleted') {
                messages = messages.filter((x) => x.id !== m.m);
                renderMessages(nearBottom());
            }
        }
        function nearBottom() { return msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120; }

        // ---- new channel (rail-side creator, no native dialogs) --------------
        function peopleMatches(q) {
            const s = q.trim().toLowerCase();
            return (d) => !s || String(d.name || '').toLowerCase().includes(s) || String(d.username || '').toLowerCase().includes(s);
        }
        function personRow(d) {
            return `<div class="nc-row ${picks.has(String(d.id)) ? 'on' : ''}" data-pick="${esc(d.id)}">
                <span class="box">${icon('check')}</span>
                ${avatar(d.name, d.avatarUrl, presence.has(String(d.id)))}
                <span class="nm">${esc(d.name)}<span class="dept">${esc((d.department || '').replace(/_/g, ' '))}</span></span>
                <button class="dm" data-dm="${esc(d.id)}">dm</button>
            </div>`;
        }
        function renderCreate() {
            if (!railList) return Promise.resolve();
            if (!directory.length && opts.refreshDirectory) {
                // the page may not have loaded a directory yet in console mode
                return opts.refreshDirectory()
                    .then((l) => { if (l && l.length) directory = l; })
                    .catch(() => {})
                    .then(renderCreateBody);
            }
            return renderCreateBody();
        }
        function renderCreateBody() {
            const people = directory.filter((d) => String(d.id) !== String(me.id) && peopleMatches(peopleQuery)(d));
            railList.classList.add('creating');
            railList.innerHTML = `
                <div class="nc-block">
                    <label class="mlabel">Group name</label>
                    <input class="nc-name mt8" maxlength="80" placeholder="Festive drop war room" value="${esc(nameDraft)}">
                </div>
                <div class="search nc-block">
                    ${icon('search')}<input class="nc-filter" placeholder="Find people"
                        style="padding-left:30px;font-size:12px" value="${esc(peopleQuery)}">
                </div>
                <div class="nc-people">${people.map(personRow).join('') || '<div class="empty small" style="padding:18px 0">No matching staff</div>'}</div>
                <div class="nc-foot hstack">
                    <button class="btn btn-sm btn-primary nc-create" ${picks.size ? '' : 'disabled'}>Create group</button>
                    <button class="btn btn-sm nc-cancel">Cancel</button>
                </div>`;
            const nameEl = railList.querySelector('.nc-name');
            const filterEl2 = railList.querySelector('.nc-filter');
            const createBtn = railList.querySelector('.nc-create');
            if (nameEl) nameEl.oninput = () => { nameDraft = nameEl.value; };
            // filtering hides rows in place so the input keeps focus while typing
            if (filterEl2) filterEl2.oninput = () => {
                peopleQuery = filterEl2.value;
                const test = peopleMatches(peopleQuery);
                railList.querySelectorAll('.nc-row').forEach((r) => {
                    const d = directory.find((x) => String(x.id) === r.dataset.pick);
                    r.classList.toggle('hidden', !(d && test(d)));
                });
            };
            railList.querySelectorAll('.nc-row').forEach((row) => {
                row.onclick = (ev) => {
                    const dmBtn = ev.target.closest('[data-dm]');
                    if (dmBtn) return openDirect(dmBtn.dataset.dm);
                    const id = String(row.dataset.pick);
                    if (picks.has(id)) picks.delete(id); else picks.add(id);
                    row.classList.toggle('on', picks.has(id));
                    if (createBtn) createBtn.disabled = !picks.size || creatingBusy;
                };
            });
            if (createBtn) createBtn.onclick = createGroup;
            const cancelBtn = railList.querySelector('.nc-cancel');
            if (cancelBtn) cancelBtn.onclick = () => { creating = false; railList.classList.remove('creating'); renderRail(); };
            if (nameEl && !nameDraft) nameEl.focus();
        }
        async function createGroup() {
            if (creatingBusy) return;
            const name = nameDraft.trim();
            if (!name) return toast('Name the group first', 'bad');
            if (!picks.size) return toast('Select at least one member', 'bad');
            creatingBusy = true;
            const btn = railList.querySelector('.nc-create');
            if (btn) btn.disabled = true;
            try {
                const r = await A.api.post('/api/company/chat/channels', { type: 'group', name, staffIds: [...picks] });
                creating = false; creatingBusy = false;
                nameDraft = ''; peopleQuery = ''; picks = new Set();
                railList.classList.remove('creating');
                await reloadChannels();
                if (r.channel) openChannel(r.channel);
                toast('Group channel created', 'good');
            } catch (e) {
                creatingBusy = false;
                if (btn) btn.disabled = !picks.size;
                toast(e.message, 'bad');
            }
        }
        async function openDirect(staffId) {
            try {
                const r = await A.api.post('/api/company/chat/channels', { type: 'direct', staffIds: [staffId] });
                creating = false; picks = new Set(); nameDraft = ''; peopleQuery = '';
                railList.classList.remove('creating');
                await reloadChannels();
                if (r.channel) openChannel(r.channel);
            } catch (e) { toast(e.message, 'bad'); }
        }
        const newBtn = $('.ch-new');
        if (newBtn) newBtn.onclick = () => {
            creating = !creating;
            newBtn.classList.toggle('active', creating);
            if (creating) renderCreate();
            else { railList.classList.remove('creating'); renderRail(); }
        };
        const filterEl = $('.ch-filter');
        if (filterEl) filterEl.oninput = renderRail;

        return {
            reloadChannels,
            openChannel,
            handleFrame,
            setDirectory(list) { directory = list; if (creating) renderCreate(); else renderRail(); },
            currentChannel() { return current; },
            destroy() { clearInterval(typingTimer); if (current) client.unsub(current.id); }
        };
    }

    global.mountChat = mountChat;
})(window);
