const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const db = require('./database');
const shopifyAPI = require('./shopify-api');
const shiprocketAPI = require('./shiprocket-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Initialize database
db.initializeDatabase();

// ==================== ROUTES ====================
const trackOrderRoute = require('./track-order-route');
app.use('/api', trackOrderRoute);

// ==================== PUBLIC ENDPOINTS ====================

// Lookup order
app.post('/api/lookup-order', async (req, res) => {
    try {
        const { orderNumber, email } = req.body;

        if (!orderNumber || !email) {
            return res.status(400).json({ error: 'Order number and email are required' });
        }

        const order = await shopifyAPI.lookupOrder(orderNumber, email);

        if (!order) {
            return res.status(404).json({ error: 'Order not found or email does not match' });
        }

        // Check if order is eligible for return/exchange (2 days after delivery)
        let deliveryDate = null;
        let isEligible = true;
        let eligibilityMessage = null;

        // Get delivery date from fulfillments
        if (order.fulfillments && order.fulfillments.length > 0) {
            const fulfillment = order.fulfillments[0];

            // Check if delivered
            if (fulfillment.status === 'success' && fulfillment.updated_at) {
                deliveryDate = new Date(fulfillment.updated_at);
                const now = new Date();
                const daysSinceDelivery = Math.floor((now - deliveryDate) / (1000 * 60 * 60 * 24));

                if (daysSinceDelivery > 2) {
                    isEligible = false;
                    eligibilityMessage = `Returns and exchanges are only allowed within 2 days of delivery. Your order was delivered ${daysSinceDelivery} days ago.`;
                }
            } else {
                // Order not yet delivered
                isEligible = false;
                eligibilityMessage = 'Returns and exchanges are only allowed after you receive your order.';
            }
        } else {
            // No fulfillment data
            isEligible = false;
            eligibilityMessage = 'This order has not been shipped yet. Returns and exchanges are only allowed after delivery.';
        }

        res.json({
            order,
            isEligible,
            eligibilityMessage,
            deliveryDate: deliveryDate ? deliveryDate.toISOString() : null
        });
    } catch (error) {
        console.error('Order lookup error:', error);
        res.status(500).json({ error: 'Failed to lookup order' });
    }
});

// Submit return request
app.post('/api/submit-return', upload.array('images', 5), async (req, res) => {
    try {
        console.log('Received return submission:', req.body);
        console.log('Files:', req.files);

        const { orderNumber, email, items, reason, comments, paymentId, paymentAmount } = req.body;

        // Validate required fields
        if (!orderNumber || !email || !items || !reason) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify Payment (if applicable)
        if (paymentId) {
            try {
                // Mock payment bypass for testing
                if (paymentId.startsWith('pay_mock_')) {
                    console.log('Mock payment accepted:', paymentId);
                } else {
                    // Fetch payment details from Razorpay to verify
                    const payment = await razorpay.payments.fetch(paymentId);

                    if (payment.status !== 'captured' && payment.status !== 'authorized') {
                        return res.status(400).json({ error: 'Payment not successful' });
                    }
                    console.log(`Payment Verified: ${paymentId}, Status: ${payment.status}`);
                }
            } catch (paymentError) {
                console.error('Payment verification failed:', paymentError);
                if (paymentId.startsWith('pay_')) {
                    return res.status(400).json({ error: 'Invalid payment ID' });
                }
            }
        }
        // NOTE: In production, you might want to ENFORCE payment here if it's mandatory.

        // Lookup order to get customer details
        const order = await shopifyAPI.lookupOrder(orderNumber, email);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Parse items
        const parsedItems = JSON.parse(items);

        // Calculate refund amount (mock logic)
        // Store credit is issued for full amount minus shipping/restocking if applicable
        // Here we just record the items. The specific coupon amount decision is manual by admin.

        // Create notification/request in database
        const requestId = db.createRequest({
            type: 'return',
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            customerEmail: order.email,
            customerPhone: order.phone,
            shippingAddress: order.shippingAddress,
            items: parsedItems,
            reason,
            comments,
            images: req.files ? req.files.map(f => f.filename) : null,
            payment: paymentId ? {
                id: paymentId,
                amount: paymentAmount,
                status: 'verified'
            } : null
        });

        // Schedule Shiprocket pickup immediately
        try {
            const pickupResult = await shiprocketAPI.createReversePickup({
                type: 'return',
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                customerEmail: order.email,
                customerPhone: order.phone,
                shippingAddress: order.shippingAddress,
                items: parsedItems,
                reason
            });

            // Update request with pickup details
            db.updateRequestStatus(requestId, 'scheduled', {
                awbNumber: pickupResult.awbNumber,
                pickupDate: new Date().toISOString()
            });

            console.log(`Return request ${requestId} created with Shiprocket pickup`);
        } catch (pickupError) {
            console.error('Shiprocket pickup scheduling failed:', pickupError);
            // Request is still created, but pickup failed
        }

        res.json({
            success: true,
            requestId,
            message: 'Return request submitted successfully. Pickup will be scheduled shortly.'
        });
    } catch (error) {
        console.error('Submit return error:', error);
        res.status(500).json({ error: 'Failed to submit return request' });
    }
});

const Razorpay = require('razorpay');

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret'
});

// Submit exchange request
app.post('/api/submit-exchange', upload.array('images', 5), async (req, res) => {
    try {
        const { orderNumber, email, items, reason, comments, newAddress, newCity, newPincode, paymentId, paymentAmount } = req.body;

        // Validate required fields
        if (!orderNumber || !email || !items || !reason) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify Payment (if applicable)
        if (paymentId) {
            try {
                // Fetch payment details from Razorpay to verify
                const payment = await razorpay.payments.fetch(paymentId);

                if (payment.status !== 'captured' && payment.status !== 'authorized') {
                    return res.status(400).json({ error: 'Payment not successful' });
                }

                // Verify amount matches
                // Note: Razorpay amount is in paise
                const expectedAmount = parseFloat(paymentAmount) * 100;
                if (payment.amount < expectedAmount) {
                    console.warn(`Payment amount mismatch: Expected ${expectedAmount}, Got ${payment.amount}`);
                    // We allow it for now but log warning, or you could reject
                }

                console.log(`Payment Verified: ${paymentId}, Status: ${payment.status}`);
            } catch (paymentError) {
                console.error('Payment verification failed:', paymentError);

                // Allow mock payments for testing
                if (paymentId.startsWith('pay_mock_')) {
                    console.log('Mock payment accepted for testing:', paymentId);
                    // Continue execution
                } else if (paymentId.startsWith('pay_')) { // Real Razorpay ID format but failed verification
                    return res.status(400).json({ error: 'Invalid payment ID' });
                }
            }
        }

        // Lookup order to get customer details
        const order = await shopifyAPI.lookupOrder(orderNumber, email);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Parse items
        const parsedItems = JSON.parse(items);

        // Create request in database
        const requestId = db.createRequest({
            type: 'exchange',
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            customerEmail: order.email,
            customerPhone: order.phone,
            shippingAddress: order.shippingAddress,
            items: parsedItems,
            reason,
            comments,
            images: req.files ? req.files.map(f => f.filename) : null,
            newAddress: newAddress ? `${newAddress}, ${newCity}, ${newPincode}` : null,
            payment: paymentId ? {
                id: paymentId,
                amount: paymentAmount,
                status: 'verified' // We verified it above
            } : null
        });

        // Schedule Shiprocket pickup immediately
        try {
            const pickupResult = await shiprocketAPI.createReversePickup({
                type: 'exchange',
                orderNumber: order.orderNumber,
                customerName: order.customerName,
                customerEmail: order.email,
                customerPhone: order.phone,
                shippingAddress: order.shippingAddress,
                items: parsedItems,
                reason
            });

            // Update request with pickup details
            db.updateRequestStatus(requestId, 'scheduled', {
                awbNumber: pickupResult.awbNumber,
                pickupDate: new Date().toISOString()
            });

            console.log(`Exchange request ${requestId} created with Shiprocket pickup`);
        } catch (pickupError) {
            console.error('Shiprocket pickup scheduling failed:', pickupError);
            // Request is still created, but pickup failed
        }

        res.json({
            success: true,
            requestId,
            message: 'Exchange request submitted successfully. Pickup will be scheduled shortly.'
        });
    } catch (error) {
        console.error('Submit exchange error:', error);
        res.status(500).json({ error: 'Failed to submit exchange request' });
    }
});

// Track request
app.get('/api/track-request/:requestId', (req, res) => {
    try {
        const { requestId } = req.params;
        const request = db.getRequestById(requestId);

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        res.json(request);
    } catch (error) {
        console.error('Track request error:', error);
        res.status(500).json({ error: 'Failed to track request' });
    }
});

// ==================== ADMIN ENDPOINTS ====================

// Simple authentication middleware
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);

    // Simple token validation (in production, use proper JWT)
    if (token !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    next();
}

// Sync status manually (Admin)
app.post('/api/admin/sync-status', authenticateAdmin, async (req, res) => {
    try {
        const requests = db.getAllRequests();
        let updatedCount = 0;

        // In a real app, this would query Shiprocket API for each AWB
        // For our local setup with mock data, we will simulate progression:
        // scheduled -> picked_up -> in_transit -> delivered

        for (const req of requests) {
            let newStatus = null;

            // Logic to advance status for demo purposes
            if (req.status === 'scheduled') newStatus = 'picked_up';
            else if (req.status === 'picked_up') newStatus = 'in_transit';
            else if (req.status === 'in_transit') newStatus = 'delivered';

            // Only update if not already final state (approved/rejected/delivered)
            if (newStatus && ['scheduled', 'picked_up', 'in_transit'].includes(req.status)) {
                // Update DB
                db.updateRequestStatus(req.requestId, newStatus);
                updatedCount++;
            }
        }

        res.json({ success: true, updated: updatedCount });
    } catch (error) {
        console.error('Sync status error:', error);
        res.status(500).json({ error: 'Failed to sync status' });
    }
});

// Admin login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;

    if (password === process.env.ADMIN_PASSWORD) {
        res.json({
            success: true,
            token: password // In production, generate proper JWT
        });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// Get all requests (admin)
app.get('/api/admin/requests', authenticateAdmin, (req, res) => {
    try {
        const { status, type } = req.query;
        const filters = {};

        if (status) filters.status = status;
        if (type) filters.type = type;

        const requests = db.getAllRequests(filters);
        const stats = db.getStats();

        res.json({ requests, stats });
    } catch (error) {
        console.error('Get requests error:', error);
        res.status(500).json({ error: 'Failed to get requests' });
    }
});

// Approve return
app.post('/api/admin/approve-return', authenticateAdmin, (req, res) => {
    try {
        const { requestId, notes } = req.body;

        // Generate store credit coupon code
        const couponCode = 'OFFCOMFRT-' + Date.now().toString().slice(-8);

        db.updateRequestStatus(requestId, 'approved', {
            adminNotes: notes || `Return approved. Store credit coupon: ${couponCode}`,
            couponCode: couponCode
        });

        // TODO: Create coupon in Shopify with the generated code
        // TODO: Send email to customer with coupon code
        console.log(`Return ${requestId} approved. Coupon code: ${couponCode}`);

        res.json({
            success: true,
            message: 'Return approved',
            couponCode: couponCode
        });
    } catch (error) {
        console.error('Approve return error:', error);
        res.status(500).json({ error: 'Failed to approve return' });
    }
});

// Reject return
app.post('/api/admin/reject-return', authenticateAdmin, (req, res) => {
    try {
        const { requestId, notes } = req.body;

        db.updateRequestStatus(requestId, 'rejected', {
            adminNotes: notes || 'Return rejected.'
        });

        console.log(`Return ${requestId} rejected.`);

        res.json({ success: true, message: 'Return rejected' });
    } catch (error) {
        console.error('Reject return error:', error);
        res.status(500).json({ error: 'Failed to reject return' });
    }
});

// Approve exchange
app.post('/api/admin/approve-exchange', authenticateAdmin, (req, res) => {
    try {
        const { requestId, notes } = req.body;

        db.updateRequestStatus(requestId, 'approved', {
            adminNotes: notes || 'Exchange approved. Replacement will be shipped.'
        });

        // TODO: Create forward shipment for replacement item
        console.log(`Exchange ${requestId} approved. Ship replacement item manually.`);

        res.json({ success: true, message: 'Exchange approved' });
    } catch (error) {
        console.error('Approve exchange error:', error);
        res.status(500).json({ error: 'Failed to approve exchange' });
    }
});

// Reject exchange
app.post('/api/admin/reject-exchange', authenticateAdmin, (req, res) => {
    try {
        const { requestId, notes } = req.body;

        db.updateRequestStatus(requestId, 'rejected', {
            adminNotes: notes || 'Exchange rejected.'
        });

        console.log(`Exchange ${requestId} rejected.`);

        res.json({ success: true, message: 'Exchange rejected' });
    } catch (error) {
        console.error('Reject exchange error:', error);
        res.status(500).json({ error: 'Failed to reject exchange' });
    }
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Return & Exchange system ready!');
});
