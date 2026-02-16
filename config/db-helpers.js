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
            status: 'pending',
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
            pickup_date: requestData.pickupDate
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
 * Get all requests with optional filters
 */
async function getAllRequests(filters = {}) {
    let query = supabase.from('requests').select('*');

    if (filters.status) {
        query = query.eq('status', filters.status);
    }

    if (filters.type) {
        query = query.eq('type', filters.type);
    }

    if (filters.date) {
        // Filter by specific date (ignoring time)
        // usage: created_at >= start_of_day AND created_at <= end_of_day
        const startDate = new Date(filters.date);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(filters.date);
        endDate.setHours(23, 59, 59, 999);

        query = query.gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());
    }

    if (filters.search) {
        const searchTerm = filters.search;
        console.log('Applying Admin Search:', searchTerm);
        // Search across multiple columns: request_id, order_number, customer_name, customer_email, or customer_phone
        // We use .or() with ilike (case-insensitive)
        query = query.or(`request_id.ilike.%${searchTerm}%,order_number.ilike.%${searchTerm}%,customer_name.ilike.%${searchTerm}%,customer_email.ilike.%${searchTerm}%,customer_phone.ilike.%${searchTerm}%`);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (filters.search) {
        console.log(`Search Results for "${filters.search}": ${data ? data.length : 0} records found`);
    }

    if (error) {
        console.error('Database Query Error:', error);
        throw error;
    }

    return data.map(convertFromSnakeCase);
}

/**
 * Get request statistics
 */
async function getRequestStats() {
    const { data: allRequests, error: allError } = await supabase
        .from('requests')
        .select('status');

    if (allError) throw allError;

    const stats = {
        total: allRequests.length,
        pending: allRequests.filter(r => r.status === 'pending').length,
        approved: allRequests.filter(r => r.status === 'approved').length,
        rejected: allRequests.filter(r => r.status === 'rejected').length
    };

    return stats;
}

/**
 * Update request status (approve/reject)
 */
async function updateRequestStatus(requestId, updates) {
    const updateData = {
        status: updates.status,
        admin_notes: updates.adminNotes
    };

    if (updates.status === 'approved') {
        updateData.approved_at = new Date().toISOString();
    } else if (updates.status === 'rejected') {
        updateData.rejected_at = new Date().toISOString();
    }

    const { data, error } = await supabase
        .from('requests')
        .update(updateData)
        .eq('request_id', requestId)
        .select()
        .single();

    return convertFromSnakeCase(data);
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

module.exports = {
    createRequest,
    getRequestById,
    getAllRequests,
    getRequestStats,
    updateRequestStatus,
    deleteRequests
};
