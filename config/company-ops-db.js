/**
 * Company Ops Portal - Database Helpers
 *
 * All database operations for the company-wide task management + chat system
 * (company_* tables). Follows the same pattern as tech-team-db.js: snake_case
 * in Postgres, camelCase to the UI. Every scoped read/write goes through a
 * `scope` object produced by resolvePermissions():
 *   { all: true }                      -> platform admin, sees everything
 *   { departments: ['ops','hr'] }      -> dept lead, row-level filtered
 */

const supabase = require('./supabase');

// ---------------------------------------------------------------------------
// Table schemas
// ---------------------------------------------------------------------------
const TABLES = {
    departments: {
        table: 'company_departments',
        columns: {
            slug: 'text',
            name: 'text',
            headStaffId: 'uuid',
            color: 'text',
            active: 'bool'
        }
    },
    staff: {
        table: 'company_staff',
        columns: {
            username: 'text',
            fullName: 'text',
            mobile: 'text',
            email: 'text',
            role: 'text',
            department: 'text',
            hierarchy: 'text',
            reportsTo: 'uuid',
            isAdmin: 'bool',
            platformAdmin: 'bool',
            canViewDepartments: 'array',
            skills: 'json',
            avatarUrl: 'text',
            active: 'bool',
            joinDate: 'date',
            location: 'text',
            timezone: 'text',
            bio: 'text',
            overallRating: 'text',
            reviewCount: 'int',
            achievementCount: 'int'
        }
    },
    projects: {
        table: 'company_projects',
        columns: {
            name: 'text',
            description: 'text',
            department: 'text',
            ownerId: 'uuid',
            status: 'text',
            startDate: 'date',
            targetDate: 'date',
            color: 'text'
        }
    },
    tasks: {
        table: 'company_tasks',
        columns: {
            title: 'text',
            description: 'text',
            status: 'text',
            workflowState: 'text',
            priority: 'text',
            assignedTo: 'uuid',
            createdBy: 'uuid',
            projectId: 'uuid',
            department: 'text',
            category: 'text',
            dueDate: 'date',
            slaDueAt: 'ts',
            progress: 'int',
            estimatedHours: 'int',
            actualHours: 'int',
            parentTaskId: 'uuid',
            dependsOn: 'json',
            sortOrder: 'int',
            tags: 'json',
            notes: 'json',
            subtasks: 'json',
            attachments: 'json',
            watchers: 'json',
            stageHistory: 'json',
            acknowledgedAt: 'ts',
            completedAt: 'ts',
            isRecurring: 'bool',
            recurrenceRule: 'text',
            timeLogged: 'json',
            qualityRating: 'int'
        }
    },
    comments: {
        table: 'company_task_comments',
        columns: {
            taskId: 'uuid',
            authorId: 'uuid',
            authorName: 'text',
            text: 'text',
            parentId: 'uuid'
        }
    },
    reviews: {
        table: 'company_performance_reviews',
        columns: {
            staffId: 'uuid',
            reviewerId: 'uuid',
            reviewPeriod: 'text',
            overallRating: 'text',
            timeliness: 'int',
            quality: 'int',
            communication: 'int',
            collaboration: 'int',
            initiative: 'int',
            problemSolving: 'int',
            strengths: 'text',
            improvements: 'text',
            comments: 'text',
            reviewType: 'text',
            department: 'text'
        }
    },
    skills: {
        table: 'company_staff_skills',
        columns: {
            staffId: 'uuid',
            skillName: 'text',
            category: 'text',
            proficiency: 'int',
            yearsExperience: 'num',
            lastUsed: 'date',
            notes: 'text'
        }
    },
    okrs: {
        table: 'company_okrs',
        columns: {
            staffId: 'uuid',
            deptId: 'text',
            objectiveText: 'text',
            period: 'text',
            keyResults: 'json',
            status: 'text',
            progress: 'int'
        }
    },
    meetings: {
        table: 'company_meetings',
        columns: {
            staffId: 'uuid',
            organizerId: 'uuid',
            department: 'text',
            meetingType: 'text',
            title: 'text',
            notes: 'text',
            actionItems: 'json',
            attendees: 'json',
            scheduledAt: 'ts',
            durationMinutes: 'int'
        }
    },
    achievements: {
        table: 'company_achievements',
        columns: {
            staffId: 'uuid',
            title: 'text',
            description: 'text',
            category: 'text',
            awardedBy: 'uuid',
            badgeIcon: 'text',
            department: 'text'
        }
    },
    goals: {
        table: 'company_goals',
        columns: {
            staffId: 'uuid',
            department: 'text',
            goalText: 'text',
            category: 'text',
            targetDate: 'date',
            status: 'text',
            progress: 'int',
            milestones: 'json'
        }
    },
    channels: {
        table: 'company_chat_channels',
        columns: {
            type: 'text',
            name: 'text',
            department: 'text',
            createdBy: 'uuid',
            pinnedMessageIds: 'json',
            taskId: 'uuid'
        }
    },
    channelMembers: {
        table: 'company_chat_channel_members',
        columns: {
            channelId: 'uuid',
            staffId: 'uuid',
            role: 'text',
            lastReadAt: 'ts',
            joinedAt: 'ts',
            muted: 'bool'
        }
    },
    messages: {
        table: 'company_chat_messages',
        columns: {
            channelId: 'uuid',
            senderId: 'uuid',
            senderName: 'text',
            text: 'text',
            replyTo: 'uuid',
            attachments: 'json',
            reactions: 'json',
            mentions: 'json',
            editedAt: 'ts'
        }
    }
};

// Legal forward/backward moves on the task workflow machine. Admins may force
// any transition; the audit entry then records forced: true.
const WORKFLOW_TRANSITIONS = {
    draft: ['assigned', 'cancelled'],
    assigned: ['in_progress', 'blocked', 'cancelled'],
    in_progress: ['blocked', 'review', 'cancelled'],
    blocked: ['in_progress', 'assigned', 'cancelled'],
    review: ['rework', 'done'],
    rework: ['in_progress', 'review'],
    done: ['rework'],           // reopen
    cancelled: ['draft']        // revive
};
const LANES = ['todo', 'in_progress', 'review', 'done', 'blocked'];
const workflowToLane = (ws) => ({
    draft: 'todo', assigned: 'todo', in_progress: 'in_progress',
    blocked: 'blocked', review: 'review', rework: 'in_progress',
    done: 'done', cancelled: 'done'
}[ws] || 'todo');

const camelize = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snakeify = (s) => s.replace(/([A-Z])/g, (c) => '_' + c.toLowerCase());

// Convert a Postgres row -> UI shape (camelCase, normalized scalars)
function toUi(row, kind) {
    if (!row) return null;
    const cols = TABLES[kind].columns;
    const out = { id: row.id };
    for (const [col, type] of Object.entries(cols)) {
        const dbCol = snakeify(col);
        let v = row[dbCol];
        if (v == null) {
            out[camelize(col)] = (type === 'json' || type === 'array') ? [] : null;
            continue;
        }
        if (type === 'int') v = parseInt(v, 10) || 0;
        else if (type === 'num') v = parseFloat(v) || 0;
        else if (type === 'bool') v = !!v;
        else if (type === 'date') v = String(v).slice(0, 10);
        out[camelize(col)] = v;
    }
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
        // find declared camel name whose snake form matches this key
        const declared = Object.keys(cols).find((c) => snakeify(c) === col);
        if (!declared) continue;
        const ctype = cols[declared];
        let v = record[key];
        if (v === '' && ctype !== 'json' && ctype !== 'array') v = null;
        if (v == null && ctype === 'json') v = [];
        else if (ctype === 'int' && v != null) v = parseInt(v, 10) || 0;
        else if (ctype === 'num' && v != null) v = parseFloat(v) || 0;
        else if (ctype === 'bool') v = !!v;
        else if (ctype === 'date' && v) v = String(v).slice(0, 10);
        row[col] = v;
    }
    if (!partial) row.updated_at = new Date().toISOString();
    return row;
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
// req.companyActor: { staffId, isAdmin, department, canViewDepartments, platformAdmin }
function resolvePermissions(actor) {
    if (!actor) return null;
    if (actor.platformAdmin) return { all: true };
    const departments = new Set([actor.department]);
    for (const d of (actor.canViewDepartments || [])) departments.add(d);
    if (actor.staffId) departments.add(actor.department);
    return { all: false, departments: [...departments].filter(Boolean), staffId: actor.staffId || null };
}

// Throw-shaped guard used by routes; returns scope for chaining.
function assertDeptAccess(scope, department, { allowUnscoped = true } = {}) {
    if (!scope) throw Object.assign(new Error('Not authenticated'), { status: 401 });
    if (scope.all) return;
    if (!department && allowUnscoped) return;
    if (!scope.departments.includes(department)) {
        throw Object.assign(new Error('Department not in your scope'), { status: 403 });
    }
}

// Apply a scope's department filter to a supabase query on `col`.
// Rows with no department are company-wide visible (kept, not filtered out).
function applyDeptScope(query, scope, col = 'department') {
    if (!scope || scope.all || !col) return query;
    const deps = scope.departments.filter(Boolean);
    if (deps.length === 0) return query.is(col, null);
    return query.or(`${col}.is.null,${col}.in.(${deps.join(',')})`);
}

// ---------------------------------------------------------------------------
// Departments CRUD
// ---------------------------------------------------------------------------
async function listDepartments({ activeOnly = false } = {}) {
    let query = supabase.from('company_departments').select('*');
    if (activeOnly) query = query.eq('active', true);
    const { data, error } = await query.order('name');
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'departments'));
}

async function createDepartment(record) {
    const row = toDb('departments', record);
    if (row.slug) row.slug = String(row.slug).trim().toLowerCase().replace(/\s+/g, '_');
    const { data, error } = await supabase.from('company_departments').insert(row).select().single();
    if (error) throw error;
    // Every department gets its own dept channel, lazily but once.
    await ensureDeptChannel(data.slug).catch((e) => console.warn('[CompanyOps] dept channel ensure failed:', e.message));
    return toUi(data, 'departments');
}

async function updateDepartment(id, record) {
    const row = toDb('departments', record, { partial: true });
    const { data, error } = await supabase.from('company_departments').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'departments');
}

async function deleteDepartment(id) {
    const { error } = await supabase.from('company_departments').update({ active: false }).eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Staff CRUD
// ---------------------------------------------------------------------------
async function listStaff(scope, { activeOnly = false, department } = {}) {
    let query = supabase.from('company_staff').select('*');
    if (activeOnly) query = query.eq('active', true);
    if (department) {
        assertDeptAccess(scope, department);
        query = query.eq('department', department);
    } else {
        query = applyDeptScope(query, scope, 'department');
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'staff'));
}

async function getStaff(id) {
    const { data, error } = await supabase.from('company_staff').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return toUi(data, 'staff');
}

async function getStaffByLogin(username, mobile) {
    const { data, error } = await supabase
        .from('company_staff')
        .select('*')
        .eq('username', String(username).trim().toLowerCase())
        .eq('mobile', String(mobile).trim())
        .eq('active', true)
        .maybeSingle();
    if (error) throw error;
    return toUi(data, 'staff');
}

async function createStaff(record) {
    const row = toDb('staff', record);
    if (row.username) row.username = String(row.username).trim().toLowerCase();
    const { data, error } = await supabase.from('company_staff').insert(row).select().single();
    if (error) throw error;
    const member = toUi(data, 'staff');
    // Auto-join the member's department channel so chat works from day one.
    ensureDeptChannel(member.department)
        .then((ch) => ch && joinChannel(ch.id, member.id, 'member'))
        .catch((e) => console.warn('[CompanyOps] dept channel auto-join failed:', e.message));
    return member;
}

async function updateStaff(id, record) {
    const row = toDb('staff', record, { partial: true });
    if (row.username) row.username = String(row.username).trim().toLowerCase();
    const { data, error } = await supabase.from('company_staff').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'staff');
}

async function deleteStaff(id) {
    const { error } = await supabase.from('company_staff').update({ active: false }).eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Projects CRUD
// ---------------------------------------------------------------------------
async function listProjects(scope, filters = {}) {
    let query = supabase.from('company_projects').select('*');
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.department) {
        assertDeptAccess(scope, filters.department);
        query = query.eq('department', filters.department);
    } else if (scope) {
        query = applyDeptScope(query, scope, 'department');
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'projects'));
}

async function createProject(record) {
    const row = toDb('projects', record);
    const { data, error } = await supabase.from('company_projects').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'projects');
}

async function updateProject(id, record) {
    const row = toDb('projects', record, { partial: true });
    const { data, error } = await supabase.from('company_projects').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'projects');
}

async function deleteProject(id) {
    const { error } = await supabase.from('company_projects').update({ status: 'archived' }).eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Tasks CRUD + workflow machine
// ---------------------------------------------------------------------------
async function listTasks(scope, filters = {}) {
    let query = supabase.from('company_tasks').select('*');
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.workflowState) query = query.eq('workflow_state', filters.workflowState);
    if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
    if (filters.projectId) query = query.eq('project_id', filters.projectId);
    if (filters.priority) query = query.eq('priority', filters.priority);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.parentTaskId) query = query.eq('parent_task_id', filters.parentTaskId);
    if (filters.topLevelOnly) query = query.is('parent_task_id', null);
    if (filters.department) {
        assertDeptAccess(scope, filters.department);
        query = query.eq('department', filters.department);
    } else if (scope) {
        query = applyDeptScope(query, scope, 'department');
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'tasks'));
}

async function getTask(id) {
    const { data, error } = await supabase.from('company_tasks').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return toUi(data, 'tasks');
}

async function getStaffTasks(staffId) {
    const { data, error } = await supabase
        .from('company_tasks')
        .select('*')
        .eq('assigned_to', staffId)
        .order('created_at', { ascending: false })
        .limit(500);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'tasks'));
}

function validateWorkflowTransition(from, to, force) {
    if (force) return true;
    if (!from || from === to) return true;
    const allowed = WORKFLOW_TRANSITIONS[from] || [];
    return allowed.includes(to);
}

async function createTask(record, actor) {
    const row = toDb('tasks', record);
    const ws = row.workflow_state || 'draft';
    row.workflow_state = ws;
    row.status = row.status && row.status !== 'todo' ? row.status : workflowToLane(ws);
    row.stage_history = [{ from: null, to: ws, by: (actor && (actor.name || actor.staffId)) || 'system', at: new Date().toISOString() }];
    const { data, error } = await supabase.from('company_tasks').insert(row).select().single();
    if (error) throw error;
    const task = toUi(data, 'tasks');
    ensureTaskThread(task, actor).catch(() => {});
    return task;
}

async function updateTask(id, record, { actor = null, force = false } = {}) {
    const current = await getTask(id);
    if (!current) throw Object.assign(new Error('Task not found'), { status: 404 });
    const row = toDb('tasks', record, { partial: true });
    const nextWs = row.workflow_state;
    if (nextWs && nextWs !== current.workflowState) {
        if (!validateWorkflowTransition(current.workflowState, nextWs, force)) {
            throw Object.assign(
                new Error(`Illegal transition ${current.workflowState} -> ${nextWs}. Use force to override.`),
                { status: 422 }
            );
        }
        const history = Array.isArray(current.stageHistory) ? current.stageHistory : [];
        history.push({
            from: current.workflowState,
            to: nextWs,
            by: (actor && (actor.name || actor.staffId)) || 'system',
            at: new Date().toISOString(),
            ...(force ? { forced: true } : {})
        });
        row.stage_history = history;
        row.status = workflowToLane(nextWs);
        if (nextWs === 'done' && !current.completedAt) row.completed_at = new Date().toISOString();
        if (nextWs !== 'done' && current.completedAt) row.completed_at = null;
    }
    if (row.status && !LANES.includes(row.status)) delete row.status;
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('company_tasks').update(row).eq('id', id).select().single();
    if (error) throw error;
    const task = toUi(data, 'tasks');
    // Parent progress follows subtask completion ratio.
    if (task.parentTaskId) await refreshParentProgress(task.parentTaskId).catch(() => {});
    if (record.assignedTo && record.assignedTo !== current.assignedTo) {
        // assignment auto-advances draft -> assigned (silently when legal)
        if (task.workflowState === 'draft') {
            await updateTask(id, { workflowState: 'assigned' }, { actor }).catch(() => {});
        }
        ensureTaskThread(task, actor).catch(() => {});
    }
    return task;
}

async function refreshParentProgress(parentId) {
    const { data: subs, error } = await supabase.from('company_tasks').select('subtasks, status').eq('parent_task_id', parentId);
    if (error || !subs || !subs.length) return;
    const total = subs.length;
    const done = subs.filter((s) => s.status === 'done').length;
    const progress = Math.round((done / total) * 100);
    await supabase.from('company_tasks').update({ progress, updated_at: new Date().toISOString() }).eq('id', parentId);
}

async function logTaskTime(id, entry, actor) {
    const task = await getTask(id);
    if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
    const log = Array.isArray(task.timeLogged) ? task.timeLogged : [];
    log.push({
        by: (actor && (actor.name || actor.staffId)) || 'unknown',
        byId: actor && actor.staffId ? actor.staffId : null,
        minutes: parseInt(entry.minutes, 10) || 0,
        note: entry.note || '',
        at: new Date().toISOString()
    });
    const totalMinutes = log.reduce((s, e) => s + (e.minutes || 0), 0);
    const { data, error } = await supabase
        .from('company_tasks')
        .update({ time_logged: log, actual_hours: Math.round(totalMinutes / 60), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return toUi(data, 'tasks');
}

async function acknowledgeTask(id, actor) {
    const { data, error } = await supabase
        .from('company_tasks')
        .update({ acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    void actor;
    return toUi(data, 'tasks');
}

async function deleteTask(id) {
    const { error } = await supabase.from('company_tasks').delete().eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Task comments (threaded)
// ---------------------------------------------------------------------------
async function listTaskComments(taskId) {
    const { data, error } = await supabase
        .from('company_task_comments')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true })
        .limit(500);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'comments'));
}

async function addTaskComment(record) {
    const row = toDb('comments', record);
    const { data, error } = await supabase.from('company_task_comments').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'comments');
}

async function deleteTaskComment(id) {
    const { error } = await supabase.from('company_task_comments').delete().eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
async function getStats(scope) {
    const [allTasks, allStaff] = await Promise.all([
        listTasks(scope || { all: true }),
        listStaff(scope || { all: true }, { activeOnly: true })
    ]);

    const byStatus = { todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0 };
    const byPriority = { low: 0, medium: 0, high: 0, critical: 0 };
    const byDepartment = {};
    const byMember = {};

    for (const m of allStaff) {
        byMember[m.id] = { id: m.id, name: m.fullName, department: m.department, hierarchy: m.hierarchy, todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0, total: 0 };
        const dept = m.department || 'unassigned';
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
        const dept = t.department || 'unassigned';
        if (!byDepartment[dept]) byDepartment[dept] = { members: 0, tasks: 0, done: 0 };
        byDepartment[dept].tasks++;
        if (t.status === 'done') byDepartment[dept].done++;
        if (t.dueDate && new Date(t.dueDate) < now && t.status !== 'done') overdue++;
        if (t.estimatedHours) totalEstimated += t.estimatedHours;
        if (t.actualHours) totalActual += t.actualHours;
    }

    return {
        totalTasks: allTasks.length,
        totalStaff: allStaff.length,
        byStatus,
        byPriority,
        byDepartment,
        byMember: Object.values(byMember),
        overdue,
        totalEstimated,
        totalActual
    };
}

async function updateStaffRating(memberId) {
    const { data: reviews } = await supabase
        .from('company_performance_reviews')
        .select('overall_rating')
        .eq('staff_id', memberId)
        .eq('review_type', 'manager');
    const { count } = await supabase
        .from('company_achievements')
        .select('id', { count: 'exact', head: true })
        .eq('staff_id', memberId);
    const avg = reviews && reviews.length
        ? (reviews.reduce((s, r) => s + parseFloat(r.overall_rating || 0), 0) / reviews.length).toFixed(2)
        : 0;
    await supabase.from('company_staff')
        .update({ overall_rating: avg, review_count: reviews ? reviews.length : 0, achievement_count: count || 0 })
        .eq('id', memberId);
}

// ---------------------------------------------------------------------------
// Performance reviews
// ---------------------------------------------------------------------------
async function listReviews(scope, filters = {}) {
    let query = supabase.from('company_performance_reviews').select('*');
    if (filters.staffId) query = query.eq('staff_id', filters.staffId);
    if (filters.period) query = query.eq('review_period', filters.period);
    if (filters.reviewType) query = query.eq('review_type', filters.reviewType);
    if (filters.reviewerId) query = query.eq('reviewer_id', filters.reviewerId);
    if (filters.department) {
        assertDeptAccess(scope, filters.department);
        query = query.eq('department', filters.department);
    } else if (scope) {
        query = applyDeptScope(query, scope, 'department');
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'reviews'));
}

async function createReview(record) {
    const row = toDb('reviews', record);
    const { data, error } = await supabase.from('company_performance_reviews').insert(row).select().single();
    if (error) throw error;
    if (row.staff_id) await updateStaffRating(row.staff_id);
    return toUi(data, 'reviews');
}

async function updateReview(id, record) {
    const row = toDb('reviews', record, { partial: true });
    const { data, error } = await supabase.from('company_performance_reviews').update(row).eq('id', id).select().single();
    if (error) throw error;
    const rec = toUi(data, 'reviews');
    if (rec && rec.staffId) await updateStaffRating(rec.staffId);
    return rec;
}

async function deleteReview(id) {
    const { data: existing } = await supabase.from('company_performance_reviews').select('staff_id').eq('id', id).maybeSingle();
    const { error } = await supabase.from('company_performance_reviews').delete().eq('id', id);
    if (error) throw error;
    if (existing && existing.staff_id) await updateStaffRating(existing.staff_id);
}

// ---------------------------------------------------------------------------
// Skills matrix
// ---------------------------------------------------------------------------
async function listSkills(filters = {}) {
    let query = supabase.from('company_staff_skills').select('*');
    if (filters.staffId) query = query.eq('staff_id', filters.staffId);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.skillName) query = query.ilike('skill_name', '%' + filters.skillName + '%');
    const { data, error } = await query.order('skill_name').limit(2000);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'skills'));
}

async function createSkill(record) {
    const row = toDb('skills', record);
    const { data, error } = await supabase.from('company_staff_skills').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'skills');
}

async function updateSkill(id, record) {
    const row = toDb('skills', record, { partial: true });
    const { data, error } = await supabase.from('company_staff_skills').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'skills');
}

async function deleteSkill(id) {
    const { error } = await supabase.from('company_staff_skills').delete().eq('id', id);
    if (error) throw error;
}

async function getSkillMatrix(scope) {
    const [skills, members] = await Promise.all([
        listSkills(),
        listStaff(scope || { all: true }, { activeOnly: true })
    ]);
    const matrix = {};
    for (const m of members) matrix[m.id] = { member: m, skills: {} };
    for (const s of skills) {
        if (matrix[s.staffId]) {
            matrix[s.staffId].skills[s.skillName] = {
                category: s.category,
                proficiency: s.proficiency,
                yearsExperience: s.yearsExperience
            };
        }
    }
    return Object.values(matrix);
}

// ---------------------------------------------------------------------------
// OKRs
// ---------------------------------------------------------------------------
async function listOkrs(filters = {}) {
    let query = supabase.from('company_okrs').select('*');
    if (filters.staffId) query = query.eq('staff_id', filters.staffId);
    if (filters.deptId) query = query.eq('dept_id', filters.deptId);
    if (filters.period) query = query.eq('period', filters.period);
    if (filters.status) query = query.eq('status', filters.status);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'okrs'));
}

async function createOkr(record) {
    const row = toDb('okrs', record);
    const { data, error } = await supabase.from('company_okrs').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'okrs');
}

async function updateOkr(id, record) {
    const row = toDb('okrs', record, { partial: true });
    const { data, error } = await supabase.from('company_okrs').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'okrs');
}

async function deleteOkr(id) {
    const { error } = await supabase.from('company_okrs').delete().eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------
async function listMeetings(filters = {}) {
    let query = supabase.from('company_meetings').select('*');
    if (filters.staffId) query = query.eq('staff_id', filters.staffId);
    if (filters.meetingType) query = query.eq('meeting_type', filters.meetingType);
    if (filters.department) query = query.eq('department', filters.department);
    if (filters.fromDate) query = query.gte('scheduled_at', filters.fromDate);
    if (filters.toDate) query = query.lte('scheduled_at', filters.toDate);
    const { data, error } = await query.order('scheduled_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'meetings'));
}

async function createMeeting(record) {
    const row = toDb('meetings', record);
    const { data, error } = await supabase.from('company_meetings').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'meetings');
}

async function updateMeeting(id, record) {
    const row = toDb('meetings', record, { partial: true });
    const { data, error } = await supabase.from('company_meetings').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'meetings');
}

async function deleteMeeting(id) {
    const { error } = await supabase.from('company_meetings').delete().eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------
async function listAchievements(filters = {}) {
    let query = supabase.from('company_achievements').select('*');
    if (filters.staffId) query = query.eq('staff_id', filters.staffId);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.department) query = query.eq('department', filters.department);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'achievements'));
}

async function createAchievement(record) {
    const row = toDb('achievements', record);
    const { data, error } = await supabase.from('company_achievements').insert(row).select().single();
    if (error) throw error;
    if (row.staff_id) await updateStaffRating(row.staff_id);
    return toUi(data, 'achievements');
}

async function deleteAchievement(id) {
    const { data: existing } = await supabase.from('company_achievements').select('staff_id').eq('id', id).maybeSingle();
    const { error } = await supabase.from('company_achievements').delete().eq('id', id);
    if (error) throw error;
    if (existing && existing.staff_id) await updateStaffRating(existing.staff_id);
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
async function listGoals(filters = {}) {
    let query = supabase.from('company_goals').select('*');
    if (filters.staffId) query = query.eq('staff_id', filters.staffId);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.department) query = query.eq('department', filters.department);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'goals'));
}

async function createGoal(record) {
    const row = toDb('goals', record);
    const { data, error } = await supabase.from('company_goals').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'goals');
}

async function updateGoal(id, record) {
    const row = toDb('goals', record, { partial: true });
    const { data, error } = await supabase.from('company_goals').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'goals');
}

async function deleteGoal(id) {
    const { error } = await supabase.from('company_goals').delete().eq('id', id);
    if (error) throw error;
}

// ---------------------------------------------------------------------------
// Chat — channels
// ---------------------------------------------------------------------------
async function ensureDeptChannel(deptSlug) {
    if (!deptSlug) return null;
    const { data: existing } = await supabase
        .from('company_chat_channels')
        .select('*')
        .eq('type', 'dept')
        .eq('department', deptSlug)
        .maybeSingle();
    if (existing) return toUi(existing, 'channels');
    const { data, error } = await supabase
        .from('company_chat_channels')
        .insert({ type: 'dept', department: deptSlug, name: deptSlug })
        .select()
        .single();
    if (error) throw error;
    return toUi(data, 'channels');
}

// One persistent thread channel per task; assignee/creator/watchers auto-join.
async function ensureTaskThread(task, actor) {
    if (!task || !task.id) return null;
    const { data: existing } = await supabase
        .from('company_chat_channels')
        .select('*')
        .eq('type', 'task')
        .eq('task_id', task.id)
        .maybeSingle();
    if (existing) return toUi(existing, 'channels');
    const { data, error } = await supabase
        .from('company_chat_channels')
        .insert({ type: 'task', task_id: task.id, name: task.title, created_by: (actor && actor.staffId) || task.createdBy || null })
        .select()
        .single();
    if (error) throw error;
    const channel = toUi(data, 'channels');
    const members = new Set([task.createdBy, task.assignedTo].filter(Boolean));
    for (const w of (task.watchers || [])) members.add(w);
    for (const sid of members) await joinChannel(channel.id, sid, 'member').catch((e) => console.warn('[CompanyOps] task thread join failed:', e.message));
    return channel;
}

async function createChannel({ type, name, department, staffIds, createdBy, taskId }) {
    const { data, error } = await supabase
        .from('company_chat_channels')
        .insert({ type: type || 'group', name: name || null, department: department || null, created_by: createdBy || null, task_id: taskId || null })
        .select()
        .single();
    if (error) throw error;
    const channel = toUi(data, 'channels');
    const ids = new Set([...(staffIds || []), createdBy].filter(Boolean));
    for (const sid of ids) await joinChannel(channel.id, sid, sid === createdBy ? 'owner' : 'member').catch((e) => console.warn('[CompanyOps] channel join failed:', e.message));
    return channel;
}

async function findOrCreateDirect(staffA, staffB) {
    const { data: channels, error } = await supabase
        .from('company_chat_channels')
        .select('*')
        .eq('type', 'direct')
        .limit(1000);
    if (error) throw error;
    for (const ch of (channels || [])) {
        const { data: members } = await supabase
            .from('company_chat_channel_members')
            .select('staff_id')
            .eq('channel_id', ch.id);
        const ids = (members || []).map((m) => String(m.staff_id));
        if (ids.includes(String(staffA)) && ids.includes(String(staffB))) return toUi(ch, 'channels');
    }
    return createChannel({ type: 'direct', staffIds: [staffA, staffB], createdBy: staffA });
}

async function joinChannel(channelId, staffId, role = 'member') {
    // onConflict/ignoreDuplicates are upsert options; on an insert they throw.
    const { error } = await supabase
        .from('company_chat_channel_members')
        .upsert({ channel_id: channelId, staff_id: staffId, role }, {
            onConflict: 'channel_id,staff_id',
            ignoreDuplicates: true
        });
    if (error) throw error;
}

async function listChannelsForStaff(staffId) {
    const { data: membership, error } = await supabase
        .from('company_chat_channel_members')
        .select('channel_id, role, last_read_at, muted, company_chat_channels(*)')
        .eq('staff_id', staffId)
        .limit(500);
    if (error) throw error;
    const channels = [];
    for (const m of (membership || [])) {
        const ch = m.company_chat_channels;
        if (!ch) continue;
        channels.push({
            ...toUi(ch, 'channels'),
            myRole: m.role,
            lastReadAt: m.last_read_at,
            muted: !!m.muted
        });
    }
    return channels;
}

async function listAllChannels(scope) {
    let query = supabase.from('company_chat_channels').select('*');
    if (scope && !scope.all) query = query.in('department', scope.departments.length ? scope.departments : ['__none__']);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'channels'));
}

async function getChannelMembers(channelId) {
    const { data, error } = await supabase
        .from('company_chat_channel_members')
        .select('staff_id, role, last_read_at, muted')
        .eq('channel_id', channelId);
    if (error) throw error;
    return (data || []).map((r) => ({
        staffId: r.staff_id,
        role: r.role,
        lastReadAt: r.last_read_at,
        muted: !!r.muted
    }));
}

async function isChannelMember(channelId, staffId) {
    const { data, error } = await supabase
        .from('company_chat_channel_members')
        .select('id')
        .eq('channel_id', channelId)
        .eq('staff_id', staffId)
        .maybeSingle();
    if (error) throw error;
    return !!data;
}

async function getChannel(channelId) {
    const { data, error } = await supabase
        .from('company_chat_channels')
        .select('*')
        .eq('id', channelId)
        .maybeSingle();
    if (error) throw error;
    return data ? toUi(data, 'channels') : null;
}

// The one channel-access rule, shared by the HTTP routes and the socket hub so
// both halves agree. Members always read; a lead browsing inside their
// department scope joins a department channel on first open (so posting and
// read receipts work from then on); platform admins may read but are not joined.
async function resolveChannelAccess(channelId, actor = {}) {
    if (actor.platformAdmin) return true;
    if (!actor.staffId) return false;
    if (await isChannelMember(channelId, actor.staffId)) return true;
    if (!actor.isAdmin) return false;
    const ch = await getChannel(channelId);
    if (!ch || ch.type !== 'dept' || !ch.department) return false;
    const visible = [actor.department, ...(actor.canViewDepartments || [])].filter(Boolean);
    if (!visible.includes(ch.department)) return false;
    await joinChannel(channelId, actor.staffId, 'member');
    return true;
}

async function setChannelMuted(channelId, staffId, muted) {
    const { error } = await supabase
        .from('company_chat_channel_members')
        .update({ muted: !!muted })
        .eq('channel_id', channelId)
        .eq('staff_id', staffId);
    if (error) throw error;
}

async function pinMessages(channelId, messageIds) {
    const { data, error } = await supabase
        .from('company_chat_channels')
        .update({ pinned_message_ids: messageIds || [], updated_at: new Date().toISOString() })
        .eq('id', channelId)
        .select()
        .single();
    if (error) throw error;
    return toUi(data, 'channels');
}

// ---------------------------------------------------------------------------
// Chat — messages
// ---------------------------------------------------------------------------
async function sendMessage({ channelId, senderId, senderName, text, replyTo, attachments, mentions }) {
    const { data, error } = await supabase
        .from('company_chat_messages')
        .insert({
            channel_id: channelId,
            sender_id: senderId || null,
            sender_name: senderName || null,
            text: String(text || '').slice(0, 8000),
            reply_to: replyTo || null,
            attachments: attachments || [],
            mentions: mentions || []
        })
        .select()
        .single();
    if (error) throw error;
    // sender's own read marker follows the message
    if (senderId) await markRead(channelId, senderId);
    return toUi(data, 'messages');
}

// Cursor pagination: pass beforeId (message uuid) to page older, beforeCreatedAt
// as a fallback cursor. Always newest-first page of `limit`, returned asc.
async function listMessages(channelId, { limit = 50, beforeId = null } = {}) {
    let query = supabase
        .from('company_chat_messages')
        .select('*')
        .eq('channel_id', channelId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(Math.min(parseInt(limit, 10) || 50, 100));
    if (beforeId) {
        const { data: anchor } = await supabase.from('company_chat_messages').select('created_at').eq('id', beforeId).maybeSingle();
        if (anchor) query = query.lt('created_at', anchor.created_at);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'messages')).reverse();
}

async function markRead(channelId, staffId) {
    const { error } = await supabase
        .from('company_chat_channel_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('channel_id', channelId)
        .eq('staff_id', staffId);
    if (error) throw error;
}

// Everything newer than an ISO cursor (reconnect replay); asc order.
async function listMessagesSince(channelId, sinceIso, limit = 100) {
    const { data, error } = await supabase
        .from('company_chat_messages')
        .select('*')
        .eq('channel_id', channelId)
        .is('deleted_at', null)
        .gt('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .limit(Math.min(parseInt(limit, 10) || 100, 200));
    if (error) throw error;
    return (data || []).map((r) => toUi(r, 'messages'));
}

// Atomic add/remove of a reactor via the company_toggle_reaction RPC; falls
// back to read-modify-write if the function is not yet installed.
async function toggleReaction(messageId, staffId, emoji) {
    const uid = String(staffId || 'anon');
    const { data, error } = await supabase.rpc('company_toggle_reaction', {
        p_message_id: messageId,
        p_staff_id: uid,
        p_emoji: emoji
    });
    if (!error && data) return data; // { id, channelId, reactions }
    const { data: row, error: readErr } = await supabase
        .from('company_chat_messages')
        .select('channel_id, reactions')
        .eq('id', messageId)
        .maybeSingle();
    if (readErr) throw readErr;
    if (!row) return null;
    const reactions = row.reactions && typeof row.reactions === 'object' ? row.reactions : {};
    const users = Array.isArray(reactions[emoji]) ? reactions[emoji].map(String) : [];
    const idx = users.indexOf(uid);
    if (idx >= 0) users.splice(idx, 1); else users.push(uid);
    reactions[emoji] = users;
    const { error: updErr } = await supabase
        .from('company_chat_messages')
        .update({ reactions })
        .eq('id', messageId);
    if (updErr) throw updErr;
    return { id: messageId, channelId: row.channel_id, reactions };
}

// Unread counts per channel for one staff member (single join-shaped pass).
async function getUnreadCounts(staffId) {
    const { data: membership, error } = await supabase
        .from('company_chat_channel_members')
        .select('channel_id, last_read_at')
        .eq('staff_id', staffId);
    if (error) throw error;
    const counts = {};
    for (const m of (membership || [])) {
        const { count } = await supabase
            .from('company_chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('channel_id', m.channel_id)
            .is('deleted_at', null)
            .gt('created_at', m.last_read_at)
            .neq('sender_id', staffId);
        if (count) counts[m.channel_id] = count;
    }
    return counts;
}

async function editMessage(id, staffId, text) {
    const { data: existing } = await supabase.from('company_chat_messages').select('sender_id').eq('id', id).maybeSingle();
    if (!existing || String(existing.sender_id) !== String(staffId)) {
        throw Object.assign(new Error('Can only edit your own messages'), { status: 403 });
    }
    const { data, error } = await supabase
        .from('company_chat_messages')
        .update({ text: String(text || '').slice(0, 8000), edited_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return toUi(data, 'messages');
}

// Soft delete (author or moderator flag). Returns the owning channel id so the
// caller can broadcast the removal to the right thread.
async function deleteMessage(id, { moderator = false, staffId = null } = {}) {
    const { data: existing } = await supabase
        .from('company_chat_messages')
        .select('sender_id, channel_id')
        .eq('id', id)
        .maybeSingle();
    if (!existing) throw Object.assign(new Error('Message not found'), { status: 404 });
    if (!moderator && String(existing.sender_id) !== String(staffId)) {
        throw Object.assign(new Error('Can only delete your own messages'), { status: 403 });
    }
    const { error } = await supabase
        .from('company_chat_messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
    return existing.channel_id;
}

// ---------------------------------------------------------------------------
// Premium stats (scoped)
// ---------------------------------------------------------------------------
async function getPremiumStats(scope) {
    const effScope = scope || { all: true };
    const [members, tasks, reviews, skills, okrs, meetings, achievements, goals] = await Promise.all([
        listStaff(effScope, { activeOnly: true }),
        listTasks(effScope),
        listReviews(effScope),
        listSkills(),
        listOkrs(),
        listMeetings(),
        listAchievements(),
        listGoals()
    ]);

    // Velocity: tasks completed per week (last 8 weeks), from real completed_at
    const now = new Date();
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
        const start = new Date(now);
        start.setDate(start.getDate() - (i * 7));
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        const count = tasks.filter((t) => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= start && new Date(t.completedAt) < end).length;
        weeks.push({ week: start.toISOString().slice(0, 10), count });
    }

    const doneTasks = tasks.filter((t) => t.status === 'done');
    const onTime = doneTasks.filter((t) => t.dueDate && t.completedAt && new Date(t.completedAt) <= new Date(t.dueDate)).length;
    const onTimeRate = doneTasks.length ? Math.round((onTime / doneTasks.length) * 100) : 0;

    const ratedMembers = members.filter((m) => m.reviewCount > 0);
    const avgRating = ratedMembers.length
        ? (ratedMembers.reduce((s, m) => s + parseFloat(m.overallRating || 0), 0) / ratedMembers.length).toFixed(2)
        : 0;

    const activeOkrs = okrs.filter((o) => o.status === 'active' || o.status === 'achieved');
    const achievedOkrs = okrs.filter((o) => o.status === 'achieved').length;
    const okrRate = activeOkrs.length ? Math.round((achievedOkrs / activeOkrs.length) * 100) : 0;

    const memberIds = new Set(members.map((m) => m.id));
    const uniqueSkills = [...new Set(skills.filter((s) => memberIds.has(s.staffId)).map((s) => s.skillName))];

    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const upcomingMeetings = meetings.filter((m) => m.scheduledAt && new Date(m.scheduledAt) >= now && new Date(m.scheduledAt) <= nextWeek && memberIds.has(m.staffId));

    const dept = {};
    for (const m of members) {
        const d = m.department || 'unassigned';
        if (!dept[d]) dept[d] = { members: 0, tasks: 0, done: 0, avgRating: 0, ratings: [] };
        dept[d].members++;
        if (m.overallRating) dept[d].ratings.push(parseFloat(m.overallRating));
    }
    for (const t of tasks) {
        const d = t.department || 'unassigned';
        if (!dept[d]) dept[d] = { members: 0, tasks: 0, done: 0, avgRating: 0, ratings: [] };
        dept[d].tasks++;
        if (t.status === 'done') dept[d].done++;
    }
    for (const d of Object.values(dept)) {
        d.avgRating = d.ratings.length ? (d.ratings.reduce((a, b) => a + b, 0) / d.ratings.length).toFixed(2) : 0;
        delete d.ratings;
    }

    return {
        totalStaff: members.length,
        totalTasks: tasks.length,
        totalReviews: reviews.length,
        totalSkills: skills.length,
        uniqueSkills: uniqueSkills.length,
        totalOkrs: okrs.length,
        totalMeetings: meetings.length,
        totalAchievements: achievements.length,
        totalGoals: goals.length,
        avgRating: parseFloat(avgRating),
        onTimeRate,
        okrAchievementRate: okrRate,
        velocity: weeks,
        upcomingMeetings: upcomingMeetings.length,
        byDepartment: dept
    };
}

// Recent activity feed across tasks/comments/achievements (scope-filtered).
async function getFeed(scope, { limit = 40 } = {}) {
    const tasks = await listTasks(scope, {});
    const events = [];
    for (const t of tasks.slice(0, 200)) {
        const hist = Array.isArray(t.stageHistory) ? t.stageHistory : [];
        for (const h of hist.slice(-3)) {
            events.push({ kind: 'task:stage', taskId: t.id, taskTitle: t.title, department: t.department, at: h.at, by: h.by, detail: `${h.from || 'new'} -> ${h.to}` });
        }
        for (const c of (t.notes || []).slice(-2)) {
            events.push({ kind: 'task:note', taskId: t.id, taskTitle: t.title, department: t.department, at: c.created_at, by: c.author, detail: String(c.text || '').slice(0, 120) });
        }
    }
    events.sort((a, b) => new Date(b.at) - new Date(a.at));
    return events.slice(0, limit);
}

module.exports = {
    TABLES,
    WORKFLOW_TRANSITIONS,
    LANES,
    toUi,
    toDb,
    workflowToLane,
    resolvePermissions,
    assertDeptAccess,
    // Departments
    listDepartments, createDepartment, updateDepartment, deleteDepartment,
    // Staff
    listStaff, getStaff, getStaffByLogin, createStaff, updateStaff, deleteStaff,
    // Projects
    listProjects, createProject, updateProject, deleteProject,
    // Tasks
    listTasks, getTask, getStaffTasks, createTask, updateTask, logTaskTime, acknowledgeTask, deleteTask,
    refreshParentProgress,
    // Comments
    listTaskComments, addTaskComment, deleteTaskComment,
    // Stats
    getStats, getPremiumStats, getFeed,
    // Reviews
    listReviews, createReview, updateReview, deleteReview,
    // Skills
    listSkills, createSkill, updateSkill, deleteSkill, getSkillMatrix,
    // OKRs
    listOkrs, createOkr, updateOkr, deleteOkr,
    // Meetings
    listMeetings, createMeeting, updateMeeting, deleteMeeting,
    // Achievements
    listAchievements, createAchievement, deleteAchievement,
    // Goals
    listGoals, createGoal, updateGoal, deleteGoal,
    // Chat
    ensureDeptChannel, ensureTaskThread, createChannel, findOrCreateDirect,
    joinChannel, listChannelsForStaff, listAllChannels, getChannelMembers,
    getChannel, resolveChannelAccess,
    isChannelMember, setChannelMuted, pinMessages,
    sendMessage, listMessages, listMessagesSince, markRead, getUnreadCounts,
    editMessage, deleteMessage, toggleReaction
};
