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


async function createShiprocketReturnOrder(requestData, shopifyOrder) {
    try {
        const token = await getShiprocketToken();
        const address = shopifyOrder.shipping_address || shopifyOrder.customer.default_address;

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
            pickup_email: shopifyOrder.email || 'noreply@example.com',
            pickup_phone: address.phone || shopifyOrder.phone || '9999999999',

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
                const shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(requestData.orderNumber)}&limit=1`);
                shopifyOrder = shopifyData.orders && shopifyData.orders[0];
            } catch (e) {
                console.error('Failed to fetch original order for forward creation:', e);
            }
        }

        // 2. Determine Address
        let billingAddress = requestData.newAddress;
        let billingCity = requestData.newCity;
        let billingPincode = requestData.newPincode;

        if (!billingAddress) {
            if (shopifyOrder && shopifyOrder.shipping_address) {
                billingAddress = shopifyOrder.shipping_address.address1;
                billingCity = shopifyOrder.shipping_address.city;
                billingPincode = shopifyOrder.shipping_address.zip;
            } else {
                billingAddress = requestData.shippingAddress || 'Address not available';
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
            pickup_location: 'warehouse 1', // As provided by user
            billing_customer_name: customerName,
            billing_last_name: '',
            billing_address: billingAddress,
            billing_city: billingCity || '',
            billing_pincode: billingPincode || '',
            billing_state: '', // Auto-detected usually or separate field
            billing_country: 'India',
            billing_email: requestData.email,
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

        // Fetch original order
        const shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(requestData.orderNumber)}&limit=1`);
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

        const items = Array.isArray(requestData.items) ? requestData.items : [];
        const lineItems = [];

        for (const item of items) {
            if (item.replacementVariant && item.productId) {
                try {
                    const variantsData = await shopifyAPI(`products/${item.productId}/variants.json`);
                    const variants = variantsData.variants || [];
                    // Find variant matching the option (Size) - strict or loose match
                    const variant = variants.find(v => v.title === item.replacementVariant || v.option1 === item.replacementVariant || v.option2 === item.replacementVariant);

                    if (variant) {
                        lineItems.push({
                            variant_id: variant.id,
                            quantity: parseInt(item.quantity) || 1
                        });
                    } else {
                        console.warn(`Replacement variant ${item.replacementVariant} not found for product ${item.productId}.`);
                    }
                } catch (e) {
                    console.error(`Failed to fetch variants for product ${item.productId}:`, e);
                }
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

        // Fetch product images
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
    const requestId = 'REQ-' + Math.floor(10000 + Math.random() * 90000);
    console.log(`[${requestId}] 📥 Received exchange submission`);

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

        console.log(`[${requestId}] Order: ${req.body.orderNumber}, Items: ${items.length}, PaymentId: ${req.body.paymentId || 'None'}`);

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
        if (req.body.paymentId) {
            if (!razorpay) {
                console.error(`[${requestId}] Payment config missing`);
                return res.status(500).json({ error: 'Payment configuration missing on server' });
            }
            try {
                const payment = await razorpay.payments.fetch(req.body.paymentId);
                console.log(`[${requestId}] Payment Status: ${payment.status}`);
                if (payment.status !== 'captured' && payment.status !== 'authorized') {
                    return res.status(400).json({ error: 'Payment not successful' });
                }
            } catch (payError) {
                console.error(`[${requestId}] Payment Verification Failed:`, payError);
                return res.status(400).json({ error: 'Invalid Payment ID' });
            }
        }


        // Create Shiprocket Return Order (if enabled)
        let awbNumber = null;
        let shipmentId = null;
        let pickupDate = null;

        if (process.env.SHIPROCKET_EMAIL && shopifyOrder) {
            try {
                console.log(`[${requestId}] Creating Shiprocket Return...`);
                const shiprocketData = await createShiprocketReturnOrder({ ...req.body, requestId, items }, shopifyOrder);
                if (shiprocketData && shiprocketData.shipment_id) {
                    shipmentId = shiprocketData.shipment_id;
                    awbNumber = shiprocketData.awb_code;
                    pickupDate = shiprocketData.pickup_scheduled_date;
                    console.log(`[${requestId}] Shiprocket Return Created: ${shipmentId}`);
                }
            } catch (srError) {
                console.error(`[${requestId}] Shiprocket return creation failed:`, srError);
            }
        }

        console.log(`[${requestId}] Saving Request to Database...`);
        await createRequest({
            requestId,
            ...req.body,
            email,
            customerName,
            customerPhone,
            items,
            images: imageUrls,
            type: 'exchange',
            shippingAddress: originalAddressFormatted, // Save original address
            awbNumber,
            shipmentId,
            pickupDate
        });

        console.log(`[${requestId}] ✅ Exchange Request Submitted Successfully`);
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

        if (req.body.paymentId) {
            // Payment verif logic...
            if (!razorpay) return res.status(500).json({ error: 'Config error' });
            try {
                const payment = await razorpay.payments.fetch(req.body.paymentId);
                if (payment.status !== 'captured' && payment.status !== 'authorized') return res.status(400).json({ error: 'Payment failed' });
            } catch (e) { return res.status(400).json({ error: 'Invalid payment' }); }
        }

        let awbNumber = null;
        let shipmentId = null;
        let pickupDate = null;

        if (process.env.SHIPROCKET_EMAIL && shopifyOrder) {
            try {
                const shiprocketData = await createShiprocketReturnOrder({ ...req.body, requestId, items }, shopifyOrder);
                if (shiprocketData && shiprocketData.shipment_id) {
                    shipmentId = shiprocketData.shipment_id;
                    awbNumber = shiprocketData.awb_code;
                    pickupDate = shiprocketData.pickup_scheduled_date;
                }
            } catch (e) { console.error(e); }
        }

        await createRequest({
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
            pickupDate
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

// Track request (Return/Exchange)
app.get('/api/track-request/:requestId', async (req, res) => {
    try {
        const request = await getRequestById(req.params.requestId);

        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
        }

        // Try to fetch Shiprocket Data if AWB exists
        if (request.awbNumber && process.env.SHIPROCKET_EMAIL) {
            try {
                const trackingData = await shiprocketAPI(`/courier/track/awb/${request.awbNumber}`);
                if (trackingData && trackingData.tracking_data) {
                    const tracking = trackingData.tracking_data;
                    // Add shipment details to request object
                    request.shipment = {
                        origin: tracking.shipment_track?.[0]?.origin || tracking.origin || null,
                        destination: tracking.shipment_track?.[0]?.destination || tracking.destination || null,
                        status: tracking.current_status,
                        edd: tracking.edd || null,
                        activities: tracking.shipment_track || []
                    };
                }
            } catch (err) {
                console.error('Failed to fetch Shiprocket tracking for request:', err.message);
            }
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
                    response.estimatedDelivery = tracking.edd || null;

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
        let adminNotes = notes || '';

        // Trigger Forward Shipment & Create Store Order for Exchange
        if (requestDetails && requestDetails.type === 'exchange' && requestDetails.status !== 'approved') {
            // 1. Create Shopify Order - SKIPPED AS PER USER REQUEST
            // const newOrder = await createShopifyExchangeOrder(requestDetails);
            // if (newOrder) {
            //     adminNotes += `\nExchange Order Created: #${newOrder.order_number}`;
            // }

            // 2. Create Shiprocket Forward Shipment (if configured)
            if (process.env.SHIPROCKET_EMAIL) {
                console.log('Creating Forward Shipment for Exchange:', requestId);
                const forwardOrder = await createShiprocketForwardOrder(requestDetails);
                if (forwardOrder && forwardOrder.shipment_id) {
                    adminNotes += `\nForward Shipment Created: ID ${forwardOrder.shipment_id}, AWB: ${forwardOrder.awb_code || 'Pending'}`;
                }
            }
        }

        const request = await updateRequestStatus(requestId, {
            status: 'approved',
            adminNotes: adminNotes
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

// Sync Status Endpoint
app.post('/api/admin/sync-status', authenticateAdmin, async (req, res) => {
    try {
        // Get relevant statuses where shipment is active
        const allRequests = await getAllRequests({});

        let activeRequests = allRequests.filter(r =>
            ['scheduled', 'picked_up', 'in_transit'].includes(r.status) && r.awbNumber
        );

        let updatedCount = 0;

        for (const req of activeRequests) {
            try {
                // Call Shiprocket Tracking API
                const trackingData = await shiprocketAPI(`/courier/track/awb/${req.awbNumber}`);

                if (trackingData && trackingData.tracking_data) {
                    const tracking = trackingData.tracking_data;
                    const currentStatus = tracking.shipment_track?.[0]?.current_status || tracking.current_status;

                    if (!currentStatus) continue;

                    let newStatus = req.status;
                    // Map Shiprocket status to our status
                    const statusUpper = currentStatus.toUpperCase();

                    if (statusUpper.includes('DELIVERED')) {
                        newStatus = 'delivered';
                    } else if (statusUpper.includes('PICKED UP') || statusUpper.includes('OUT FOR PICKUP')) {
                        newStatus = 'picked_up';
                    } else if (statusUpper.includes('IN TRANSIT') || statusUpper.includes('SHIPPED')) {
                        newStatus = 'in_transit';
                    } else if (statusUpper.includes('RTO') || statusUpper.includes('RETURNED')) {
                        newStatus = 'rejected'; // Or handle RTO separately
                    }

                    if (newStatus !== req.status) {
                        await updateRequestStatus(req.requestId, { status: newStatus });
                        updatedCount++;
                    }
                }
            } catch (err) {
                console.error(`Failed to sync ${req.requestId}:`, err.message);
            }
        }

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
