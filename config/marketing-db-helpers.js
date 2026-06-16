/**
 * Marketing Dashboard - Database Helpers
 * 
 * All database operations for the marketing module.
 * Isolated from existing db-helpers.js to prevent any impact on return/exchange functionality.
 * Uses the same Supabase client from config/supabase.js.
 */

const supabase = require('./supabase');

// ════════════════════════════════════════════════════════════════
// CUSTOMER INTELLIGENCE
// ════════════════════════════════════════════════════════════════

async function getMarketingCustomers(filters = {}) {
    let query = supabase.from('marketing_customers').select('*', { count: 'exact' });

    if (filters.segment) query = query.eq('segment', filters.segment);
    if (filters.tier) query = query.eq('lifetime_value_tier', filters.tier);
    if (filters.acceptsMarketing !== undefined && filters.acceptsMarketing !== '') {
        query = query.eq('accepts_marketing', filters.acceptsMarketing === 'true' || filters.acceptsMarketing === true);
    }

    if (filters.search) {
        const s = filters.search;
        query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
    }

    if (filters.minSpent) query = query.gte('total_spent', parseFloat(filters.minSpent));
    if (filters.maxSpent) query = query.lte('total_spent', parseFloat(filters.maxSpent));
    if (filters.minOrders) query = query.gte('total_orders', parseInt(filters.minOrders));
    if (filters.churnRisk) query = query.eq('churn_risk', filters.churnRisk);
    if (filters.minHealth) query = query.gte('health_score', parseInt(filters.minHealth));
    if (filters.maxHealth) query = query.lte('health_score', parseInt(filters.maxHealth));

    const sortBy = filters.sortBy || 'created_at';
    const sortOrder = filters.sortOrder || 'desc';
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 50;
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    return {
        data: data || [],
        pagination: { total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) }
    };
}

async function getMarketingCustomerById(id) {
    const { data, error } = await supabase.from('marketing_customers').select('*').eq('id', id).single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
}

async function getMarketingCustomerByEmail(email) {
    const { data, error } = await supabase.from('marketing_customers').select('*').ilike('email', email).single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
}

async function upsertMarketingCustomer(customerData) {
    const row = {
        shopify_customer_id: customerData.shopifyCustomerId || null,
        first_name: customerData.firstName || null,
        last_name: customerData.lastName || null,
        email: customerData.email,
        phone: customerData.phone || null,
        total_orders: customerData.totalOrders || 0,
        total_spent: customerData.totalSpent || 0,
        average_order_value: customerData.averageOrderValue || 0,
        last_order_date: customerData.lastOrderDate || null,
        first_order_date: customerData.firstOrderDate || null,
        tags: customerData.tags || [],
        location: customerData.location || null,
        accepts_marketing: customerData.acceptsMarketing || false,
        verified_email: customerData.verifiedEmail || false,
        segment: customerData.segment || 'general',
        lifetime_value_tier: customerData.lifetimeValueTier || 'bronze',
        health_score: customerData.healthScore != null ? customerData.healthScore : 0,
        churn_risk: customerData.churnRisk || 'low',
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from('marketing_customers')
        .upsert(row, { onConflict: customerData.shopifyCustomerId ? 'shopify_customer_id' : 'email' })
        .select().single();
    if (error) throw error;
    return data;
}

// Batch upsert customers - much faster than one-by-one
async function batchUpsertMarketingCustomers(customersArray) {
    if (!customersArray || customersArray.length === 0) return [];
    const now = new Date().toISOString();
    const rows = customersArray.map(c => ({
        shopify_customer_id: c.shopifyCustomerId || null,
        first_name: c.firstName || null,
        last_name: c.lastName || null,
        email: c.email,
        phone: c.phone || null,
        total_orders: c.totalOrders || 0,
        total_spent: c.totalSpent || 0,
        average_order_value: c.averageOrderValue || 0,
        last_order_date: c.lastOrderDate || null,
        first_order_date: c.firstOrderDate || null,
        tags: c.tags || [],
        location: c.location || null,
        accepts_marketing: c.acceptsMarketing || false,
        verified_email: c.verifiedEmail || false,
        segment: c.segment || 'general',
        lifetime_value_tier: c.lifetimeValueTier || 'bronze',
        health_score: c.healthScore != null ? c.healthScore : 0,
        churn_risk: c.churnRisk || 'low',
        last_synced_at: now,
        updated_at: now
    }));
    const { data, error } = await supabase
        .from('marketing_customers')
        .upsert(rows, { onConflict: 'shopify_customer_id' })
        .select();
    if (error) throw error;
    return data || [];
}

// Get the most recent sync timestamp from existing customers
async function getLastCustomerSyncTime() {
    const { data, error } = await supabase
        .from('marketing_customers')
        .select('last_synced_at')
        .order('last_synced_at', { ascending: false })
        .limit(1)
        .single();
    if (error || !data) return null;
    return data.last_synced_at;
}

async function updateMarketingCustomer(id, updates) {
    const row = { updated_at: new Date().toISOString() };
    if (updates.segment !== undefined) row.segment = updates.segment;
    if (updates.tags !== undefined) row.tags = updates.tags;
    if (updates.notes !== undefined) row.notes = updates.notes;
    if (updates.customAttributes !== undefined) row.custom_attributes = updates.customAttributes;
    if (updates.acceptsMarketing !== undefined) row.accepts_marketing = updates.acceptsMarketing;
    if (updates.lifetimeValueTier !== undefined) row.lifetime_value_tier = updates.lifetimeValueTier;

    const { data, error } = await supabase.from('marketing_customers').update(row).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

async function getCustomerOrders(customerId) {
    const { data, error } = await supabase
        .from('marketing_customer_orders')
        .select('*').eq('customer_id', customerId).order('order_created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function upsertCustomerOrder(orderData) {
    const row = {
        customer_id: orderData.customerId,
        shopify_order_id: orderData.shopifyOrderId,
        order_name: orderData.orderName,
        total_price: orderData.totalPrice || 0,
        subtotal_price: orderData.subtotalPrice || 0,
        total_discount: orderData.totalDiscount || 0,
        currency: orderData.currency || 'INR',
        financial_status: orderData.financialStatus || null,
        fulfillment_status: orderData.fulfillmentStatus || null,
        cancelled_at: orderData.cancelledAt || null,
        line_items: orderData.lineItems || [],
        discount_codes: orderData.discountCodes || [],
        order_created_at: orderData.orderCreatedAt,
        synced_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from('marketing_customer_orders')
        .upsert(row, { onConflict: 'shopify_order_id' })
        .select().single();
    if (error) throw error;
    return data;
}

async function getCustomerStats() {
    const [{ count: total }] = await Promise.all([
        supabase.from('marketing_customers').select('*', { count: 'exact', head: true })
    ]);

    // Fetch segments and tiers in batches to avoid 1000 row limit
    const BATCH_SIZE = 1000;
    let allSegments = [];
    let allTiers = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const [{ data: segmentData }, { data: tierData }] = await Promise.all([
            supabase.from('marketing_customers').select('segment').range(offset, offset + BATCH_SIZE - 1),
            supabase.from('marketing_customers').select('lifetime_value_tier').range(offset, offset + BATCH_SIZE - 1)
        ]);

        if (!segmentData || segmentData.length === 0) {
            hasMore = false;
        } else {
            allSegments = allSegments.concat(segmentData);
            allTiers = allTiers.concat(tierData);
            offset += BATCH_SIZE;
            hasMore = segmentData.length === BATCH_SIZE;
        }
    }

    // Fetch new customers in last 30 days
    const { data: recentData } = await supabase
        .from('marketing_customers')
        .select('id')
        .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());

    const segments = {};
    (allSegments || []).forEach(c => { segments[c.segment] = (segments[c.segment] || 0) + 1; });

    const tiers = {};
    (allTiers || []).forEach(c => { tiers[c.lifetime_value_tier] = (tiers[c.lifetime_value_tier] || 0) + 1; });

    return { total: total || 0, segments, tiers, newLast30Days: (recentData || []).length };
}

// ── Customer Segments ──

async function getCustomerSegments() {
    const { data, error } = await supabase.from('marketing_customer_segments').select('*').order('name');
    if (error) throw error;
    return data || [];
}

async function getCustomersBySegment(segmentName, filters = {}) {
    const { data: segment } = await supabase
        .from('marketing_customer_segments').select('*').eq('name', segmentName).single();
    if (!segment) return { data: [], pagination: { total: 0 } };

    let query = supabase.from('marketing_customers').select('*', { count: 'exact' });

    // Apply segment rules
    const rules = segment.rules || {};
    if (rules.field === 'total_spent' && rules.operator === 'gt') query = query.gt('total_spent', rules.value);
    if (rules.field === 'total_orders' && rules.operator === 'gte') query = query.gte('total_orders', rules.value);
    if (rules.field === 'last_order_date' && rules.operator === 'lt' && rules.value === '90_days_ago') {
        query = query.lt('last_order_date', new Date(Date.now() - 90 * 86400000).toISOString());
    }
    if (rules.field === 'first_order_date' && rules.operator === 'gt' && rules.value === '30_days_ago') {
        query = query.gte('first_order_date', new Date(Date.now() - 30 * 86400000).toISOString());
    }
    if (rules.or) {
        // Handle OR conditions
        const orFilters = rules.or.map(r => {
            if (r.field === 'total_spent' && r.operator === 'gt') return `total_spent.gt.${r.value}`;
            if (r.field === 'total_orders' && r.operator === 'gte') return `total_orders.gte.${r.value}`;
            return null;
        }).filter(Boolean);
        if (orFilters.length > 0) query = query.or(orFilters.join(','));
    }

    if (filters.search) {
        const s = filters.search;
        query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`);
    }

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 50;
    const offset = (page - 1) * limit;
    query = query.order('total_spent', { ascending: false }).range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;
    return { data: data || [], pagination: { total: count || 0, page, limit } };
}

// ════════════════════════════════════════════════════════════════
// SMART CUSTOMER INTELLIGENCE (RFM, Health Score, Churn Risk)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute RFM-based health score (0-100) for a customer.
 * R = Recency (days since last order, lower is better)
 * F = Frequency (total orders)
 * M = Monetary (total spent)
 */
function computeHealthScore(customer) {
    const totalSpent = parseFloat(customer.total_spent) || 0;
    const totalOrders = parseInt(customer.total_orders) || 0;
    const lastOrderDate = customer.last_order_date ? new Date(customer.last_order_date) : null;
    const daysSinceLastOrder = lastOrderDate ? Math.floor((Date.now() - lastOrderDate.getTime()) / 86400000) : 999;

    // Recency Score (0-35): More recent = higher score
    let rScore = 0;
    if (daysSinceLastOrder <= 7) rScore = 35;
    else if (daysSinceLastOrder <= 30) rScore = 30;
    else if (daysSinceLastOrder <= 60) rScore = 22;
    else if (daysSinceLastOrder <= 90) rScore = 15;
    else if (daysSinceLastOrder <= 180) rScore = 8;
    else if (daysSinceLastOrder <= 365) rScore = 3;
    else rScore = 0;

    // Frequency Score (0-35): More orders = higher score
    let fScore = 0;
    if (totalOrders >= 20) fScore = 35;
    else if (totalOrders >= 10) fScore = 30;
    else if (totalOrders >= 5) fScore = 24;
    else if (totalOrders >= 3) fScore = 18;
    else if (totalOrders >= 2) fScore = 10;
    else if (totalOrders === 1) fScore = 5;
    else fScore = 0;

    // Monetary Score (0-30): Higher spend = higher score
    let mScore = 0;
    if (totalSpent >= 50000) mScore = 30;
    else if (totalSpent >= 20000) mScore = 26;
    else if (totalSpent >= 10000) mScore = 22;
    else if (totalSpent >= 5000) mScore = 17;
    else if (totalSpent >= 2000) mScore = 12;
    else if (totalSpent >= 500) mScore = 7;
    else if (totalSpent > 0) mScore = 3;
    else mScore = 0;

    return Math.min(100, rScore + fScore + mScore);
}

/**
 * Compute churn risk level based on recency and engagement.
 * Returns: 'low', 'medium', 'high', 'critical'
 */
function computeChurnRisk(customer) {
    const totalOrders = parseInt(customer.total_orders) || 0;
    if (totalOrders === 0) return 'low'; // Never ordered, can't churn

    const lastOrderDate = customer.last_order_date ? new Date(customer.last_order_date) : null;
    const daysSinceLastOrder = lastOrderDate ? Math.floor((Date.now() - lastOrderDate.getTime()) / 86400000) : 999;

    if (daysSinceLastOrder > 365) return 'critical';
    if (daysSinceLastOrder > 180) return 'high';
    if (daysSinceLastOrder > 90) return 'medium';
    return 'low';
}

/**
 * Smart RFM-based segmentation.
 * Returns segment name based on behavior patterns.
 */
function smartSegment(customer) {
    const totalSpent = parseFloat(customer.total_spent) || 0;
    const totalOrders = parseInt(customer.total_orders) || 0;
    const lastOrderDate = customer.last_order_date ? new Date(customer.last_order_date) : null;
    const daysSinceLastOrder = lastOrderDate ? Math.floor((Date.now() - lastOrderDate.getTime()) / 86400000) : 999;
    const firstOrderDate = customer.first_order_date ? new Date(customer.first_order_date) : null;
    const daysSinceFirst = firstOrderDate ? Math.floor((Date.now() - firstOrderDate.getTime()) / 86400000) : 999;

    // VIP: High spend + recent
    if (totalSpent >= 20000 && daysSinceLastOrder <= 90) return 'vip';
    // High Value: High spend but maybe less recent
    if (totalSpent >= 10000) return 'high_value';
    // At Risk: Was active but hasn't ordered recently
    if (totalOrders >= 2 && daysSinceLastOrder > 90 && daysSinceLastOrder <= 180) return 'at_risk';
    // Dormant: Haven't ordered in a long time
    if (totalOrders >= 1 && daysSinceLastOrder > 180) return 'dormant';
    // Repeat: Multiple orders, recent
    if (totalOrders >= 3 && daysSinceLastOrder <= 90) return 'repeat';
    // New: First order within last 30 days
    if (totalOrders >= 1 && daysSinceFirst <= 30) return 'new_customer';
    // General: Everyone else
    return 'general';
}

/**
 * Smart tier assignment based on lifetime value.
 */
function smartTier(totalSpent) {
    const spent = parseFloat(totalSpent) || 0;
    if (spent >= 50000) return 'platinum';
    if (spent >= 20000) return 'gold';
    if (spent >= 5000) return 'silver';
    return 'bronze';
}

/**
 * Recompute smart fields for ALL customers in the database.
 * Used by the /customers/recompute-segments endpoint.
 */
async function recomputeAllCustomerSegments() {
    // Fetch all customers in batches to avoid Supabase 1000 row limit
    const BATCH_SIZE = 1000;
    let allCustomers = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const { data: customers, error } = await supabase
            .from('marketing_customers')
            .select('id, total_spent, total_orders, last_order_date, first_order_date, segment, lifetime_value_tier')
            .range(offset, offset + BATCH_SIZE - 1);
        
        if (error) throw error;
        
        if (!customers || customers.length === 0) {
            hasMore = false;
        } else {
            allCustomers = allCustomers.concat(customers);
            offset += BATCH_SIZE;
            hasMore = customers.length === BATCH_SIZE;
        }
    }

    let updated = 0;
    const BATCH = 50;
    const batch = [];

    for (const c of allCustomers) {
        const newSegment = smartSegment(c);
        const newTier = smartTier(c.total_spent);
        const healthScore = computeHealthScore(c);
        const churnRisk = computeChurnRisk(c);

        const needsUpdate = c.segment !== newSegment || c.lifetime_value_tier !== newTier;

        batch.push({
            id: c.id,
            segment: newSegment,
            lifetime_value_tier: newTier,
            health_score: healthScore,
            churn_risk: churnRisk,
            updated_at: new Date().toISOString()
        });

        if (batch.length >= BATCH) {
            const { error: upsertErr } = await supabase.from('marketing_customers').upsert(batch, { onConflict: 'id' });
            if (upsertErr) console.error('[Smart Recompute] Batch error:', upsertErr.message);
            else updated += batch.length;
            batch.length = 0;
        }
    }

    // Final batch
    if (batch.length > 0) {
        const { error: upsertErr } = await supabase.from('marketing_customers').upsert(batch, { onConflict: 'id' });
        if (upsertErr) console.error('[Smart Recompute] Final batch error:', upsertErr.message);
        else updated += batch.length;
    }

    return { total: allCustomers.length, updated };
}

/**
 * Get smart customer stats with health/churn breakdowns.
 */
async function getSmartCustomerStats() {
    // Fetch all customers in batches to avoid Supabase 1000 row limit
    const BATCH_SIZE = 1000;
    let allCustomers = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
        const { data: customers, error } = await supabase
            .from('marketing_customers')
            .select('segment, lifetime_value_tier, created_at, health_score, churn_risk')
            .range(offset, offset + BATCH_SIZE - 1);
        
        if (error) throw error;
        
        if (!customers || customers.length === 0) {
            hasMore = false;
        } else {
            allCustomers = allCustomers.concat(customers);
            offset += BATCH_SIZE;
            hasMore = customers.length === BATCH_SIZE;
        }
    }

    const list = allCustomers;
    const total = list.length;
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 86400000;

    const segments = {};
    const tiers = {};
    let healthTotal = 0;
    let healthCount = 0;
    const churnBreakdown = { low: 0, medium: 0, high: 0, critical: 0 };
    const healthBreakdown = { excellent: 0, good: 0, average: 0, poor: 0 };

    list.forEach(c => {
        // Segments
        segments[c.segment] = (segments[c.segment] || 0) + 1;
        // Tiers
        tiers[c.lifetime_value_tier] = (tiers[c.lifetime_value_tier] || 0) + 1;
        // Health score
        if (c.health_score != null) {
            healthTotal += (parseInt(c.health_score) || 0);
            healthCount++;
            const hs = parseInt(c.health_score) || 0;
            if (hs >= 75) healthBreakdown.excellent++;
            else if (hs >= 50) healthBreakdown.good++;
            else if (hs >= 25) healthBreakdown.average++;
            else healthBreakdown.poor++;
        }
        // Churn risk
        const cr = (c.churn_risk || 'low').toLowerCase();
        if (churnBreakdown[cr] !== undefined) churnBreakdown[cr]++;
    });

    const newLast30Days = list.filter(c => new Date(c.created_at).getTime() > thirtyDaysAgo).length;
    const avgHealth = healthCount > 0 ? Math.round(healthTotal / healthCount) : 0;

    return {
        total,
        segments,
        tiers,
        newLast30Days,
        avgHealthScore: avgHealth,
        healthBreakdown,
        churnBreakdown,
        vipCount: (tiers.gold || 0) + (tiers.platinum || 0),
        atRiskCount: churnBreakdown.high + churnBreakdown.critical
    };
}

// ════════════════════════════════════════════════════════════════
// TEMPLATES
// ════════════════════════════════════════════════════════════════

async function getMarketingTemplates(filters = {}) {
    let query = supabase.from('marketing_templates').select('*');

    if (filters.category) query = query.eq('category', filters.category);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.isActive !== undefined) query = query.eq('is_active', filters.isActive);

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function getMarketingTemplateById(id) {
    const { data, error } = await supabase.from('marketing_templates').select('*').eq('id', id).single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
}

async function getMarketingTemplateByName(name) {
    const { data, error } = await supabase.from('marketing_templates').select('*').eq('name', name).single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
}

async function createMarketingTemplate(templateData) {
    const row = {
        name: templateData.name,
        category: templateData.category || 'marketing',
        language: templateData.language || 'en',
        status: templateData.status || 'draft',
        header: templateData.header || null,
        header_type: templateData.headerType || 'text',
        body: templateData.body,
        footer: templateData.footer || null,
        buttons: templateData.buttons || [],
        variables: templateData.variables || [],
        meta_template_id: templateData.metaTemplateId || null,
        meta_status: templateData.metaStatus || 'PENDING',
        created_by: templateData.createdBy || 'admin'
    };

    const { data, error } = await supabase.from('marketing_templates').insert([row]).select().single();
    if (error) throw error;
    return data;
}

async function updateMarketingTemplate(id, updates) {
    const row = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.category !== undefined) row.category = updates.category;
    if (updates.language !== undefined) row.language = updates.language;
    if (updates.status !== undefined) row.status = updates.status;
    if (updates.header !== undefined) row.header = updates.header;
    if (updates.headerType !== undefined) row.header_type = updates.headerType;
    if (updates.body !== undefined) row.body = updates.body;
    if (updates.footer !== undefined) row.footer = updates.footer;
    if (updates.buttons !== undefined) row.buttons = updates.buttons;
    if (updates.variables !== undefined) row.variables = updates.variables;
    if (updates.metaTemplateId !== undefined) row.meta_template_id = updates.metaTemplateId;
    if (updates.metaStatus !== undefined) row.meta_status = updates.metaStatus;
    if (updates.metaRejectionReason !== undefined) row.meta_rejection_reason = updates.metaRejectionReason;
    if (updates.isActive !== undefined) row.is_active = updates.isActive;

    const { data, error } = await supabase.from('marketing_templates').update(row).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

async function deleteMarketingTemplate(id) {
    const { error } = await supabase.from('marketing_templates').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    return { success: true };
}

// ════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ════════════════════════════════════════════════════════════════

async function getMarketingCampaigns(filters = {}) {
    let query = supabase.from('marketing_campaigns').select('*', { count: 'exact' });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.type) query = query.eq('type', filters.type);
    if (filters.search) query = query.ilike('name', `%${filters.search}%`);

    query = query.order('created_at', { ascending: false });

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 50;
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;
    return {
        data: data || [],
        pagination: { total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) }
    };
}

async function getMarketingCampaignById(id) {
    const { data, error } = await supabase.from('marketing_campaigns').select('*').eq('id', id).single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
}

async function createMarketingCampaign(campaignData) {
    const row = {
        name: campaignData.name,
        description: campaignData.description || null,
        type: campaignData.type || 'bulk',
        status: 'draft',
        template_id: campaignData.templateId || null,
        segment_filter: campaignData.segmentFilter || {},
        recipient_count: campaignData.recipientCount || 0,
        excluded_customers: campaignData.excludedCustomers || [],
        scheduled_at: campaignData.scheduledAt || null,
        send_window_start: campaignData.sendWindowStart || null,
        send_window_end: campaignData.sendWindowEnd || null,
        timezone: campaignData.timezone || 'Asia/Kolkata',
        budget: campaignData.budget || null,
        cost_per_message: campaignData.costPerMessage || null,
        created_by: campaignData.createdBy || 'admin',
        notes: campaignData.notes || null,
        tags: campaignData.tags || []
    };

    const { data, error } = await supabase.from('marketing_campaigns').insert([row]).select().single();
    if (error) throw error;
    return data;
}

async function updateMarketingCampaign(id, updates) {
    const row = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.description !== undefined) row.description = updates.description;
    if (updates.type !== undefined) row.type = updates.type;
    if (updates.status !== undefined) row.status = updates.status;
    if (updates.templateId !== undefined) row.template_id = updates.templateId;
    if (updates.segmentFilter !== undefined) row.segment_filter = updates.segmentFilter;
    if (updates.recipientCount !== undefined) row.recipient_count = updates.recipientCount;
    if (updates.excludedCustomers !== undefined) row.excluded_customers = updates.excludedCustomers;
    if (updates.scheduledAt !== undefined) row.scheduled_at = updates.scheduledAt;
    if (updates.sendWindowStart !== undefined) row.send_window_start = updates.sendWindowStart;
    if (updates.sendWindowEnd !== undefined) row.send_window_end = updates.sendWindowEnd;
    if (updates.budget !== undefined) row.budget = updates.budget;
    if (updates.costPerMessage !== undefined) row.cost_per_message = updates.costPerMessage;
    if (updates.notes !== undefined) row.notes = updates.notes;
    if (updates.tags !== undefined) row.tags = updates.tags;

    // Status transition timestamps
    if (updates.status === 'sending') row.started_at = new Date().toISOString();
    if (updates.status === 'sent') row.sent_at = new Date().toISOString();
    if (updates.status === 'sent' || updates.status === 'cancelled' || updates.status === 'failed') {
        row.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase.from('marketing_campaigns').update(row).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

// ── Campaign Recipients ──

async function addCampaignRecipients(campaignId, recipients) {
    const rows = recipients.map(r => ({
        campaign_id: campaignId,
        customer_id: r.customerId || null,
        phone: r.phone,
        customer_name: r.customerName || null,
        template_variables: r.templateVariables || {}
    }));

    const { data, error } = await supabase.from('marketing_campaign_recipients').insert(rows).select();
    if (error) throw error;
    return data;
}

async function getCampaignRecipients(campaignId, filters = {}) {
    let query = supabase.from('marketing_campaign_recipients').select('*', { count: 'exact' }).eq('campaign_id', campaignId);

    if (filters.status) query = query.eq('status', filters.status);

    query = query.order('created_at', { ascending: false });

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 100;
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;
    return {
        data: data || [],
        pagination: { total: count || 0, page, limit }
    };
}

async function updateCampaignRecipient(id, updates) {
    const row = {};
    if (updates.status !== undefined) row.status = updates.status;
    if (updates.metaMessageId !== undefined) row.meta_message_id = updates.metaMessageId;
    if (updates.metaConversationId !== undefined) row.meta_conversation_id = updates.metaConversationId;
    if (updates.metaPricingCategory !== undefined) row.meta_pricing_category = updates.metaPricingCategory;
    if (updates.errorMessage !== undefined) row.error_message = updates.errorMessage;
    if (updates.errorCode !== undefined) row.error_code = updates.errorCode;
    if (updates.sentAt !== undefined) row.sent_at = updates.sentAt;
    if (updates.deliveredAt !== undefined) row.delivered_at = updates.deliveredAt;
    if (updates.readAt !== undefined) row.read_at = updates.readAt;
    if (updates.repliedAt !== undefined) row.replied_at = updates.repliedAt;
    if (updates.failedAt !== undefined) row.failed_at = updates.failedAt;
    if (updates.queuedAt !== undefined) row.queued_at = updates.queuedAt;

    const { data, error } = await supabase.from('marketing_campaign_recipients').update(row).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

async function getCampaignRecipientStats(campaignId) {
    const { data, error } = await supabase
        .from('marketing_campaign_recipients').select('status').eq('campaign_id', campaignId);
    if (error) throw error;

    const stats = { pending: 0, queued: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, bounced: 0 };
    (data || []).forEach(r => { if (stats[r.status] !== undefined) stats[r.status]++; });
    return stats;
}

// ── Campaign Snapshots ──

async function createCampaignSnapshot(campaignId) {
    const stats = await getCampaignRecipientStats(campaignId);
    const row = {
        campaign_id: campaignId,
        sent_count: stats.sent + stats.delivered + stats.read + stats.replied,
        delivered_count: stats.delivered + stats.read + stats.replied,
        read_count: stats.read + stats.replied,
        replied_count: stats.replied,
        failed_count: stats.failed,
        total_cost: 0
    };

    const { data, error } = await supabase.from('marketing_campaign_snapshots').insert([row]).select().single();
    if (error) throw error;
    return data;
}

// ════════════════════════════════════════════════════════════════
// COUPONS
// ════════════════════════════════════════════════════════════════

async function getMarketingCoupons(filters = {}) {
    let query = supabase.from('marketing_coupons').select('*', { count: 'exact' });

    if (filters.isActive !== undefined) query = query.eq('is_active', filters.isActive);
    if (filters.isDeleted !== undefined) query = query.eq('is_deleted', filters.isDeleted);
    else query = query.eq('is_deleted', false);
    if (filters.discountType) query = query.eq('discount_type', filters.discountType);
    if (filters.campaignId) query = query.eq('campaign_id', filters.campaignId);
    if (filters.search) query = query.or(`code.ilike.%${filters.search}%,name.ilike.%${filters.search}%`);

    query = query.order('created_at', { ascending: false });

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 50;
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;
    return {
        data: data || [],
        pagination: { total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) }
    };
}

async function getMarketingCouponById(id) {
    const { data, error } = await supabase.from('marketing_coupons').select('*').eq('id', id).single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
}

async function getMarketingCouponByCode(code) {
    const { data, error } = await supabase.from('marketing_coupons').select('*').ilike('code', code).single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
}

async function createMarketingCoupon(couponData) {
    const row = {
        code: couponData.code.toUpperCase(),
        name: couponData.name || null,
        description: couponData.description || null,
        discount_type: couponData.discountType || 'percentage',
        discount_value: parseFloat(couponData.discountValue),
        min_purchase_amount: parseFloat(couponData.minPurchaseAmount) || 0,
        max_discount_amount: couponData.maxDiscountAmount ? parseFloat(couponData.maxDiscountAmount) : null,
        applies_to: couponData.appliesTo || 'all',
        usage_limit: couponData.usageLimit || null,
        usage_limit_per_customer: couponData.usageLimitPerCustomer || 1,
        applicable_products: couponData.applicableProducts || [],
        applicable_collections: couponData.applicableCollections || [],
        segment_target: couponData.segmentTarget || null,
        campaign_id: couponData.campaignId || null,
        starts_at: couponData.startsAt || null,
        expires_at: couponData.expiresAt || null,
        is_active: couponData.isActive !== undefined ? couponData.isActive : true,
        created_by: couponData.createdBy || 'admin'
    };

    const { data, error } = await supabase.from('marketing_coupons').insert([row]).select().single();
    if (error) throw error;
    return data;
}

async function updateMarketingCoupon(id, updates) {
    const row = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) row.name = updates.name;
    if (updates.description !== undefined) row.description = updates.description;
    if (updates.discountType !== undefined) row.discount_type = updates.discountType;
    if (updates.discountValue !== undefined) row.discount_value = parseFloat(updates.discountValue);
    if (updates.minPurchaseAmount !== undefined) row.min_purchase_amount = parseFloat(updates.minPurchaseAmount);
    if (updates.maxDiscountAmount !== undefined) row.max_discount_amount = parseFloat(updates.maxDiscountAmount);
    if (updates.appliesTo !== undefined) row.applies_to = updates.appliesTo;
    if (updates.usageLimit !== undefined) row.usage_limit = updates.usageLimit;
    if (updates.applicableProducts !== undefined) row.applicable_products = updates.applicableProducts;
    if (updates.segmentTarget !== undefined) row.segment_target = updates.segmentTarget;
    if (updates.startsAt !== undefined) row.starts_at = updates.startsAt;
    if (updates.expiresAt !== undefined) row.expires_at = updates.expiresAt;
    if (updates.isActive !== undefined) row.is_active = updates.isActive;
    if (updates.shopifyPriceRuleId !== undefined) row.shopify_price_rule_id = updates.shopifyPriceRuleId;
    if (updates.shopifyDiscountCodeId !== undefined) row.shopify_discount_code_id = updates.shopifyDiscountCodeId;
    if (updates.shopifySyncStatus !== undefined) row.shopify_sync_status = updates.shopifySyncStatus;
    if (updates.shopifySyncError !== undefined) row.shopify_sync_error = updates.shopifySyncError;
    if (updates.shopifySyncedAt !== undefined) row.shopify_synced_at = updates.shopifySyncedAt;

    const { data, error } = await supabase.from('marketing_coupons').update(row).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

async function deleteMarketingCoupon(id) {
    const { error } = await supabase.from('marketing_coupons')
        .update({ is_deleted: true, is_active: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    return { success: true };
}

async function logCouponUsage(usageData) {
    const row = {
        coupon_id: usageData.couponId,
        shopify_order_id: usageData.shopifyOrderId || null,
        order_name: usageData.orderName || null,
        customer_email: usageData.customerEmail || null,
        customer_id: usageData.customerId || null,
        discount_amount: usageData.discountAmount || 0,
        order_total: usageData.orderTotal || 0
    };

    const { data, error } = await supabase.from('marketing_coupon_usage').insert([row]).select().single();
    if (error) throw error;

    // Increment coupon usage count
    await supabase.rpc('increment_coupon_usage', { coupon_id_val: usageData.couponId }).catch(() => {
        // Fallback: manual increment
        supabase.from('marketing_coupons')
            .update({ used_count: supabase.rpc('increment_field'), last_used_at: new Date().toISOString() })
            .eq('id', usageData.couponId);
    });

    return data;
}

async function getCouponStats() {
    const [
        { count: totalActive },
        { count: totalExpired },
        { data: usageSummary }
    ] = await Promise.all([
        supabase.from('marketing_coupons').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('is_deleted', false),
        supabase.from('marketing_coupons').select('*', { count: 'exact', head: true }).lt('expires_at', new Date().toISOString()),
        supabase.from('marketing_coupon_usage').select('discount_amount, order_total')
    ]);

    const totalDiscountGiven = (usageSummary || []).reduce((sum, u) => sum + (parseFloat(u.discount_amount) || 0), 0);
    const totalOrderValue = (usageSummary || []).reduce((sum, u) => sum + (parseFloat(u.order_total) || 0), 0);

    return {
        totalActive: totalActive || 0,
        totalExpired: totalExpired || 0,
        totalUses: (usageSummary || []).length,
        totalDiscountGiven,
        totalOrderValue
    };
}

// ════════════════════════════════════════════════════════════════
// ABANDONED CARTS
// ════════════════════════════════════════════════════════════════

async function getAbandonedCarts(filters = {}) {
    let query = supabase.from('marketing_abandoned_carts').select('*', { count: 'exact' });

    if (filters.status) query = query.eq('recovery_status', filters.status);
    if (filters.email) query = query.ilike('customer_email', `%${filters.email}%`);
    if (filters.phone) query = query.ilike('customer_phone', `%${filters.phone}%`);
    if (filters.minValue) query = query.gte('cart_value', parseFloat(filters.minValue));
    if (filters.source) query = query.eq('checkout_source', filters.source); // 'gokwik' or 'shopify'

    query = query.order('created_at', { ascending: false });

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 50;
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;
    return {
        data: data || [],
        pagination: { total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) }
    };
}

async function getAbandonedCartById(id) {
    const { data, error } = await supabase.from('marketing_abandoned_carts').select('*').eq('id', id).single();
    if (error) { if (error.code === 'PGRST116') return null; throw error; }
    return data;
}

async function createAbandonedCart(cartData) {
    const row = {
        customer_email: cartData.customerEmail || null,
        customer_phone: cartData.customerPhone || null,
        customer_name: cartData.customerName || null,
        shopify_customer_id: cartData.shopifyCustomerId || null,
        anonymous_id: cartData.anonymousId || null,
        cart_token: cartData.cartToken,
        checkout_id: cartData.checkoutId || null,
        checkout_url: cartData.checkoutUrl || null,
        cart_value: cartData.cartValue || 0,
        currency: cartData.currency || 'INR',
        items: cartData.items || [],
        auto_recovery_enabled: cartData.auto_recovery_enabled !== undefined ? cartData.auto_recovery_enabled : true,
        source: cartData.source || 'api',
        // Gokwik-specific fields
        checkout_source: cartData.source === 'gokwik' ? 'gokwik' : (cartData.checkoutSource || 'shopify'),
        gokwik_checkout_id: cartData.gokwikCheckoutId || null,
        checkout_version: cartData.checkoutVersion || null,
        gokwik_customer_phone_verified: cartData.gokwikCustomerPhoneVerified || false,
        payment_method: cartData.paymentMethod || null
    };

    const { data, error } = await supabase.from('marketing_abandoned_carts').insert([row]).select().single();
    if (error) throw error;
    return data;
}

async function updateAbandonedCart(id, updates) {
    const row = { updated_at: new Date().toISOString() };
    if (updates.recoveryStatus !== undefined) row.recovery_status = updates.recoveryStatus;
    if (updates.firstReminderAt !== undefined) row.first_reminder_at = updates.firstReminderAt;
    if (updates.secondReminderAt !== undefined) row.second_reminder_at = updates.secondReminderAt;
    if (updates.finalReminderAt !== undefined) row.final_reminder_at = updates.finalReminderAt;
    if (updates.reminderCount !== undefined) row.reminder_count = updates.reminderCount;
    if (updates.lastReminderAt !== undefined) row.last_reminder_at = updates.lastReminderAt;
    if (updates.recoveredAt !== undefined) row.recovered_at = updates.recoveredAt;
    if (updates.recoveredOrderId !== undefined) row.recovered_order_id = updates.recoveredOrderId;
    if (updates.recoveredOrderName !== undefined) row.recovered_order_name = updates.recoveredOrderName;
    if (updates.recoveredAmount !== undefined) row.recovered_amount = updates.recoveredAmount;
    if (updates.recoveryChannel !== undefined) row.recovery_channel = updates.recoveryChannel;

    const { data, error } = await supabase.from('marketing_abandoned_carts').update(row).eq('id', id).select().single();
    if (error) throw error;
    return data;
}

async function getAbandonedCartStats() {
    const [
        { count: total },
        { data: statusData },
        { data: recoveredData },
        { data: sourceData }
    ] = await Promise.all([
        supabase.from('marketing_abandoned_carts').select('*', { count: 'exact', head: true }),
        supabase.from('marketing_abandoned_carts').select('recovery_status, checkout_source'),
        supabase.from('marketing_abandoned_carts').select('recovered_amount, cart_value, checkout_source').eq('recovery_status', 'recovered'),
        supabase.from('marketing_abandoned_carts').select('checkout_source, recovery_status')
    ]);

    const statuses = {};
    (statusData || []).forEach(c => { statuses[c.recovery_status] = (statuses[c.recovery_status] || 0) + 1; });

    const recoveredCount = (recoveredData || []).length;
    const recoveredRevenue = (recoveredData || []).reduce((sum, c) => sum + (parseFloat(c.recovered_amount) || 0), 0);
    const totalCartValue = (recoveredData || []).reduce((sum, c) => sum + (parseFloat(c.cart_value) || 0), 0);
    const recoveryRate = total > 0 ? ((recoveredCount / total) * 100).toFixed(2) : 0;

    // Source-specific stats
    const sourceStats = { gokwik: { total: 0, recovered: 0, revenue: 0 }, shopify: { total: 0, recovered: 0, revenue: 0 } };
    (sourceData || []).forEach(c => {
        const source = c.checkout_source || 'shopify';
        if (sourceStats[source]) {
            sourceStats[source].total++;
            if (c.recovery_status === 'recovered') {
                sourceStats[source].recovered++;
                sourceStats[source].revenue += parseFloat(c.recovered_amount) || 0;
            }
        }
    });

    return {
        total: total || 0,
        statuses,
        recoveredCount,
        recoveredRevenue,
        totalCartValueAtRecovery: totalCartValue,
        recoveryRate: parseFloat(recoveryRate),
        bySource: {
            gokwik: {
                total: sourceStats.gokwik.total,
                recovered: sourceStats.gokwik.recovered,
                revenue: sourceStats.gokwik.revenue,
                recoveryRate: sourceStats.gokwik.total > 0 ? ((sourceStats.gokwik.recovered / sourceStats.gokwik.total) * 100).toFixed(2) : 0
            },
            shopify: {
                total: sourceStats.shopify.total,
                recovered: sourceStats.shopify.recovered,
                revenue: sourceStats.shopify.revenue,
                recoveryRate: sourceStats.shopify.total > 0 ? ((sourceStats.shopify.recovered / sourceStats.shopify.total) * 100).toFixed(2) : 0
            }
        }
    };
}

async function getPendingReminderCarts() {
    // Get carts that need reminders based on their schedule
    const { data, error } = await supabase
        .from('marketing_abandoned_carts')
        .select('*')
        .eq('auto_recovery_enabled', true)
        .in('recovery_status', ['pending', 'first_reminder_sent', 'second_reminder_sent'])
        .lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // At least 1 hour old
        .gt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Not older than 7 days
        .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
}

// ════════════════════════════════════════════════════════════════
// ANALYTICS
// ════════════════════════════════════════════════════════════════

async function getMarketingAnalyticsOverview(dateRange = {}) {
    const startDate = dateRange.start || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const endDate = dateRange.end || new Date().toISOString().split('T')[0];

    const [
        customerStats,
        { data: dailyData },
        { data: campaignData },
        couponStats,
        cartStats
    ] = await Promise.all([
        getCustomerStats(),
        supabase.from('marketing_analytics_daily').select('*').gte('date', startDate).lte('date', endDate).order('date'),
        supabase.from('marketing_analytics_campaigns').select('*, marketing_campaigns(name, type, status)').order('computed_at', { ascending: false }).limit(20),
        getCouponStats(),
        getAbandonedCartStats()
    ]);

    // Aggregate daily data
    const totals = (dailyData || []).reduce((acc, day) => ({
        totalRevenue: acc.totalRevenue + (parseFloat(day.total_revenue) || 0),
        marketingRevenue: acc.marketingRevenue + (parseFloat(day.marketing_attributed_revenue) || 0),
        totalSpend: acc.totalSpend + (parseFloat(day.total_spend) || 0),
        campaignsSent: acc.campaignsSent + (day.campaigns_sent || 0),
        cartsAbandoned: acc.cartsAbandoned + (day.carts_abandoned || 0),
        cartsRecovered: acc.cartsRecovered + (day.carts_recovered || 0)
    }), { totalRevenue: 0, marketingRevenue: 0, totalSpend: 0, campaignsSent: 0, cartsAbandoned: 0, cartsRecovered: 0 });

    return {
        customers: customerStats,
        revenue: totals,
        campaigns: campaignData || [],
        coupons: couponStats,
        abandonedCarts: cartStats,
        dailyTrend: dailyData || [],
        dateRange: { start: startDate, end: endDate }
    };
}

async function getCampaignAnalytics() {
    const { data, error } = await supabase
        .from('marketing_analytics_campaigns')
        .select('*, marketing_campaigns(name, type, status, created_at)')
        .order('computed_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function getChannelAnalytics(dateRange = {}) {
    const startDate = dateRange.start || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const endDate = dateRange.end || new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('marketing_analytics_channels')
        .select('*').gte('date', startDate).lte('date', endDate).order('date');
    if (error) throw error;
    return data || [];
}

async function getSegmentAnalytics(dateRange = {}) {
    const startDate = dateRange.start || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const endDate = dateRange.end || new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('marketing_analytics_segments')
        .select('*').gte('date', startDate).lte('date', endDate).order('date');
    if (error) throw error;
    return data || [];
}

// ════════════════════════════════════════════════════════════════
// MARKETING SETTINGS
// ════════════════════════════════════════════════════════════════

let _marketingSettingsCache = {};
let _marketingSettingsCacheTime = 0;
const MARKETING_CACHE_TTL = 60000; // 1 minute

async function getMarketingSetting(key, defaultValue = null) {
    try {
        if (Date.now() - _marketingSettingsCacheTime > MARKETING_CACHE_TTL) {
            const { data } = await supabase.from('marketing_settings').select('key, value');
            if (data) {
                const newCache = {};
                data.forEach(row => newCache[row.key] = row.value);
                _marketingSettingsCache = newCache;
                _marketingSettingsCacheTime = Date.now();
            }
        }
        if (_marketingSettingsCache[key] !== undefined) return _marketingSettingsCache[key];
    } catch (err) {
        console.error('[Marketing Settings] Fetch error:', err.message);
    }
    return defaultValue;
}

async function getAllMarketingSettings() {
    const { data, error } = await supabase.from('marketing_settings').select('*').order('category').order('key');
    if (error) throw error;
    return data || [];
}

async function updateMarketingSetting(key, value, updatedBy = 'admin') {
    const { data, error } = await supabase
        .from('marketing_settings')
        .upsert({ key, value, updated_by: updatedBy, updated_at: new Date().toISOString() })
        .select().single();
    if (error) throw error;
    _marketingSettingsCache[key] = value;
    return data;
}

// ════════════════════════════════════════════════════════════════
// AUDIT LOG
// ════════════════════════════════════════════════════════════════

async function createAuditLog(entry) {
    const row = {
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId || null,
        entity_name: entry.entityName || null,
        actor: entry.actor || 'admin',
        actor_type: entry.actorType || 'admin',
        previous_values: entry.previousValues || {},
        new_values: entry.newValues || {},
        changed_fields: entry.changedFields || [],
        details: entry.details || {},
        ip_address: entry.ipAddress || null,
        user_agent: entry.userAgent || null,
        request_id: entry.requestId || null,
        success: entry.success !== undefined ? entry.success : true,
        error_message: entry.errorMessage || null
    };

    const { data, error } = await supabase.from('marketing_audit_log').insert([row]).select().single();
    if (error) {
        console.error('[Marketing Audit] Log insert failed:', error.message);
        return null; // Non-blocking: audit log failure should not break operations
    }
    return data;
}

async function getAuditLogs(filters = {}) {
    let query = supabase.from('marketing_audit_log').select('*', { count: 'exact' });

    if (filters.action) query = query.eq('action', filters.action);
    if (filters.entityType) query = query.eq('entity_type', filters.entityType);
    if (filters.entityId) query = query.eq('entity_id', filters.entityId);
    if (filters.actor) query = query.eq('actor', filters.actor);
    if (filters.success !== undefined) query = query.eq('success', filters.success);

    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
    if (filters.dateTo) query = query.lte('created_at', filters.dateTo);

    query = query.order('created_at', { ascending: false });

    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 50;
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;
    return {
        data: data || [],
        pagination: { total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) }
    };
}

// ════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════

module.exports = {
    // Customer Intelligence
    getMarketingCustomers,
    getMarketingCustomerById,
    getMarketingCustomerByEmail,
    upsertMarketingCustomer,
    batchUpsertMarketingCustomers,
    getLastCustomerSyncTime,
    updateMarketingCustomer,
    getCustomerOrders,
    upsertCustomerOrder,
    getCustomerStats,
    getCustomerSegments,
    getCustomersBySegment,
    computeHealthScore,
    computeChurnRisk,
    smartSegment,
    smartTier,
    recomputeAllCustomerSegments,
    getSmartCustomerStats,

    // Templates
    getMarketingTemplates,
    getMarketingTemplateById,
    getMarketingTemplateByName,
    createMarketingTemplate,
    updateMarketingTemplate,
    deleteMarketingTemplate,

    // Campaigns
    getMarketingCampaigns,
    getMarketingCampaignById,
    createMarketingCampaign,
    updateMarketingCampaign,
    addCampaignRecipients,
    getCampaignRecipients,
    updateCampaignRecipient,
    getCampaignRecipientStats,
    createCampaignSnapshot,

    // Coupons
    getMarketingCoupons,
    getMarketingCouponById,
    getMarketingCouponByCode,
    createMarketingCoupon,
    updateMarketingCoupon,
    deleteMarketingCoupon,
    logCouponUsage,
    getCouponStats,

    // Abandoned Carts
    getAbandonedCarts,
    getAbandonedCartById,
    createAbandonedCart,
    updateAbandonedCart,
    getAbandonedCartStats,
    getPendingReminderCarts,

    // Analytics
    getMarketingAnalyticsOverview,
    getCampaignAnalytics,
    getChannelAnalytics,
    getSegmentAnalytics,

    // Settings
    getMarketingSetting,
    getAllMarketingSettings,
    updateMarketingSetting,

    // Audit Log
    createAuditLog,
    getAuditLogs
};
