/**
 * Manufacture Studio - Database Helpers
 *
 * All database operations for the manufacture_designs table.
 * Isolated module (same pattern as marketing-db-helpers.js) so it never
 * touches return/exchange logic. Uses the shared Supabase client.
 */

const supabase = require('./supabase');

const VALID_STATUSES = ['pending', 'approved', 'in_production', 'completed', 'rejected'];

// List designs, newest first (optional status filter)
async function listDesigns(filters = {}) {
    let query = supabase.from('manufacture_designs').select('*');

    if (filters.status && VALID_STATUSES.includes(filters.status)) {
        query = query.eq('status', filters.status);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function getDesignById(id) {
    const { data, error } = await supabase
        .from('manufacture_designs')
        .select('*')
        .eq('id', id)
        .single();
    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

async function createDesign(design) {
    const row = {
        design_name: design.design_name,
        style_code: design.style_code || null,
        description: design.description || null,
        quantity: design.quantity,
        deadline: design.deadline
    };
    const { data, error } = await supabase
        .from('manufacture_designs')
        .insert(row)
        .select()
        .single();
    if (error) throw error;
    return data;
}

// Manufacturer edits content fields only — status/admin_note are admin-owned
async function updateDesign(id, design) {
    const row = { updated_at: new Date().toISOString() };
    if (design.design_name !== undefined) row.design_name = design.design_name;
    if (design.style_code !== undefined) row.style_code = design.style_code || null;
    if (design.description !== undefined) row.description = design.description || null;
    if (design.quantity !== undefined) row.quantity = design.quantity;
    if (design.deadline !== undefined) row.deadline = design.deadline;

    const { data, error } = await supabase
        .from('manufacture_designs')
        .update(row)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

async function deleteDesign(id) {
    const { error } = await supabase.from('manufacture_designs').delete().eq('id', id);
    if (error) throw error;
}

// Admin-only: change production status and optional note
async function updateStatus(id, status, adminNote) {
    const row = { status, updated_at: new Date().toISOString() };
    if (adminNote !== undefined) row.admin_note = adminNote || null;

    const { data, error } = await supabase
        .from('manufacture_designs')
        .update(row)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

module.exports = {
    VALID_STATUSES,
    listDesigns,
    getDesignById,
    createDesign,
    updateDesign,
    deleteDesign,
    updateStatus
};
