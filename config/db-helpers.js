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
            agent_notes: requestData.agentNotes || null
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
 * Get request statistics with detailed analytics
 */
async function getRequestStats() {
    const { data: allRequests, error: allError } = await supabase
        .from('requests')
        .select('status, reason, type, payment_amount');

    if (allError) throw allError;

    const stats = {
        total: allRequests.length,
        pending: 0,
        scheduled: 0,
        approved: 0,
        rejected: 0,
        waitingPayment: 0,
        returns: 0,
        exchanges: 0,
        totalRevenue: 0,
        reasons: {
            size: 0,
            fit: 0,
            color: 0,
            changed_mind: 0,
            defective: 0,
            wrong_item: 0,
            other: 0
        }
    };

    allRequests.forEach(r => {
        // Status counts
        if (r.status === 'pending') stats.pending++;
        if (r.status === 'scheduled') stats.scheduled++;
        if (r.status === 'approved') stats.approved++;
        if (r.status === 'rejected') stats.rejected++;
        if (r.status === 'waiting_payment') stats.waitingPayment++;

        // Type counts
        if (r.type === 'return') stats.returns++;
        if (r.type === 'exchange') stats.exchanges++;

        // Reason counts
        if (r.reason && stats.reasons[r.reason] !== undefined) {
            stats.reasons[r.reason]++;
        } else if (r.reason) {
            stats.reasons.other++;
        }

        // Financials (if payment was successful)
        if (r.payment_amount) {
            stats.totalRevenue += parseFloat(r.payment_amount) || 0;
        }
    });

    return stats;
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
    const { data, error } = await supabase
        .from('influencers')
        .insert([{
            name: influencerData.name,
            referral_code: influencerData.referralCode,
            link_token: influencerData.linkToken,
            commission_rate: influencerData.commissionRate ?? 10.00,
            phone: influencerData.phone,
            is_active: true
        }])
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Update an influencer's profile (name, referral code, commission rate)
 */
async function updateInfluencer(id, updates) {
    const updateData = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.referralCode !== undefined) updateData.referral_code = updates.referralCode;
    if (updates.commissionRate !== undefined) updateData.commission_rate = parseFloat(updates.commissionRate);
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

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
 * Get influencer by token (for portal auth)
 */
async function getInfluencerByToken(token) {
    const { data, error } = await supabase
        .from('influencers')
        .select('*')
        .eq('link_token', token)
        .eq('is_active', true)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
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
    getInfluencerByToken
};
