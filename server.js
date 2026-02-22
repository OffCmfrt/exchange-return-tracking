const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Razorpay = require('razorpay');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Database
const {
    createRequest,
    getRequestById,
    getAllRequests,
    getRequestStats,
    updateRequestStatus,
    deleteRequests
} = require('./config/db-helpers');

// Middleware
app.use(cors());
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(express.static('public'));

// In-memory storage for OAuth tokens only (admin tokens can stay in memory)
const storage = {
    accessToken: null,
    adminTokens: new Set()
};

console.log('Starting server initialization...');

// ==================== CLOUDINARY CONFIG ====================

let uploadStorage;
try {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        throw new Error('Missing Cloudinary Environment Variables');
    }

    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });

    uploadStorage = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder: 'returns',
            allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
        },
    });
    console.log('✅ Cloudinary storage configured successfully');
} catch (error) {
    console.error('⚠️ Cloudinary configuration failed:', error.message);
    console.warn('⚠️ Falling back to MemoryStorage (Warning: High RAM usage with multiple uploads)');
    uploadStorage = multer.memoryStorage();
}

const upload = multer({ storage: uploadStorage });

// ==================== RAZORPAY CONFIG ====================
let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    console.log('✅ Razorpay initialized');
} else {
    console.warn('⚠️ Razorpay credentials missing - Payments may fail or be unverified');
}

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


// ==================== SHIPROCKET HELPERS ====================

/**
 * Ensures an email is valid for Shiprocket, with fallbacks.
 */
function getValidEmail(inputEmail, shopifyOrder) {
    const isValid = (email) => {
        if (!email || typeof email !== 'string') return false;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    if (isValid(inputEmail)) return inputEmail;

    if (shopifyOrder) {
        if (isValid(shopifyOrder.email)) return shopifyOrder.email;
        if (shopifyOrder.customer && isValid(shopifyOrder.customer.email)) return shopifyOrder.customer.email;
    }

    // Default placeholder email to ensure label creation doesn't fail
    return 'returns@offcomfort.com';
}

async function createShiprocketReturnOrder(requestData, shopifyOrder) {
    try {
        const token = getShiprocketToken ? await getShiprocketToken() : null; // Ensure token function exists

        // Fetch Shopify Order if missing with robust name matching
        if (!shopifyOrder) {
            try {
                let orderName = requestData.orderNumber;
                let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderName)}&limit=1`);

                if (!shopifyData.orders || shopifyData.orders.length === 0) {
                    const altName = orderName.startsWith('#') ? orderName.substring(1) : `#${orderName}`;
                    shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(altName)}&limit=1`);
                }

                shopifyOrder = shopifyData.orders && shopifyData.orders[0];
            } catch (e) {
                console.error('Failed to fetch original order for return creation:', e);
            }
        }

        const address = shopifyOrder ? (shopifyOrder.shipping_address || shopifyOrder.customer.default_address) : null;

        if (!address) {
            console.error('Shiprocket Error: No address found for return pickup');
            return null;
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

            // Pickup Details (Customer Address)
            pickup_customer_name: address.first_name,
            pickup_last_name: address.last_name || '',
            pickup_address: address.address1,
            pickup_address_2: address.address2 || '',
            pickup_city: address.city,
            pickup_state: address.province,
            pickup_country: address.country_code || 'IN',
            pickup_pincode: address.zip,
            pickup_email: getValidEmail(shopifyOrder?.email, shopifyOrder),
            pickup_phone: address.phone || shopifyOrder?.phone || '9999999999',

            // Shipping Details (Warehouse - Destination)
            shipping_customer_name: 'BURB MANUFACTURES PVT LTD',
            shipping_last_name: '',
            shipping_address: 'VILLAGE - BAIRAWAS, NEAR GOVT. SCHOOL',
            shipping_address_2: '',
            shipping_city: 'MAHENDERGARH',
            shipping_state: 'Haryana',
            shipping_country: 'IN',
            shipping_pincode: '123028',
            shipping_email: 'returns@offcomfort.com',
            shipping_phone: '9138514222',

            order_items: returnItems,
            payment_method: 'Prepaid',
            total_discount: 0,
            sub_total: returnItems.reduce((sum, item) => sum + (item.selling_price * item.units), 0),
            length: 10,
            breadth: 10,
            height: 10,
            weight: 0.5
        };

        console.log('🚀 Creating Shiprocket Return. Payload:', JSON.stringify(payload, null, 2));

        const response = await fetch('https://apiv2.shiprocket.in/v1/external/orders/create/return', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('📦 Shiprocket Response:', JSON.stringify(data, null, 2));

        if (data.status_code === 422 || (data.errors && Object.keys(data.errors).length > 0)) {
            console.error('❌ Shiprocket Validation Error:', JSON.stringify(data));
            return null;
        }

        return data;
    } catch (error) {
        console.error('❌ Failed to create Shiprocket return:', error);
        return null;
    }
}

async function createShiprocketForwardOrder(requestData) {
    try {
        const token = await getShiprocketToken();

        // 1. Fetch Shopify Order if we need ANY missing data (Address or Customer)
        let shopifyOrder = null;
        const needsAddress = !requestData.newAddress;
        const needsCustomer = !requestData.customerName || requestData.customerName === 'Customer' || !requestData.customerPhone || requestData.customerPhone === 'null';

        if (needsAddress || needsCustomer) {
            try {
                let orderName = requestData.orderNumber;
                let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderName)}&limit=1`);

                // Robust lookup: try with/without '#'
                if (!shopifyData.orders || shopifyData.orders.length === 0) {
                    const altName = orderName.startsWith('#') ? orderName.substring(1) : `#${orderName}`;
                    shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(altName)}&limit=1`);
                }

                shopifyOrder = shopifyData.orders && shopifyData.orders[0];
            } catch (e) {
                console.error('Failed to fetch original order for forward creation:', e);
            }
        }

        // 2. Determine Address
        let billingAddress = requestData.newAddress;
        let billingCity = requestData.newCity;
        let billingPincode = requestData.newPincode;
        let billingState = '';

        if (!billingAddress) {
            if (shopifyOrder && shopifyOrder.shipping_address) {
                billingAddress = shopifyOrder.shipping_address.address1;
                billingCity = shopifyOrder.shipping_address.city;
                billingPincode = shopifyOrder.shipping_address.zip;
                billingState = shopifyOrder.shipping_address.province;
            } else if (requestData.shippingAddress) {
                // FALLBACK: Parse from concatenated string: "Addr1, Addr2, City, State, Pincode, Country"
                const parts = requestData.shippingAddress.split(',').map(p => p.trim());
                billingAddress = parts.slice(0, -4).join(', ') || parts[0];
                billingCity = parts[parts.length - 4] || '';
                billingState = parts[parts.length - 3] || '';
                billingPincode = parts[parts.length - 2] || '';

                // Last ditch: regex for pincode if not found
                if (!billingPincode.match(/^\d{6}$/)) {
                    const pinMatch = requestData.shippingAddress.match(/\b\d{6}\b/);
                    if (pinMatch) billingPincode = pinMatch[0];
                }
            }
        }

        // 3. Determine Customer Details
        let customerName = requestData.customerName;
        if (!customerName || customerName === 'Customer' || customerName === 'null') {
            if (shopifyOrder) {
                customerName = `${shopifyOrder.customer?.first_name || ''} ${shopifyOrder.customer?.last_name || ''}`.trim();
                if (!customerName) customerName = shopifyOrder.shipping_address?.name || 'Customer';
            } else {
                customerName = 'Customer';
            }
        }

        let customerPhone = requestData.customerPhone;
        // Check for null string or placeholder
        if (!customerPhone || customerPhone === 'null' || customerPhone === '9999999999') {
            if (shopifyOrder) {
                customerPhone = shopifyOrder.shipping_address?.phone || shopifyOrder.customer?.phone || '';
            }
        }

        // Sanitize Phone (Shiprocket requires 10 digits for India)
        // Remove all non-digits
        customerPhone = (customerPhone || '').replace(/\D/g, '');
        // If it starts with 91 and is 12 digits, remove 91
        if (customerPhone.length === 12 && customerPhone.startsWith('91')) {
            customerPhone = customerPhone.substring(2);
        }
        // If still > 10 digits, take last 10 (risky but often correct for mobile)
        if (customerPhone.length > 10) {
            customerPhone = customerPhone.slice(-10);
        }
        // If invalid/empty, fallback to dummy but log warning
        if (customerPhone.length < 10) {
            console.warn(`⚠️ Invalid phone number for ${requestData.requestId}: ${customerPhone}. Using fallback.`);
            customerPhone = '9999999999';
        }

        // Forward Order Items (Replacement Items)
        const items = Array.isArray(requestData.items) ? requestData.items : [];
        const orderItems = items.map(item => ({
            name: item.name + (item.replacementVariant ? ` (${item.replacementVariant})` : ''),
            sku: String(item.variantId || item.id) + '-EXCH',
            units: parseInt(item.quantity) || 1,
            selling_price: parseFloat(item.price) || 0,
            discount: 0,
            tax: 0
        }));

        const payload = {
            order_id: requestData.requestId + '-FWD',
            order_date: new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0],
            pickup_location: 'Primary', // Change this to your preferred Shiprocket nickname (e.g., 'warehouse-1', 'Burb')
            billing_customer_name: customerName,
            billing_last_name: '',
            billing_address: billingAddress || 'Address not available',
            billing_city: billingCity || billingState || 'City',
            billing_pincode: billingPincode || '110001',
            billing_state: billingState || billingCity || 'State', // Shiprocket requires state
            billing_country: 'India',
            billing_email: getValidEmail(requestData.email, shopifyOrder),
            billing_phone: customerPhone,
            shipping_is_billing: true,
            order_items: orderItems,
            payment_method: 'Prepaid',
            sub_total: orderItems.reduce((sum, item) => sum + (item.selling_price * item.units), 0),
            length: 10, breadth: 10, height: 10, weight: 0.5
        };

        console.log('🚀 Creating Shiprocket Forward Order:', JSON.stringify(payload, null, 2));

        const response = await fetch('https://apiv2.shiprocket.in/v1/external/orders/create/adhoc', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('📦 Shiprocket Forward Response:', JSON.stringify(data, null, 2));

        if (data.status_code === 422 || (data.errors && Object.keys(data.errors).length > 0)) {
            console.error('❌ Shiprocket Validation Error (Forward):', JSON.stringify(data));
            return null;
        }

        return data;
    } catch (error) {
        console.error('❌ Failed to create forward order:', error);
        return null;
    }
}

async function createShopifyExchangeOrder(requestData) {
    try {
        console.log('Creating Shopify Exchange Order for:', requestData.requestId);

        // Fetch original order with robust name matching
        let orderName = requestData.orderNumber;
        let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderName)}&limit=1`);

        if (!shopifyData.orders || shopifyData.orders.length === 0) {
            const altName = orderName.startsWith('#') ? orderName.substring(1) : `#${orderName}`;
            shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(altName)}&limit=1`);
        }

        const originalOrder = shopifyData.orders && shopifyData.orders[0];

        if (!originalOrder) {
            console.error('Original order not found for exchange creation');
            return null;
        }

        // Determine Address
        let shippingAddress = { ...originalOrder.shipping_address };
        if (requestData.newAddress) {
            shippingAddress = {
                address1: requestData.newAddress,
                city: requestData.newCity,
                zip: requestData.newPincode,
                country: 'India',
                first_name: requestData.customerName?.split(' ')[0] || originalOrder.customer?.first_name || 'Customer',
                last_name: requestData.customerName?.split(' ').slice(1).join(' ') || originalOrder.customer?.last_name || '',
                phone: requestData.customerPhone || originalOrder.shipping_address?.phone
            };
        }

        let items = requestData.items;
        if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
        const lineItems = [];

        for (const item of items) {
            let variantId = item.replacementVariantId;

            // If variantId is missing (legacy request) or "Same", try to resolve it
            if ((!variantId || variantId === 'Same') && item.replacementVariant && item.productId) {
                try {
                    const variantsData = await shopifyAPI(`products/${item.productId}/variants.json`);
                    const variants = variantsData.variants || [];
                    const variant = variants.find(v =>
                        v.title === item.replacementVariant ||
                        v.option1 === item.replacementVariant ||
                        v.option2 === item.replacementVariant ||
                        v.id.toString() === item.replacementVariant
                    );
                    if (variant) variantId = variant.id;
                } catch (e) {
                    console.error(`Failed to fetch variants for product ${item.productId}:`, e);
                }
            }

            if (variantId && variantId !== 'Same') {
                lineItems.push({
                    variant_id: variantId,
                    quantity: parseInt(item.quantity) || 1
                });
            } else if (variantId === 'Same') {
                // If still "Same", use original variantId
                lineItems.push({
                    variant_id: item.variantId,
                    quantity: parseInt(item.quantity) || 1
                });
            } else {
                console.warn(`No valid replacement variant identified for item ${item.name} (Request ${requestData.requestId})`);
            }
        }

        if (lineItems.length === 0) {
            console.error('No valid replacement items identified for Shopify Order creation.');
            return null;
        }

        const orderPayload = {
            order: {
                line_items: lineItems,
                shipping_address: shippingAddress,
                billing_address: shippingAddress,
                customer: {
                    id: originalOrder.customer?.id
                },
                financial_status: 'paid',
                send_receipt: true,
                tags: `Exchange, Replacement, Orig-${requestData.orderNumber}`,
                note: `Exchange for Request ${requestData.requestId}. Reason: ${requestData.reason}`
            }
        };

        const response = await shopifyAPI('orders.json', {
            method: 'POST',
            body: JSON.stringify(orderPayload)
        });

        if (response.order) {
            console.log('✅ Shopify Exchange Order Created:', response.order.name);
            return response.order;
        } else {
            console.error('Failed to create Shopify order:', response);
            return null;
        }

    } catch (error) {
        console.error('Failed to create Shopify exchange order:', error);
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

// Helper to get Shiprocket tracking details
async function getShiprocketTracking(awb) {
    if (!awb || !process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD) return null;
    try {
        const trackingData = await shiprocketAPI(`/courier/track/awb/${awb}`);
        if (trackingData && trackingData.tracking_data) {
            return trackingData.tracking_data;
        }
    } catch (error) {
        console.error('Shiprocket tracking fetch error:', error.message);
    }
    return null;
}

// Lookup order (improved with better error handling)
app.post('/api/lookup-order', async (req, res) => {
    try {
        const { orderNumber, email } = req.body;

        console.log('Looking up order:', orderNumber, 'for email:', email);

        // Try to fetch order from Shopify
        let data;
        try {
            // 1. Try exact match
            data = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&status=any&limit=5`);

            // 2. If no result, try adding/removing '#'
            if (!data.orders || data.orders.length === 0) {
                let retryOrderNumber = orderNumber;
                if (orderNumber.startsWith('#')) {
                    retryOrderNumber = orderNumber.substring(1);
                } else {
                    retryOrderNumber = '#' + orderNumber;
                }

                console.log(`Retrying lookup with: ${retryOrderNumber}`);
                data = await shopifyAPI(`orders.json?name=${encodeURIComponent(retryOrderNumber)}&status=any&limit=5`);
            }
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
                eligibilityMessage: `Order ${orderNumber} not found. Please check your order number.`
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
        const isWithin60Days = daysSinceOrder <= 60;

        const eligibilityMessage = !isFulfilled
            ? 'Order must be fulfilled before exchange/return'
            : !isWithin60Days
                ? 'Order is older than 60 days and not eligible'
                : 'Order is eligible for exchange/return';

        console.log('Eligibility:', { isFulfilled, isWithin60Days, daysSinceOrder });

        // Get Tracking / Delivered Date
        let deliveredDate = null;
        if (order.fulfillments && order.fulfillments.length > 0) {
            const fulfillment = order.fulfillments[0];
            const awb = fulfillment.tracking_number;
            console.log('Fulfillment found. AWB:', awb);

            if (awb) {
                const tracking = await getShiprocketTracking(awb);
                console.log('Tracking data fetched:', tracking ? 'Yes' : 'No');

                if (tracking) {
                    // Try multiple fields for delivered date
                    deliveredDate = tracking.delivered_date || tracking.etd || tracking.edd || null;
                    console.log('Extracted deliveredDate:', deliveredDate);
                }
            }
        } else {
            console.log('No fulfillments found for order');
        }

        // Fetch product images and variants for inventory check
        const productIds = [...new Set(order.line_items.map(item => item.product_id).filter(id => id))];
        const productDataMap = {}; // Stores images and variants

        if (productIds.length > 0) {
            try {
                // Fetch fields: id, image, images, variants (for inventory)
                const productsData = await shopifyAPI(`products.json?ids=${productIds.join(',')}&fields=id,image,images,variants`);
                if (productsData.products) {
                    productsData.products.forEach(p => {
                        let imageUrl = null;
                        if (p.image) {
                            imageUrl = p.image.src;
                        } else if (p.images && p.images.length > 0) {
                            imageUrl = p.images[0].src;
                        }

                        // Process variants
                        const variants = p.variants.map(v => ({
                            id: v.id,
                            title: v.title,
                            price: v.price,
                            inventory_quantity: v.inventory_quantity,
                            inventory_policy: v.inventory_policy,
                            inventory_management: v.inventory_management
                        }));

                        productDataMap[p.id] = {
                            image: imageUrl,
                            variants: variants
                        };
                    });
                }
            } catch (err) {
                console.error('Failed to fetch product data:', err);
                // Continue without extra data
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
            isEligible: isFulfilled && isWithin60Days,
            eligibilityMessage,
            productVariants: productDataMap, // Send variants to frontend
            order: {
                orderNumber: order.name,
                customerName: order.customer
                    ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                    : 'Customer',
                email: order.customer?.email || email,
                phone: order.customer?.phone || order.shipping_address?.phone || '',
                orderDate: order.created_at,
                deliveredDate: deliveredDate, // NEW FIELD
                totalAmount: order.total_price,
                shippingAddress,
                items: order.line_items.map(item => {
                    const pData = productDataMap[item.product_id] || {};
                    return {
                        id: item.id,
                        productId: item.product_id,
                        variantId: item.variant_id,
                        name: item.name,
                        variant: item.variant_title || 'Default',
                        quantity: item.quantity,
                        price: item.price,
                        image: pData.image || (item.properties && item.properties.image) || `https://cdn.shopify.com/shopifycloud/placeholder.jpg`
                    };
                })
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

// Search products for exchange
app.get('/api/products/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        // Fetch products - limit to 50 for performance
        const data = await shopifyAPI(`products.json?limit=50&fields=id,title,image,variants`);

        let products = data.products || [];

        if (query) {
            const lowerQuery = query.toLowerCase();
            products = products.filter(p =>
                p.title.toLowerCase().includes(lowerQuery) ||
                p.id.toString() === query
            );
        }

        const formatted = products.map(p => ({
            id: p.id,
            title: p.title,
            image: p.image ? p.image.src : (p.images && p.images.length > 0 ? p.images[0].src : null),
            variants: p.variants.map(v => ({
                id: v.id,
                title: v.title,
                price: v.price,
                inventory_quantity: v.inventory_quantity,
                inventory_policy: v.inventory_policy,
                inventory_management: v.inventory_management
            }))
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Product search error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get product variants with full info
app.post('/api/get-variants', async (req, res) => {
    try {
        const { productId } = req.body;
        const data = await shopifyAPI(`products/${productId}.json?fields=id,title,image,variants`);

        if (!data.product) return res.status(404).json({ error: 'Product not found' });

        const p = data.product;
        res.json({
            id: p.id,
            title: p.title,
            image: p.image ? p.image.src : (p.images && p.images.length > 0 ? p.images[0].src : null),
            variants: p.variants.map(v => ({
                id: v.id,
                title: v.title,
                price: v.price,
                inventory_quantity: v.inventory_quantity,
                inventory_policy: v.inventory_policy,
                inventory_management: v.inventory_management
            }))
        });
    } catch (error) {
        console.error('Get variants error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== WHATSAPP BOT INTEGRATION ====================

async function sendWhatsAppNotification(phone, message, type, requestId) {
    if (!phone || !message) return;

    // Use environment variable or default to localhost:3000 (standard for local dev)
    const botUrl = process.env.WHATSAPP_BOT_URL || 'http://localhost:3000';

    try {
        console.log(`[${requestId}] 📤 Sending WhatsApp notification to ${phone}`);
        // Ensure fetch is available (Node 18+)
        const response = await fetch(`${botUrl}/api/internal/send-notification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, message, type, requestId })
        });

        const data = await response.json();
        if (data.success) {
            console.log(`[${requestId}] ✅ WhatsApp notification sent: ${data.messageId}`);
        } else {
            console.warn(`[${requestId}] ⚠️ WhatsApp notification failed: ${data.error}`);
        }
    } catch (error) {
        console.error(`[${requestId}] ❌ WhatsApp notification error:`, error.message);
    }
}

/**
 * Finalize a request after payment is confirmed (either via frontend response or webhook)
 */
async function finalizeRequestAfterPayment(requestId, paymentId, paymentAmount) {
    console.log(`[${requestId}] 🚀 Finalizing request after payment confirmation. PaymentId: ${paymentId}`);

    try {
        const request = await getRequestById(requestId);
        if (!request) {
            console.error(`[${requestId}] ❌ Cannot finalize: Request not found in DB`);
            return { success: false, error: 'Request not found' };
        }

        if (request.status !== 'waiting_payment') {
            console.log(`[${requestId}] ℹ️ Request already processed (Status: ${request.status})`);
            return { success: true, alreadyProcessed: true };
        }

        // 1. Prepare Updates
        const updates = {
            paymentId: paymentId,
            paymentAmount: paymentAmount,
            status: 'pending' // Default status after payment
        };

        // 2. Trigger Shiprocket Return (Auto-Pickup)
        let awbNumber = null;
        let shipmentId = null;
        let pickupDate = null;

        if (process.env.SHIPROCKET_EMAIL) {
            console.log(`[${requestId}] Initiating Shiprocket Pickup (Background)...`);
            try {
                const srResponse = await createShiprocketReturnOrder({
                    requestId,
                    orderNumber: request.orderNumber,
                    items: request.items
                }, null); // Force re-fetch Shopify Order

                if (srResponse && srResponse.shipment_id) {
                    awbNumber = srResponse.awb_code;
                    shipmentId = srResponse.shipment_id;
                    pickupDate = srResponse.pickup_scheduled_date;

                    updates.status = 'scheduled';
                    updates.awbNumber = awbNumber;
                    updates.shipmentId = shipmentId;
                    updates.pickupDate = pickupDate;
                    console.log(`[${requestId}] ✅ Background Auto-Pickup Success: ${shipmentId}`);
                }
            } catch (err) {
                console.error(`[${requestId}] ⚠️ Background Shiprocket creation failed:`, err.message);
            }
        }

        // 3. Save to DB
        await updateRequestStatus(requestId, updates);
        console.log(`[${requestId}] ✅ Request finalized and updated in DB`);

        // 4. Send WhatsApp Notification
        const customerName = request.customerName || 'Customer';
        const typeLabel = request.type === 'exchange' ? 'Exchange' : 'Return';
        const message = `Payment confirmed for your ${typeLabel} Request ${requestId}. Status: ${updates.status.replace('_', ' ')}. We've recorded your request and will process it shortly.`;
        sendWhatsAppNotification(request.customerPhone, message, request.type, requestId).catch(err => console.error(err));

        return { success: true, status: updates.status };
    } catch (error) {
        console.error(`[${requestId}] ❌ Finalize Error:`, error);
        return { success: false, error: error.message };
    }
}

// Submit exchange request
app.post('/api/submit-exchange', upload.any(), async (req, res) => {
    const requestId = 'REQ-' + Math.floor(10000 + Math.random() * 90000);
    console.log(`[${requestId}] 📥 Received exchange submission`);
    console.log(`[${requestId}] Body Fields:`, Object.keys(req.body));
    console.log(`[${requestId}] Files:`, req.files ? req.files.length : 0);

    try {
        // Parse items if string
        let items = req.body.items;
        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                console.error(`[${requestId}] Failed to parse items:`, e);
                items = [];
            }
        }

        console.log(`[${requestId}] Order: ${req.body.orderNumber}, Items: ${items.length}, PaymentId: ${req.body.paymentId || 'None'}, Amount: ${req.body.paymentAmount || 0}`);

        // Get Cloudinary Image URLs
        const imageUrls = req.files ? req.files.map(file => file.path) : [];

        // Fetch Order for details
        let shopifyOrder = null;
        let originalAddressFormatted = '';
        try {
            // 1. Try exact match
            let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(req.body.orderNumber)}&status=any&limit=1`);

            // 2. Fuzzy retry
            if (!shopifyData.orders || shopifyData.orders.length === 0) {
                let retryOrderNumber = req.body.orderNumber;
                if (retryOrderNumber.startsWith('#')) {
                    retryOrderNumber = retryOrderNumber.substring(1);
                } else {
                    retryOrderNumber = '#' + retryOrderNumber;
                }
                console.log(`[${requestId}] Retrying order fetch with: ${retryOrderNumber}`);
                shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(retryOrderNumber)}&status=any&limit=1`);
            }

            shopifyOrder = shopifyData.orders && shopifyData.orders[0];

            if (shopifyOrder && shopifyOrder.shipping_address) {
                const addr = shopifyOrder.shipping_address;
                originalAddressFormatted = [
                    addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country
                ].filter(Boolean).join(', ');
            }
        } catch (err) {
            console.error(`[${requestId}] Failed to fetch Shopify order for submission:`, err);
        }

        const customerName = req.body.customerName || (shopifyOrder?.customer ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim() : 'Customer');
        const customerPhone = req.body.customerPhone || shopifyOrder?.shipping_address?.phone || shopifyOrder?.customer?.phone || '';
        const email = req.body.email || shopifyOrder?.email;

        // Verify Payment logic
        const isFeeWaived = req.body.reason === 'defective' || req.body.reason === 'wrong_item';
        let paymentVerified = false;

        if (req.body.paymentId && !isFeeWaived) {
            if (!razorpay) {
                console.error(`[${requestId}] Payment config missing`);
                return res.status(500).json({ error: 'Payment configuration missing on server' });
            }
            try {
                const payment = await razorpay.payments.fetch(req.body.paymentId);
                console.log(`[${requestId}] Razorpay Verification - PaymentId: ${req.body.paymentId}, Status: ${payment.status}, Amount: ${payment.amount / 100} ${payment.currency}`);
                if (payment.status === 'captured' || payment.status === 'authorized') {
                    paymentVerified = true;
                } else {
                    return res.status(400).json({ error: 'Payment not successful' });
                }
            } catch (payError) {
                console.error(`[${requestId}] Payment Verification Failed:`, payError);
                return res.status(400).json({ error: 'Invalid Payment ID' });
            }
        }

        const needsPayment = !isFeeWaived && !paymentVerified;

        console.log(`[${requestId}] Status Calculation: isFeeWaived=${isFeeWaived}, paymentVerified=${paymentVerified}, needsPayment=${needsPayment}`);


        // Shiprocket Return Order (Auto-Pickup) - Selective Initiation
        let awbNumber = null;
        let shipmentId = null;
        let pickupDate = null;

        if (!needsPayment && process.env.SHIPROCKET_EMAIL) {
            console.log(`[${requestId}] Initiating Automatic Shiprocket Pickup for reason: ${req.body.reason}`);
            try {
                const srResponse = await createShiprocketReturnOrder({
                    requestId,
                    orderNumber: req.body.orderNumber,
                    items
                }, shopifyOrder);

                if (srResponse && srResponse.shipment_id) {
                    awbNumber = srResponse.awb_code;
                    shipmentId = srResponse.shipment_id;
                    pickupDate = srResponse.pickup_scheduled_date;
                    console.log(`[${requestId}] ✅ Auto-Pickup Created: ShipmentID ${shipmentId}, AWB ${awbNumber || 'PENDING'}`);
                } else {
                    console.log(`[${requestId}] ⚠️ Shiprocket accepted request but didn't return shipment_id. Response:`, JSON.stringify(srResponse));
                }
            } catch (err) {
                console.error(`[${requestId}] ⚠️ Auto-Pickup Failed but proceeding with DB save:`, err.message);
            }
        } else {
            console.log(`[${requestId}] Shiprocket Return creation deferred (Damaged reason or missing config). Reason: ${req.body.reason}`);
        }

        try {
            console.log(`[${requestId}] Saving Request to Database...`);
            const requestData = {
                requestId,
                ...req.body,
                email,
                customerName,
                customerPhone,
                items,
                images: imageUrls,
                type: 'exchange',
                shippingAddress: originalAddressFormatted,
                awbNumber,
                shipmentId,
                pickupDate,
                status: needsPayment ? 'waiting_payment' : ((awbNumber || shipmentId) ? 'scheduled' : 'pending')
            };

            console.log(`[${requestId}] Final Status: ${requestData.status}, AWB: ${awbNumber}`);
            await createRequest(requestData);
        } catch (dbError) {
            console.error(`[${requestId}] ❌ Database Insert Failed:`, dbError.message);
            if (dbError.message.includes('column "images"')) {
                return res.status(500).json({ error: 'Database mismatch: Please add "images" column.' });
            }
            throw dbError;
        }

        console.log(`[${requestId}] ✅ Exchange Request Submitted Successfully`);
        const message = `Hello ${customerName}, your exchange request for Order ${req.body.orderNumber} has been received. Request ID: ${requestId}.`;
        sendWhatsAppNotification(customerPhone, message, 'exchange', requestId).catch(err => console.error(err));

        res.json({
            success: true,
            requestId,
            message: 'Exchange request submitted successfully'
        });
    } catch (error) {
        console.error(`[${requestId}] ❌ Submit exchange error:`, error);
        res.status(500).json({ error: error.message });
    }
});

// Submit return request
app.post('/api/submit-return', upload.any(), async (req, res) => {
    const requestId = 'REQ-' + Math.floor(10000 + Math.random() * 90000);
    console.log(`[${requestId}] 📥 Received return submission`);
    console.log(`[${requestId}] Body Fields:`, Object.keys(req.body));
    console.log(`[${requestId}] Files:`, req.files ? req.files.length : 0);

    try {
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

        const imageUrls = req.files ? req.files.map(file => file.path) : [];

        // Fetch Order for details
        let shopifyOrder = null;
        let originalAddressFormatted = '';
        try {
            // 1. Try exact match
            let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(req.body.orderNumber)}&status=any&limit=1`);

            // 2. Fuzzy retry
            if (!shopifyData.orders || shopifyData.orders.length === 0) {
                let retryOrderNumber = req.body.orderNumber;
                if (retryOrderNumber.startsWith('#')) {
                    retryOrderNumber = retryOrderNumber.substring(1);
                } else {
                    retryOrderNumber = '#' + retryOrderNumber;
                }
                console.log(`[${requestId}] Retrying order fetch with: ${retryOrderNumber}`);
                shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(retryOrderNumber)}&status=any&limit=1`);
            }

            shopifyOrder = shopifyData.orders && shopifyData.orders[0];

            if (shopifyOrder && shopifyOrder.shipping_address) {
                const addr = shopifyOrder.shipping_address;
                originalAddressFormatted = [
                    addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country
                ].filter(Boolean).join(', ');
            }
        } catch (err) {
            console.error('Failed to fetch Shopify order for submission:', err);
        }

        const customerName = req.body.customerName || (shopifyOrder?.customer ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim() : 'Customer');
        const customerPhone = req.body.customerPhone || shopifyOrder?.shipping_address?.phone || shopifyOrder?.customer?.phone || '';
        const email = req.body.email || shopifyOrder?.email;

        const isFeeWaivedReturn = req.body.reason === 'defective' || req.body.reason === 'wrong_item';
        let paymentVerified = false;

        if (req.body.paymentId && !isFeeWaivedReturn) {
            if (!razorpay) return res.status(500).json({ error: 'Config error' });
            try {
                const payment = await razorpay.payments.fetch(req.body.paymentId);
                console.log(`[${requestId}] Razorpay Verification (Return) - PaymentId: ${req.body.paymentId}, Status: ${payment.status}, Amount: ${payment.amount / 100} ${payment.currency}`);
                if (payment.status === 'captured' || payment.status === 'authorized') {
                    paymentVerified = true;
                } else {
                    return res.status(400).json({ error: 'Payment failed' });
                }
            } catch (e) {
                console.error(`[${requestId}] Razorpay Verification Failed (Return):`, e.message);
                return res.status(400).json({ error: 'Invalid payment' });
            }
        }

        const needsPayment = !isFeeWaivedReturn && !paymentVerified;

        console.log(`[${requestId}] Status Calculation (Return): isFeeWaivedReturn=${isFeeWaivedReturn}, paymentVerified=${paymentVerified}, needsPayment=${needsPayment}`);

        // Shiprocket Return Order (Auto-Pickup) - Selective Initiation
        let awbNumber = null;
        let shipmentId = null;
        let pickupDate = null;

        if (!needsPayment && process.env.SHIPROCKET_EMAIL) {
            console.log(`[${requestId}] Initiating Automatic Shiprocket Pickup for reason: ${req.body.reason}`);
            try {
                const srResponse = await createShiprocketReturnOrder({
                    requestId,
                    orderNumber: req.body.orderNumber,
                    items
                }, shopifyOrder);

                if (srResponse && srResponse.shipment_id) {
                    awbNumber = srResponse.awb_code;
                    shipmentId = srResponse.shipment_id;
                    pickupDate = srResponse.pickup_scheduled_date;
                    console.log(`[${requestId}] ✅ Auto-Pickup Created Success: ShipmentID ${shipmentId}, AWB ${awbNumber || 'PENDING'}`);
                } else {
                    console.log(`[${requestId}] ⚠️ Shiprocket accepted request but didn't return shipment_id. Response:`, JSON.stringify(srResponse));
                }
            } catch (err) {
                console.error(`[${requestId}] ⚠️ Auto-Pickup Failed but proceeding with DB save:`, err.message);
            }
        } else {
            console.log(`[${requestId}] Shiprocket Return creation deferred (Damaged reason or missing config). Reason: ${req.body.reason}`);
        }

        try {
            console.log(`[${requestId}] Saving Request to Database...`);
            const requestData = {
                requestId,
                ...req.body,
                email,
                customerName,
                customerPhone,
                items,
                images: imageUrls,
                type: 'return',
                shippingAddress: originalAddressFormatted,
                awbNumber,
                shipmentId,
                pickupDate,
                status: needsPayment ? 'waiting_payment' : ((awbNumber || shipmentId) ? 'scheduled' : 'pending')
            };

            console.log(`[${requestId}] Final Status (Return): ${requestData.status}, AWB: ${awbNumber}`);
            await createRequest(requestData);
        } catch (dbError) {
            console.error(`[${requestId}] ❌ Database Insert Failed:`, dbError.message);
            if (dbError.message.includes('column "images"')) {
                return res.status(500).json({ error: 'Database mismatch: Please add "images" column.' });
            }
            throw dbError;
        }

        console.log(`[${requestId}] ✅ Return Request Submitted Successfully`);
        const message = `Hello ${customerName}, your return request for Order ${req.body.orderNumber} has been received. Request ID: ${requestId}.`;
        sendWhatsAppNotification(customerPhone, message, 'return', requestId).catch(err => console.error(err));

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

// Track request (Return/Exchange)
app.get('/api/track-request/:requestId', async (req, res) => {
    try {
        const request = await getRequestById(req.params.requestId);

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        // 1. Fetch Return Tracking Data
        if (request.awbNumber && process.env.SHIPROCKET_EMAIL) {
            try {
                const trackingData = await shiprocketAPI(`/courier/track/awb/${request.awbNumber}`);
                if (trackingData && trackingData.tracking_data) {
                    const tracking = trackingData.tracking_data;
                    request.shipment = {
                        origin: tracking.shipment_track?.[0]?.origin || tracking.origin || null,
                        destination: tracking.shipment_track?.[0]?.destination || tracking.destination || null,
                        status: tracking.current_status || 'Pending',
                        edd: tracking.edd || tracking.etd || null,
                        activities: tracking.shipment_track || []
                    };
                }
            } catch (err) {
                console.error(`[Tracking API] Return Shipment (${request.awbNumber}) failed:`, err.message);
                // We DON'T throw here so the page still loads basic info
            }
        }

        // 2. Fetch Forward Tracking Data (for Exchanges)
        if (request.forwardAwbNumber && process.env.SHIPROCKET_EMAIL) {
            try {
                const trackingData = await shiprocketAPI(`/courier/track/awb/${request.forwardAwbNumber}`);
                if (trackingData && trackingData.tracking_data) {
                    const tracking = trackingData.tracking_data;
                    request.forwardShipment = {
                        awb: request.forwardAwbNumber,
                        status: tracking.current_status || 'Scheduled',
                        edd: tracking.edd || tracking.etd || null,
                        activities: tracking.shipment_track || []
                    };
                }
            } catch (err) {
                console.error(`[Tracking API] Forward Shipment (${request.forwardAwbNumber}) failed:`, err.message);
                // We DON'T throw here so the page still loads basic info
            }
        }

        res.json(request);
    } catch (error) {
        console.error(`[Tracking Error] [${req.params.requestId}]:`, error);
        res.status(500).json({
            error: 'Failed to track request',
            details: error.message,
            requestId: req.params.requestId
        });
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
            // 1. Try exact match
            shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&status=any&limit=5`);

            // 2. If no result, try adding/removing '#'
            if (!shopifyData.orders || shopifyData.orders.length === 0) {
                let retryOrderNumber = orderNumber;
                if (orderNumber.startsWith('#')) {
                    retryOrderNumber = orderNumber.substring(1);
                } else {
                    retryOrderNumber = '#' + orderNumber;
                }

                console.log(`Retrying tracking lookup with: ${retryOrderNumber}`);
                shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(retryOrderNumber)}&status=any&limit=5`);
            }
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
                console.log('Shiprocket Tracking Response:', JSON.stringify(trackingData, null, 2));

                if (trackingData && trackingData.tracking_data) {
                    const tracking = trackingData.tracking_data;

                    // Update response with Shiprocket data
                    response.currentStatus = tracking.current_status || response.currentStatus;
                    response.courierName = tracking.courier_name || response.courierName;
                    response.estimatedDelivery = tracking.etd || tracking.edd || null; // Fix: Shiprocket returns 'etd'

                    // Add shipment details
                    response.shipment = {
                        origin: tracking.shipment_track?.[0]?.origin || tracking.origin || null,
                        destination: tracking.shipment_track?.[0]?.destination || tracking.destination || null,
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
                    response.isOldOrder = daysSinceOrder > 60;

                    if (response.isDelivered) {
                        response.message = '✅ Your order has been delivered successfully!';
                    } else if (response.isOldOrder) {
                        response.message = 'This order is older than 60 days. Some tracking details may no longer be available.';
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
        const { status, type, date, search } = req.query;

        const requests = await getAllRequests({ status, type, date, search });
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

        // Get request details first
        const requestDetails = await getRequestById(requestId);
        if (!requestDetails) {
            return res.status(404).json({ error: 'Request not found' });
        }

        let adminNotes = notes || '';
        let newStatus = 'approved';
        let updates = { adminNotes };

        // 1. Initial Approval -> Initiate Pickup
        if (requestDetails.status === 'pending') {
            console.log(`[${requestId}] Admin authorized pickup. Initiating Shiprocket...`);

            // Need Shopify Order for Shiprocket
            let shopifyOrder = null;
            try {
                const shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(requestDetails.orderNumber)}&status=any&limit=1`);
                shopifyOrder = shopifyData.orders && shopifyData.orders[0];
            } catch (err) {
                console.error(`[${requestId}] Failed to fetch Shopify order for approval:`, err);
            }

            if (process.env.SHIPROCKET_EMAIL && shopifyOrder) {
                try {
                    const shiprocketData = await createShiprocketReturnOrder({
                        ...requestDetails,
                        requestId
                    }, shopifyOrder);

                    if (shiprocketData && shiprocketData.shipment_id) {
                        updates.shipmentId = shiprocketData.shipment_id;
                        updates.awbNumber = shiprocketData.awb_code;
                        updates.pickupDate = shiprocketData.pickup_scheduled_date;
                        updates.status = 'scheduled';
                        updates.adminNotes = adminNotes + `\nPickup scheduled: AWB ${shiprocketData.awb_code}`;

                        const request = await updateRequestStatus(requestId, updates);
                        return res.json({ success: true, message: 'Pickup initiated and status updated to scheduled', request });
                    } else {
                        throw new Error('Shiprocket did not return shipment data');
                    }
                } catch (srError) {
                    console.error(`[${requestId}] Shiprocket initiation failed:`, srError);
                    return res.status(500).json({ error: 'Failed to initiate Shiprocket pickup: ' + srError.message });
                }
            } else {
                return res.status(400).json({ error: 'Cannot initiate Shiprocket: Shopify order or config missing' });
            }
        }

        // 2. Final Approval -> Quality Check Passed -> Process Resolution
        // Trigger Forward Shipment & Create Store Order for Exchange
        if (requestDetails.type === 'exchange' && requestDetails.status !== 'approved') {
            console.log(`[${requestId}] Finalizing exchange resolution...`);

            // 2.1 Create Shopify replacement order
            try {
                const shopifyExch = await createShopifyExchangeOrder(requestDetails);
                if (shopifyExch && (shopifyExch.name || shopifyExch.id)) {
                    adminNotes += `\nShopify Replacement Order Created: #${shopifyExch.name || shopifyExch.id}`;
                }
            } catch (shopifyError) {
                console.error(`[${requestId}] Shopify exchange order creation failed:`, shopifyError.message);
                adminNotes += `\nWarning: Failed to create Shopify replacement order.`;
            }

            // 2.2 Create Shiprocket forward shipment
            if (process.env.SHIPROCKET_EMAIL) {
                console.log('Creating Forward Shipment for Exchange:', requestId);
                let items = requestDetails.items;
                if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }

                const forwardOrder = await createShiprocketForwardOrder({ ...requestDetails, items });
                if (forwardOrder && forwardOrder.shipment_id) {
                    adminNotes += `\nReplacement Shipment Created (Shiprocket ID: ${forwardOrder.shipment_id})`;
                    updates.forwardShipmentId = String(forwardOrder.shipment_id);
                    updates.forwardAwbNumber = forwardOrder.awb_code || '';
                    updates.forwardStatus = 'scheduled';
                } else {
                    adminNotes += `\nFailed to create replacement shipment in Shiprocket. Check logs.`;
                }
            }
        }

        const request = await updateRequestStatus(requestId, {
            ...updates,
            status: 'approved',
            adminNotes: adminNotes
        });

        res.json({ success: true, message: 'Request approved successfully', request });
    } catch (error) {
        console.error('Approve request error:', error);
        res.status(500).json({ error: 'Failed to approve request' });
    }
});

// Mark request as delivered/received manually (admin override)
app.post('/api/admin/mark-delivered', authenticateAdmin, async (req, res) => {
    try {
        const { requestId } = req.body;
        console.log(`[${requestId}] Manual Override: Marking as Delivered`);

        const request = await updateRequestStatus(requestId, {
            status: 'delivered',
            deliveredAt: new Date().toISOString()
        });

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        res.json({ success: true, message: 'Request marked as delivered/received', request });

    } catch (error) {
        console.error('Mark delivered error:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Sync Status Endpoint
app.post('/api/admin/sync-status', authenticateAdmin, async (req, res) => {
    try {
        // Get relevant statuses where shipment is active
        const allRequests = await getAllRequests({});

        let activeRequests = allRequests.filter(r =>
            (['pending', 'scheduled', 'picked_up', 'in_transit'].includes(r.status) && (r.awbNumber || r.shipmentId)) ||
            (r.type === 'exchange' && r.forwardAwbNumber && r.forwardStatus !== 'delivered')
        );

        let updatedCount = 0;
        console.log(`[Sync] Processing ${activeRequests.length} requests (including forward shipments)...`);

        for (const req of activeRequests) {
            try {
                // --- 1. Sync Return Status (Existing Logic) ---
                if (['pending', 'scheduled', 'picked_up', 'in_transit'].includes(req.status)) {
                    let trackingData = null;
                    if (req.awbNumber) {
                        try { trackingData = await shiprocketAPI(`/courier/track/awb/${req.awbNumber}`); } catch (e) { }
                    }
                    if ((!trackingData || !trackingData.tracking_data) && req.shipmentId) {
                        try { trackingData = await shiprocketAPI(`/courier/track/shipment/${req.shipmentId}`); } catch (e) { }
                    }

                    if (trackingData && trackingData.tracking_data) {
                        const tracking = trackingData.tracking_data;
                        const currentStatus = tracking.shipment_track?.[0]?.current_status || tracking.current_status;
                        if (currentStatus) {
                            const newAwb = tracking.shipment_track?.[0]?.awb_code || tracking.awb_code;
                            let newStatus = req.status;
                            const statusUpper = currentStatus.toUpperCase();

                            if (statusUpper.includes('DELIVERED') || statusUpper.includes('CLOSED') || statusUpper.includes('RETURN RECEIVED')) {
                                newStatus = 'delivered';
                            } else if (statusUpper.includes('PICKED UP') || statusUpper.includes('PICKUP GENERATED')) {
                                newStatus = 'picked_up';
                            } else if (statusUpper.includes('IN TRANSIT') || statusUpper.includes('SHIPPED') || statusUpper.includes('OUT FOR DELIVERY')) {
                                newStatus = 'in_transit';
                            } else if (statusUpper.includes('SCHEDULED') || statusUpper.includes('GENERATED') || statusUpper.includes('AWB ASSIGNED')) {
                                newStatus = 'scheduled';
                            } else if (statusUpper.includes('RTO') || statusUpper.includes('REJECTED') || statusUpper.includes('CANCELLED')) {
                                newStatus = 'rejected';
                            }

                            if (newStatus !== req.status || (newAwb && newAwb !== req.awbNumber)) {
                                const updatesArr = { status: newStatus };
                                if (newStatus === 'delivered') updatesArr.deliveredAt = new Date().toISOString();
                                if (newStatus === 'picked_up') updatesArr.pickedUpAt = new Date().toISOString();
                                if (newStatus === 'in_transit') updatesArr.inTransitAt = new Date().toISOString();
                                if (newAwb) updatesArr.awbNumber = newAwb;
                                await updateRequestStatus(req.requestId, updatesArr);
                                updatedCount++;
                            }
                        }
                    }
                }

                // --- 2. Sync Forward Status (New Logic) ---
                if (req.type === 'exchange' && req.forwardAwbNumber && req.forwardStatus !== 'delivered') {
                    try {
                        const forwardTrack = await shiprocketAPI(`/courier/track/awb/${req.forwardAwbNumber}`);
                        if (forwardTrack && forwardTrack.tracking_data) {
                            const tracking = forwardTrack.tracking_data;
                            const currentStatus = (tracking.shipment_track?.[0]?.current_status || tracking.current_status || '').toUpperCase();

                            let newForwardStatus = req.forwardStatus || 'scheduled';
                            if (currentStatus.includes('DELIVERED')) newForwardStatus = 'delivered';
                            else if (currentStatus.includes('PICKED UP') || currentStatus.includes('PICKUP GENERATED')) newForwardStatus = 'picked_up';
                            else if (currentStatus.includes('IN TRANSIT') || currentStatus.includes('SHIPPED') || currentStatus.includes('OUT FOR DELIVERY')) newForwardStatus = 'in_transit';

                            if (newForwardStatus !== req.forwardStatus) {
                                console.log(`[${req.requestId}] Updating Forward Status: ${newForwardStatus}`);
                                await updateRequestStatus(req.requestId, { forwardStatus: newForwardStatus });
                                updatedCount++;
                            }
                        }
                    } catch (e) {
                        console.error(`[${req.requestId}] Forward Sync Failed:`, e.message);
                    }
                }
            } catch (err) {
                console.error(`Failed to sync ${req.requestId}:`, err.message);
            }
        }

        console.log(`Sync Complete: Updated ${updatedCount} requests`);
        res.json({ success: true, updated: updatedCount, message: 'Sync complete' });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: 'Failed to sync status' });
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

        res.json({ success: true, request });

    } catch (error) {
        console.error('Reject request error:', error);
        res.status(500).json({ error: 'Failed to reject request' });
    }
});

// Delete requests (admin)
app.post('/api/admin/delete-requests', authenticateAdmin, async (req, res) => {
    try {
        const { requestIds } = req.body;

        if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
            return res.status(400).json({ error: 'Invalid request IDs' });
        }

        const result = await deleteRequests(requestIds);

        res.json({ success: true, count: result.count, message: `Deleted ${result.count || 0} requests` });
    } catch (error) {
        console.error('Delete requests error:', error);
        res.status(500).json({ error: 'Failed to delete requests' });
    }
});

// Finalize payment from frontend
app.post('/api/finalize-payment', async (req, res) => {
    const { requestId, paymentId, paymentAmount } = req.body;
    console.log(`[${requestId}] Frontend requesting finalization for payment ${paymentId}`);

    if (!requestId || !paymentId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const result = await finalizeRequestAfterPayment(requestId, paymentId, paymentAmount);
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Razorpay Webhook
app.post('/api/razorpay-webhook', async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    console.log('📥 Received Razorpay Webhook');

    if (secret && signature) {
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(req.rawBody)
            .digest('hex');

        if (signature !== expectedSignature) {
            console.error('❌ Razorpay Webhook Signature Mismatch');
            return res.status(400).send('Invalid signature');
        }
    } else if (!secret) {
        console.warn('⚠️ RAZORPAY_WEBHOOK_SECRET missing. Skipping signature verification (DEVELOPMENT ONLY)');
    }

    const event = req.body.event;
    const payload = req.body.payload;

    if (event === 'payment.captured' || event === 'payment.authorized') {
        const payment = payload.payment.entity;
        const requestId = payment.notes?.requestId;
        const paymentId = payment.id;
        const amount = payment.amount / 100;

        if (requestId && requestId.startsWith('REQ-')) {
            console.log(`[${requestId}] 🛡️ Webhook Safety Net: Processing payment ${paymentId} (${amount})`);
            await finalizeRequestAfterPayment(requestId, paymentId, amount);
        } else {
            console.log(`[Webhook] Payment ${paymentId} received but no requestId found in notes.`);
        }
    }

    res.json({ status: 'ok' });
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
