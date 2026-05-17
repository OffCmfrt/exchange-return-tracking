const supabase = require('./supabase');

// Helper functions for database operations

/**
 * Create a new request (return or exchange)
 */
async function createRequest(requestData) {
    const { data, error } = await supabase
        .from('requests')
        .insert([{
            request_id: requestData.requestId,
            order_number: requestData.orderNumber,
            email: requestData.email,
            customer_name: requestData.customerName,
            customer_email: requestData.customerEmail || requestData.email,
            customer_phone: requestData.customerPhone,
            type: requestData.type,
            status: requestData.status || 'pending',
            reason: requestData.reason,
            comments: requestData.comments,
            items: requestData.items,
            shipping_address: requestData.shippingAddress,
            new_address: requestData.newAddress,
            new_city: requestData.newCity,
            new_pincode: requestData.newPincode,
            payment_id: requestData.paymentId,
            payment_amount: requestData.paymentAmount,
            awb_number: requestData.awbNumber,
            shipment_id: requestData.shipmentId,
            pickup_date: requestData.pickupDate,
            images: requestData.images,
            admin_notes: requestData.adminNotes || null,
            agent_notes: requestData.agentNotes || null,
            carrier: requestData.carrier || 'shiprocket',
            carrier_shipment_id: requestData.carrierShipmentId,
            carrier_awb: requestData.carrierAwb,
            carrier_fallback_reason: requestData.carrierFallbackReason || null
        }])
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Get request by request ID
 */
async function getRequestById(requestId) {
    const { data, error } = await supabase
        .from('requests')
        .select('*')
        .eq('request_id', requestId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
    }

    return convertFromSnakeCase(data);
}

/**
 * Get all requests for a given order number (customer may have multiple)
 */
async function getRequestsByOrderNumber(orderNumber) {
    // Try both with and without # prefix since orders may be stored either way
    const bare = orderNumber.replace(/^#/, '');  // '1234'
    const hashed = '#' + bare;                   // '#1234'

    // Run both lookups in parallel
    const [res1, res2] = await Promise.all([
        supabase.from('requests').select('*').eq('order_number', bare).order('created_at', { ascending: false }),
        supabase.from('requests').select('*').eq('order_number', hashed).order('created_at', { ascending: false })
    ]);

    if (res1.error && res1.error.code !== 'PGRST116') throw res1.error;
    if (res2.error && res2.error.code !== 'PGRST116') throw res2.error;

    // Merge and deduplicate by request_id
    const seen = new Set();
    const merged = [...(res1.data || []), ...(res2.data || [])].filter(row => {
        if (seen.has(row.request_id)) return false;
        seen.add(row.request_id);
        return true;
    });

    // Sort newest first
    merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return merged.map(convertFromSnakeCase);
}

/**
 * Get all requests with optional filters
 */
async function getAllRequests(filters = {}) {
    let query = supabase.from('requests').select('*', { count: 'exact' });

    if (filters.status) {
        query = query.eq('status', filters.status);
    }

    if (filters.type) {
        query = query.eq('type', filters.type);
    }

    if (filters.date) {
        const startDate = new Date(filters.date);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(filters.date);
        endDate.setHours(23, 59, 59, 999);

        query = query.gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());
    }

    if (filters.carrier) {
        query = query.eq('carrier', filters.carrier);
    }

    if (filters.search) {
        const searchTerm = filters.search;
        // Log search activity without exposing the actual search term (could contain PII)
        console.log('Applying Admin Search: [REDACTED]');
        query = query.or(`request_id.ilike.%${searchTerm}%,order_number.ilike.%${searchTerm}%,customer_name.ilike.%${searchTerm}%,customer_email.ilike.%${searchTerm}%,customer_phone.ilike.%${searchTerm}%`);
    }

    query = query.order('created_at', { ascending: false });

    // Ensure pagination defaults
    const page = parseInt(filters.page, 10) || 1;
    const limit = parseInt(filters.limit, 10) || 50;
    const offset = (page - 1) * limit;
    const rangeTo = offset + limit - 1;
    
    console.log(`[Pagination Debug] Page: ${page}, Limit: ${limit}, Range: ${offset} - ${rangeTo}`);
    query = query.range(offset, rangeTo);

    const { data, count, error } = await query;
    console.log(`[Pagination Debug] Database returned ${data ? data.length : 0} rows. Total count: ${count}`);

    if (filters.search) {
        console.log(`Search Results for "${filters.search}": ${data ? data.length : 0} records found`);
    }

    if (error) {
        console.error('Database Query Error:', error);
        throw error;
    }

    return {
        data: data.map(convertFromSnakeCase),
        pagination: {
            total: count || 0,
            page: filters.page ? parseInt(filters.page, 10) : 1,
            limit: filters.limit ? parseInt(filters.limit, 10) : (count || 0)
        }
    };
}

/**
 * Get request statistics
 */
/**
 * Get request statistics with detailed analytics (OPTIMIZED with database aggregation)
 */
async function getRequestStats() {
    try {
        // Fetch counts using database aggregation (much faster than loading all records)
        const [
            { count: totalCount },
            { count: pendingCount },
            { count: pickupPendingCount },
            { count: scheduledCount },
            { count: approvedCount },
            { count: rejectedCount },
            { count: waitingPaymentCount },
            { count: returnsCount },
            { count: exchangesCount }
        ] = await Promise.all([
            supabase.from('requests').select('*', { count: 'exact', head: true }),
            supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'pickup_pending'),
            supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
            supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
            supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'rejected'),
            supabase.from('requests').select('*', { count: 'exact', head: true }).eq('status', 'waiting_payment'),
            supabase.from('requests').select('*', { count: 'exact', head: true }).eq('type', 'return'),
            supabase.from('requests').select('*', { count: 'exact', head: true }).eq('type', 'exchange')
        ]);

        // Fetch reason breakdown
        const { data: reasonData, error: reasonError } = await supabase
            .from('requests')
            .select('reason');
        
        if (reasonError) throw reasonError;

        const reasons = {
            size: 0,
            fit: 0,
            color: 0,
            changed_mind: 0,
            defective: 0,
            wrong_item: 0,
            other: 0
        };
        
        reasonData.forEach(r => {
            if (r.reason && reasons[r.reason] !== undefined) {
                reasons[r.reason]++;
            } else if (r.reason) {
                reasons.other++;
            }
        });

        // Fetch total revenue (only records with payment_amount)
        const { data: revenueData, error: revenueError } = await supabase
            .from('requests')
            .select('payment_amount')
            .not('payment_amount', 'is', null);
        
        if (revenueError) throw revenueError;
        
        const totalRevenue = revenueData.reduce((sum, r) => sum + (parseFloat(r.payment_amount) || 0), 0);

        return {
            total: totalCount || 0,
            pending: pendingCount || 0,
            pickupPending: pickupPendingCount || 0,
            scheduled: scheduledCount || 0,
            approved: approvedCount || 0,
            rejected: rejectedCount || 0,
            waitingPayment: waitingPaymentCount || 0,
            returns: returnsCount || 0,
            exchanges: exchangesCount || 0,
            totalRevenue,
            reasons
        };
    } catch (error) {
        console.error('Error in getRequestStats:', error);
        throw error;
    }
}

/**
 * Overwrite core submission data on an existing request (used when resubmitting a waiting_payment request)
 * Preserves the REQ ID — does NOT create a new record.
 */
async function updateRequestData(requestId, data) {
    const updateData = {
        type: data.type,
        reason: data.reason,
        comments: data.comments,
        items: data.items,
        images: data.images,
        customer_name: data.customerName,
        customer_email: data.customerEmail,
        customer_phone: data.customerPhone,
        shipping_address: data.shippingAddress,
        new_address: data.newAddress,
        new_city: data.newCity,
        new_pincode: data.newPincode,
        payment_id: data.paymentId || null,
        payment_amount: data.paymentAmount || null,
        status: data.status || 'waiting_payment',
        admin_notes: data.adminNotes || null,
        agent_notes: data.agentNotes || null,
        updated_at: new Date().toISOString()
    };

    const { data: row, error } = await supabase
        .from('requests')
        .update(updateData)
        .eq('request_id', requestId)
        .select()
        .single();

    if (error) throw error;
    return convertFromSnakeCase(row);
}

/**
 * Update request status (approve/reject)
 */
async function updateRequestStatus(requestId, updates) {
    const updateData = {};

    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.adminNotes !== undefined) updateData.admin_notes = updates.adminNotes;
    if (updates.agentNotes !== undefined) updateData.agent_notes = updates.agentNotes;

    // Status Timestamps
    if (updates.status === 'approved') {
        updateData.approved_at = new Date().toISOString();
    } else if (updates.status === 'rejected') {
        updateData.rejected_at = new Date().toISOString();
    }

    // Payment Info
    if (updates.paymentId !== undefined) {
        updateData.payment_id = updates.paymentId;
        console.log(`[${requestId}] 💳 DB Update: payment_id = ${updates.paymentId}`);
    }
    if (updates.paymentAmount !== undefined) updateData.payment_amount = updates.paymentAmount;

    // Tracking Info
    if (updates.awbNumber !== undefined) updateData.awb_number = updates.awbNumber;
    if (updates.shipmentId !== undefined) updateData.shipment_id = updates.shipmentId;
    if (updates.pickupDate !== undefined) updateData.pickup_date = updates.pickupDate;

    // Status Timestamps
    if (updates.deliveredAt) updateData.delivered_at = updates.deliveredAt;
    if (updates.pickedUpAt) updateData.picked_up_at = updates.pickedUpAt;
    if (updates.inTransitAt) updateData.in_transit_at = updates.inTransitAt;
    if (updates.inspectedAt) updateData.inspected_at = updates.inspectedAt;

    // Forward Tracking
    if (updates.forwardShipmentId) updateData.forward_shipment_id = updates.forwardShipmentId;
    if (updates.forwardAwbNumber) updateData.forward_awb_number = updates.forwardAwbNumber;
    if (updates.forwardStatus) updateData.forward_status = updates.forwardStatus;

    // Carrier Tracking
    if (updates.carrier !== undefined) updateData.carrier = updates.carrier;
    if (updates.carrierShipmentId !== undefined) updateData.carrier_shipment_id = updates.carrierShipmentId;
    if (updates.carrierAwb !== undefined) updateData.carrier_awb = updates.carrierAwb;
    if (updates.carrierFallbackReason !== undefined) updateData.carrier_fallback_reason = updates.carrierFallbackReason;

    if (Object.keys(updateData).length === 0) return null;

    const { data, error } = await supabase
        .from('requests')
        .update(updateData)
        .eq('request_id', requestId)
        .select()
        .single();

    if (error) {
        console.error('Update Request Error:', error);
        throw error;
    }

    return convertFromSnakeCase(data);
}

/**
 * Convert snake_case database fields to camelCase for API responses
 */
function convertFromSnakeCase(data) {
    if (!data) return null;

    return {
        id: data.id,
        requestId: data.request_id,
        orderNumber: data.order_number,
        email: data.email,
        customerName: data.customer_name,
        customerEmail: data.customer_email,
        customerPhone: data.customer_phone,
        type: data.type,
        status: data.status,
        reason: data.reason,
        comments: data.comments,
        items: data.items,
        shippingAddress: data.shipping_address,
        newAddress: data.new_address,
        newCity: data.new_city,
        newPincode: data.new_pincode,
        paymentId: data.payment_id,
        paymentAmount: data.payment_amount,
        awbNumber: data.awb_number,
        shipmentId: data.shipment_id,
        pickupDate: data.pickup_date,
        pickedUpAt: data.picked_up_at,
        inTransitAt: data.in_transit_at,
        deliveredAt: data.delivered_at,
        inspectedAt: data.inspected_at,
        approvedAt: data.approved_at,
        rejectedAt: data.rejected_at,
        adminNotes: data.admin_notes,
        agentNotes: data.agent_notes,
        images: data.images,
        forwardShipmentId: data.forward_shipment_id,
        forwardAwbNumber: data.forward_awb_number,
        forwardStatus: data.forward_status,
        carrier: data.carrier,
        carrierShipmentId: data.carrier_shipment_id,
        carrierAwb: data.carrier_awb,
        carrierFallbackReason: data.carrier_fallback_reason,
        createdAt: data.created_at,
        updatedAt: data.updated_at
    };
}

/**
 * Save agent notes on a request (visible to admin, agent cannot approve/reject)
 */
async function saveAgentNotes(requestId, notes) {
    const { data, error } = await supabase
        .from('requests')
        .update({ agent_notes: notes, updated_at: new Date().toISOString() })
        .eq('request_id', requestId)
        .select()
        .single();

    if (error) throw error;
    return convertFromSnakeCase(data);
}

// ── Dynamic Power Settings ──

let settingsCache = {};
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Fetch a setting by key. Uses in-memory cache to prevent DB spam.
 */
async function getSetting(key, defaultValue = null) {
    try {
        if (Date.now() - lastCacheUpdate > CACHE_TTL) {
            const { data, error } = await supabase.from('store_settings').select('key, value');
            if (!error && data) {
                const newCache = {};
                data.forEach(row => newCache[row.key] = row.value);
                settingsCache = newCache;
                lastCacheUpdate = Date.now();
            }
        }
        if (settingsCache[key] !== undefined) return settingsCache[key];
    } catch (err) {
        console.error('Error fetching setting:', err);
    }
    return defaultValue;
}

/**
 * Update or insert a setting
 */
async function updateSetting(key, value) {
    const { error } = await supabase
        .from('store_settings')
        .upsert({ key, value, updated_at: new Date().toISOString() });

    if (error) throw error;

    // Update local cache immediately
    settingsCache[key] = value;
    return value;
}

/**
 * Delete multiple requests by ID
 */
async function deleteRequests(requestIds) {
    if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) return { count: 0 };

    const { data, error, count } = await supabase
        .from('requests')
        .delete({ count: 'exact' })
        .in('request_id', requestIds);

    if (error) {
        console.error('Delete DB Error:', error);
        throw error;
    }

    return { count };
}

// ── Influencer Helpers ──

/**
 * Get all influencers
 */
async function getAllInfluencers() {
    const { data, error } = await supabase
        .from('influencers')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

/**
 * Create a new influencer
 */
async function createInfluencer(influencerData) {
    const insertRow = {
        name: influencerData.name,
        referral_code: influencerData.referralCode,
        link_token: influencerData.linkToken,
        commission_rate: influencerData.commissionRate ?? 10.00,
        discount_value: influencerData.discountValue ?? influencerData.commissionRate ?? 10.00,
        usage_limit: influencerData.usageLimit ?? null,
        phone: influencerData.phone,
        is_active: influencerData.isActive !== undefined ? influencerData.isActive : true
    };

    // ── Application fields (only if provided; safe for legacy schemas) ──
    if (influencerData.status !== undefined) insertRow.status = influencerData.status;
    if (influencerData.email !== undefined) insertRow.email = influencerData.email;
    if (influencerData.instagramHandle !== undefined) insertRow.instagram_handle = influencerData.instagramHandle;
    if (influencerData.youtubeHandle !== undefined) insertRow.youtube_handle = influencerData.youtubeHandle;
    if (influencerData.followerCount !== undefined) insertRow.follower_count = influencerData.followerCount;
    if (influencerData.niche !== undefined) insertRow.niche = influencerData.niche;
    if (influencerData.city !== undefined) insertRow.city = influencerData.city;
    if (influencerData.whyJoin !== undefined) insertRow.why_join = influencerData.whyJoin;
    if (influencerData.payoutUpi !== undefined) insertRow.payout_upi = influencerData.payoutUpi;
    if (influencerData.payoutNotes !== undefined) insertRow.payout_notes = influencerData.payoutNotes;
    if (influencerData.appliedAt !== undefined) insertRow.applied_at = influencerData.appliedAt;

    const { data, error } = await supabase
        .from('influencers')
        .insert([insertRow])
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Update an influencer's profile
 */
async function updateInfluencer(id, updates) {
    const updateData = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.referralCode !== undefined) updateData.referral_code = updates.referralCode;
    if (updates.commissionRate !== undefined) updateData.commission_rate = parseFloat(updates.commissionRate);
    if (updates.discountValue !== undefined) updateData.discount_value = parseFloat(updates.discountValue);
    if (updates.usageLimit !== undefined) updateData.usage_limit = updates.usageLimit === '' ? null : parseInt(updates.usageLimit);
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
    if (updates.shopifyPriceRuleId !== undefined) updateData.shopify_price_rule_id = updates.shopifyPriceRuleId;
    if (updates.shopifyDiscountCodeId !== undefined) updateData.shopify_discount_code_id = updates.shopifyDiscountCodeId;

    // ── Application fields ──
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.instagramHandle !== undefined) updateData.instagram_handle = updates.instagramHandle;
    if (updates.youtubeHandle !== undefined) updateData.youtube_handle = updates.youtubeHandle;
    if (updates.followerCount !== undefined) updateData.follower_count = updates.followerCount;
    if (updates.niche !== undefined) updateData.niche = updates.niche;
    if (updates.city !== undefined) updateData.city = updates.city;
    if (updates.whyJoin !== undefined) updateData.why_join = updates.whyJoin;
    if (updates.payoutUpi !== undefined) updateData.payout_upi = updates.payoutUpi;
    if (updates.payoutNotes !== undefined) updateData.payout_notes = updates.payoutNotes;
    if (updates.approvedAt !== undefined) updateData.approved_at = updates.approvedAt;

    const { data, error } = await supabase
        .from('influencers')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Delete an influencer
 */
async function deleteInfluencer(id) {
    const { error } = await supabase
        .from('influencers')
        .delete()
        .eq('id', id);

    if (error) throw error;
    return { success: true };
}

/**
 * Get influencer by token (for portal auth).
 * Allows status='pending' (so applicants can preview their portal) but blocks suspended/rejected.
 */
async function getInfluencerByToken(token) {
    const { data, error } = await supabase
        .from('influencers')
        .select('*')
        .eq('link_token', token)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
    }
    if (!data) return null;

    // If status column exists, block suspended/rejected
    if (data.status === 'suspended' || data.status === 'rejected') return null;
    // If legacy schema (no status column), fall back to is_active
    if (data.status === undefined && data.is_active === false) return null;

    return data;
}

/**
 * Get influencer by ID (for admin)
 */
async function getInfluencerById(id) {
    const { data, error } = await supabase
        .from('influencers')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
    }
    return data;
}

// ── Self-Signup & Duplicate Checks ──

/**
 * Check if a referral code is already taken (case-insensitive)
 */
async function isReferralCodeTaken(code) {
    if (!code) return false;
    const { data, error } = await supabase
        .from('influencers')
        .select('id')
        .ilike('referral_code', code)
        .limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
}

/**
 * Check if an email is already registered (case-insensitive)
 */
async function isEmailTaken(email) {
    if (!email) return false;
    const { data, error } = await supabase
        .from('influencers')
        .select('id')
        .ilike('email', email)
        .limit(1);
    if (error) {
        // If 'email' column doesn't exist yet (pre-migration), don't block signup
        if (error.code === '42703') return false;
        throw error;
    }
    return Array.isArray(data) && data.length > 0;
}

/**
 * Check if a phone is already registered
 */
async function isPhoneTaken(phone) {
    if (!phone) return false;
    const cleaned = String(phone).replace(/\D/g, '');
    const { data, error } = await supabase
        .from('influencers')
        .select('id, phone')
        .not('phone', 'is', null);
    if (error) throw error;
    return Array.isArray(data) && data.some(row => String(row.phone || '').replace(/\D/g, '') === cleaned);
}

/**
 * List pending (un-approved) influencer applications
 */
async function listPendingInfluencers() {
    const { data, error } = await supabase
        .from('influencers')
        .select('*')
        .eq('status', 'pending')
        .order('applied_at', { ascending: false });
    if (error) {
        if (error.code === '42703') return []; // status column missing
        throw error;
    }
    return data || [];
}

// ── Payout Helpers ──

/**
 * List payouts for an influencer (newest period first)
 */
async function listPayouts(influencerId) {
    const { data, error } = await supabase
        .from('influencer_payouts')
        .select('*')
        .eq('influencer_id', influencerId)
        .order('period_end', { ascending: false });
    if (error) {
        if (error.code === '42P01') return []; // table missing (pre-migration)
        throw error;
    }
    return data || [];
}

/**
 * Create a new payout entry
 */
async function createPayout(payoutData) {
    const insertRow = {
        influencer_id: payoutData.influencerId,
        period_start: payoutData.periodStart,
        period_end: payoutData.periodEnd,
        amount: parseFloat(payoutData.amount) || 0,
        currency: payoutData.currency || 'INR',
        status: payoutData.status || 'pending',
        reference: payoutData.reference || null,
        notes: payoutData.notes || null
    };
    if (insertRow.status === 'paid') {
        insertRow.paid_at = new Date().toISOString();
    }

    const { data, error } = await supabase
        .from('influencer_payouts')
        .insert([insertRow])
        .select()
        .single();
    if (error) throw error;
    return data;
}

/**
 * Update payout status (e.g., mark as paid / cancelled)
 */
async function updatePayoutStatus(payoutId, status, reference = null) {
    const updateRow = {
        status,
        updated_at: new Date().toISOString()
    };
    if (status === 'paid') {
        updateRow.paid_at = new Date().toISOString();
    } else if (status === 'pending') {
        updateRow.paid_at = null;
    }
    if (reference !== null && reference !== undefined) {
        updateRow.reference = reference;
    }

    const { data, error } = await supabase
        .from('influencer_payouts')
        .update(updateRow)
        .eq('id', payoutId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

/**
 * Get a single payout by ID
 */
async function getPayoutById(payoutId) {
    const { data, error } = await supabase
        .from('influencer_payouts')
        .select('*')
        .eq('id', payoutId)
        .single();
    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data;
}

module.exports = {
    createRequest,
    getRequestById,
    getRequestsByOrderNumber,
    getAllRequests,
    getRequestStats,
    updateRequestStatus,
    updateRequestData,
    saveAgentNotes,
    deleteRequests,
    getSetting,
    updateSetting,
    
    // Influencer Helpers
    getAllInfluencers,
    createInfluencer,
    updateInfluencer,
    deleteInfluencer,
    getInfluencerByToken,
    getInfluencerById,

    // Self-Signup & Duplicate Checks
    isReferralCodeTaken,
    isEmailTaken,
    isPhoneTaken,
    listPendingInfluencers,

    // Payout Helpers
    listPayouts,
    createPayout,
    updatePayoutStatus,
    getPayoutById
};
