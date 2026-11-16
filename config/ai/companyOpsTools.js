/**
 * AI Copilot tool registry for the Company Ops portal.
 *
 * Every read tool receives ctx = { scope } from the route (the caller's
 * resolved department scope) and passes it to company-ops-db, so a dept lead
 * can never ask the AI around their permissions. Unlike techTeamTools, the
 * function names here are verified against the module's real exports.
 */

const companyOpsDB = require('../company-ops-db');

const MAX_ROWS = 50;

const scopeOf = (ctx) => (ctx && ctx.scope) || { all: true };

const tools = [
    // ── Read-only company data tools ──
    {
        name: 'get_company_overview',
        description: 'Overview of the company org: departments, staff counts, task totals, average rating, delayed tasks.',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresConfirmation: false,
        async execute(args, ctx) {
            const scope = scopeOf(ctx);
            const [stats, departments] = await Promise.all([
                companyOpsDB.getPremiumStats(scope),
                companyOpsDB.listDepartments({ activeOnly: true })
            ]);
            const tasks = await companyOpsDB.listTasks(scope);
            const now = new Date();
            return {
                departments: departments.map((d) => d.slug),
                totalStaff: stats.totalStaff,
                totalTasks: stats.totalTasks,
                activeTasks: tasks.filter((t) => t.status !== 'done').length,
                completedTasks: tasks.filter((t) => t.status === 'done').length,
                delayedTasks: tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done').length,
                averageRating: stats.avgRating,
                onTimeDeliveryRate: stats.onTimeRate,
                byDepartment: stats.byDepartment
            };
        }
    },
    {
        name: 'get_staff',
        description: 'List company staff with role, department, hierarchy and rating. Filter by department or hierarchy.',
        parameters: {
            type: 'object',
            properties: {
                department: { type: 'string', description: 'Department slug (engineering, operations, warehouse, customer_support, marketing, design, finance, hr, retail)' },
                hierarchy: { type: 'string', description: 'intern | junior | mid | senior | lead | manager | head | director' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ department, hierarchy }, ctx) {
            const staff = await companyOpsDB.listStaff(scopeOf(ctx), { department, activeOnly: true });
            const list = (hierarchy ? staff.filter((s) => s.hierarchy === hierarchy) : staff)
                .slice(0, MAX_ROWS)
                .map((s) => ({
                    id: s.id, name: s.fullName, username: s.username, role: s.role,
                    department: s.department, hierarchy: s.hierarchy, isAdmin: !!s.isAdmin,
                    rating: s.overallRating || 0, reviewCount: s.reviewCount || 0
                }));
            return { count: list.length, staff: list };
        }
    },
    {
        name: 'get_tasks',
        description: 'List internal tasks with status, workflow state, priority, assignee and due dates. Filter by status, department, priority, assignee, or only delayed.',
        parameters: {
            type: 'object',
            properties: {
                status: { type: 'string', description: 'todo | in_progress | review | done | blocked' },
                department: { type: 'string', description: 'Department slug' },
                priority: { type: 'string', description: 'low | medium | high | critical' },
                assignedTo: { type: 'string', description: 'Staff ID' },
                includeDelayed: { type: 'boolean', description: 'Only overdue, not-done tasks' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ status, department, priority, assignedTo, includeDelayed }, ctx) {
            const scope = scopeOf(ctx);
            let tasks = await companyOpsDB.listTasks(scope, { status, department, priority, assignedTo });
            if (includeDelayed) {
                const now = new Date();
                tasks = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done');
            }
            const staff = await companyOpsDB.listStaff(scope);
            const nameOf = new Map(staff.map((s) => [String(s.id), s.fullName]));
            const now = new Date();
            const list = tasks.slice(0, MAX_ROWS).map((t) => ({
                id: t.id, title: t.title, status: t.status, workflowState: t.workflowState,
                priority: t.priority, department: t.department,
                assignee: nameOf.get(String(t.assignedTo)) || 'Unassigned',
                progress: t.progress || 0, dueDate: t.dueDate || null,
                isDelayed: !!(t.dueDate && new Date(t.dueDate) < now && t.status !== 'done'),
                estimatedHours: t.estimatedHours || 0, actualHours: t.actualHours || 0
            }));
            return { count: list.length, tasks: list };
        }
    },
    {
        name: 'get_staff_performance',
        description: 'Detailed performance data for one staff member: reviews, skills, OKRs, task counts.',
        parameters: {
            type: 'object',
            properties: {
                staffId: { type: 'string', description: 'Staff ID' },
                staffName: { type: 'string', description: 'Name to fuzzy-match if ID unknown' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ staffId, staffName }, ctx) {
            const scope = scopeOf(ctx);
            const staff = await companyOpsDB.listStaff(scope);
            let member = staffId ? staff.find((s) => s.id === staffId) : null;
            if (!member && staffName) {
                const lower = String(staffName).toLowerCase();
                member = staff.find((s) => (s.fullName || '').toLowerCase().includes(lower));
            }
            if (!member) return { error: 'Staff not found in your scope. Use get_staff first.' };
            const [reviews, skills, okrs, tasks] = await Promise.all([
                companyOpsDB.listReviews(null, { staffId: member.id }),
                companyOpsDB.listSkills({ staffId: member.id }),
                companyOpsDB.listOkrs({ staffId: member.id }),
                companyOpsDB.getStaffTasks(member.id)
            ]);
            const now = new Date();
            return {
                member: { id: member.id, name: member.fullName, role: member.role, department: member.department, hierarchy: member.hierarchy, rating: member.overallRating || 0 },
                reviews: reviews.slice(0, 10).map((r) => ({ period: r.reviewPeriod, type: r.reviewType, overall: r.overallRating, strengths: r.strengths, improvements: r.improvements })),
                skills: skills.map((s) => ({ name: s.skillName, category: s.category, proficiency: s.proficiency })),
                activeOkrs: okrs.filter((o) => o.status === 'active').map((o) => ({ objective: o.objectiveText, progress: o.progress, period: o.period })),
                tasks: {
                    total: tasks.length,
                    active: tasks.filter((t) => t.status !== 'done').length,
                    delayed: tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done').length
                }
            };
        }
    },
    {
        name: 'get_delayed_tasks',
        description: 'All overdue (not-done, past due) tasks in scope with days overdue and assignee.',
        parameters: {
            type: 'object',
            properties: { department: { type: 'string', description: 'Department slug' } },
            required: []
        },
        requiresConfirmation: false,
        async execute({ department }, ctx) {
            const scope = scopeOf(ctx);
            const tasks = await companyOpsDB.listTasks(scope, { department });
            const now = new Date();
            const delayed = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done');
            const staff = await companyOpsDB.listStaff(scope);
            const nameOf = new Map(staff.map((s) => [String(s.id), s.fullName]));
            return {
                count: delayed.length,
                tasks: delayed.slice(0, MAX_ROWS).map((t) => ({
                    id: t.id, title: t.title, status: t.status, priority: t.priority,
                    assignee: nameOf.get(String(t.assignedTo)) || 'Unassigned',
                    department: t.department, dueDate: t.dueDate,
                    daysOverdue: Math.floor((now - new Date(t.dueDate)) / 86400000)
                }))
            };
        }
    },
    {
        name: 'get_department_report',
        description: 'Per-department report: headcount, open/done/delayed tasks, on-time rate, average rating.',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresConfirmation: false,
        async execute(args, ctx) {
            const scope = scopeOf(ctx);
            const stats = await companyOpsDB.getPremiumStats(scope);
            return { byDepartment: stats.byDepartment, velocity: stats.velocity, onTimeRate: stats.onTimeRate };
        }
    },
    // ── Text generation tools (return data + prompt; the route renders text) ──
    {
        name: 'generate_review_text',
        description: 'Prepare data for a professional performance review of one staff member.',
        parameters: {
            type: 'object',
            properties: {
                staffId: { type: 'string', description: 'Staff ID' },
                focusAreas: { type: 'string', description: 'e.g. "communication and ownership"' },
                reviewType: { type: 'string', description: 'manager | peer | self' }
            },
            required: ['staffId']
        },
        requiresConfirmation: false,
        async execute({ staffId, focusAreas, reviewType }, ctx) {
            const scope = scopeOf(ctx);
            const staff = await companyOpsDB.listStaff(scope);
            const member = staff.find((s) => s.id === staffId);
            if (!member) return { error: 'Staff not found in your scope' };
            const [reviews, skills, tasks, okrs] = await Promise.all([
                companyOpsDB.listReviews(null, { staffId }),
                companyOpsDB.listSkills({ staffId }),
                companyOpsDB.getStaffTasks(staffId),
                companyOpsDB.listOkrs({ staffId })
            ]);
            const now = new Date();
            const activeOkrs = okrs.filter((o) => o.status === 'active');
            const dataSummary = {
                name: member.fullName, role: member.role, department: member.department,
                currentRating: member.overallRating || 'N/A',
                totalReviews: reviews.length,
                skills: skills.map((s) => `${s.skillName} (${s.proficiency}/5)`).join(', ') || 'None listed',
                completedTasks: tasks.filter((t) => t.status === 'done').length,
                totalTasks: tasks.length,
                delayedTasks: tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done').length,
                activeOkrs: activeOkrs.length,
                avgOkrProgress: activeOkrs.length ? Math.round(activeOkrs.reduce((s, o) => s + (o.progress || 0), 0) / activeOkrs.length) + '%' : 'N/A',
                recentStrengths: reviews.length ? reviews[0].strengths || 'N/A' : 'N/A',
                recentImprovements: reviews.length ? reviews[0].improvements || 'N/A' : 'N/A'
            };
            return {
                memberData: dataSummary,
                prompt: `Generate a professional ${reviewType || 'manager'} performance review for ${member.fullName} (${member.role}, ${member.department}) based on the member data. ${focusAreas ? 'Focus on: ' + focusAreas + '.' : ''} Provide: 1) Key strengths (2-3 sentences), 2) Areas for improvement (2-3 sentences), 3) Overall comments (2-3 sentences). Be specific, constructive and professional.`
            };
        }
    },
    {
        name: 'generate_task_description',
        description: 'Produce a well-structured internal task description scaffold for a given title.',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Task title' },
                department: { type: 'string', description: 'Department slug' },
                priority: { type: 'string', description: 'low | medium | high | critical' },
                category: { type: 'string', description: 'Task category' }
            },
            required: ['title']
        },
        requiresConfirmation: false,
        async execute({ title, department, priority, category }) {
            return {
                title,
                prompt: `Write a detailed internal task description for: "${title}". Department: ${department || 'general'}. Priority: ${priority || 'medium'}. Category: ${category || 'operations'}. Include: 1) Objective (1-2 sentences), 2) Deliverables (3-5 bullets), 3) Acceptance criteria (3-5 items), 4) Dependencies/notes. Concise but thorough.`
            };
        }
    },
    {
        name: 'generate_meeting_agenda',
        description: 'Draft a meeting agenda informed by current task load in scope.',
        parameters: {
            type: 'object',
            properties: {
                meetingType: { type: 'string', description: '1on1 | team | review | retro | planning' },
                department: { type: 'string', description: 'Department slug' },
                focusTopic: { type: 'string', description: 'Specific focus' }
            },
            required: ['meetingType']
        },
        requiresConfirmation: false,
        async execute({ meetingType, department, focusTopic }, ctx) {
            const tasks = await companyOpsDB.listTasks(scopeOf(ctx), { department });
            const now = new Date();
            const delayed = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done').length;
            const active = tasks.filter((t) => t.status !== 'done').length;
            return {
                meetingType,
                context: { delayedTasks: delayed, activeTasks: active, department: department || 'all' },
                prompt: `Generate a ${meetingType} meeting agenda. ${department ? 'Department: ' + department + '.' : ''} ${focusTopic ? 'Focus topic: ' + focusTopic + '.' : ''} Context: ${delayed} delayed tasks, ${active} active tasks. Include: 1) Opening, 2) Key discussion points (4-6), 3) Action items template, 4) Time allocations. Professional and actionable.`
            };
        }
    }
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

function getTool(name) {
    return toolMap.get(name) || null;
}

function getToolSchemas() {
    return tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
}

function summarizeTool(name, args) {
    const tool = getTool(name);
    if (!tool) return name;
    if (typeof tool.summary === 'function') {
        try { return tool.summary(args || {}); } catch { return name; }
    }
    return `${name}(${JSON.stringify(args || {})})`;
}

module.exports = { tools, getTool, getToolSchemas, summarizeTool };
