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
            status: requestData.awbNumber ? 'scheduled' : 'pending',
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
            images: requestData.images
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

    if (updates.awbNumber) updateData.awb_number = updates.awbNumber;
    if (updates.shipmentId) updateData.shipment_id = updates.shipmentId;
    if (updates.pickupDate) updateData.pickup_date = updates.pickupDate;

    const { data, error } = await supabase
        .from('requests')
        .update(updateData)
        .eq('request_id', requestId)
        .select()
        .single();

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
        images: data.images,
        createdAt: data.created_at,
        updatedAt: data.updated_at
    };
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
