/**
 * AI data store (exchange-return system) — pending actions, chat history,
 * usage logging, daily limits. Backed by the shared Supabase JS client.
 * Tables created by supabase_migration_ai_assistant.sql.
 */

const supabase = require('../supabase');
const { computeCostUsd } = require('./aiClient');

const PENDING_ACTION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const HISTORY_MAX_TURNS = 20;

// ---------- Pending actions (confirmation flow) ----------

async function createPendingAction({ actor, toolName, toolArgs, summary }) {
    const { data, error } = await supabase
        .from('ai_pending_actions')
        .insert({
            actor,
            tool_name: toolName,
            tool_args: toolArgs || {},
            summary: summary || toolName,
            status: 'pending',
            expires_at: new Date(Date.now() + PENDING_ACTION_TTL_MS).toISOString()
        })
        .select()
        .single();
    if (error) throw new Error(`Failed to save pending action: ${error.message}`);
    return data;
}

async function getPendingAction(id) {
    const { data } = await supabase.from('ai_pending_actions').select('*').eq('id', id).single();
    return data || null;
}

async function updatePendingAction(id, fields) {
    await supabase.from('ai_pending_actions').update(fields).eq('id', id);
}

/** Claim a pending action for execution (validates actor, status, expiry). */
async function claimPendingAction(id, actor) {
    const action = await getPendingAction(id);
    if (!action) return { ok: false, error: 'Action not found' };
    if (action.actor !== actor) return { ok: false, error: 'This action belongs to another user' };
    if (action.status !== 'pending') return { ok: false, error: `Action is already ${action.status}` };
    if (action.expires_at && new Date(action.expires_at).getTime() < Date.now()) {
        await updatePendingAction(id, { status: 'expired' });
        return { ok: false, error: 'Action expired (10 minute limit). Please ask the copilot again.' };
    }
    await updatePendingAction(id, { status: 'confirmed' });
    return { ok: true, action };
}

async function cancelPendingAction(id, actor) {
    const action = await getPendingAction(id);
    if (!action) return { ok: false, error: 'Action not found' };
    if (action.actor !== actor) return { ok: false, error: 'This action belongs to another user' };
    if (action.status !== 'pending') return { ok: false, error: `Action is already ${action.status}` };
    await updatePendingAction(id, { status: 'cancelled' });
    return { ok: true };
}

// ---------- Chat history ----------

async function getChatHistory(actor) {
    const { data } = await supabase
        .from('ai_chat_history')
        .select('id, role, content')
        .eq('actor', actor)
        .order('id', { ascending: false })
        .limit(HISTORY_MAX_TURNS);
    return (data || []).reverse().map(r => ({ role: r.role, content: r.content }));
}

async function appendChatHistory(actor, role, content) {
    await supabase.from('ai_chat_history').insert({
        actor,
        role,
        content: typeof content === 'string' ? content.substring(0, 8000) : JSON.stringify(content)
    });
}

async function pruneChatHistory(actor) {
    // Keep only the newest HISTORY_MAX_TURNS rows per actor
    const { data } = await supabase
        .from('ai_chat_history')
        .select('id')
        .eq('actor', actor)
        .order('id', { ascending: false })
        .range(HISTORY_MAX_TURNS, HISTORY_MAX_TURNS + 200);
    if (data && data.length) {
        await supabase.from('ai_chat_history').delete().in('id', data.map(r => r.id));
    }
}

async function clearChatHistory(actor) {
    await supabase.from('ai_chat_history').delete().eq('actor', actor);
}

// ---------- Usage logging & daily limits ----------

async function logUsage({ actor, kind, model, promptTokens, completionTokens, toolCalls }) {
    try {
        await supabase.from('ai_usage_log').insert({
            actor: actor || 'unknown',
            kind: kind || 'chat',
            model: model || null,
            prompt_tokens: promptTokens || 0,
            completion_tokens: completionTokens || 0,
            cost_usd: Number(computeCostUsd(promptTokens || 0, completionTokens || 0).toFixed(6)),
            tool_calls: toolCalls && toolCalls.length ? JSON.stringify(toolCalls).substring(0, 2000) : null
        });
    } catch (e) {
        console.error('[AI] Failed to log usage:', e.message);
    }
}

function todayStartIso() {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
}

/** Count of AI requests by this actor today (UTC). */
async function getTodayUsageCount(actor, kind = null) {
    let query = supabase
        .from('ai_usage_log')
        .select('id', { count: 'exact', head: true })
        .eq('actor', actor)
        .gte('created_at', todayStartIso());
    if (kind) query = query.eq('kind', kind);
    const { count } = await query;
    return count || 0;
}

/** Aggregate usage stats for the dashboard widget (aggregated in JS). */
async function getUsageStats(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
        .from('ai_usage_log')
        .select('kind, prompt_tokens, completion_tokens, cost_usd, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000);

    const rows = data || [];
    const dailyMap = new Map();
    const totals = { requests: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };
    for (const r of rows) {
        const day = String(r.created_at).substring(0, 10);
        const key = `${day}|${r.kind}`;
        if (!dailyMap.has(key)) {
            dailyMap.set(key, { day, kind: r.kind, requests: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 });
        }
        const bucket = dailyMap.get(key);
        bucket.requests += 1;
        bucket.prompt_tokens += r.prompt_tokens || 0;
        bucket.completion_tokens += r.completion_tokens || 0;
        bucket.cost_usd += Number(r.cost_usd) || 0;
        totals.requests += 1;
        totals.prompt_tokens += r.prompt_tokens || 0;
        totals.completion_tokens += r.completion_tokens || 0;
        totals.cost_usd += Number(r.cost_usd) || 0;
    }
    return { daily: Array.from(dailyMap.values()), totals };
}

module.exports = {
    createPendingAction,
    getPendingAction,
    updatePendingAction,
    claimPendingAction,
    cancelPendingAction,
    getChatHistory,
    appendChatHistory,
    pruneChatHistory,
    clearChatHistory,
    logUsage,
    getTodayUsageCount,
    getUsageStats
};
