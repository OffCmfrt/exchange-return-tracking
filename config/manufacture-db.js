/**
 * Manufacture Control Tower - Database Helpers
 *
 * All database operations for the product-development workspace
 * (manufacturers, mfr_tech_packs, mfr_samples, mfr_production_orders).
 * Isolated module (same pattern as marketing-db-helpers.js) so it never
 * touches return/exchange logic. Uses the shared Supabase client.
 *
 * Rows are stored snake_case in Postgres and surfaced camelCase to the
 * frontends so they match the control-tower UI data model exactly.
 */

const supabase = require('./supabase');

// ---------------------------------------------------------------------------
// Table schemas: column name -> type. Types: 'int', 'num', 'bool', 'date',
// 'json', 'text' (default).
// ---------------------------------------------------------------------------
const TABLES = {
    manufacturers: {
        table: 'manufacturers',
        columns: {
            name: 'text', location: 'text', contact: 'text', phone: 'text', email: 'text',
            categories: 'text', fabric_capabilities: 'text', moq: 'text',
            sample_lead_time: 'text', bulk_lead_time: 'text',
            quality_rating: 'int', communication_rating: 'int', notes: 'text',
            portal_access: 'bool', link_token: 'text', portal_password: 'text'
        }
    },
    techPacks: {
        table: 'mfr_tech_packs',
        columns: {
            sku: 'text', product: 'text', version: 'text', status: 'text', link: 'text',
            created_by: 'text', created_date: 'date',
            sent_to_manufacturer: 'bool', manufacturer_acknowledged: 'bool',
            manufacturer_questions: 'text', revision_required: 'bool',
            final_approved: 'bool', approved_date: 'date', notes: 'text'
        }
    },
    samples: {
        table: 'mfr_samples',
        columns: {
            sku: 'text', product: 'text', category: 'text', version: 'text', type: 'text',
            request_date: 'date', target_date: 'date',
            manufacturer: 'text', manufacturer_contact: 'text',
            fabric: 'text', gsm: 'int', composition: 'text', color: 'text', size: 'text', fit: 'text',
            tech_pack_id: 'text', ref_link: 'text', cost: 'json',
            courier_awb: 'text', date_sent: 'date', date_received: 'date',
            status: 'text', stage: 'text',
            mfr_update: 'text', feedback: 'text', changes_required: 'text',
            next_action: 'text', action_owner: 'text', waiting_on: 'text', next_due: 'date',
            approval_status: 'text', approved_by: 'text', approval_date: 'date',
            final_decision: 'text', notes: 'text',
            qc: 'json', revisions: 'json', comms: 'json', files: 'json'
        }
    },
    orders: {
        table: 'mfr_production_orders',
        columns: {
            sample_id: 'text', sku: 'text', product: 'text', category: 'text',
            manufacturer: 'text', manufacturer_contact: 'text',
            po_date: 'date', expected_delivery: 'date', actual_delivery: 'date',
            breakdown: 'json', unit_price: 'num', advance_paid: 'num', payment_status: 'text',
            current_stage: 'text', action_owner: 'text', waiting_on: 'text',
            next_action: 'text', next_action_due: 'date',
            shipping_method: 'text', tracking_number: 'text', notes: 'text',
            qc: 'json', comms: 'json', files: 'json'
        }
    }
};

const camelize = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snakeify = (s) => s.replace(/([A-Z])/g, (c) => '_' + c.toLowerCase());

// Kinds whose tables carry an updated_at column (manufacturers doesn't)
const HAS_UPDATED_AT = new Set(['techPacks', 'samples', 'orders']);

// Convert a Postgres row -> UI shape (camelCase, normalized scalars)
function toUi(row, kind) {
    if (!row) return null;
    const cols = TABLES[kind].columns;
    const out = { id: row.id };
    for (const [col, type] of Object.entries(cols)) {
        let v = row[col];
        if (v == null) { out[camelize(col)] = type === 'json' ? (col === 'cost' ? {} : []) : null; continue; }
        if (type === 'int') v = parseInt(v, 10) || 0;
        else if (type === 'num') v = Number(v) || 0;
        else if (type === 'bool') v = !!v;
        else if (type === 'date') v = String(v).slice(0, 10);
        out[camelize(col)] = v;
    }
    return out;
}

// Convert a UI record -> Postgres row (snake_case, coerced scalars).
// Only known columns are written; id is handled by the caller.
function toDb(kind, record, { partial = false } = {}) {
    const cols = TABLES[kind].columns;
    const row = {};
    for (const key of Object.keys(record)) {
        const col = snakeify(key);
        const type = cols[col];
        if (!type) continue; // unknown field — ignore
        let v = record[key];
        if (v === '' && type !== 'json') v = null;
        if (v == null && type === 'json') v = col === 'cost' ? {} : [];
        else if (type === 'int' && v != null) v = parseInt(v, 10) || 0;
        else if (type === 'num' && v != null) v = Number(v) || 0;
        else if (type === 'bool') v = !!v;
        else if (type === 'date' && v) v = String(v).slice(0, 10);
        row[col] = v;
    }
    if (!partial && HAS_UPDATED_AT.has(kind)) row.updated_at = new Date().toISOString();
    return row;
}

// ---------------------------------------------------------------------------
// Generic CRUD (all tables upsert/delete on `id`)
// ---------------------------------------------------------------------------
async function list(kind, { eq } = {}) {
    let query = supabase.from(TABLES[kind].table).select('*');
    if (eq) query = query.eq(eq.column, eq.value);
    const order = kind === 'manufacturers'
        ? ['name', { ascending: true }]
        : ['created_at', { ascending: false }];
    const { data, error } = await query.order(order[0], order[1]).limit(1000);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, kind));
}

async function getById(kind, id, { eq } = {}) {
    let query = supabase.from(TABLES[kind].table).select('*').eq('id', id);
    if (eq) query = query.eq(eq.column, eq.value);
    const { data, error } = await query.single();
    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return toUi(data, kind);
}

// Insert (generates uuid id for manufacturers)
async function insert(kind, record) {
    const row = toDb(kind, record);
    if (kind !== 'manufacturers' && record.id) row.id = String(record.id).trim();
    const { data, error } = await supabase.from(TABLES[kind].table).insert(row).select().single();
    if (error) throw error;
    return toUi(data, kind);
}

// Upsert on id (used by both admin PUT and manufacturer PATCH)
async function upsert(kind, id, rowPartial) {
    if (HAS_UPDATED_AT.has(kind)) rowPartial.updated_at = new Date().toISOString();
    const { data, error } = await supabase
        .from(TABLES[kind].table)
        .upsert({ id, ...rowPartial }, { onConflict: 'id' })
        .select()
        .single();
    if (error) throw error;
    return toUi(data, kind);
}

async function remove(kind, id) {
    const { error } = await supabase.from(TABLES[kind].table).delete().eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Portal links (each manufacturer with portal_access gets a private
// ?token=... link, same pattern as influencer portals)
// ---------------------------------------------------------------------------

// Manufacturer owning a portal link token (only active links resolve)
async function getByLinkToken(token) {
    if (!token) return null;
    const { data, error } = await supabase
        .from('manufacturers')
        .select('*')
        .eq('link_token', token)
        .eq('portal_access', true)
        .maybeSingle();
    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return toUi(data, 'manufacturers');
}

// ---------------------------------------------------------------------------
// Workspace loaders (exact shape the control-tower UI expects)
// ---------------------------------------------------------------------------
async function getWorkspace() {
    const [samples, manufacturers, techPacks, productionOrders] = await Promise.all([
        list('samples'), list('manufacturers'), list('techPacks'), list('orders')
    ]);
    return { samples, manufacturers, techPacks, productionOrders };
}

// Manufacturer-scoped workspace: only their samples/orders, plus tech packs
// (shared reference docs) and their own directory entry.
async function getManufacturerWorkspace(manufacturerName) {
    const eq = { column: 'manufacturer', value: manufacturerName };
    const [samples, productionOrders, techPacks, allMfrs] = await Promise.all([
        list('samples', { eq }), list('orders', { eq }), list('techPacks'), list('manufacturers')
    ]);
    const self = allMfrs.find((m) => m.name === manufacturerName) || null;
    if (self) { delete self.linkToken; delete self.portalPassword; }
    return { samples, productionOrders, techPacks, manufacturer: self, manufacturerName };
}

module.exports = {
    TABLES,
    toUi,
    toDb,
    list,
    getById,
    insert,
    upsert,
    remove,
    getByLinkToken,
    getWorkspace,
    getManufacturerWorkspace
};
