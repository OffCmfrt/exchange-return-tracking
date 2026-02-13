const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory storage (replace with database in production)
const storage = {
    accessToken: null,
    requests: new Map(),
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
        throw new Error(`Shopify API error: ${response.status}`);
    }

    return response.json();
}

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
        res.status(500).json({ error: error.message });
    }
});

// Get product variants
app.post('/api/get-variants', async (req, res) => {
    try {
        const { productId } = req.body;

        const data = await shopifyAPI(`products/${productId}.json`);
        res.json(data.product.variants);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Submit exchange request
app.post('/api/submit-exchange', async (req, res) => {
    try {
        const requestId = 'REQ-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();

        storage.requests.set(requestId, {
            ...req.body,
            type: 'exchange',
            status: 'pending',
            createdAt: new Date().toISOString()
        });

        res.json({
            success: true,
            requestId,
            message: 'Exchange request submitted successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Submit return request
app.post('/api/submit-return', async (req, res) => {
    try {
        const requestId = 'REQ-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();

        storage.requests.set(requestId, {
            ...req.body,
            type: 'return',
            status: 'pending',
            createdAt: new Date().toISOString()
        });

        res.json({
            success: true,
            requestId,
            message: 'Return request submitted successfully'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Track request
app.get('/api/track-request/:requestId', (req, res) => {
    const request = storage.requests.get(req.params.requestId);

    if (!request) {
        return res.status(404).json({ error: 'Request not found' });
    }

    res.json(request);
});

// Track order (Shiprocket integration)
app.post('/api/track-order', async (req, res) => {
    try {
        const { orderNumber } = req.body;

        // Mock tracking data - replace with actual Shiprocket API
        res.json({
            orderNumber,
            status: 'in_transit',
            trackingNumber: 'SHIP' + Date.now(),
            estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
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
app.get('/api/admin/requests', authenticateAdmin, (req, res) => {
    const { status, type } = req.query;

    let requests = Array.from(storage.requests.values());

    if (status) {
        requests = requests.filter(r => r.status === status);
    }

    if (type) {
        requests = requests.filter(r => r.type === type);
    }

    const stats = {
        total: storage.requests.size,
        pending: requests.filter(r => r.status === 'pending').length,
        approved: requests.filter(r => r.status === 'approved').length,
        rejected: requests.filter(r => r.status === 'rejected').length
    };

    res.json({ requests, stats });
});

// Approve request (admin)
app.post('/api/admin/approve', authenticateAdmin, (req, res) => {
    const { requestId, notes } = req.body;

    const request = storage.requests.get(requestId);
    if (!request) {
        return res.status(404).json({ error: 'Request not found' });
    }

    request.status = 'approved';
    request.adminNotes = notes;
    request.approvedAt = new Date().toISOString();

    storage.requests.set(requestId, request);

    res.json({ success: true, message: 'Request approved' });
});

// Reject request (admin)
app.post('/api/admin/reject', authenticateAdmin, (req, res) => {
    const { requestId, notes } = req.body;

    const request = storage.requests.get(requestId);
    if (!request) {
        return res.status(404).json({ error: 'Request not found' });
    }

    request.status = 'rejected';
    request.adminNotes = notes;
    request.rejectedAt = new Date().toISOString();

    storage.requests.set(requestId, request);

    res.json({ success: true, message: 'Request rejected' });
});

// ==================== HEALTH CHECK ====================

app.get('/', (req, res) => {
    res.json({
        service: 'Offcomfrt Returns & Exchanges',
        status: 'running',
        authorized: !!(process.env.SHOPIFY_ACCESS_TOKEN || storage.accessToken),
        endpoints: {
            oauth: '/auth/install',
            public: ['/api/get-order', '/api/submit-exchange', '/api/submit-return', '/api/track-request/:id', '/api/track-order'],
            admin: ['/api/admin/login', '/api/admin/requests', '/api/admin/approve', '/api/admin/reject']
        }
    });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📦 Store: ${process.env.SHOPIFY_STORE}`);
    console.log(`🔐 Authorized: ${!!(process.env.SHOPIFY_ACCESS_TOKEN || storage.accessToken)}`);

    if (!process.env.SHOPIFY_ACCESS_TOKEN && !storage.accessToken) {
        console.log(`⚠️  Not authorized yet. Visit /auth/install to complete OAuth`);
    }
});
