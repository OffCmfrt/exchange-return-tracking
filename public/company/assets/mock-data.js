/* ==========================================================================
   Company Ops — mock dataset for the standalone preview (?mock=1).
   The pages inject this via document.write only when the URL carries the mock
   flag, so a real session never sees placeholder data even if the file is
   reachable. Shape mirrors /api/company responses exactly.
   ========================================================================== */
(function (global) {
    'use strict';
    const now = Date.now();
    const iso = (msAgo) => new Date(now - msAgo).toISOString();
    const day = 86400000;
    const dateStr = (inDays) => new Date(now + inDays * day).toISOString().slice(0, 10);

    const departments = [
        { id: 'd1', slug: 'operations', name: 'Operations', color: '#7a8caa', headStaffId: 's2', active: true },
        { id: 'd2', slug: 'warehouse', name: 'Warehouse', color: '#8a9a7b', headStaffId: 's4', active: true },
        { id: 'd3', slug: 'customer_support', name: 'Customer Support', color: '#aa8c7a', headStaffId: 's5', active: true },
        { id: 'd4', slug: 'marketing', name: 'Marketing', color: '#9a7ba0', headStaffId: 's3', active: true },
        { id: 'd5', slug: 'finance', name: 'Finance', color: '#7aa09a', headStaffId: 's6', active: true }
    ];

    const staff = [
        { id: 's1', username: 'admin', fullName: 'Simran Kohli', mobile: '9000000001', email: 'simran@offcomfrt.in', role: 'ops-lead', department: 'operations', hierarchy: 'head', isAdmin: true, canViewDepartments: ['warehouse', 'customer_support', 'finance', 'marketing'], active: true, overallRating: '4.6', reviewCount: 3, achievementCount: 5, location: 'Delhi NCR', joinDate: '2023-02-01' },
        { id: 's2', username: 'vikram', fullName: 'Vikram Mehta', mobile: '9000000002', role: 'manager', department: 'operations', hierarchy: 'manager', isAdmin: true, canViewDepartments: [], active: true, overallRating: '4.1', reviewCount: 2, achievementCount: 2, location: 'Delhi NCR' },
        { id: 's3', username: 'neha', fullName: 'Neha Saran', mobile: '9000000003', role: 'growth-lead', department: 'marketing', hierarchy: 'lead', isAdmin: true, canViewDepartments: [], active: true, overallRating: '4.4', reviewCount: 2, achievementCount: 4, location: 'Mumbai' },
        { id: 's4', username: 'rahul', fullName: 'Rahul Nair', mobile: '9000000004', role: 'warehouse-exec', department: 'warehouse', hierarchy: 'mid', isAdmin: false, canViewDepartments: [], active: true, overallRating: '3.9', reviewCount: 1, achievementCount: 1, location: 'Bhiwandi' },
        { id: 's5', username: 'priya', fullName: 'Priya Desai', mobile: '9000000005', role: 'support-lead', department: 'customer_support', hierarchy: 'lead', isAdmin: true, canViewDepartments: [], active: true, overallRating: '4.7', reviewCount: 3, achievementCount: 6, location: 'Delhi NCR' },
        { id: 's6', username: 'arjun', fullName: 'Arjun Bhatia', mobile: '9000000006', role: 'analyst', department: 'finance', hierarchy: 'junior', isAdmin: false, canViewDepartments: [], active: true, overallRating: '3.5', reviewCount: 1, achievementCount: 0, location: 'Delhi NCR' },
        { id: 's7', username: 'fatima', fullName: 'Fatima Sheikh', mobile: '9000000007', role: 'support-exec', department: 'customer_support', hierarchy: 'mid', isAdmin: false, canViewDepartments: [], active: true, overallRating: '4.0', reviewCount: 1, achievementCount: 2, location: 'Mumbai' }
    ];

    const projects = [
        { id: 'p1', name: 'Festive Drop 26', department: 'operations', ownerId: 's2', status: 'active', targetDate: dateStr(21) },
        { id: 'p2', name: 'RTO Reduction', department: 'customer_support', ownerId: 's5', status: 'active', targetDate: dateStr(40) },
        { id: 'p3', name: 'Warehouse SLA', department: 'warehouse', ownerId: 's2', status: 'planning', targetDate: dateStr(60) }
    ];

    const mkTask = (id, title, dept, state, prio, assignee, opts) => Object.assign({
        id, title, description: 'Mock description for ' + title + '. Deliverables, acceptance criteria and context would live here.',
        status: ({ draft: 'todo', assigned: 'todo', in_progress: 'in_progress', blocked: 'blocked', review: 'review', rework: 'in_progress', done: 'done', cancelled: 'done' })[state],
        workflowState: state, priority: prio, assignedTo: assignee, createdBy: 's1',
        department: dept, projectId: null, category: 'operations',
        dueDate: dateStr(3), progress: 0, estimatedHours: 8, actualHours: 0,
        subtasks: [], watchers: [], tags: [], attachments: [], stageHistory: [],
        timeLogged: [], dependsOn: [], notes: [], acknowledgedAt: null, completedAt: null,
        createdAt: iso(4 * day), updatedAt: iso(2 * day)
    }, opts || {});

    const tasks = [
        mkTask('t1', 'Freeze festive discount grid', 'operations', 'in_progress', 'critical', 's2', { projectId: 'p1', progress: 60, dueDate: dateStr(1), subtasks: [{ id: 'a', title: 'Margin sweep', done: true }, { id: 'b', title: 'Code generation', done: true }, { id: 'c', title: 'Sign-off with finance', done: false }], stageHistory: [{ from: null, to: 'draft', by: 'Simran Kohli', at: iso(4 * day) }, { from: 'draft', to: 'assigned', by: 'Simran Kohli', at: iso(3.6 * day) }, { from: 'assigned', to: 'in_progress', by: 'Vikram Mehta', at: iso(3 * day) }] }),
        mkTask('t2', 'Escalation playbook for premium tier', 'customer_support', 'review', 'high', 's5', { projectId: 'p2', progress: 90, stageHistory: [{ from: 'assigned', to: 'review', by: 'Priya Desai', at: iso(1 * day) }] }),
        mkTask('t3', 'Cycle count audit — Bhiwandi rack C', 'warehouse', 'assigned', 'medium', 's4', { dueDate: dateStr(-1), projectId: 'p3' }),
        mkTask('t4', 'Weekly RTO credit-note reconciliation', 'finance', 'done', 'high', 's6', { progress: 100, completedAt: iso(2 * day), dueDate: dateStr(-2) }),
        mkTask('t5', 'Creator briefs for drop teasers', 'marketing', 'blocked', 'high', 's3', { stageHistory: [{ from: 'in_progress', to: 'blocked', by: 'Neha Saran', at: iso(12 * 3600000) }] }),
        mkTask('t6', 'Return-label printer failover', 'warehouse', 'in_progress', 'critical', 's4', { progress: 35, dueDate: dateStr(0) }),
        mkTask('t7', 'Refund SLA dashboard mockup', 'customer_support', 'draft', 'low', null, {}),
        mkTask('t8', 'COD-to-prepaid nudge copy', 'marketing', 'rework', 'medium', 's3', { progress: 55 }),
        mkTask('t9', 'Picklist batching pilot', 'warehouse', 'todo' === 'x' ? 'todo' : 'draft', 'medium', 's2', { projectId: 'p3' }),
        mkTask('t10', 'GSTR-3B prep pack', 'finance', 'assigned', 'critical', 's6', { dueDate: dateStr(2) }),
        mkTask('t11', 'Courier scorecard — Nov', 'operations', 'done', 'medium', 's1', { progress: 100, completedAt: iso(5 * day) }),
        mkTask('t12', 'Docket weight tolerance policy', 'operations', 'review', 'high', 's2', { progress: 80 }),
        mkTask('t13', 'Sign off courier incentive revision', 'operations', 'in_progress', 'critical', 's1', { projectId: 'p1', progress: 40, dueDate: dateStr(2), subtasks: [{ id: 'a', title: 'Compare Q3 payouts', done: true }, { id: 'b', title: 'Draft revised slab', done: false }], stageHistory: [{ from: 'assigned', to: 'in_progress', by: 'Simran Kohli', at: iso(2 * day) }] }),
        mkTask('t14', 'Publish RTO policy to support macros', 'customer_support', 'assigned', 'medium', 's1', { dueDate: dateStr(-1) }),
        mkTask('t15', 'Approve annual warehouse capex note', 'warehouse', 'blocked', 'high', 's1', { stageHistory: [{ from: 'in_progress', to: 'blocked', by: 'Simran Kohli', at: iso(30 * 3600000) }] })
    ];

    const reviews = [
        { id: 'r0', staffId: 's1', reviewerId: 's1', reviewPeriod: '2026-Q3', overallRating: '4.6', timeliness: 5, quality: 5, communication: 4, collaboration: 5, initiative: 4, problemSolving: 5, strengths: 'Holds cross-department delivery to schedule; escalates cleanly.', improvements: 'Push more first-line decisions down to dept leads.', reviewType: 'manager', department: 'operations', createdAt: iso(31 * day) },
        { id: 'r1', staffId: 's4', reviewerId: 's2', reviewPeriod: '2026-Q3', overallRating: '3.9', timeliness: 3, quality: 4, communication: 4, collaboration: 4, initiative: 3, problemSolving: 4, strengths: 'Dependable on cycle counts; stays calm under dispatch pressure.', improvements: 'Could own blockers earlier instead of absorbing them.', reviewType: 'manager', department: 'warehouse', createdAt: iso(30 * day) },
        { id: 'r2', staffId: 's5', reviewerId: 's1', reviewPeriod: '2026-Q3', overallRating: '4.7', timeliness: 5, quality: 5, communication: 5, collaboration: 4, initiative: 5, problemSolving: 5, strengths: 'Rebuilt the escalation ladder in a week.', improvements: 'Delegate first-response queue to Fatima.', reviewType: 'manager', department: 'customer_support', createdAt: iso(29 * day) }
    ];
    const skills = [
        { id: 'k0', staffId: 's1', skillName: 'Logistics commercial negotiation', category: 'ops', proficiency: 5, yearsExperience: 7 },
        { id: 'k0b', staffId: 's1', skillName: 'P&L control', category: 'finance', proficiency: 4, yearsExperience: 4 },
        { id: 'k1', staffId: 's5', skillName: 'Escalation design', category: 'ops', proficiency: 5, yearsExperience: 4 },
        { id: 'k2', staffId: 's4', skillName: 'WMS operations', category: 'ops', proficiency: 4, yearsExperience: 3 },
        { id: 'k3', staffId: 's6', skillName: 'GST compliance', category: 'finance', proficiency: 3, yearsExperience: 2 },
        { id: 'k4', staffId: 's3', skillName: 'Paid social', category: 'growth', proficiency: 4, yearsExperience: 5 },
        { id: 'k5', staffId: 's2', skillName: 'Carrier negotiation', category: 'ops', proficiency: 5, yearsExperience: 6 }
    ];
    const okrs = [
        { id: 'o0', staffId: 's1', deptId: 'operations', objectiveText: 'Land Festive Drop 26 with sub-2% RTO', period: '2026-Q4', status: 'active', progress: 35, keyResults: [{ text: 'Discount grid frozen', target: 1, current: 0.6 }, { text: 'Courier SLA signed', target: 3, current: 1 }] },
        { id: 'o1', staffId: null, deptId: 'customer_support', objectiveText: 'Cut RTO rate from 9% to 5%', period: '2026-Q4', status: 'active', progress: 45, keyResults: [{ text: 'Playbook live', target: 1, current: 0.5 }, { text: 'Address validation on', target: 100, current: 60 }] },
        { id: 'o2', staffId: null, deptId: 'warehouse', objectiveText: 'Dispatch within SLA 98% of the time', period: '2026-Q4', status: 'active', progress: 71, keyResults: [{ text: 'SLA now', target: 98, current: 91 }] },
        { id: 'o3', staffId: 's6', deptId: 'finance', objectiveText: 'Zero late filings', period: '2026-Q4', status: 'achieved', progress: 100, keyResults: [] }
    ];
    const meetings = [
        { id: 'm1', staffId: 's4', organizerId: 's2', meetingType: '1on1', title: 'Rack C audit blockers', scheduledAt: iso(-1 * day), durationMinutes: 30, actionItems: [{ text: 'Order spare label roll', owner: 's4', done: false }], attendees: ['s2', 's4'], department: 'warehouse' },
        { id: 'm2', staffId: 's5', organizerId: 's1', meetingType: 'team', title: 'Weekly support sync', scheduledAt: iso(-12 * 3600000), durationMinutes: 45, actionItems: [], attendees: ['s5', 's7'], department: 'customer_support' }
    ];
    const achievements = [
        { id: 'ac0', staffId: 's1', title: 'Founder Award — Q3', description: 'Cut average dispatch time from 31h to 19h across both hubs.', category: 'impact', awardedBy: 's1', department: 'operations', createdAt: iso(12 * day) },
        { id: 'ac1', staffId: 's5', title: 'Save of the Quarter', description: 'Recovered a 400-order festival RTO cluster.', category: 'impact', awardedBy: 's1', department: 'customer_support', createdAt: iso(20 * day) },
        { id: 'ac2', staffId: 's4', title: 'Zero-defect month', description: 'No mispicks across 6,000 orders.', category: 'quality', awardedBy: 's2', department: 'warehouse', createdAt: iso(15 * day) }
    ];
    const goals = [
        { id: 'g0', staffId: 's1', department: 'operations', goalText: 'Hand the weekly courier review to Vikram', category: 'process', targetDate: dateStr(25), status: 'active', progress: 50, milestones: [{ text: 'Playbook written', done: true }, { text: 'Two solo reviews run', done: false }] },
        { id: 'g1', staffId: 's6', department: 'finance', goalText: 'Automate the weekly margin report', category: 'growth', targetDate: dateStr(45), status: 'active', progress: 30, milestones: [{ text: 'SQL views', done: true }, { text: 'Sheet sync', done: false }] },
        { id: 'g2', staffId: 's7', department: 'customer_support', goalText: 'First-line owner for WhatsApp queue', category: 'skills', targetDate: dateStr(20), status: 'active', progress: 65, milestones: [] }
    ];

    const channels = [
        { id: 'c1', type: 'dept', department: 'operations', name: 'operations', createdBy: 's1', pinnedMessageIds: [], memberStaffIds: ['s1', 's2'], createdAt: iso(60 * day) },
        { id: 'c2', type: 'dept', department: 'warehouse', name: 'warehouse', createdBy: 's1', pinnedMessageIds: [], memberStaffIds: ['s2', 's4'], createdAt: iso(60 * day) },
        { id: 'c3', type: 'dept', department: 'customer_support', name: 'customer_support', createdBy: 's1', pinnedMessageIds: [], memberStaffIds: ['s5', 's7'], createdAt: iso(60 * day) },
        { id: 'c4', type: 'group', name: 'Festive Drop war room', createdBy: 's1', pinnedMessageIds: ['x1'], memberStaffIds: ['s1', 's2', 's3', 's5'], createdAt: iso(6 * day) },
        { id: 'c5', type: 'direct', name: null, createdBy: 's2', pinnedMessageIds: [], memberStaffIds: ['s1', 's2'], createdAt: iso(2 * day) },
        { id: 'c6', type: 'task', name: 'Freeze festive discount grid', taskId: 't1', createdBy: 's1', pinnedMessageIds: [], memberStaffIds: ['s1', 's2'], createdAt: iso(3.5 * day) },
        { id: 'c7', type: 'task', name: 'Sign off courier incentive revision', taskId: 't13', createdBy: 's1', pinnedMessageIds: [], memberStaffIds: ['s1', 's2'], createdAt: iso(2 * day) }
    ];
    const messages = {
        c1: [
            { id: 'x1', channelId: 'c1', senderId: 's2', senderName: 'Vikram Mehta', text: 'Carrier scorecard for Nov is in @admin — Delhivery slipped on Tier-2.', reactions: { '+1': ['s1'] }, attachments: [], mentions: ['s1'], createdAt: iso(3 * day) },
            { id: 'x2', channelId: 'c1', senderId: 's1', senderName: 'Simran Kohli', text: 'Ack. Escalate via the weekly review, and hold the discount grid freeze till the margin sweep is signed.', reactions: {}, attachments: [], mentions: [], createdAt: iso(2.9 * day) },
            { id: 'x3', channelId: 'c1', senderId: 's2', senderName: 'Vikram Mehta', text: 'Printer failover on rack C is critical — Rahul is on it, ETA tomorrow.', reactions: { eye: ['s1', 's5'] }, attachments: [], mentions: [], createdAt: iso(5 * 3600000) }
        ],
        c4: [
            { id: 'y1', channelId: 'c4', senderId: 's3', senderName: 'Neha Saran', text: 'Creator briefs blocked till the discount grid is final. Any ETA?', reactions: {}, attachments: [], mentions: [], createdAt: iso(20 * 3600000) },
            { id: 'y2', channelId: 'c4', senderId: 's1', senderName: 'Simran Kohli', text: 'Vikram targets EOD tomorrow — teasers can go out with code-free copy meanwhile.', reactions: { ok: ['s3'] }, attachments: [], mentions: [], createdAt: iso(19 * 3600000) }
        ],
        c5: [
            { id: 'z1', channelId: 'c5', senderId: 's2', senderName: 'Vikram Mehta', text: 'Can you join the call with BlueDart at 4?', reactions: {}, attachments: [], mentions: [], createdAt: iso(3 * 3600000) },
            { id: 'z2', channelId: 'c5', senderId: 's1', senderName: 'Simran Kohli', text: 'Yes. Send the agenda.', reactions: { '+1': ['s2'] }, attachments: [], mentions: [], createdAt: iso(2.8 * 3600000) }
        ],
        c6: [
            { id: 'w1', channelId: 'c6', senderId: 's1', senderName: 'System', text: 'Task assigned by Simran Kohli', reactions: {}, attachments: [], mentions: [], createdAt: iso(3.6 * day) },
            { id: 'w2', channelId: 'c6', senderId: 's2', senderName: 'Vikram Mehta', text: 'Margin sweep done. Waiting on finance for sign-off — Arjun?', reactions: {}, attachments: [], mentions: [], createdAt: iso(1 * day) }
        ],
        c7: [
            { id: 'q1', channelId: 'c7', senderId: 's1', senderName: 'Simran Kohli', text: 'Slab draft is at 40% — need the Q3 payout comparison before this goes to finance.', reactions: {}, attachments: [], mentions: [], createdAt: iso(6 * 3600000) }
        ],
        c2: [{ id: 'v1', channelId: 'c2', senderId: 's4', senderName: 'Rahul Nair', text: 'Rack C count starts tomorrow 9am.', reactions: {}, attachments: [], mentions: [], createdAt: iso(8 * 3600000) }],
        c3: [{ id: 'u1', channelId: 'c3', senderId: 's5', senderName: 'Priya Desai', text: 'Premium tier escalations route to me after 2 unfixed touches.', reactions: { ok: ['s7'] }, attachments: [], mentions: [], createdAt: iso(26 * 3600000) }]
    };

    const stats = () => ({
        totalTasks: tasks.length, totalStaff: staff.filter((s) => s.active).length,
        byStatus: tasks.reduce((a, t) => (a[t.status] = (a[t.status] || 0) + 1, a), { todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0 }),
        byPriority: { low: 1, medium: 4, high: 4, critical: 3 },
        byDepartment: { operations: { members: 2, tasks: 4, done: 1 }, warehouse: { members: 1, tasks: 4, done: 0 }, customer_support: { members: 2, tasks: 2, done: 0 }, marketing: { members: 1, tasks: 2, done: 0 }, finance: { members: 1, tasks: 2, done: 1 } },
        byMember: staff.map((s) => ({ id: s.id, name: s.fullName, department: s.department, total: tasks.filter((t) => t.assignedTo === s.id).length, done: tasks.filter((t) => t.assignedTo === s.id && t.status === 'done').length })),
        overdue: tasks.filter((t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date()).length,
        totalEstimated: 96, totalActual: 41
    });
    const premiumStats = () => ({
        ...stats(),
        totalReviews: reviews.length, totalSkills: skills.length, uniqueSkills: skills.length,
        totalOkrs: okrs.length, totalMeetings: meetings.length, totalAchievements: achievements.length, totalGoals: goals.length,
        avgRating: 4.2, onTimeRate: 78, okrAchievementRate: 33,
        velocity: Array.from({ length: 8 }, (_, i) => ({ week: dateStr(-(7 - i) * 7 - 2), count: [2, 3, 1, 4, 3, 5, 2, 4][i] })),
        upcomingMeetings: 3,
        byDepartment: stats().byDepartment
    });

    // --- routing -------------------------------------------------------------
    let seq = 100;
    const nid = (p) => p + ++seq;
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const ok = (o) => Promise.resolve(o);

    function handle(method, url, body) {
        const u = url.split('?')[0];
        const q = new URLSearchParams(url.split('?')[1] || '');
        if (method === 'POST' && u === '/api/company/login') return ok({ success: true, token: 'mock', staff: clone(staff[0]) });
        if (u === '/api/company/me' && method === 'GET') return ok({ success: true, staff: clone(staff[0]) });
        if (u === '/api/company/me' && method === 'PUT') {
            const allow = ['fullName', 'email', 'avatarUrl', 'bio', 'location', 'timezone', 'mobile'];
            for (const k of allow) if (body[k] !== undefined) staff[0][k] = body[k];
            return ok({ success: true, staff: clone(staff[0]) });
        }
        if (method === 'GET' && u === '/api/company/console/departments') return ok({ success: true, departments: clone(departments) });
        // preview staff s1 is the platform admin, so dept CRUD is allowed here
        if (method === 'GET' && u === '/api/company/console/session') return ok({ success: true, platformAdmin: true });
        if (method === 'POST' && u === '/api/company/console/departments') {
            const d = { id: nid('d'), slug: body.slug || nid('dept_'), name: body.name, color: body.color, headStaffId: body.headStaffId || null, active: true };
            departments.push(d);
            return ok({ success: true, department: clone(d) });
        }
        const deptPut = /^\/api\/company\/console\/departments\/([^/]+)$/.exec(u);
        if (method === 'PUT' && deptPut) {
            const d = departments.find((x) => x.id === deptPut[1]);
            if (!d) return Promise.reject(new Error('Department not found'));
            Object.assign(d, body);
            return ok({ success: true, department: clone(d) });
        }
        if (method === 'DELETE' && deptPut) {
            const d = departments.find((x) => x.id === deptPut[1]);
            if (d) d.active = false;
            return ok({ success: true });
        }
        if (method === 'GET' && u === '/api/company/console/staff') return ok({ success: true, staff: clone(staff) });
        if (method === 'GET' && u === '/api/company/directory') return ok({ success: true, directory: staff.filter((s) => s.id !== 's1').map((s) => ({ id: s.id, name: s.fullName, username: s.username, department: s.department, role: s.role, avatarUrl: null })) });
        if (method === 'GET' && u === '/api/company/console/projects') return ok({ success: true, projects: clone(projects) });
        if (method === 'GET' && u === '/api/company/console/tasks') {
            let list = clone(tasks);
            if (q.get('department')) list = list.filter((t) => t.department === q.get('department'));
            if (q.get('status')) list = list.filter((t) => t.status === q.get('status'));
            return ok({ success: true, tasks: list });
        }
        if (method === 'POST' && u === '/api/company/console/tasks') {
            const t = mkTask(nid('t'), body.title || 'Untitled', body.department || 'operations', body.workflowState || 'draft', body.priority || 'medium', body.assignedTo || null, { progress: body.progress || 0, dueDate: body.dueDate || null });
            tasks.unshift(t);
            return ok({ success: true, task: clone(t) });
        }
        const taskPut = /^\/api\/company\/console\/tasks\/([^/]+)$/.exec(u);
        if (method === 'PUT' && taskPut) {
            const t = tasks.find((x) => x.id === taskPut[1]);
            if (!t) return Promise.reject(new Error('Task not found'));
            Object.assign(t, body);
            if (body.workflowState) t.status = ({ draft: 'todo', assigned: 'todo', in_progress: 'in_progress', blocked: 'blocked', review: 'review', rework: 'in_progress', done: 'done', cancelled: 'done' })[body.workflowState] || t.status;
            return ok({ success: true, task: clone(t) });
        }
        const taskGet = /^\/api\/company\/console\/tasks\/([^/]+)$/.exec(u);
        if (method === 'GET' && taskGet) {
            const t = tasks.find((x) => x.id === taskGet[1]);
            return ok({ success: true, task: clone(t), comments: [], channelId: channels.find((c) => c.taskId === t.id) ? channels.find((c) => c.taskId === t.id).id : 'c6' });
        }
        if (method === 'GET' && u === '/api/company/console/stats') return ok({ success: true, stats: stats() });
        if (method === 'GET' && u === '/api/company/console/premium-stats') return ok({ success: true, stats: premiumStats() });
        if (method === 'GET' && u === '/api/company/console/feed') return ok({ success: true, feed: [{ kind: 'task:stage', taskTitle: 'Freeze festive discount grid', at: iso(5 * 3600000), by: 'Vikram Mehta', detail: 'assigned -> in_progress' }, { kind: 'task:stage', taskTitle: 'GSTR-3B prep pack', at: iso(9 * 3600000), by: 'Simran Kohli', detail: 'draft -> assigned' }] });
        if (method === 'GET' && u === '/api/company/console/reviews') return ok({ success: true, reviews: clone(reviews) });
        if (method === 'GET' && u === '/api/company/console/skills') return ok({ success: true, skills: clone(skills) });
        if (method === 'GET' && u === '/api/company/console/skill-matrix') return ok({ success: true, matrix: staff.map((s) => ({ member: clone(s), skills: Object.fromEntries(skills.filter((k) => k.staffId === s.id).map((k) => [k.skillName, { category: k.category, proficiency: k.proficiency, yearsExperience: k.yearsExperience }])) })) });
        if (method === 'GET' && u === '/api/company/console/okrs') return ok({ success: true, okrs: clone(okrs) });
        if (method === 'GET' && u === '/api/company/console/meetings') return ok({ success: true, meetings: clone(meetings) });
        if (method === 'GET' && u === '/api/company/console/achievements') return ok({ success: true, achievements: clone(achievements) });
        if (method === 'GET' && u === '/api/company/console/goals') return ok({ success: true, goals: clone(goals) });
        if (method === 'GET' && u === '/api/company/my/tasks') return ok({ success: true, tasks: clone(tasks.filter((t) => t.assignedTo === 's1')) });
        if (method === 'GET' && u === '/api/company/my/reference') return ok({ success: true, departments: clone(departments), projects: clone(projects), workflow: { draft: ['assigned', 'cancelled'], assigned: ['in_progress', 'blocked', 'cancelled'], in_progress: ['blocked', 'review', 'cancelled'], blocked: ['in_progress', 'assigned', 'cancelled'], review: ['rework', 'done'], rework: ['in_progress', 'review'], done: ['rework'], cancelled: ['draft'] } });
        const myPut = /^\/api\/company\/my\/tasks\/([^/]+)$/.exec(u);
        if (method === 'PUT' && myPut) {
            const t = tasks.find((x) => x.id === myPut[1]);
            if (!t) return Promise.reject(new Error('Task not found or not assigned to you'));
            Object.assign(t, body);
            if (body.workflowState) t.status = ({ draft: 'todo', assigned: 'todo', in_progress: 'in_progress', blocked: 'blocked', review: 'review', rework: 'in_progress', done: 'done', cancelled: 'done' })[body.workflowState] || t.status;
            return ok({ success: true, task: clone(t) });
        }
        const myAck = /^\/api\/company\/my\/tasks\/([^/]+)\/acknowledge$/.exec(u);
        if (method === 'POST' && myAck) {
            const t = tasks.find((x) => x.id === myAck[1]);
            if (!t) return Promise.reject(new Error('Task not found'));
            t.acknowledgedAt = new Date().toISOString();
            return ok({ success: true, task: clone(t) });
        }
        const myLog = /^\/api\/company\/my\/tasks\/([^/]+)\/log$/.exec(u);
        if (method === 'POST' && myLog) {
            const t = tasks.find((x) => x.id === myLog[1]);
            if (!t) return Promise.reject(new Error('Task not found'));
            t.timeLogged = (t.timeLogged || []).concat([{ by: 'Simran Kohli', byId: 's1', minutes: parseInt(body.minutes, 10) || 0, note: body.note || '', at: new Date().toISOString() }]);
            t.actualHours = Math.round(t.timeLogged.reduce((a, e) => a + (e.minutes || 0), 0) / 60);
            return ok({ success: true, task: clone(t) });
        }
        if (method === 'GET' && u === '/api/company/my/stats') {
            const mine = tasks.filter((t) => t.assignedTo === 's1');
            const pick = (arr) => arr.filter((x) => x.staffId === 's1');
            return ok({
                success: true,
                stats: {
                    totalTasks: mine.length,
                    completed: mine.filter((t) => t.status === 'done').length,
                    overdue: mine.filter((t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date()).length,
                    avgRating: staff[0].overallRating,
                    reviewCount: pick(reviews).length, skillCount: pick(skills).length,
                    activeOkrs: pick(okrs).filter((o) => o.status === 'active').length,
                    activeGoals: pick(goals).filter((g) => g.status === 'active').length,
                    achievementCount: pick(achievements).length,
                    reviews: clone(pick(reviews)), skills: clone(pick(skills)), okrs: clone(pick(okrs)),
                    goals: clone(pick(goals)), achievements: clone(pick(achievements)), tasks: clone(mine)
                }
            });
        }
        if (method === 'GET' && u === '/api/company/chat/channels') return ok({ success: true, channels: clone(channels), unread: { c1: 2, c4: 1 } });
        if (method === 'POST' && u === '/api/company/chat/channels') {
            const ids = [...new Set([...(body.staffIds || []), 's1'])];
            if (body.type === 'direct') {
                const existing = channels.find((c) => c.type === 'direct' &&
                    c.memberStaffIds.length === ids.length && ids.every((i) => c.memberStaffIds.includes(i)));
                if (existing) return ok({ success: true, channel: clone(existing) });
            }
            const ch = { id: nid('c'), type: body.type || 'group', name: body.name || null, createdBy: 's1', pinnedMessageIds: [], memberStaffIds: ids, createdAt: new Date().toISOString() };
            channels.push(ch); messages[ch.id] = [];
            return ok({ success: true, channel: clone(ch) });
        }
        if (method === 'GET' && u === '/api/company/console/channels') return ok({ success: true, channels: clone(channels) });
        const memGet = /^\/api\/company\/chat\/channels\/([^/]+)\/members$/.exec(u);
        if (method === 'GET' && memGet) {
            const ch = channels.find((c) => c.id === memGet[1]);
            return ok({ success: true, members: (ch ? ch.memberStaffIds : []).map((id) => { const s = staff.find((x) => x.id === id); return { staffId: id, role: 'member', name: s.fullName, department: s.department, avatarUrl: null }; }) });
        }
        const msgGet = /^\/api\/company\/chat\/channels\/([^/]+)\/messages$/.exec(u);
        if (method === 'GET' && msgGet) {
            const list = messages[msgGet[1]] || [];
            const limit = parseInt(q.get('limit'), 10) || 50;
            let window = list;
            if (q.get('beforeId')) {
                const i = list.findIndex((m) => m.id === q.get('beforeId'));
                window = i < 0 ? [] : list.slice(0, i);
            }
            return ok({ success: true, messages: clone(window.slice(Math.max(0, window.length - limit))) });
        }
        const msgPost = /^\/api\/company\/chat\/channels\/([^/]+)\/messages$/.exec(u);
        if (method === 'POST' && msgPost) {
            const m = { id: nid('x'), channelId: msgPost[1], senderId: 's1', senderName: 'Simran Kohli', text: body.text, replyTo: body.replyTo || null, reactions: {}, attachments: [], mentions: [], createdAt: new Date().toISOString() };
            (messages[m.channelId] = messages[m.channelId] || []).push(m);
            return ok({ success: true, message: clone(m) });
        }
        const readM = /^\/api\/company\/chat\/channels\/([^/]+)\/read$/.exec(u);
        if (method === 'POST' && readM) return ok({ success: true });
        const msgOne = /^\/api\/company\/chat\/messages\/([^/]+)$/.exec(u);
        if (method === 'PUT' && msgOne) {
            const hit = findMessage(msgOne[1]);
            if (!hit) return Promise.reject(new Error('Message not found'));
            hit.m.text = String(body.text || '').slice(0, 8000);
            hit.m.editedAt = new Date().toISOString();
            return ok({ success: true, message: clone(hit.m) });
        }
        if (method === 'DELETE' && msgOne) {
            const hit = findMessage(msgOne[1]);
            if (hit) hit.list.splice(hit.list.indexOf(hit.m), 1);
            return ok({ success: true });
        }
        const rxOne = /^\/api\/company\/chat\/messages\/([^/]+)\/react$/.exec(u);
        if (method === 'POST' && rxOne) return ok({ success: true, message: wsReact(rxOne[1], body.emoji) });
        const pinM = /^\/api\/company\/chat\/channels\/([^/]+)\/pin$/.exec(u);
        if (method === 'POST' && pinM) { const ch = channels.find((c) => c.id === pinM[1]); if (ch) ch.pinnedMessageIds = body.messageIds || []; return ok({ success: true, channel: clone(ch) }); }
        if (method === 'POST' && /\/log$/.test(u)) return ok({ success: true, task: clone(tasks[0]) });
        if (method === 'POST' && /\/acknowledge$/.test(u)) return ok({ success: true, task: clone(tasks[0]) });
        if (method === 'POST' && /\/ai\/chat$/.test(u)) return ok({ success: true, reply: 'AI tools are disabled in mock preview. Deployed mode queries live data through companyOpsTools.' });
        // generic write echo so modals close happily in preview
        return ok({ success: true });
    }

    function wsSend(id, channelId, text, replyTo, deliver) {
        const m = { id: 'srv' + id, channelId, senderId: 's1', senderName: 'Simran Kohli', text, replyTo: replyTo || null, reactions: {}, attachments: [], mentions: [], createdAt: new Date().toISOString() };
        (messages[channelId] = messages[channelId] || []).push(m);
        setTimeout(() => deliver(clone(m)), 150);
        return clone(m);
    }

    // Socket-side mutations replayed locally: in the preview the WebSocket never
    // connects, so edit/delete/react fall through to these to keep parity.
    function findMessage(id) {
        for (const list of Object.values(messages)) {
            const m = list.find((x) => x.id === id);
            if (m) return { m, list };
        }
        return null;
    }
    function wsReact(messageId, emoji) {
        const hit = findMessage(messageId);
        if (!hit || !emoji) return null;
        hit.m.reactions = hit.m.reactions || {};
        const users = (hit.m.reactions[emoji] || []).map(String);
        const i = users.indexOf('s1');
        if (i >= 0) users.splice(i, 1); else users.push('s1');
        if (users.length) hit.m.reactions[emoji] = users; else delete hit.m.reactions[emoji];
        return clone(hit.m);
    }
    function wsEdit(messageId, text) {
        const hit = findMessage(messageId);
        if (!hit) return null;
        hit.m.text = String(text || '').slice(0, 8000);
        hit.m.editedAt = new Date().toISOString();
        return clone(hit.m);
    }
    function wsDelete(messageId) {
        const hit = findMessage(messageId);
        if (!hit) return null;
        hit.list.splice(hit.list.indexOf(hit.m), 1);
        return { id: messageId, deleted: true };
    }

    global.CompanyMock = { handle, wsSend, wsReact, wsEdit, wsDelete, staff, tasks, departments };
})(window);
