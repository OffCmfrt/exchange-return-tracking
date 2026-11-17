/**
 * Product Lab - Database Helpers
 *
 * Doc-style storage for the OFFCOMFRT Product Lab (pl_* tables). Each of the
 * 16 client collections lives in a table shaped (id text PK, pid text,
 * data jsonb, updated_at timestamptz) so the browser app can keep its
 * whole-record put()/del() semantics: a record is stored as {id, ...data}
 * and travels over the API unchanged.
 *
 * Sign-in model: the Founder authenticates with the server's ADMIN_PASSWORD
 * (never stored in these tables); everyone else gets a row in pl_users with a
 * scrypt password hash, created by the Founder from the Setup page.
 *
 * Sync model: the client loads GET /snapshot once, then polls
 * GET /changes?since=<watermark>. Upserts come from updated_at > since;
 * deletes come from pl_tombstones (deleted_at > since).
 */

const crypto = require('crypto');
const supabase = require('./supabase');

// client collection name -> table name
const COLLS = ['products', 'milestones', 'tasks', 'approvals', 'activity', 'config',
    'samples', 'fabrics', 'trims', 'suppliers', 'ideas', 'costsheets', 'qc',
    'hires', 'expenses', 'experiments'];
const PAGE = 1000; // PostgREST silently caps at 1000 rows -> page with .range()

function table(coll) {
    if (COLLS.indexOf(coll) === -1) throw new Error('Unknown collection: ' + coll);
    return 'pl_' + coll;
}

function toRecord(row) {
    return Object.assign({ id: row.id }, row.data || {});
}

// Reads every row of a table into map, paging in PAGE-size chunks.
// Returns the max updated_at seen (ISO string or null).
async function loadAll(coll, map) {
    const tbl = table(coll);
    let from = 0, maxAt = null;
    for (;;) {
        const { data, error } = await supabase
            .from(tbl)
            .select('id,data,updated_at')
            .order('updated_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw new Error(tbl + ': ' + error.message);
        (data || []).forEach(row => {
            map[row.id] = toRecord(row);
            if (row.updated_at && (!maxAt || row.updated_at > maxAt)) maxAt = row.updated_at;
        });
        if (!data || data.length < PAGE) break;
        from += PAGE;
    }
    return maxAt;
}

// Full workspace state: { collections: {coll: {id: record}}, since: ISO }
async function getSnapshot() {
    const collections = {};
    let since = null;
    for (const coll of COLLS) {
        const map = {};
        const maxAt = await loadAll(coll, map);
        collections[coll] = map;
        if (maxAt && (!since || maxAt > since)) since = maxAt;
    }
    // Watermark slightly in the future is fine — re-sent upserts are idempotent,
    // but rows committed during the paginated read must never be missed.
    const { data: tombRows } = await supabase.from('pl_tombstones').select('deleted_at');
    (tombRows || []).forEach(t => { if (t.deleted_at && (!since || t.deleted_at > since)) since = t.deleted_at; });
    return { collections, since: new Date().toISOString() };
}

// Delta since a watermark: { upserts: {coll: {id: record}}, deletes: {coll: [ids]}, since: ISO }
async function getChanges(sinceIso) {
    const since = new Date(sinceIso);
    if (isNaN(since.getTime())) throw new Error('Invalid since watermark');
    const sinceStr = since.toISOString();
    const upserts = {}, deletes = {};
    let maxAt = sinceStr;
    for (const coll of COLLS) {
        const tbl = table(coll);
        const map = {};
        let from = 0;
        for (;;) {
            const { data, error } = await supabase
                .from(tbl)
                .select('id,data,updated_at')
                .gt('updated_at', sinceStr)
                .order('updated_at', { ascending: true })
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw new Error(tbl + ': ' + error.message);
            (data || []).forEach(row => {
                map[row.id] = toRecord(row);
                if (row.updated_at > maxAt) maxAt = row.updated_at;
            });
            if (!data || data.length < PAGE) break;
            from += PAGE;
        }
        upserts[coll] = map;
    }
    // tombstones (paged the same way)
    let from = 0;
    for (;;) {
        const { data, error } = await supabase
            .from('pl_tombstones')
            .select('collection,record_id,deleted_at')
            .gt('deleted_at', sinceStr)
            .order('deleted_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        if (error) throw new Error('pl_tombstones: ' + error.message);
        (data || []).forEach(t => {
            if (COLLS.indexOf(t.collection) === -1) return;
            if (!deletes[t.collection]) deletes[t.collection] = [];
            if (deletes[t.collection].indexOf(t.record_id) === -1) deletes[t.collection].push(t.record_id);
            if (t.deleted_at > maxAt) maxAt = t.deleted_at;
        });
        if (!data || data.length < PAGE) break;
        from += PAGE;
    }
    return { upserts, deletes, since: new Date().toISOString() };
}

// Whole-record upsert. record = {id, ...fields}; pid lifted for indexing.
async function putRecord(coll, record) {
    const tbl = table(coll);
    if (!record || typeof record.id !== 'string' || !record.id) throw new Error('record.id is required');
    const data = Object.assign({}, record);
    delete data.id;
    const { error } = await supabase.from(tbl).upsert({
        id: record.id,
        pid: String(record.pid != null ? record.pid : record.id),
        data: data,
        updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) throw new Error(tbl + ' upsert: ' + error.message);
    return true;
}

// Hard delete + tombstone so polling clients can see the removal.
async function deleteRecord(coll, id) {
    const tbl = table(coll);
    if (!id || typeof id !== 'string') throw new Error('id is required');
    const { error } = await supabase.from(tbl).delete().eq('id', id);
    if (error) throw new Error(tbl + ' delete: ' + error.message);
    const { error: terr } = await supabase.from('pl_tombstones').insert({
        id: coll + ':' + id + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8),
        collection: coll,
        record_id: id,
        deleted_at: new Date().toISOString()
    });
    if (terr) throw new Error('pl_tombstones insert: ' + terr.message);
    return true;
}

// Backup import: wipe every pl_* table, then insert the payload collections.
// payload = { collections: {coll: {id: record}}, ... } (the client's export shape)
async function replaceWorkspace(payload) {
    const collections = (payload && payload.collections) || payload || {};
    // validate before touching anything
    for (const coll of Object.keys(collections)) {
        if (COLLS.indexOf(coll) === -1) throw new Error('Unknown collection: ' + coll);
        const map = collections[coll];
        if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(coll + ': expected an object of records');
    }
    for (const coll of COLLS) { // clear
        const { error } = await supabase.from(table(coll)).delete().neq('id', '');
        if (error) throw new Error(table(coll) + ' clear: ' + error.message);
    }
    const { error: tombErr } = await supabase.from('pl_tombstones').delete().neq('id', '');
    if (tombErr) throw new Error('pl_tombstones clear: ' + tombErr.message);
    const now = new Date().toISOString();
    for (const coll of Object.keys(collections)) { // insert
        const tbl = table(coll);
        const rows = Object.values(collections[coll] || {})
            .filter(rec => rec && typeof rec.id === 'string' && rec.id)
            .map(rec => {
                const data = Object.assign({}, rec);
                delete data.id;
                return { id: rec.id, pid: String(rec.pid != null ? rec.pid : rec.id), data: data, updated_at: now };
            });
        for (let i = 0; i < rows.length; i += 200) {
            const { error } = await supabase.from(tbl).upsert(rows.slice(i, i + 200), { onConflict: 'id' });
            if (error) throw new Error(tbl + ' insert: ' + error.message);
        }
    }
    return { imported: Object.keys(collections).reduce((n, c) => n + Object.keys(collections[c] || {}).length, 0) };
}

// ---------------------------------------------------------------------------
// Sign-in accounts (pl_users). The Founder is not a row here: they sign in
// with the server's ADMIN_PASSWORD and is the only one allowed to manage
// these credentials.
// ---------------------------------------------------------------------------
const USER_COLS = 'id,email,name,role,person_id,active,created_at';

function hashPassword(password, salt) {
    const s = salt || crypto.randomBytes(16).toString('hex');
    return { salt: s, hash: crypto.scryptSync(String(password), s, 32).toString('hex') };
}

function safeEqualHex(a, b) {
    const x = Buffer.from(String(a || ''), 'hex');
    const y = Buffer.from(String(b || ''), 'hex');
    if (x.length !== y.length || !x.length) return false;
    return crypto.timingSafeEqual(x, y);
}

function toUser(row) {
    return { id: row.id, email: row.email, name: row.name, role: row.role || 'member', personId: row.person_id || null, active: row.active !== false, createdAt: row.created_at };
}

async function listUsers() {
    const { data, error } = await supabase.from('pl_users').select(USER_COLS).order('email', { ascending: true });
    if (error) throw new Error('pl_users: ' + error.message);
    return (data || []).map(toUser);
}

async function findUserByEmail(email) {
    const needle = String(email || '').trim().toLowerCase();
    if (!needle) return null;
    const { data, error } = await supabase.from('pl_users')
        .select(USER_COLS + ',pw_hash,pw_salt').ilike('email', needle).limit(1);
    if (error) throw new Error('pl_users lookup: ' + error.message);
    return data && data.length ? data[0] : null;
}

async function findUserById(id) {
    if (!id) return null;
    const { data, error } = await supabase.from('pl_users')
        .select(USER_COLS + ',pw_hash,pw_salt').eq('id', String(id)).limit(1);
    if (error) throw new Error('pl_users lookup: ' + error.message);
    return data && data.length ? data[0] : null;
}

// Returns the public user shape on success, null on a bad password / unknown
// email / deactivated account. Never distinguishes the reason to the caller.
async function verifyUser(email, password) {
    const row = await findUserByEmail(email);
    if (!row || row.active === false) return null;
    if (!row.pw_hash || !row.pw_salt) return null;
    const attempt = hashPassword(password, row.pw_salt).hash;
    if (!safeEqualHex(attempt, row.pw_hash)) return null;
    return toUser(row);
}

// Create when id is new, update in place when it exists. password is optional
// on update: blank keeps the current hash, a value replaces it.
async function upsertUser(user) {
    if (!user || !user.email) throw new Error('email is required');
    const email = String(user.email).trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address');
    const row = { id: user.id || ('u-' + crypto.randomBytes(6).toString('hex')),
        email: email,
        name: String(user.name || email.split('@')[0]).slice(0, 120),
        role: String(user.role || 'member').slice(0, 40),
        person_id: user.personId ? String(user.personId).slice(0, 60) : null,
        active: user.active !== false,
        updated_at: new Date().toISOString() };
    if (user.password && String(user.password).length >= 6) {
        const h = hashPassword(user.password);
        row.pw_hash = h.hash; row.pw_salt = h.salt;
    } else if (user.password) {
        throw new Error('Password must be at least 6 characters');
    }
    if (!row.pw_hash) { // an existing account may keep its current password, a new one can't
        const existing = user.id ? await findUserById(user.id) : await findUserByEmail(email);
        if (!existing || !existing.pw_hash) throw new Error('A password of at least 6 characters is required');
    }
    const { error } = await supabase.from('pl_users').upsert(row, { onConflict: 'id' });
    if (error) {
        // a second account claiming the same email surfaces as a unique violation
        throw new Error(/duplicate key/i.test(error.message) ? 'That email already has a sign-in' : 'pl_users upsert: ' + error.message);
    }
    // drop any other row that had this email (id changed hands)
    const others = (await listUsers()).filter(u => u.email === email && u.id !== row.id);
    for (const o of others) await deleteUser(o.id);
    return toUser({ id: row.id, email: row.email, name: row.name, role: row.role, person_id: row.person_id, active: row.active, created_at: null });
}

async function deleteUser(id) {
    if (!id) throw new Error('id is required');
    const { error } = await supabase.from('pl_users').delete().eq('id', id);
    if (error) throw new Error('pl_users delete: ' + error.message);
    return true;
}

module.exports = { COLLS, getSnapshot, getChanges, putRecord, deleteRecord, replaceWorkspace,
    listUsers, upsertUser, deleteUser, verifyUser };
