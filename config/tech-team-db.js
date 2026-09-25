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
            active: 'bool',
            join_date: 'date',
            location: 'text',
            timezone: 'text',
            bio: 'text',
            overall_rating: 'text',
            review_count: 'int',
            achievement_count: 'int'
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
            notes: 'json',
            subtasks: 'json',
            depends_on: 'json',
            time_logged: 'int',
            quality_rating: 'int'
        }
    },
    reviews: {
        table: 'tech_performance_reviews',
        columns: {
            member_id: 'text',
            reviewer_id: 'text',
            review_period: 'text',
            overall_rating: 'text',
            timeliness: 'int',
            quality: 'int',
            communication: 'int',
            collaboration: 'int',
            initiative: 'int',
            problem_solving: 'int',
            strengths: 'text',
            improvements: 'text',
            comments: 'text',
            review_type: 'text'
        }
    },
    skills: {
        table: 'tech_member_skills',
        columns: {
            member_id: 'text',
            skill_name: 'text',
            category: 'text',
            proficiency: 'int',
            years_experience: 'text',
            last_used: 'date',
            notes: 'text'
        }
    },
    okrs: {
        table: 'tech_okrs',
        columns: {
            member_id: 'text',
            objective_text: 'text',
            period: 'text',
            key_results: 'json',
            status: 'text',
            progress: 'int'
        }
    },
    meetings: {
        table: 'tech_meetings',
        columns: {
            member_id: 'text',
            meeting_type: 'text',
            title: 'text',
            notes: 'text',
            action_items: 'json',
            attendees: 'json',
            scheduled_at: 'text',
            duration_minutes: 'int'
        }
    },
    achievements: {
        table: 'tech_achievements',
        columns: {
            member_id: 'text',
            title: 'text',
            description: 'text',
            category: 'text',
            awarded_by: 'text',
            badge_icon: 'text'
        }
    },
    goals: {
        table: 'tech_goals',
        columns: {
            member_id: 'text',
            goal_text: 'text',
            category: 'text',
            target_date: 'date',
            status: 'text',
            progress: 'int',
            milestones: 'json'
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

// ===========================================================================
// PREMIUM FEATURES — Performance Reviews
// ===========================================================================
async function listReviews(filters = {}) {
    let query = supabase.from('tech_performance_reviews').select('*');
    if (filters.memberId) query = query.eq('member_id', filters.memberId);
    if (filters.period) query = query.eq('review_period', filters.period);
    if (filters.reviewType) query = query.eq('review_type', filters.reviewType);
    if (filters.reviewerId) query = query.eq('reviewer_id', filters.reviewerId);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map(r => toUi(r, 'reviews'));
}

async function getReview(id) {
    const { data, error } = await supabase.from('tech_performance_reviews').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return toUi(data, 'reviews');
}

async function createReview(record) {
    const row = toDb('reviews', record);
    const { data, error } = await supabase.from('tech_performance_reviews').insert(row).select().single();
    if (error) throw error;
    // Update member's overall rating and review count
    await updateMemberRating(row.member_id);
    return toUi(data, 'reviews');
}

async function updateReview(id, record) {
    const row = toDb('reviews', record, { partial: true });
    const { data, error } = await supabase.from('tech_performance_reviews').update(row).eq('id', id).select().single();
    if (error) throw error;
    if (row.member_id) await updateMemberRating(row.member_id);
    return toUi(data, 'reviews');
}

async function deleteReview(id) {
    const review = await getReview(id);
    const { error } = await supabase.from('tech_performance_reviews').delete().eq('id', id);
    if (error) throw error;
    if (review && review.memberId) await updateMemberRating(review.memberId);
}

async function updateMemberRating(memberId) {
    const { data: reviews } = await supabase
        .from('tech_performance_reviews')
        .select('overall_rating')
        .eq('member_id', memberId)
        .eq('review_type', 'manager');
    const { data: achievements } = await supabase
        .from('tech_achievements')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', memberId);
    const avg = reviews && reviews.length
        ? (reviews.reduce((s, r) => s + parseFloat(r.overall_rating || 0), 0) / reviews.length).toFixed(2)
        : 0;
    await supabase.from('tech_team_members')
        .update({ overall_rating: avg, review_count: reviews ? reviews.length : 0, achievement_count: (achievements || 0) })
        .eq('id', memberId);
}

// ===========================================================================
// PREMIUM FEATURES — Skills Matrix
// ===========================================================================
async function listSkills(filters = {}) {
    let query = supabase.from('tech_member_skills').select('*');
    if (filters.memberId) query = query.eq('member_id', filters.memberId);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.skillName) query = query.ilike('skill_name', '%' + filters.skillName + '%');
    const { data, error } = await query.order('skill_name').limit(1000);
    if (error) throw error;
    return (data || []).map(r => toUi(r, 'skills'));
}

async function getSkill(id) {
    const { data, error } = await supabase.from('tech_member_skills').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return toUi(data, 'skills');
}

async function createSkill(record) {
    const row = toDb('skills', record);
    if (row.years_experience != null) row.years_experience = parseFloat(row.years_experience) || 0;
    const { data, error } = await supabase.from('tech_member_skills').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'skills');
}

async function updateSkill(id, record) {
    const row = toDb('skills', record, { partial: true });
    if (row.years_experience != null) row.years_experience = parseFloat(row.years_experience) || 0;
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('tech_member_skills').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'skills');
}

async function deleteSkill(id) {
    const { error } = await supabase.from('tech_member_skills').delete().eq('id', id);
    if (error) throw error;
}

async function getSkillMatrix() {
    const { data: skills, error } = await supabase.from('tech_member_skills').select('*').order('skill_name');
    if (error) throw error;
    const members = await listTeamMembers({ activeOnly: true });
    const matrix = {};
    for (const m of members) {
        matrix[m.id] = { member: m, skills: {} };
    }
    for (const s of (skills || [])) {
        if (matrix[s.member_id]) {
            matrix[s.member_id].skills[s.skill_name] = {
                category: s.category,
                proficiency: s.proficiency,
                yearsExperience: s.years_experience
            };
        }
    }
    return Object.values(matrix);
}

// ===========================================================================
// PREMIUM FEATURES — OKRs
// ===========================================================================
async function listOkrs(filters = {}) {
    let query = supabase.from('tech_okrs').select('*');
    if (filters.memberId) query = query.eq('member_id', filters.memberId);
    if (filters.period) query = query.eq('period', filters.period);
    if (filters.status) query = query.eq('status', filters.status);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map(r => toUi(r, 'okrs'));
}

async function getOkr(id) {
    const { data, error } = await supabase.from('tech_okrs').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return toUi(data, 'okrs');
}

async function createOkr(record) {
    const row = toDb('okrs', record);
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('tech_okrs').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'okrs');
}

async function updateOkr(id, record) {
    const row = toDb('okrs', record, { partial: true });
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('tech_okrs').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'okrs');
}

async function deleteOkr(id) {
    const { error } = await supabase.from('tech_okrs').delete().eq('id', id);
    if (error) throw error;
}

// ===========================================================================
// PREMIUM FEATURES — Meetings
// ===========================================================================
async function listMeetings(filters = {}) {
    let query = supabase.from('tech_meetings').select('*');
    if (filters.memberId) query = query.eq('member_id', filters.memberId);
    if (filters.meetingType) query = query.eq('meeting_type', filters.meetingType);
    if (filters.fromDate) query = query.gte('scheduled_at', filters.fromDate);
    if (filters.toDate) query = query.lte('scheduled_at', filters.toDate);
    const { data, error } = await query.order('scheduled_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map(r => toUi(r, 'meetings'));
}

async function getMeeting(id) {
    const { data, error } = await supabase.from('tech_meetings').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return toUi(data, 'meetings');
}

async function createMeeting(record) {
    const row = toDb('meetings', record);
    const { data, error } = await supabase.from('tech_meetings').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'meetings');
}

async function updateMeeting(id, record) {
    const row = toDb('meetings', record, { partial: true });
    const { data, error } = await supabase.from('tech_meetings').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'meetings');
}

async function deleteMeeting(id) {
    const { error } = await supabase.from('tech_meetings').delete().eq('id', id);
    if (error) throw error;
}

// ===========================================================================
// PREMIUM FEATURES — Achievements
// ===========================================================================
async function listAchievements(filters = {}) {
    let query = supabase.from('tech_achievements').select('*');
    if (filters.memberId) query = query.eq('member_id', filters.memberId);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.awardedBy) query = query.eq('awarded_by', filters.awardedBy);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map(r => toUi(r, 'achievements'));
}

async function createAchievement(record) {
    const row = toDb('achievements', record);
    const { data, error } = await supabase.from('tech_achievements').insert(row).select().single();
    if (error) throw error;
    if (row.member_id) await updateMemberRating(row.member_id);
    return toUi(data, 'achievements');
}

async function deleteAchievement(id) {
    const ach = await (async () => {
        const { data } = await supabase.from('tech_achievements').select('member_id').eq('id', id).maybeSingle();
        return data;
    })();
    const { error } = await supabase.from('tech_achievements').delete().eq('id', id);
    if (error) throw error;
    if (ach && ach.member_id) await updateMemberRating(ach.member_id);
}

// ===========================================================================
// PREMIUM FEATURES — Goals
// ===========================================================================
async function listGoals(filters = {}) {
    let query = supabase.from('tech_goals').select('*');
    if (filters.memberId) query = query.eq('member_id', filters.memberId);
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.status) query = query.eq('status', filters.status);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    return (data || []).map(r => toUi(r, 'goals'));
}

async function getGoal(id) {
    const { data, error } = await supabase.from('tech_goals').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return toUi(data, 'goals');
}

async function createGoal(record) {
    const row = toDb('goals', record);
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('tech_goals').insert(row).select().single();
    if (error) throw error;
    return toUi(data, 'goals');
}

async function updateGoal(id, record) {
    const row = toDb('goals', record, { partial: true });
    row.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('tech_goals').update(row).eq('id', id).select().single();
    if (error) throw error;
    return toUi(data, 'goals');
}

async function deleteGoal(id) {
    const { error } = await supabase.from('tech_goals').delete().eq('id', id);
    if (error) throw error;
}

// ===========================================================================
// PREMIUM STATS — Enhanced analytics
// ===========================================================================
async function getPremiumStats() {
    const [members, tasks, reviews, skills, okrs, meetings, achievements, goals] = await Promise.all([
        listTeamMembers({ activeOnly: true }),
        listTasks(),
        listReviews(),
        listSkills(),
        listOkrs(),
        listMeetings(),
        listAchievements(),
        listGoals()
    ]);

    // Velocity: tasks completed per week (last 8 weeks)
    const now = new Date();
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
        const start = new Date(now);
        start.setDate(start.getDate() - (i * 7));
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        const count = tasks.filter(t => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= start && new Date(t.completedAt) < end).length;
        weeks.push({ week: start.toISOString().slice(0, 10), count });
    }

    // On-time delivery rate
    const doneTasks = tasks.filter(t => t.status === 'done');
    const onTime = doneTasks.filter(t => t.dueDate && t.completedAt && new Date(t.completedAt) <= new Date(t.dueDate)).length;
    const onTimeRate = doneTasks.length ? Math.round((onTime / doneTasks.length) * 100) : 0;

    // Avg rating across all members
    const ratedMembers = members.filter(m => m.reviewCount > 0);
    const avgRating = ratedMembers.length
        ? (ratedMembers.reduce((s, m) => s + parseFloat(m.overallRating || 0), 0) / ratedMembers.length).toFixed(2)
        : 0;

    // OKR achievement rate
    const activeOkrs = okrs.filter(o => o.status === 'active' || o.status === 'achieved');
    const achievedOkrs = okrs.filter(o => o.status === 'achieved').length;
    const okrRate = activeOkrs.length ? Math.round((achievedOkrs / activeOkrs.length) * 100) : 0;

    // Skill coverage: count unique skills
    const uniqueSkills = [...new Set(skills.map(s => s.skillName))];

    // Upcoming meetings (next 7 days)
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const upcomingMeetings = meetings.filter(m => m.scheduledAt && new Date(m.scheduledAt) >= now && new Date(m.scheduledAt) <= nextWeek);

    return {
        totalMembers: members.length,
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
        byDepartment: (() => {
            const dept = {};
            for (const m of members) {
                const d = m.department || 'engineering';
                if (!dept[d]) dept[d] = { members: 0, tasks: 0, done: 0, avgRating: 0, ratings: [] };
                dept[d].members++;
                if (m.overallRating) dept[d].ratings.push(parseFloat(m.overallRating));
            }
            for (const t of tasks) {
                const d = t.department || 'engineering';
                if (!dept[d]) dept[d] = { members: 0, tasks: 0, done: 0, avgRating: 0, ratings: [] };
                dept[d].tasks++;
                if (t.status === 'done') dept[d].done++;
            }
            for (const d of Object.values(dept)) {
                d.avgRating = d.ratings.length ? (d.ratings.reduce((a, b) => a + b, 0) / d.ratings.length).toFixed(2) : 0;
                delete d.ratings;
            }
            return dept;
        })()
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
    getStats,
    // Premium: Reviews
    listReviews, getReview, createReview, updateReview, deleteReview,
    // Premium: Skills
    listSkills, getSkill, createSkill, updateSkill, deleteSkill, getSkillMatrix,
    // Premium: OKRs
    listOkrs, getOkr, createOkr, updateOkr, deleteOkr,
    // Premium: Meetings
    listMeetings, getMeeting, createMeeting, updateMeeting, deleteMeeting,
    // Premium: Achievements
    listAchievements, createAchievement, deleteAchievement,
    // Premium: Goals
    listGoals, getGoal, createGoal, updateGoal, deleteGoal,
    // Premium: Stats
    getPremiumStats
};
