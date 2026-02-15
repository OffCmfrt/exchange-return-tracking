const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();
const multer = require('multer');
const upload = multer();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Database
const {
    createRequest,
    getRequestById,
    getAllRequests,
    getRequestStats,
    updateRequestStatus
} = require('./config/db-helpers');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for OAuth tokens only (admin tokens can stay in memory)
const storage = {
    accessToken: null,
    adminTokens: new Set()
};



// ==================== OAUTH ROUTES ====================

// Start OAuth installation
app.get('/auth/install', (req, res) => {
    const shop = process.env.SHOPIFY_STORE;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
    const scopes = 'read_orders,write_orders,read_products,read_customers';

    const state = crypto.randomBytes(16).toString('hex');
    storage.oauthState = state;

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;

    res.redirect(authUrl);
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
    const { code, shop } = req.query;

    // Validate that we have the required parameters
    if (!code || !shop) {
        return res.status(400).send('Invalid OAuth callback - missing code or shop parameter');
    }

    // Verify shop matches our configured store
    if (shop !== process.env.SHOPIFY_STORE) {
        return res.status(400).send('Invalid OAuth callback - shop mismatch');
    }

    try {
        // Exchange code for access token
        const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: process.env.SHOPIFY_CLIENT_ID,
                client_secret: process.env.SHOPIFY_CLIENT_SECRET,
                code
            })
        });

        const data = await tokenResponse.json();
        storage.accessToken = data.access_token;

        res.send(`
      <h1>✅ Authorization Successful!</h1>
      <h2>Your Access Token:</h2>
      <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-wrap: break-word;">${data.access_token}</pre>
      <p><strong>IMPORTANT:</strong> Copy this token and add it to your Render environment variables as <code>SHOPIFY_ACCESS_TOKEN</code></p>
      <p>After adding the token, your service will be fully operational!</p>
    `);
    } catch (error) {
        res.status(500).send(`OAuth error: ${error.message}`);
    }
});

// ==================== SHOPIFY API HELPER ====================

async function shopifyAPI(endpoint, options = {}) {
    const token = process.env.SHOPIFY_ACCESS_TOKEN || storage.accessToken;
    const shop = process.env.SHOPIFY_STORE;

    if (!token) {
        throw new Error('Not authorized. Please complete OAuth flow first.');
    }

    const response = await fetch(`https://${shop}/admin/api/2024-01/${endpoint}`, {
        ...options,
        headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
    }

    return response.json();
}

// ==================== SHIPROCKET API HELPER ====================

let shiprocketToken = null;
let shiprocketTokenExpiry = null;

async function getShiprocketToken() {
    // Return cached token if still valid
    if (shiprocketToken && shiprocketTokenExpiry && Date.now() < shiprocketTokenExpiry) {
        return shiprocketToken;
    }

    // Get new token
    try {
        const response = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: process.env.SHIPROCKET_EMAIL,
                password: process.env.SHIPROCKET_PASSWORD
            })
        });

        if (!response.ok) {
            throw new Error(`Shiprocket auth failed: ${response.status}`);
        }

        const data = await response.json();
        shiprocketToken = data.token;
        shiprocketTokenExpiry = Date.now() + (10 * 24 * 60 * 60 * 1000); // 10 days

        return shiprocketToken;
    } catch (error) {
        console.error('Shiprocket authentication error:', error);
        throw error;
    }
}

async function shiprocketAPI(endpoint, options = {}) {
    const token = await getShiprocketToken();

    const response = await fetch(`https://apiv2.shiprocket.in/v1/external${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shiprocket API error: ${response.status} - ${errorText}`);
    }

    return response.json();
}


async function createShiprocketReturnOrder(requestData, shopifyOrder) {
    try {
        const token = await getShiprocketToken();
        const address = shopifyOrder.shipping_address || shopifyOrder.customer.default_address;

        if (!address) {
            throw new Error('No address found for return pickup');
        }

        const orderDate = new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0];

        const returnItems = requestData.items.map(item => ({
            name: item.name,
            sku: item.sku || String(item.variantId || item.id), // Fallback SKU
            units: parseInt(item.quantity) || 1,
            selling_price: parseFloat(item.price) || 0,
            discount: 0,
            tax: 0
        }));

        const payload = {
            order_id: requestData.requestId,
            order_date: orderDate,
            channel_id: '', // Optional
            pickup_customer_name: address.first_name,
            pickup_last_name: address.last_name || '',
            pickup_address: address.address1,
            pickup_address_2: address.address2 || '',
            pickup_city: address.city,
            pickup_state: address.province,
            pickup_country: address.country_code || 'IN',
            pickup_pincode: address.zip,
            pickup_email: shopifyOrder.email || 'noreply@example.com',
            pickup_phone: address.phone || shopifyOrder.phone || '9999999999',
            order_items: returnItems,
            payment_method: 'Prepaid',
            total_discount: 0,
            sub_total: returnItems.reduce((sum, item) => sum + (item.selling_price * item.units), 0),
            length: 10,
            breadth: 10,
            height: 10,
            weight: 0.5
        };

        console.log('Creating Shiprocket return order:', payload.order_id);

        const response = await fetch('https://apiv2.shiprocket.in/v1/external/orders/create/return', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.status_code === 422 || (data.errors && Object.keys(data.errors).length > 0)) {
            console.error('Shiprocket validation error:', JSON.stringify(data));
            return null;
        }

        return data;
    } catch (error) {
        console.error('Failed to create Shiprocket return:', error);
        return null;
    }
}

// ==================== CONFIG ENDPOINT ====================

// Get frontend configuration (Razorpay key, etc.)
app.get('/api/config', (req, res) => {
    res.json({
        razorpayKey: process.env.RAZORPAY_KEY_ID || null
    });
});

// ==================== PUBLIC API ENDPOINTS ====================

// Get order details
app.post('/api/get-order', async (req, res) => {
    try {
        const { orderNumber, email } = req.body;

        const data = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}&limit=1`);

        if (!data.orders || data.orders.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json(data.orders[0]);
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Lookup order (improved with better error handling)
app.post('/api/lookup-order', async (req, res) => {
    try {
        const { orderNumber, email } = req.body;

        console.log('Looking up order:', orderNumber, 'for email:', email);

        // Try to fetch order from Shopify
        let data;
        try {
            data = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&limit=10`);
        } catch (apiError) {
            console.error('Shopify API Error:', apiError.message);
            return res.status(500).json({
                error: 'Failed to connect to Shopify API',
                details: apiError.message
            });
        }

        if (!data.orders || data.orders.length === 0) {
            console.log('No orders found for:', orderNumber);
            return res.status(404).json({
                error: 'Order not found',
                isEligible: false,
                eligibilityMessage: 'Order not found. Please check your order number.'
            });
        }

        // Find order matching email OR phone
        const normalizedInput = email ? email.toLowerCase().trim() : '';
        const inputDigits = normalizedInput.replace(/\D/g, '');

        const order = data.orders.find(o => {
            const customerEmail = o.customer?.email?.toLowerCase() || '';
            const customerPhone = o.customer?.phone?.replace(/\D/g, '') || '';
            const shippingPhone = o.shipping_address?.phone?.replace(/\D/g, '') || '';

            // Check Email
            if (customerEmail && customerEmail === normalizedInput) return true;

            // Check Phone (loose match for last 10 digits)
            if (inputDigits.length >= 10) {
                if (customerPhone.endsWith(inputDigits.slice(-10))) return true;
                if (shippingPhone.endsWith(inputDigits.slice(-10))) return true;
            }
            return false;
        });

        if (!order) {
            console.log('Order found but email/phone does not match');
            return res.status(404).json({
                error: 'Order not found',
                isEligible: false,
                eligibilityMessage: 'Order not found with this email/phone. Please check your details.'
            });
        }

        console.log('Order found:', order.name);

        // Check eligibility
        const orderDate = new Date(order.created_at);
        const daysSinceOrder = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
        const isFulfilled = order.fulfillment_status === 'fulfilled';
        const isWithin30Days = daysSinceOrder <= 30;

        const eligibilityMessage = !isFulfilled
            ? 'Order must be fulfilled before exchange/return'
            : !isWithin30Days
                ? 'Order is older than 30 days and not eligible'
                : 'Order is eligible for exchange/return';

        console.log('Eligibility:', { isFulfilled, isWithin30Days, daysSinceOrder });

        // Fetch product images
        const productIds = [...new Set(order.line_items.map(item => item.product_id).filter(id => id))];
        const productImages = {};

        if (productIds.length > 0) {
            try {
                const productsData = await shopifyAPI(`products.json?ids=${productIds.join(',')}&fields=id,image,images`);
                if (productsData.products) {
                    productsData.products.forEach(p => {
                        if (p.image) {
                            productImages[p.id] = p.image.src;
                        } else if (p.images && p.images.length > 0) {
                            productImages[p.id] = p.images[0].src;
                        }
                    });
                }
            } catch (err) {
                console.error('Failed to fetch product images:', err);
                // Continue without images
            }
        }

        // Format shipping address
        let shippingAddress = 'No shipping address';
        if (order.shipping_address) {
            const addr = order.shipping_address;
            shippingAddress = [
                addr.address1,
                addr.address2,
                addr.city,
                addr.province,
                addr.zip,
                addr.country
            ].filter(part => part).join(', ');
        }

        res.json({
            isEligible: isFulfilled && isWithin30Days,
            eligibilityMessage,
            order: {
                orderNumber: order.name,
                customerName: order.customer
                    ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                    : 'Customer',
                email: order.customer?.email || email,
                phone: order.customer?.phone || order.shipping_address?.phone || '',
                orderDate: order.created_at,
                totalAmount: order.total_price,
                shippingAddress,
                items: order.line_items.map(item => ({
                    id: item.id,
                    productId: item.product_id,
                    variantId: item.variant_id,
                    name: item.name,
                    variant: item.variant_title || 'Default',
                    quantity: item.quantity,
                    price: item.price,
                    image: productImages[item.product_id] ||
                        (item.properties && item.properties.image) ||
                        `https://cdn.shopify.com/shopifycloud/placeholder.jpg`
                }))
            }
        });
    } catch (error) {
        console.error('Lookup order error:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});

// Get product variants
app.post('/api/get-variants', async (req, res) => {
    try {
        const { productId } = req.body;

        const data = await shopifyAPI(`products/${productId}.json`);
        res.json(data.product.variants);
    } catch (error) {
        console.error('Get variants error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Submit exchange request
app.post('/api/submit-exchange', upload.any(), async (req, res) => {
    try {
        const requestId = 'REQ-' + Math.floor(10000 + Math.random() * 90000);

        // Parse items if string
        let items = req.body.items;
        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                console.error('Failed to parse items:', e);
                items = [];
            }
        }

        // Create Shiprocket Return Order (if enabled)
        if (process.env.SHIPROCKET_EMAIL) {
            try {
                // Fetch full order to get address
                const shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(req.body.orderNumber)}&limit=1`);
                const shopifyOrder = shopifyData.orders && shopifyData.orders[0];

                if (shopifyOrder) {
                    const shiprocketData = await createShiprocketReturnOrder({ ...req.body, requestId, items }, shopifyOrder);
                    if (shiprocketData && shiprocketData.shipment_id) {
                        console.log('Shiprocket return created. ID:', shiprocketData.shipment_id);
                        // Access AWB if available immediately (often created asynchronously or returned here)
                        // For returns, sometimes AWB is not immediate. But usually `awb_code` might be in response or separate call?
                        // Assuming response has it or we track via shipment_id.
                    }
                }
            } catch (srError) {
                console.error('Shiprocket return creation failed:', srError);
            }
        }

        await createRequest({
            requestId,
            ...req.body,
            items,
            type: 'exchange'
        });

        res.json({
            success: true,
            requestId,
            message: 'Exchange request submitted successfully'
        });
    } catch (error) {
        console.error('Submit exchange error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Submit return request
app.post('/api/submit-return', upload.any(), async (req, res) => {
    try {
        const requestId = 'REQ-' + Math.floor(10000 + Math.random() * 90000);

        // Parse items if string
        let items = req.body.items;
        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                console.error('Failed to parse items:', e);
                items = [];
            }
        }

        // Create Shiprocket Return Order (if enabled)
        if (process.env.SHIPROCKET_EMAIL) {
            try {
                // Fetch full order to get address
                const shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(req.body.orderNumber)}&limit=1`);
                const shopifyOrder = shopifyData.orders && shopifyData.orders[0];

                if (shopifyOrder) {
                    const shiprocketData = await createShiprocketReturnOrder({ ...req.body, requestId, items }, shopifyOrder);
                    if (shiprocketData && shiprocketData.shipment_id) {
                        console.log('Shiprocket return created. ID:', shiprocketData.shipment_id);
                    }
                }
            } catch (srError) {
                console.error('Shiprocket return creation failed:', srError);
            }
        }

        await createRequest({
            requestId,
            ...req.body,
            items,
            type: 'return'
        });

        res.json({
            success: true,
            requestId,
            message: 'Return request submitted successfully'
        });
    } catch (error) {
        console.error('Submit return error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Track request
app.get('/api/track-request/:requestId', async (req, res) => {
    try {
        const request = await getRequestById(req.params.requestId);

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        res.json(request);
    } catch (error) {
        console.error('Track request error:', error);
        res.status(500).json({ error: 'Failed to track request' });
    }
});

// Track order (IMPROVED with Shiprocket integration)
app.post('/api/track-order', async (req, res) => {
    try {
        const { orderNumber, email } = req.body;

        if (!orderNumber || !email) {
            return res.status(400).json({ error: 'Order number and email are required' });
        }

        console.log('Tracking order:', orderNumber, 'for email:', email);

        // Get order from Shopify
        let shopifyData;
        try {
            shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&limit=10`);
        } catch (apiError) {
            console.error('Shopify API Error:', apiError.message);
            return res.status(500).json({ error: 'Failed to fetch order from Shopify' });
        }

        if (!shopifyData.orders || shopifyData.orders.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Find matching order by email OR phone
        const normalizedInput = email ? email.toLowerCase().trim() : '';
        const inputDigits = normalizedInput.replace(/\D/g, '');

        const order = shopifyData.orders.find(o => {
            const customerEmail = o.customer?.email?.toLowerCase() || '';
            const customerPhone = o.customer?.phone?.replace(/\D/g, '') || '';
            const shippingPhone = o.shipping_address?.phone?.replace(/\D/g, '') || '';

            // Check Email
            if (customerEmail && customerEmail === normalizedInput) return true;

            // Check Phone (loose match for last 10 digits)
            if (inputDigits.length >= 10) {
                if (customerPhone.endsWith(inputDigits.slice(-10))) return true;
                if (shippingPhone.endsWith(inputDigits.slice(-10))) return true;
            }
            return false;
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found with this email/phone' });
        }

        // Check if order has fulfillments
        const fulfillments = order.fulfillments || [];

        if (fulfillments.length === 0) {
            return res.json({
                status: 'pending_shipment',
                message: 'Your order is being processed and will be shipped soon.',
                orderNumber: order.name,
                customerName: order.customer
                    ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                    : 'Customer',
                orderDate: order.created_at,
                totalAmount: order.total_price
            });
        }

        // Get tracking info from first fulfillment
        const fulfillment = fulfillments[0];
        const trackingNumber = fulfillment.tracking_number;
        const trackingUrl = fulfillment.tracking_url;

        // Fetch product images
        const productIds = [...new Set(order.line_items.map(item => item.product_id).filter(id => id))];
        const productImages = {};

        if (productIds.length > 0) {
            try {
                const productsData = await shopifyAPI(`products.json?ids=${productIds.join(',')}&fields=id,image,images`);
                if (productsData.products) {
                    productsData.products.forEach(p => {
                        if (p.image) {
                            productImages[p.id] = p.image.src;
                        } else if (p.images && p.images.length > 0) {
                            productImages[p.id] = p.images[0].src;
                        }
                    });
                }
            } catch (err) {
                console.error('Failed to fetch product images for tracking:', err);
            }
        }

        // Prepare basic response
        const response = {
            orderNumber: order.name,
            customerName: order.customer
                ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                : 'Customer',
            orderDate: order.created_at,
            totalAmount: order.total_price,
            currentStatus: fulfillment.shipment_status || 'Shipped',
            awbNumber: trackingNumber || 'N/A',
            courierName: fulfillment.tracking_company || 'N/A',
            trackingUrl: trackingUrl || null,
            estimatedDelivery: null,
            items: order.line_items.map(item => ({
                name: item.name,
                variant: item.variant_title || 'Default',
                quantity: item.quantity,
                price: item.price,
                image: productImages[item.product_id] || item.properties?.image || 'https://via.placeholder.com/200'
            })),
            activities: [],
            shipment: null
        };

        // Try to get detailed tracking from Shiprocket if AWB exists
        if (trackingNumber && process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD) {
            try {
                const trackingData = await shiprocketAPI(`/courier/track/awb/${trackingNumber}`);

                if (trackingData && trackingData.tracking_data) {
                    const tracking = trackingData.tracking_data;

                    // Update response with Shiprocket data
                    response.currentStatus = tracking.current_status || response.currentStatus;
                    response.courierName = tracking.courier_name || response.courierName;
                    response.estimatedDelivery = tracking.edd || null;

                    // Add shipment details
                    response.shipment = {
                        origin: tracking.origin || null,
                        destination: tracking.destination || null,
                        weight: tracking.weight || null,
                        packages: tracking.packages || null,
                        deliveredDate: tracking.delivered_date || null,
                        deliveredTo: tracking.delivered_to || null
                    };

                    // Add tracking activities
                    if (tracking.shipment_track && Array.isArray(tracking.shipment_track)) {
                        response.activities = tracking.shipment_track.map(activity => ({
                            status: activity['sr-status-label'] || activity.status,
                            activity: activity.activity || activity['sr-status-label'],
                            date: activity.date,
                            location: activity.location || null
                        }));
                    }

                    // Check if delivered
                    response.isDelivered = tracking.current_status?.toLowerCase().includes('delivered') || false;

                    // Add message for old/delivered orders
                    const orderDate = new Date(order.created_at);
                    const daysSinceOrder = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
                    response.isOldOrder = daysSinceOrder > 30;

                    if (response.isDelivered) {
                        response.message = '✅ Your order has been delivered successfully!';
                    } else if (response.isOldOrder) {
                        response.message = 'This order is older than 30 days. Some tracking details may no longer be available.';
                    }
                }
            } catch (shiprocketError) {
                console.error('Shiprocket tracking error:', shiprocketError.message);
                // Continue with basic Shopify data if Shiprocket fails
            }
        }

        res.json(response);

    } catch (error) {
        console.error('Track order error:', error);
        res.status(500).json({ error: 'Failed to track order. Please try again.' });
    }
});

// ==================== ADMIN ENDPOINTS ====================

// Admin authentication middleware
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);

    if (token !== process.env.ADMIN_PASSWORD && !storage.adminTokens.has(token)) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    next();
}

// Admin login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;

    if (password === process.env.ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        storage.adminTokens.add(token);

        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// Get all requests (admin)
app.get('/api/admin/requests', authenticateAdmin, async (req, res) => {
    try {
        const { status, type } = req.query;

        const requests = await getAllRequests({ status, type });
        const stats = await getRequestStats();

        res.json({ requests, stats });
    } catch (error) {
        console.error('Get requests error:', error);
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

// Approve request (admin) - supports legacy endpoints
app.post(['/api/admin/approve', '/api/admin/approve-return', '/api/admin/approve-exchange'], authenticateAdmin, async (req, res) => {
    try {
        const { requestId, notes } = req.body;

        const request = await updateRequestStatus(requestId, {
            status: 'approved',
            adminNotes: notes
        });

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        res.json({ success: true, message: 'Request approved' });
    } catch (error) {
        console.error('Approve request error:', error);
        res.status(500).json({ error: 'Failed to approve request' });
    }
});

// Reject request (admin) - supports legacy endpoints
app.post(['/api/admin/reject', '/api/admin/reject-return', '/api/admin/reject-exchange'], authenticateAdmin, async (req, res) => {
    try {
        const { requestId, notes } = req.body;

        const request = await updateRequestStatus(requestId, {
            status: 'rejected',
            adminNotes: notes
        });

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        res.json({ success: true, message: 'Request rejected' });
    } catch (error) {
        console.error('Reject request error:', error);
        res.status(500).json({ error: 'Failed to reject request' });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/', (req, res) => {
    res.json({
        service: 'Offcomfrt Returns & Exchanges',
        status: 'running',
        authorized: !!(process.env.SHOPIFY_ACCESS_TOKEN || storage.accessToken),
        shiprocketConfigured: !!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD),
        endpoints: {
            oauth: '/auth/install',
            public: ['/api/get-order', '/api/lookup-order', '/api/submit-exchange', '/api/submit-return', '/api/track-request/:id', '/api/track-order'],
            admin: ['/api/admin/login', '/api/admin/requests', '/api/admin/approve', '/api/admin/reject']
        }
    });
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📦 Store: ${process.env.SHOPIFY_STORE}`);
    console.log(`🔐 Shopify Authorized: ${!!(process.env.SHOPIFY_ACCESS_TOKEN || storage.accessToken)}`);
    console.log(`📮 Shiprocket Configured: ${!!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD)}`);

    if (!process.env.SHOPIFY_ACCESS_TOKEN && !storage.accessToken) {
        console.log(`⚠️  Not authorized yet. Visit /auth/install to complete OAuth`);
    }
});
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();
const multer = require('multer');
const upload = multer();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Database
const {
    createRequest,
    getRequestById,
    getAllRequests,
    getRequestStats,
    updateRequestStatus
} = require('./config/db-helpers');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for OAuth tokens only (admin tokens can stay in memory)
const storage = {
    accessToken: null,
    adminTokens: new Set()
};



// ==================== OAUTH ROUTES ====================

// Start OAuth installation
app.get('/auth/install', (req, res) => {
    const shop = process.env.SHOPIFY_STORE;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
    const scopes = 'read_orders,write_orders,read_products,read_customers';

    const state = crypto.randomBytes(16).toString('hex');
    storage.oauthState = state;

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;

    res.redirect(authUrl);
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
    const { code, shop } = req.query;

    // Validate that we have the required parameters
    if (!code || !shop) {
        return res.status(400).send('Invalid OAuth callback - missing code or shop parameter');
    }

    // Verify shop matches our configured store
    if (shop !== process.env.SHOPIFY_STORE) {
        return res.status(400).send('Invalid OAuth callback - shop mismatch');
    }

    try {
        // Exchange code for access token
        const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: process.env.SHOPIFY_CLIENT_ID,
                client_secret: process.env.SHOPIFY_CLIENT_SECRET,
                code
            })
        });

        const data = await tokenResponse.json();
        storage.accessToken = data.access_token;

        res.send(`
      <h1>✅ Authorization Successful!</h1>
      <h2>Your Access Token:</h2>
      <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-wrap: break-word;">${data.access_token}</pre>
      <p><strong>IMPORTANT:</strong> Copy this token and add it to your Render environment variables as <code>SHOPIFY_ACCESS_TOKEN</code></p>
      <p>After adding the token, your service will be fully operational!</p>
    `);
    } catch (error) {
        res.status(500).send(`OAuth error: ${error.message}`);
    }
});

// ==================== SHOPIFY API HELPER ====================

async function shopifyAPI(endpoint, options = {}) {
    const token = process.env.SHOPIFY_ACCESS_TOKEN || storage.accessToken;
    const shop = process.env.SHOPIFY_STORE;

    if (!token) {
        throw new Error('Not authorized. Please complete OAuth flow first.');
    }

    const response = await fetch(`https://${shop}/admin/api/2024-01/${endpoint}`, {
        ...options,
        headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
    }

    return response.json();
}

// ==================== SHIPROCKET API HELPER ====================

let shiprocketToken = null;
let shiprocketTokenExpiry = null;

async function getShiprocketToken() {
    // Return cached token if still valid
    if (shiprocketToken && shiprocketTokenExpiry && Date.now() < shiprocketTokenExpiry) {
        return shiprocketToken;
    }

    // Get new token
    try {
        const response = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: process.env.SHIPROCKET_EMAIL,
                password: process.env.SHIPROCKET_PASSWORD
            })
        });

        if (!response.ok) {
            throw new Error(`Shiprocket auth failed: ${response.status}`);
        }

        const data = await response.json();
        shiprocketToken = data.token;
        shiprocketTokenExpiry = Date.now() + (10 * 24 * 60 * 60 * 1000); // 10 days

        return shiprocketToken;
    } catch (error) {
        console.error('Shiprocket authentication error:', error);
        throw error;
    }
}

async function shiprocketAPI(endpoint, options = {}) {
    const token = await getShiprocketToken();

    const response = await fetch(`https://apiv2.shiprocket.in/v1/external${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shiprocket API error: ${response.status} - ${errorText}`);
    }

    return response.json();
}


async function createShiprocketReturnOrder(requestData, shopifyOrder) {
    try {
        const token = await getShiprocketToken();
        const address = shopifyOrder.shipping_address || shopifyOrder.customer.default_address;

        if (!address) {
            throw new Error('No address found for return pickup');
        }

        const orderDate = new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0];

        const returnItems = requestData.items.map(item => ({
            name: item.name,
            sku: item.sku || String(item.variantId || item.id), // Fallback SKU
            units: parseInt(item.quantity) || 1,
            selling_price: parseFloat(item.price) || 0,
            discount: 0,
            tax: 0
        }));

        const payload = {
            order_id: requestData.requestId,
            order_date: orderDate,
            channel_id: '', // Optional
            pickup_customer_name: address.first_name,
            pickup_last_name: address.last_name || '',
            pickup_address: address.address1,
            pickup_address_2: address.address2 || '',
            pickup_city: address.city,
            pickup_state: address.province,
            pickup_country: address.country_code || 'IN',
            pickup_pincode: address.zip,
            pickup_email: shopifyOrder.email || 'noreply@example.com',
            pickup_phone: address.phone || shopifyOrder.phone || '9999999999',
            order_items: returnItems,
            payment_method: 'Prepaid',
            total_discount: 0,
            sub_total: returnItems.reduce((sum, item) => sum + (item.selling_price * item.units), 0),
            length: 10,
            breadth: 10,
            height: 10,
            weight: 0.5
        };

        console.log('Creating Shiprocket return order:', payload.order_id);

        const response = await fetch('https://apiv2.shiprocket.in/v1/external/orders/create/return', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.status_code === 422 || (data.errors && Object.keys(data.errors).length > 0)) {
            console.error('Shiprocket validation error:', JSON.stringify(data));
            return null;
        }

        return data;
    } catch (error) {
        console.error('Failed to create Shiprocket return:', error);
        return null;
    }
}

// ==================== CONFIG ENDPOINT ====================

// Get frontend configuration (Razorpay key, etc.)
app.get('/api/config', (req, res) => {
    res.json({
        razorpayKey: process.env.RAZORPAY_KEY_ID || null
    });
});

// ==================== PUBLIC API ENDPOINTS ====================

// Get order details
app.post('/api/get-order', async (req, res) => {
    try {
        const { orderNumber, email } = req.body;

        const data = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}&limit=1`);

        if (!data.orders || data.orders.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json(data.orders[0]);
    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Lookup order (improved with better error handling)
app.post('/api/lookup-order', async (req, res) => {
    try {
        const { orderNumber, email } = req.body;

        console.log('Looking up order:', orderNumber, 'for email:', email);

        // Try to fetch order from Shopify
        let data;
        try {
            data = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&limit=10`);
        } catch (apiError) {
            console.error('Shopify API Error:', apiError.message);
            return res.status(500).json({
                error: 'Failed to connect to Shopify API',
                details: apiError.message
            });
        }

        if (!data.orders || data.orders.length === 0) {
            console.log('No orders found for:', orderNumber);
            return res.status(404).json({
                error: 'Order not found',
                isEligible: false,
                eligibilityMessage: 'Order not found. Please check your order number.'
            });
        }

        // Find order matching email OR phone
        const normalizedInput = email ? email.toLowerCase().trim() : '';
        const inputDigits = normalizedInput.replace(/\D/g, '');

        const order = data.orders.find(o => {
            const customerEmail = o.customer?.email?.toLowerCase() || '';
            const customerPhone = o.customer?.phone?.replace(/\D/g, '') || '';
            const shippingPhone = o.shipping_address?.phone?.replace(/\D/g, '') || '';

            // Check Email
            if (customerEmail && customerEmail === normalizedInput) return true;

            // Check Phone (loose match for last 10 digits)
            if (inputDigits.length >= 10) {
                if (customerPhone.endsWith(inputDigits.slice(-10))) return true;
                if (shippingPhone.endsWith(inputDigits.slice(-10))) return true;
            }
            return false;
        });

        if (!order) {
            console.log('Order found but email/phone does not match');
            return res.status(404).json({
                error: 'Order not found',
                isEligible: false,
                eligibilityMessage: 'Order not found with this email/phone. Please check your details.'
            });
        }

        console.log('Order found:', order.name);

        // Check eligibility
        const orderDate = new Date(order.created_at);
        const daysSinceOrder = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
        const isFulfilled = order.fulfillment_status === 'fulfilled';
        const isWithin30Days = daysSinceOrder <= 30;

        const eligibilityMessage = !isFulfilled
            ? 'Order must be fulfilled before exchange/return'
            : !isWithin30Days
                ? 'Order is older than 30 days and not eligible'
                : 'Order is eligible for exchange/return';

        console.log('Eligibility:', { isFulfilled, isWithin30Days, daysSinceOrder });

        // Fetch product images
        const productIds = [...new Set(order.line_items.map(item => item.product_id).filter(id => id))];
        const productImages = {};

        if (productIds.length > 0) {
            try {
                const productsData = await shopifyAPI(`products.json?ids=${productIds.join(',')}&fields=id,image,images`);
                if (productsData.products) {
                    productsData.products.forEach(p => {
                        if (p.image) {
                            productImages[p.id] = p.image.src;
                        } else if (p.images && p.images.length > 0) {
                            productImages[p.id] = p.images[0].src;
                        }
                    });
                }
            } catch (err) {
                console.error('Failed to fetch product images:', err);
                // Continue without images
            }
        }

        // Format shipping address
        let shippingAddress = 'No shipping address';
        if (order.shipping_address) {
            const addr = order.shipping_address;
            shippingAddress = [
                addr.address1,
                addr.address2,
                addr.city,
                addr.province,
                addr.zip,
                addr.country
            ].filter(part => part).join(', ');
        }

        res.json({
            isEligible: isFulfilled && isWithin30Days,
            eligibilityMessage,
            order: {
                orderNumber: order.name,
                customerName: order.customer
                    ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                    : 'Customer',
                email: order.customer?.email || email,
                phone: order.customer?.phone || order.shipping_address?.phone || '',
                orderDate: order.created_at,
                totalAmount: order.total_price,
                shippingAddress,
                items: order.line_items.map(item => ({
                    id: item.id,
                    productId: item.product_id,
                    variantId: item.variant_id,
                    name: item.name,
                    variant: item.variant_title || 'Default',
                    quantity: item.quantity,
                    price: item.price,
                    image: productImages[item.product_id] ||
                        (item.properties && item.properties.image) ||
                        `https://cdn.shopify.com/shopifycloud/placeholder.jpg`
                }))
            }
        });
    } catch (error) {
        console.error('Lookup order error:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});

// Get product variants
app.post('/api/get-variants', async (req, res) => {
    try {
        const { productId } = req.body;

        const data = await shopifyAPI(`products/${productId}.json`);
        res.json(data.product.variants);
    } catch (error) {
        console.error('Get variants error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Submit exchange request
app.post('/api/submit-exchange', upload.any(), async (req, res) => {
    try {
        const requestId = 'REQ-' + Math.floor(10000 + Math.random() * 90000);

        // Parse items if string
        let items = req.body.items;
        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                console.error('Failed to parse items:', e);
                items = [];
            }
        }

        // Create Shiprocket Return Order (if enabled)
        if (process.env.SHIPROCKET_EMAIL) {
            try {
                // Fetch full order to get address
                const shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(req.body.orderNumber)}&limit=1`);
                const shopifyOrder = shopifyData.orders && shopifyData.orders[0];

                if (shopifyOrder) {
                    const shiprocketData = await createShiprocketReturnOrder({ ...req.body, requestId, items }, shopifyOrder);
                    if (shiprocketData && shiprocketData.shipment_id) {
                        console.log('Shiprocket return created. ID:', shiprocketData.shipment_id);
                        // Access AWB if available immediately (often created asynchronously or returned here)
                        // For returns, sometimes AWB is not immediate. But usually `awb_code` might be in response or separate call?
                        // Assuming response has it or we track via shipment_id.
                    }
                }
            } catch (srError) {
                console.error('Shiprocket return creation failed:', srError);
            }
        }

        await createRequest({
            requestId,
            ...req.body,
            items,
            type: 'exchange'
        });

        res.json({
            success: true,
            requestId,
            message: 'Exchange request submitted successfully'
        });
    } catch (error) {
        console.error('Submit exchange error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Submit return request
app.post('/api/submit-return', upload.any(), async (req, res) => {
    try {
        const requestId = 'REQ-' + Math.floor(10000 + Math.random() * 90000);

        // Parse items if string
        let items = req.body.items;
        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                console.error('Failed to parse items:', e);
                items = [];
            }
        }

        // Create Shiprocket Return Order (if enabled)
        if (process.env.SHIPROCKET_EMAIL) {
            try {
                // Fetch full order to get address
                const shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(req.body.orderNumber)}&limit=1`);
                const shopifyOrder = shopifyData.orders && shopifyData.orders[0];

                if (shopifyOrder) {
                    const shiprocketData = await createShiprocketReturnOrder({ ...req.body, requestId, items }, shopifyOrder);
                    if (shiprocketData && shiprocketData.shipment_id) {
                        console.log('Shiprocket return created. ID:', shiprocketData.shipment_id);
                    }
                }
            } catch (srError) {
                console.error('Shiprocket return creation failed:', srError);
            }
        }

        await createRequest({
            requestId,
            ...req.body,
            items,
            type: 'return'
        });

        res.json({
            success: true,
            requestId,
            message: 'Return request submitted successfully'
        });
    } catch (error) {
        console.error('Submit return error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Track request
app.get('/api/track-request/:requestId', async (req, res) => {
    try {
        const request = await getRequestById(req.params.requestId);

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        res.json(request);
    } catch (error) {
        console.error('Track request error:', error);
        res.status(500).json({ error: 'Failed to track request' });
    }
});

// Track order (IMPROVED with Shiprocket integration)
app.post('/api/track-order', async (req, res) => {
    try {
        const { orderNumber, email } = req.body;

        if (!orderNumber || !email) {
            return res.status(400).json({ error: 'Order number and email are required' });
        }

        console.log('Tracking order:', orderNumber, 'for email:', email);

        // Get order from Shopify
        let shopifyData;
        try {
            shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&limit=10`);
        } catch (apiError) {
            console.error('Shopify API Error:', apiError.message);
            return res.status(500).json({ error: 'Failed to fetch order from Shopify' });
        }

        if (!shopifyData.orders || shopifyData.orders.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Find matching order by email OR phone
        const normalizedInput = email ? email.toLowerCase().trim() : '';
        const inputDigits = normalizedInput.replace(/\D/g, '');

        const order = shopifyData.orders.find(o => {
            const customerEmail = o.customer?.email?.toLowerCase() || '';
            const customerPhone = o.customer?.phone?.replace(/\D/g, '') || '';
            const shippingPhone = o.shipping_address?.phone?.replace(/\D/g, '') || '';

            // Check Email
            if (customerEmail && customerEmail === normalizedInput) return true;

            // Check Phone (loose match for last 10 digits)
            if (inputDigits.length >= 10) {
                if (customerPhone.endsWith(inputDigits.slice(-10))) return true;
                if (shippingPhone.endsWith(inputDigits.slice(-10))) return true;
            }
            return false;
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found with this email/phone' });
        }

        // Check if order has fulfillments
        const fulfillments = order.fulfillments || [];

        if (fulfillments.length === 0) {
            return res.json({
                status: 'pending_shipment',
                message: 'Your order is being processed and will be shipped soon.',
                orderNumber: order.name,
                customerName: order.customer
                    ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                    : 'Customer',
                orderDate: order.created_at,
                totalAmount: order.total_price
            });
        }

        // Get tracking info from first fulfillment
        const fulfillment = fulfillments[0];
        const trackingNumber = fulfillment.tracking_number;
        const trackingUrl = fulfillment.tracking_url;

        // Fetch product images
        const productIds = [...new Set(order.line_items.map(item => item.product_id).filter(id => id))];
        const productImages = {};

        if (productIds.length > 0) {
            try {
                const productsData = await shopifyAPI(`products.json?ids=${productIds.join(',')}&fields=id,image,images`);
                if (productsData.products) {
                    productsData.products.forEach(p => {
                        if (p.image) {
                            productImages[p.id] = p.image.src;
                        } else if (p.images && p.images.length > 0) {
                            productImages[p.id] = p.images[0].src;
                        }
                    });
                }
            } catch (err) {
                console.error('Failed to fetch product images for tracking:', err);
            }
        }

        // Prepare basic response
        const response = {
            orderNumber: order.name,
            customerName: order.customer
                ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                : 'Customer',
            orderDate: order.created_at,
            totalAmount: order.total_price,
            currentStatus: fulfillment.shipment_status || 'Shipped',
            awbNumber: trackingNumber || 'N/A',
            courierName: fulfillment.tracking_company || 'N/A',
            trackingUrl: trackingUrl || null,
            estimatedDelivery: null,
            items: order.line_items.map(item => ({
                name: item.name,
                variant: item.variant_title || 'Default',
                quantity: item.quantity,
                price: item.price,
                image: productImages[item.product_id] || item.properties?.image || 'https://via.placeholder.com/200'
            })),
            activities: [],
            shipment: null
        };

        // Try to get detailed tracking from Shiprocket if AWB exists
        if (trackingNumber && process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD) {
            try {
                const trackingData = await shiprocketAPI(`/courier/track/awb/${trackingNumber}`);

                if (trackingData && trackingData.tracking_data) {
                    const tracking = trackingData.tracking_data;

                    // Update response with Shiprocket data
                    response.currentStatus = tracking.current_status || response.currentStatus;
                    response.courierName = tracking.courier_name || response.courierName;
                    response.estimatedDelivery = tracking.edd || null;

                    // Add shipment details
                    response.shipment = {
                        origin: tracking.origin || null,
                        destination: tracking.destination || null,
                        weight: tracking.weight || null,
                        packages: tracking.packages || null,
                        deliveredDate: tracking.delivered_date || null,
                        deliveredTo: tracking.delivered_to || null
                    };

                    // Add tracking activities
                    if (tracking.shipment_track && Array.isArray(tracking.shipment_track)) {
                        response.activities = tracking.shipment_track.map(activity => ({
                            status: activity['sr-status-label'] || activity.status,
                            activity: activity.activity || activity['sr-status-label'],
                            date: activity.date,
                            location: activity.location || null
                        }));
                    }

                    // Check if delivered
                    response.isDelivered = tracking.current_status?.toLowerCase().includes('delivered') || false;

                    // Add message for old/delivered orders
                    const orderDate = new Date(order.created_at);
                    const daysSinceOrder = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
                    response.isOldOrder = daysSinceOrder > 30;

                    if (response.isDelivered) {
                        response.message = '✅ Your order has been delivered successfully!';
                    } else if (response.isOldOrder) {
                        response.message = 'This order is older than 30 days. Some tracking details may no longer be available.';
                    }
                }
            } catch (shiprocketError) {
                console.error('Shiprocket tracking error:', shiprocketError.message);
                // Continue with basic Shopify data if Shiprocket fails
            }
        }

        res.json(response);

    } catch (error) {
        console.error('Track order error:', error);
        res.status(500).json({ error: 'Failed to track order. Please try again.' });
    }
});

// ==================== ADMIN ENDPOINTS ====================

// Admin authentication middleware
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);

    if (token !== process.env.ADMIN_PASSWORD && !storage.adminTokens.has(token)) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    next();
}

// Admin login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;

    if (password === process.env.ADMIN_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        storage.adminTokens.add(token);

        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: 'Invalid password' });
    }
});

// Get all requests (admin)
app.get('/api/admin/requests', authenticateAdmin, async (req, res) => {
    try {
        const { status, type } = req.query;

        const requests = await getAllRequests({ status, type });
        const stats = await getRequestStats();

        res.json({ requests, stats });
    } catch (error) {
        console.error('Get requests error:', error);
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

// Approve request (admin) - supports legacy endpoints
app.post(['/api/admin/approve', '/api/admin/approve-return', '/api/admin/approve-exchange'], authenticateAdmin, async (req, res) => {
    try {
        const { requestId, notes } = req.body;

        const request = await updateRequestStatus(requestId, {
            status: 'approved',
            adminNotes: notes
        });

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        res.json({ success: true, message: 'Request approved' });
    } catch (error) {
        console.error('Approve request error:', error);
        res.status(500).json({ error: 'Failed to approve request' });
    }
});

// Reject request (admin) - supports legacy endpoints
app.post(['/api/admin/reject', '/api/admin/reject-return', '/api/admin/reject-exchange'], authenticateAdmin, async (req, res) => {
    try {
        const { requestId, notes } = req.body;

        const request = await updateRequestStatus(requestId, {
            status: 'rejected',
            adminNotes: notes
        });

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        res.json({ success: true, message: 'Request rejected' });
    } catch (error) {
        console.error('Reject request error:', error);
        res.status(500).json({ error: 'Failed to reject request' });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/', (req, res) => {
    res.json({
        service: 'Offcomfrt Returns & Exchanges',
        status: 'running',
        authorized: !!(process.env.SHOPIFY_ACCESS_TOKEN || storage.accessToken),
        shiprocketConfigured: !!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD),
        endpoints: {
            oauth: '/auth/install',
            public: ['/api/get-order', '/api/lookup-order', '/api/submit-exchange', '/api/submit-return', '/api/track-request/:id', '/api/track-order'],
            admin: ['/api/admin/login', '/api/admin/requests', '/api/admin/approve', '/api/admin/reject']
        }
    });
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📦 Store: ${process.env.SHOPIFY_STORE}`);
    console.log(`🔐 Shopify Authorized: ${!!(process.env.SHOPIFY_ACCESS_TOKEN || storage.accessToken)}`);
    console.log(`📮 Shiprocket Configured: ${!!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD)}`);

    if (!process.env.SHOPIFY_ACCESS_TOKEN && !storage.accessToken) {
        console.log(`⚠️  Not authorized yet. Visit /auth/install to complete OAuth`);
    }
});
