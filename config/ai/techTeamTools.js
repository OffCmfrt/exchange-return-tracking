/**
 * AI Copilot tool registry for Tech Team management.
 *
 * Provides tools for querying team data, generating review text,
 * analyzing performance, and managing tasks/members.
 */

const techTeamDB = require('../tech-team-db');
const supabase = require('../supabase');

const MAX_ROWS = 50;

const tools = [
    // ── Read-only team data tools ──
    {
        name: 'get_team_overview',
        description: 'Get an overview of the tech team: total members, departments, average rating, active tasks count, and recent activity.',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresConfirmation: false,
        async execute() {
            const members = await techTeamDB.listMembers({});
            const activeMembers = members.filter(m => m.isActive !== false);
            const tasks = await techTeamDB.listTasks({});
            const activeTasks = tasks.filter(t => t.status !== 'done');
            const reviews = await techTeamDB.listReviews({});
            const avgRating = activeMembers.length
                ? (activeMembers.reduce((s, m) => s + (parseFloat(m.overallRating) || 0), 0) / activeMembers.length).toFixed(1)
                : 0;
            const departments = [...new Set(activeMembers.map(m => m.department).filter(Boolean))];
            return {
                totalMembers: activeMembers.length,
                departments,
                averageRating: parseFloat(avgRating),
                totalTasks: tasks.length,
                activeTasks: activeTasks.length,
                completedTasks: tasks.filter(t => t.status === 'done').length,
                totalReviews: reviews.length,
                delayedTasks: activeTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date()).length
            };
        }
    },
    {
        name: 'get_team_members',
        description: 'List tech team members with their roles, departments, ratings, and status. Optionally filter by department or hierarchy.',
        parameters: {
            type: 'object',
            properties: {
                department: { type: 'string', description: 'Filter by department (engineering, frontend, backend, devops, design, qa, product, data)' },
                hierarchy: { type: 'string', description: 'Filter by hierarchy level (intern, junior, mid, senior, lead, manager, head, director)' },
                role: { type: 'string', description: 'Filter by role (developer, lead, admin, intern, qa, designer)' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ department, hierarchy, role }) {
            const filters = {};
            if (department) filters.department = department;
            if (hierarchy) filters.hierarchy = hierarchy;
            if (role) filters.role = role;
            const members = await techTeamDB.listMembers(filters);
            const list = members.slice(0, MAX_ROWS).map(m => ({
                id: m.id, name: m.fullName, username: m.username, role: m.role,
                department: m.department, hierarchy: m.hierarchy,
                rating: m.overallRating || 0, reviewCount: m.reviewCount || 0,
                isActive: m.isActive !== false
            }));
            return { count: list.length, members: list };
        }
    },
    {
        name: 'get_team_tasks',
        description: 'List tech team tasks with status, priority, assignee, and due dates. Filter by status, department, priority, or assignee.',
        parameters: {
            type: 'object',
            properties: {
                status: { type: 'string', description: 'Filter by status (todo, in_progress, review, done, blocked)' },
                department: { type: 'string', description: 'Filter by department' },
                priority: { type: 'string', description: 'Filter by priority (low, medium, high, critical)' },
                assignedTo: { type: 'string', description: 'Filter by member ID' },
                includeDelayed: { type: 'boolean', description: 'If true, only show delayed (overdue) tasks' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ status, department, priority, assignedTo, includeDelayed }) {
            const filters = {};
            if (status) filters.status = status;
            if (department) filters.department = department;
            if (priority) filters.priority = priority;
            if (assignedTo) filters.assignedTo = assignedTo;
            let tasks = await techTeamDB.listTasks(filters);
            if (includeDelayed) {
                const now = new Date();
                tasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done');
            }
            const members = await techTeamDB.listMembers({});
            const memberMap = new Map(members.map(m => [m.id, m.fullName]));
            const list = tasks.slice(0, MAX_ROWS).map(t => ({
                id: t.id, title: t.title, status: t.status, priority: t.priority,
                department: t.department, assignee: memberMap.get(t.assignedTo) || 'Unassigned',
                progress: t.progress || 0, dueDate: t.dueDate || null,
                isDelayed: t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done',
                estimatedHours: t.estimatedHours || 0, timeLogged: t.timeLogged || 0
            }));
            return { count: list.length, tasks: list };
        }
    },
    {
        name: 'get_member_performance',
        description: 'Get detailed performance data for a specific team member: reviews, skills, OKRs, tasks, and ratings.',
        parameters: {
            type: 'object',
            properties: {
                memberId: { type: 'string', description: 'Team member ID' },
                memberName: { type: 'string', description: 'Team member name (fuzzy match if ID unknown)' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ memberId, memberName }) {
            let members = await techTeamDB.listMembers({});
            let member;
            if (memberId) {
                member = members.find(m => m.id === memberId);
            } else if (memberName) {
                const lower = memberName.toLowerCase();
                member = members.find(m => m.fullName.toLowerCase().includes(lower));
            }
            if (!member) return { error: 'Member not found. Use get_team_members to list available members.' };
            const [reviews, skills, okrs, tasks] = await Promise.all([
                techTeamDB.listReviews({ memberId: member.id }),
                techTeamDB.listSkills({ memberId: member.id }),
                techTeamDB.listOkrs({ memberId: member.id }),
                techTeamDB.listTasks({ assignedTo: member.id })
            ]);
            return {
                member: { id: member.id, name: member.fullName, role: member.role, department: member.department, hierarchy: member.hierarchy, rating: member.overallRating || 0 },
                reviews: reviews.slice(0, 10).map(r => ({ period: r.reviewPeriod, type: r.reviewType, overall: r.overallRating, timeliness: r.timeliness, quality: r.quality, communication: r.communication, collaboration: r.collaboration, initiative: r.initiative, problemSolving: r.problemSolving, strengths: r.strengths, improvements: r.improvements })),
                skills: skills.map(s => ({ name: s.skillName, category: s.category, proficiency: s.proficiency })),
                activeOkrs: okrs.filter(o => o.status === 'active').map(o => ({ objective: o.objectiveText, progress: o.progress, period: o.period })),
                tasks: { total: tasks.length, active: tasks.filter(t => t.status !== 'done').length, delayed: tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done').length }
            };
        }
    },
    {
        name: 'get_performance_reviews',
        description: 'List performance reviews. Filter by member, period, or type. Returns ratings and feedback text.',
        parameters: {
            type: 'object',
            properties: {
                memberId: { type: 'string', description: 'Filter by member ID' },
                period: { type: 'string', description: 'Filter by period (e.g. 2026-Q1)' },
                reviewType: { type: 'string', description: 'Filter by type (manager, peer, self)' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ memberId, period, reviewType }) {
            const filters = {};
            if (memberId) filters.memberId = memberId;
            if (period) filters.period = period;
            if (reviewType) filters.reviewType = reviewType;
            const reviews = await techTeamDB.listReviews(filters);
            return { count: reviews.length, reviews: reviews.slice(0, MAX_ROWS) };
        }
    },
    {
        name: 'get_team_analytics',
        description: 'Get team analytics: velocity, on-time delivery rate, department comparison, skill coverage, and OKR achievement rates.',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresConfirmation: false,
        async execute() {
            const stats = await techTeamDB.getPremiumStats();
            const tasks = await techTeamDB.listTasks({});
            const members = await techTeamDB.listMembers({});
            const totalTasks = tasks.length;
            const doneTasks = tasks.filter(t => t.status === 'done').length;
            const delayedTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done').length;
            const activeTasks = tasks.filter(t => t.status !== 'done').length;
            const onTimeRate = totalTasks > 0 ? Math.round(((totalTasks - delayedTasks) / totalTasks) * 100) : 0;
            const deptStats = {};
            members.filter(m => m.isActive !== false).forEach(m => {
                const dept = m.department || 'unknown';
                if (!deptStats[dept]) deptStats[dept] = { members: 0, avgRating: 0, ratings: [] };
                deptStats[dept].members++;
                if (m.overallRating) deptStats[dept].ratings.push(parseFloat(m.overallRating));
            });
            Object.keys(deptStats).forEach(d => {
                const r = deptStats[d].ratings;
                deptStats[d].avgRating = r.length ? (r.reduce((a, b) => a + b, 0) / r.length).toFixed(1) : 0;
                delete deptStats[d].ratings;
            });
            return {
                totalMembers: members.filter(m => m.isActive !== false).length,
                totalTasks, activeTasks, doneTasks, delayedTasks,
                onTimeDeliveryRate: onTimeRate,
                departmentBreakdown: deptStats,
                ...stats
            };
        }
    },
    {
        name: 'get_delayed_tasks',
        description: 'Get all delayed/overdue tasks across the team. Shows which tasks are past due date and not yet completed.',
        parameters: {
            type: 'object',
            properties: {
                department: { type: 'string', description: 'Filter by department' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ department }) {
            const filters = {};
            if (department) filters.department = department;
            let tasks = await techTeamDB.listTasks(filters);
            const now = new Date();
            const delayed = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done');
            const members = await techTeamDB.listMembers({});
            const memberMap = new Map(members.map(m => [m.id, m.fullName]));
            return {
                count: delayed.length,
                tasks: delayed.map(t => ({
                    id: t.id, title: t.title, status: t.status, priority: t.priority,
                    assignee: memberMap.get(t.assignedTo) || 'Unassigned',
                    department: t.department, dueDate: t.dueDate,
                    daysOverdue: Math.floor((now - new Date(t.dueDate)) / (1000 * 60 * 60 * 24)),
                    progress: t.progress || 0
                }))
            };
        }
    },
    // ── Text generation tools (AI-powered) ──
    {
        name: 'generate_review_text',
        description: 'Generate professional performance review text based on a team member\'s data. Provide the member ID and optionally specific areas to focus on. Returns suggested strengths, improvements, and overall comments.',
        parameters: {
            type: 'object',
            properties: {
                memberId: { type: 'string', description: 'Team member ID to generate review for' },
                focusAreas: { type: 'string', description: 'Specific areas to focus on (e.g. "communication and leadership")' },
                reviewType: { type: 'string', description: 'Type of review (manager, peer, self)' }
            },
            required: ['memberId']
        },
        requiresConfirmation: false,
        async execute({ memberId, focusAreas, reviewType }) {
            const members = await techTeamDB.listMembers({});
            const member = members.find(m => m.id === memberId);
            if (!member) return { error: 'Member not found' };
            const [reviews, skills, tasks, okrs] = await Promise.all([
                techTeamDB.listReviews({ memberId }),
                techTeamDB.listSkills({ memberId }),
                techTeamDB.listTasks({ assignedTo: memberId }),
                techTeamDB.listOkrs({ memberId })
            ]);
            const completedTasks = tasks.filter(t => t.status === 'done').length;
            const activeOkrs = okrs.filter(o => o.status === 'active');
            const avgProgress = activeOkrs.length ? Math.round(activeOkrs.reduce((s, o) => s + (o.progress || 0), 0) / activeOkrs.length) : 0;
            const delayedTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done').length;
            const dataSummary = {
                name: member.fullName, role: member.role, department: member.department,
                currentRating: member.overallRating || 'N/A',
                totalReviews: reviews.length,
                skills: skills.map(s => `${s.skillName} (${s.proficiency}/5)`).join(', ') || 'None listed',
                completedTasks, totalTasks: tasks.length, delayedTasks,
                activeOkrs: activeOkrs.length, avgOkrProgress: avgProgress + '%',
                recentStrengths: reviews.length ? reviews[0].strengths || 'N/A' : 'N/A',
                recentImprovements: reviews.length ? reviews[0].improvements || 'N/A' : 'N/A'
            };
            return {
                memberData: dataSummary,
                prompt: `Generate a professional performance review for ${member.fullName} (${member.role}, ${member.department}). Current rating: ${member.overallRating || 'N/A'}/5. ${focusAreas ? 'Focus on: ' + focusAreas + '.' : ''} Provide: 1) Key strengths (2-3 sentences), 2) Areas for improvement (2-3 sentences), 3) Overall comments (2-3 sentences). Be specific, constructive, and professional.`
            };
        }
    },
    {
        name: 'generate_task_description',
        description: 'Generate a detailed task description based on a title and context. Useful for creating well-defined tasks.',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Task title' },
                department: { type: 'string', description: 'Department context' },
                priority: { type: 'string', description: 'Task priority (low, medium, high, critical)' },
                category: { type: 'string', description: 'Task category (feature, bug, maintenance, infra, documentation, testing)' }
            },
            required: ['title']
        },
        requiresConfirmation: false,
        async execute({ title, department, priority, category }) {
            return {
                title,
                prompt: `Generate a detailed task description for: "${title}". Department: ${department || 'general'}. Priority: ${priority || 'medium'}. Category: ${category || 'feature'}. Include: 1) Objective (1-2 sentences), 2) Key deliverables (3-5 bullet points), 3) Acceptance criteria (3-5 items), 4) Technical considerations if applicable. Keep it concise but thorough.`
            };
        }
    },
    {
        name: 'generate_meeting_agenda',
        description: 'Generate a meeting agenda based on team data, current tasks, and recent performance.',
        parameters: {
            type: 'object',
            properties: {
                meetingType: { type: 'string', description: 'Type of meeting (1on1, team, review, retro)' },
                department: { type: 'string', description: 'Department context' },
                focusTopic: { type: 'string', description: 'Specific topic to focus on' }
            },
            required: ['meetingType']
        },
        requiresConfirmation: false,
        async execute({ meetingType, department, focusTopic }) {
            const tasks = await techTeamDB.listTasks({});
            const delayedTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done');
            const activeTasks = tasks.filter(t => t.status !== 'done');
            return {
                meetingType,
                context: { delayedTasks: delayedTasks.length, activeTasks: activeTasks.length, department: department || 'all' },
                prompt: `Generate a ${meetingType} meeting agenda. ${department ? 'Department: ' + department + '.' : ''} ${focusTopic ? 'Focus topic: ' + focusTopic + '.' : ''} Current context: ${delayedTasks.length} delayed tasks, ${activeTasks.length} active tasks. Include: 1) Opening/icebreaker, 2) Key discussion points (4-6 items), 3) Action items template, 4) Time allocations. Keep it professional and actionable.`
            };
        }
    }
];

const toolMap = new Map(tools.map(t => [t.name, t]));

function getTool(name) {
    return toolMap.get(name) || null;
}

function getToolSchemas() {
    return tools.map(t => ({
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
