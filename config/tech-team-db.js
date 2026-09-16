/**
 * Tech Team Portal - Database Helpers
 *
 * All database operations for the tech team task management system
 * (tech_team_members, tech_tasks). Follows the same pattern as
 * manufacture-db.js: snake_case in Postgres, camelCase to the UI.
 */

const supabase = require('./supabase');

// ---------------------------------------------------------------------------
// Table schemas
// ---------------------------------------------------------------------------
const TABLES = {
    members: {
        table: 'tech_team_members',
        columns: {
            username: 'text',
            full_name: 'text',
            mobile: 'text',
            email: 'text',
            role: 'text',
            department: 'text',
            hierarchy: 'text',
            reports_to: 'text',
            skills: 'json',
            avatar_url: 'text',
            active: 'bool'
        }
    },
    tasks: {
        table: 'tech_tasks',
        columns: {
            title: 'text',
            description: 'text',
            status: 'text',
            priority: 'text',
            assigned_to: 'text',
            created_by: 'text',
            project: 'text',
            department: 'text',
            category: 'text',
            due_date: 'date',
            progress: 'int',
            estimated_hours: 'int',
            actual_hours: 'int',
            parent_task_id: 'text',
            sort_order: 'int',
            tags: 'json',
            notes: 'json'
        }
    }
};

const camelize = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snakeify = (s) => s.replace(/([A-Z])/g, (c) => '_' + c.toLowerCase());

// Convert a Postgres row -> UI shape (camelCase, normalized scalars)
function toUi(row, kind) {
    if (!row) return null;
    const cols = TABLES[kind].columns;
    const out = { id: row.id };
    for (const [col, type] of Object.entries(cols)) {
        let v = row[col];
        if (v == null) {
            out[camelize(col)] = type === 'json' ? [] : null;
            continue;
        }
        if (type === 'int') v = parseInt(v, 10) || 0;
        else if (type === 'bool') v = !!v;
        else if (type === 'date') v = String(v).slice(0, 10);
        out[camelize(col)] = v;
    }
    // Also include created_at / updated_at for tasks
    if (row.created_at) out.createdAt = row.created_at;
    if (row.updated_at) out.updatedAt = row.updated_at;
    return out;
}

// Convert a UI record -> Postgres row (snake_case, coerced scalars)
function toDb(kind, record, { partial = false } = {}) {
    const cols = TABLES[kind].columns;
    const row = {};
    for (const key of Object.keys(record)) {
        if (key === 'id') continue;
        const col = snakeify(key);
        const type = cols[col];
        if (!type) continue;
        let v = record[key];
        if (v === '' && type !== 'json') v = null;
        if (v == null && type === 'json') v = [];
        else if (type === 'int' && v != null) v = parseInt(v, 10) || 0;
        else if (type === 'bool') v = !!v;
        else if (type === 'date' && v) v = String(v).slice(0, 10);
        row[col] = v;
    }
    if (!partial && kind === 'tasks') row.updated_at = new Date().toISOString();
    return row;
}

// ---------------------------------------------------------------------------
// Members CRUD
// ---------------------------------------------------------------------------
async function listTeamMembers({ activeOnly = false } = {}) {
    let query = supabase.from('tech_team_members').select('*');
    if (activeOnly) query = query.eq('active', true);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'members'));
}

async function getTeamMember(id) {
    const { data, error } = await supabase.from('tech_team_members').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return toUi(data, 'members');
}

async function getTeamMemberByLogin(username, mobile) {
    const { data, error } = await supabase
        .from('tech_team_members')
        .select('*')
        .eq('username', String(username).trim().toLowerCase())
        .eq('mobile', String(mobile).trim())
        .eq('active', true)
        .maybeSingle();
    if (error) throw error;
    return toUi(data, 'members');
}

async function createTeamMember(record) {
    const row = toDb('members', record);
    if (row.username) row.username = String(row.username).trim().toLowerCase();
    const { data, error } = await supabase.from('tech_team_members').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'members');
}

async function updateTeamMember(id, record) {
    const row = toDb('members', record, { partial: true });
    if (row.username) row.username = String(row.username).trim().toLowerCase();
    const { data, error } = await supabase
        .from('tech_team_members')
        .update(row)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return toUi(data, 'members');
}

async function deleteTeamMember(id) {
    // Soft delete: set active = false
    const { error } = await supabase
        .from('tech_team_members')
        .update({ active: false })
        .eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Tasks CRUD
// ---------------------------------------------------------------------------
async function listTasks(filters = {}) {
    let query = supabase.from('tech_tasks').select('*');
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
    if (filters.project) query = query.eq('project', filters.project);
    if (filters.priority) query = query.eq('priority', filters.priority);
    if (filters.department) query = query.eq('department', filters.department);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.parentTaskId) query = query.eq('parent_task_id', filters.parentTaskId);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'tasks'));
}

async function getTask(id) {
    const { data, error } = await supabase.from('tech_tasks').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return toUi(data, 'tasks');
}

async function getMemberTasks(memberId) {
    const { data, error } = await supabase
        .from('tech_tasks')
        .select('*')
        .eq('assigned_to', memberId)
        .order('created_at', { ascending: false })
        .limit(500);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'tasks'));
}

async function createTask(record) {
    const row = toDb('tasks', record);
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('tech_tasks').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'tasks');
}

async function updateTask(id, record) {
    const row = toDb('tasks', record, { partial: true });
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase
        .from('tech_tasks')
        .update(row)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return toUi(data, 'tasks');
}

async function addTaskNote(taskId, note) {
    // Fetch current notes, append, and update
    const task = await getTask(taskId);
    if (!task) throw new Error('Task not found');
    const notes = Array.isArray(task.notes) ? task.notes : [];
    notes.push({
        text: note.text,
        author: note.author || 'System',
        created_at: new Date().toISOString()
    });
    const { error } = await supabase
        .from('tech_tasks')
        .update({ notes, updated_at: new Date().toISOString() })
        .eq('id', taskId);
    if (error) throw error;
    return notes;
}

async function deleteTask(id) {
    const { error } = await supabase.from('tech_tasks').delete().eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Stats (for admin dashboard)
// ---------------------------------------------------------------------------
async function getStats() {
    const [allTasks, allMembers] = await Promise.all([
        listTasks(),
        listTeamMembers({ activeOnly: true })
    ]);

    const byStatus = { todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0 };
    const byPriority = { low: 0, medium: 0, high: 0, critical: 0 };
    const byDepartment = {};
    const byMember = {};

    for (const m of allMembers) {
        byMember[m.id] = { id: m.id, name: m.fullName, department: m.department, hierarchy: m.hierarchy, todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0, total: 0 };
        const dept = m.department || 'engineering';
        if (!byDepartment[dept]) byDepartment[dept] = { members: 0, tasks: 0, done: 0 };
        byDepartment[dept].members++;
    }

    const now = new Date();
    let overdue = 0;
    let totalEstimated = 0;
    let totalActual = 0;

    for (const t of allTasks) {
        if (byStatus[t.status] != null) byStatus[t.status]++;
        if (byPriority[t.priority] != null) byPriority[t.priority]++;

        if (t.assignedTo && byMember[t.assignedTo]) {
            byMember[t.assignedTo][t.status] = (byMember[t.assignedTo][t.status] || 0) + 1;
            byMember[t.assignedTo].total++;
        }

        const dept = t.department || 'engineering';
        if (!byDepartment[dept]) byDepartment[dept] = { members: 0, tasks: 0, done: 0 };
        byDepartment[dept].tasks++;
        if (t.status === 'done') byDepartment[dept].done++;

        if (t.dueDate && new Date(t.dueDate) < now && t.status !== 'done') overdue++;
        if (t.estimatedHours) totalEstimated += t.estimatedHours;
        if (t.actualHours) totalActual += t.actualHours;
    }

    return {
        totalTasks: allTasks.length,
        totalMembers: allMembers.length,
        byStatus,
        byPriority,
        byDepartment,
        byMember: Object.values(byMember),
        overdue,
        totalEstimated,
        totalActual
    };
}

module.exports = {
    TABLES,
    toUi,
    toDb,
    listTeamMembers,
    getTeamMember,
    getTeamMemberByLogin,
    createTeamMember,
    updateTeamMember,
    deleteTeamMember,
    listTasks,
    getTask,
    getMemberTasks,
    createTask,
    updateTask,
    addTaskNote,
    deleteTask,
    getStats
};
