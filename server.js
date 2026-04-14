const express = require('express');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');

// Environment check
const isProduction = process.env.NODE_ENV === 'production';

// Create the logger
const logger = winston.createLogger({
    level: isProduction ? 'error' : 'warn',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
    ]
});

// Rate limit event handler with logging
function rateLimitHandler(req, res, next, options) {
    const logData = {
        timestamp: new Date().toISOString(),
        ip: req.ip,
        method: req.method,
        url: req.originalUrl,
        userAgent: req.headers['user-agent']
    };
    logger.warn('Rate limit exceeded', logData);
    res.status(options.statusCode).json({ error: 'Too many requests, please try again later.' });
}

// Simple suspicious activity tracker (in-memory, reset every hour)
const suspiciousActivity = new Map();
const SUSPICIOUS_THRESHOLD = 10;
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

function trackSuspicious(ip, action) {
    const now = Date.now();
    let record = suspiciousActivity.get(ip);

    if (!record) {
        record = { count: 0, lastAction: null, timestamps: [] };
        suspiciousActivity.set(ip, record);
    }

    record.timestamps = record.timestamps.filter(ts => now - ts < ATTEMPT_WINDOW_MS);
    record.timestamps.push(now);
    record.count = record.timestamps.length;
    record.lastAction = action;

    if (record.count >= SUSPICIOUS_THRESHOLD) {
        logger.warn(`Suspicious activity detected from IP ${ip}`, { count: record.count });
    }
}

const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Razorpay = require('razorpay');

const app = express();

// Trust Render's proxy so express-rate-limit can read real client IPs
app.set('trust proxy', 1);

// Security middleware - Helmet for security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && isProduction) {
    console.error('FATAL: JWT_SECRET environment variable is required in production');
    process.exit(1);
}

// Token expiration time (24 hours)
const TOKEN_EXPIRY = '24h';

// CORS Configuration - Allow all origins for Shopify embedded app
// Note: In production, consider restricting to your Shopify domain
const corsOptions = {
    origin: true, // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Rate limiters
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: 'Too many requests from this IP, please try again after 15 minutes.',
    handler: rateLimitHandler
});

const writeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // Max 20 requests per IP per hour for write
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many submissions from this IP, please try again after an hour.',
    handler: rateLimitHandler
});




// Apply general API rate limiter
app.use('/api/', apiLimiter);

// Apply stricter limits on sensitive write endpoints
app.post('/api/submit-return', writeLimiter);
app.post('/api/submit-exchange', writeLimiter);
app.post('/api/admin/', writeLimiter);
app.post('/api/admin/*', writeLimiter);

const PORT = process.env.PORT || 3000;

// JWT Token Generation Helper
function generateToken(payload) {
    if (!JWT_SECRET) {
        // Fallback for development only
        return crypto.randomBytes(32).toString('hex');
    }
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// JWT Token Verification Helper
function verifyToken(token) {
    if (!JWT_SECRET) {
        return null; // Development fallback
    }
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

// Supabase Database
const {
    createRequest,
    getRequestById,
    getRequestsByOrderNumber,
    getAllRequests,
    getRequestStats,
    updateRequestData,
    updateRequestStatus,
    saveAgentNotes,
    deleteRequests,
    getSetting,
    updateSetting,
    getAllInfluencers,
    createInfluencer,
    updateInfluencer,
    deleteInfluencer,
    getInfluencerByToken
} = require('./config/db-helpers');

async function generateUniqueRequestId() {
    let isUnique = false;
    let requestId;
    let retryCount = 0;
    while (!isUnique && retryCount < 10) {
        requestId = 'REQ-' + Math.floor(10000 + Math.random() * 90000);
        const existing = await getRequestById(requestId);
        if (!existing) {
            isUnique = true;
        }
        retryCount++;
    }
    if (!isUnique) {
        requestId = 'REQ-' + Date.now().toString().slice(-5);
    }
    return requestId;
}

// Body parsing middleware
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(express.static('public'));

// In-memory storage for OAuth tokens and payment processing
const storage = {
    accessToken: null,
    processingPayments: new Set() // Dedup guard: prevent double-processing same payment
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

// OAuth callback - Protected in production
app.get('/auth/callback', async (req, res) => {
    // Block OAuth callback in production if already configured
    if (isProduction && process.env.SHOPIFY_ACCESS_TOKEN) {
        return res.status(403).json({ error: 'OAuth callback is disabled in production. Shopify is already configured.' });
    }

    const { code, shop } = req.query;

    // Validate that we have the required parameters
    if (!code || !shop) {
        return res.status(400).json({ error: 'Invalid OAuth callback - missing code or shop parameter' });
    }

    // Verify shop matches our configured store
    if (shop !== process.env.SHOPIFY_STORE) {
        return res.status(400).json({ error: 'Invalid OAuth callback - shop mismatch' });
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

        // In production, don't expose the token in the response
        if (isProduction) {
            return res.json({ 
                success: true, 
                message: 'Authorization successful. Token has been stored securely.' 
            });
        }

        // Development only: Show token for setup
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

// ==================== API RETRY HELPER ====================

/**
 * A wrapper around fetch that retries on network errors (like ECONNRESET)
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options
 * @param {number} retries - Maximum number of retries
 * @param {number} backoff - Initial backoff delay in ms
 */
async function fetchWithRetry(url, options = {}, retries = 3, backoff = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (error) {
            // If it's the last retry, throw the error
            if (i === retries - 1) throw error;

            console.warn(`[Network Retry] Attempt ${i + 1}/${retries} failed for ${url}. Error: ${error.message}. Retrying in ${backoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            backoff *= 2; // Exponential backoff
        }
    }
}

// ==================== SHOPIFY API HELPER ====================

async function shopifyAPI(endpoint, options = {}) {
    const token = process.env.SHOPIFY_ACCESS_TOKEN || storage.accessToken;
    const shop = process.env.SHOPIFY_STORE;

    if (!token) {
        throw new Error('Not authorized. Please complete OAuth flow first.');
    }

    const response = await fetchWithRetry(`https://${shop}/admin/api/2024-01/${endpoint}`, {
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
        const response = await fetchWithRetry('https://apiv2.shiprocket.in/v1/external/auth/login', {
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
        shiprocketTokenExpiry = Date.now() + (24 * 60 * 60 * 1000); // Reduce to 24 hours for safety

        return shiprocketToken;
    } catch (error) {
        console.error('Shiprocket authentication error:', error);
        throw error;
    }
}

async function shiprocketAPI(endpoint, options = {}, retries = 2) {
    const token = await getShiprocketToken();

    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetchWithRetry(`https://apiv2.shiprocket.in/v1/external${endpoint}`, {
                ...options,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                // Retry on 5xx errors (like the user experienced)
                if (response.status >= 500 && i < retries) {
                    console.warn(`[Shiprocket Retry] Status ${response.status} for ${endpoint}. Attempt ${i + 1}/${retries + 1}.`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // 1s, 2s... delay
                    continue;
                }
                throw new Error(`Shiprocket API error: ${response.status} - ${errorText}`);
            }

            return response.json();
        } catch (error) {
            if (i === retries) throw error;
            console.warn(`[Shiprocket Exception Retry] Attempt ${i + 1}/${retries + 1}. Error: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
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
                let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderName)}&status=any&limit=1`);

                if (!shopifyData.orders || shopifyData.orders.length === 0) {
                    const altName = orderName.startsWith('#') ? orderName.substring(1) : `#${orderName}`;
                    console.log(`[${requestData.requestId}] Order not found by "${orderName}", retrying with "${altName}"...`);
                    shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(altName)}&status=any&limit=1`);
                }

                shopifyOrder = shopifyData.orders && shopifyData.orders[0];
                if (!shopifyOrder) console.warn(`[${requestData.requestId}] ⚠️ Shopify order not found even with fuzzy lookup for: ${orderName}`);
            } catch (e) {
                console.error(`[${requestData.requestId}] Failed to fetch original order:`, e);
            }
        }

        const address = shopifyOrder ? (shopifyOrder.shipping_address || (shopifyOrder.customer && shopifyOrder.customer.default_address)) : null;

        if (!address) {
            console.error(`[${requestData.requestId}] ❌ Shiprocket Error: No address found. ShopifyOrder fetched: ${!!shopifyOrder}`);
            return null;
        }

        const orderDate = new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0];

        // Fetch dynamic warehouse location settings
        const warehouseLocation = await getSetting('warehouse_location', null);

        let shippingCustomerName = 'BURB MANUFACTURES PVT LTD';
        let shippingAddress = 'VILLAGE - BAIRAWAS, NEAR GOVT. SCHOOL';
        let shippingAddress2 = '';
        let shippingCity = 'MAHENDERGARH';
        let shippingState = 'Haryana';
        let shippingCountry = 'IN';
        let shippingPincode = '123028';
        let shippingEmail = 'returns@offcomfort.com';
        let shippingPhone = '9138514222';

        if (warehouseLocation) {
            shippingCustomerName = warehouseLocation.name || shippingCustomerName;
            shippingAddress = warehouseLocation.address || warehouseLocation.address_line_1 || shippingAddress;
            shippingAddress2 = warehouseLocation.address_2 || warehouseLocation.address_line_2 || shippingAddress2;
            shippingCity = warehouseLocation.city || shippingCity;
            shippingState = warehouseLocation.state || shippingState;
            shippingCountry = warehouseLocation.country || shippingCountry;
            shippingPincode = warehouseLocation.pin_code || warehouseLocation.pincode || shippingPincode;
            shippingEmail = warehouseLocation.email || shippingEmail;
            shippingPhone = warehouseLocation.phone || shippingPhone;
        }

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
            pickup_address: ((address.address1 || '') + ' ' + (address.address2 || '')).trim().substring(0, 190),
            pickup_address_2: '',
            pickup_city: address.city,
            pickup_state: address.province,
            pickup_country: address.country_code || 'IN',
            pickup_pincode: address.zip,
            pickup_email: getValidEmail(shopifyOrder?.email, shopifyOrder),
            pickup_phone: (() => {
                let rawPhone = requestData.customerPhone || address.phone || shopifyOrder?.phone || '9999999999';
                let digits = String(rawPhone).replace(/\D/g, '');
                return digits.length >= 10 ? digits.slice(-10) : '9999999999';
            })(),

            // Shipping Details (Warehouse - Destination)
            shipping_customer_name: shippingCustomerName,
            shipping_last_name: '',
            shipping_address: ((shippingAddress || '') + ' ' + (shippingAddress2 || '')).trim().substring(0, 190),
            shipping_address_2: '',
            shipping_city: shippingCity,
            shipping_state: shippingState,
            shipping_country: shippingCountry,
            shipping_pincode: shippingPincode,
            shipping_email: shippingEmail,
            shipping_phone: shippingPhone,

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

        if (data.status_code === 400 || data.status_code === 422 || (data.errors && Object.keys(data.errors).length > 0)) {
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
                let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderName)}&status=any&limit=1`);

                // Robust lookup: try with/without '#'
                if (!shopifyData.orders || shopifyData.orders.length === 0) {
                    const altName = orderName.startsWith('#') ? orderName.substring(1) : `#${orderName}`;
                    shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(altName)}&status=any&limit=1`);
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

        // Sanitize to exactly 10 digits for Shiprocket rules
        let cleanPhone = String(customerPhone).replace(/\D/g, '');
        customerPhone = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : '9999999999';


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
        const orderItems = items.map(item => {
            const isDifferentProduct = item.replacementProductId && item.replacementProductId !== item.productId;
            const title = item.replacementProductTitle || item.name;
            const variantStr = (item.replacementVariant && item.replacementVariant !== 'Same') ? ` (${item.replacementVariant})` : '';
            const finalName = title + variantStr;
            const finalVariantId = (item.replacementVariantId && item.replacementVariantId !== 'Same') ? item.replacementVariantId : (item.variantId || item.id);

            return {
                name: finalName,
                sku: String(finalVariantId) + '-EXCH',
                units: parseInt(item.quantity) || 1,
                selling_price: parseFloat(item.replacementPrice || item.price) || 0,
                discount: 0,
                tax: 0
            };
        });

        // Fetch dynamic warehouse location settings
        const warehouseLocation = await getSetting('warehouse_location', null);
        const pickupLocationNickname = warehouseLocation && warehouseLocation.pickup_location
            ? warehouseLocation.pickup_location
            : 'Primary';

        const payload = {
            order_id: requestData.requestId + '-FWD',
            order_date: new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0],
            pickup_location: pickupLocationNickname, // Dynamically set from Shiprocket settings
            billing_customer_name: customerName,
            billing_last_name: '',
            billing_address: (billingAddress || 'Address not available').substring(0, 190),
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

        if (data.status_code === 400 || data.status_code === 422 || (data.errors && Object.keys(data.errors).length > 0)) {
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
        let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderName)}&status=any&limit=1`);

        if (!shopifyData.orders || shopifyData.orders.length === 0) {
            const altName = orderName.startsWith('#') ? orderName.substring(1) : `#${orderName}`;
            shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(altName)}&status=any&limit=1`);
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
app.get('/api/config', async (req, res) => {
    res.json({
        razorpayKey: process.env.RAZORPAY_KEY_ID || null,
        allowReturns: await getSetting('allow_returns', true),
        allowExchanges: await getSetting('allow_exchanges', true)
    });
});

// ==================== PUBLIC API ENDPOINTS ====================

// Get order details
app.post('/api/get-order', async (req, res) => {
    try {
        const { orderNumber, email } = req.body;

        const data = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}&status=any&limit=1`);

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
        console.log('--- LOOKUP REQUEST ---');
        console.log('Body:', req.body);
        console.log('Headers:', req.headers['content-type']);

        const { orderNumber, email } = req.body;

        if (!orderNumber || !email) {
            console.log('Lookup attempt with missing fields:', { orderNumber, email });
            return res.status(400).json({
                error: 'Order number and email/phone are required',
                isEligible: false
            });
        }

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

        // ── One request per order guard ──────────────────────────────────────────
        // Check BEFORE eligibility so the form never loads for duplicate orders
        try {
            const existingForOrder = await getRequestsByOrderNumber(order.name);
            const activeForOrder = existingForOrder.filter(r => r.status !== 'rejected' && r.status !== 'waiting_payment');
            if (activeForOrder.length > 0) {
                const existing = activeForOrder[0];
                console.log(`Order ${order.name} already has active request ${existing.requestId}`);
                return res.status(400).json({
                    isEligible: false,
                    alreadyHasRequest: true,
                    existingRequestId: existing.requestId,
                    existingRequestType: existing.type,
                    error: `A ${existing.type} request (${existing.requestId}) already exists for this order. Track it at the Track Request page.`,
                    eligibilityMessage: `A ${existing.type} request (${existing.requestId}) has already been raised for this order. You can track it on the Track Request page.`
                });
            }
        } catch (dupCheckErr) {
            // Non-fatal — if duplicate check fails, continue and let submit-time guard catch it
            console.warn('Duplicate check failed (non-fatal):', dupCheckErr.message);
        }
        // ────────────────────────────────────────────────────────────────────────

        const isFulfilled = order.fulfillment_status === 'fulfilled';

        // Fetch delivery date BEFORE eligibility check so we can base window on it
        let deliveredDate = null;
        if (order.fulfillments && order.fulfillments.length > 0) {
            const fulfillment = order.fulfillments[0];
            const awb = fulfillment.tracking_number;
            console.log('Fulfillment found. AWB:', awb);

            if (awb) {
                const tracking = await getShiprocketTracking(awb);
                console.log('Tracking data fetched:', tracking ? 'Yes' : 'No');

                if (tracking) {
                    // Only use the ACTUAL delivered_date — NOT estimated dates (etd/edd).
                    // Using estimated dates caused orders to fail the return window check
                    // even when they were delivered today or still in transit.
                    deliveredDate = tracking.delivered_date || null;
                    console.log('Extracted deliveredDate (actual only):', deliveredDate);
                }
            }
        } else {
            console.log('No fulfillments found for order');
        }

        // Eligibility: Check cutoff date first
        const CUTOFF_ENABLED = await getSetting('cutoff_date_enabled', false);
        const CUTOFF_DATE = await getSetting('cutoff_date', null);
        
        if (CUTOFF_ENABLED && CUTOFF_DATE && order.created_at) {
            const orderDate = new Date(order.created_at);
            const cutoff = new Date(CUTOFF_DATE);
            // Set cutoff to end of day for inclusive comparison
            cutoff.setHours(23, 59, 59, 999);
            
            if (orderDate < cutoff) {
                return res.status(200).json({
                    isEligible: false,
                    eligibilityMessage: `This order is not eligible for return/exchange as it was placed before the cutoff date (${CUTOFF_DATE}).`,
                    order: {
                        orderNumber: order.name,
                        customerName: order.customer
                            ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                            : 'Customer',
                        email: order.customer?.email || email,
                        phone: order.customer?.phone || order.shipping_address?.phone || '',
                        orderDate: order.created_at,
                        totalAmount: order.total_price,
                        items: order.line_items.map(item => ({
                            id: item.id,
                            productId: item.product_id,
                            variantId: item.variant_id,
                            name: item.name,
                            variant: item.variant_title || 'Default',
                            quantity: item.quantity,
                            price: item.price,
                            image: item.properties?.image ||
                                (item.product_id ? `https://cdn.shopify.com/shopifycloud/placeholder.jpg` : '')
                        }))
                    }
                });
            }
        }

        // Eligibility: Check window mode (delivery date vs order date)
        const RETURN_WINDOW_DAYS = await getSetting('return_window_days', 2);
        const RETURN_WINDOW_MODE = await getSetting('return_window_mode', 'delivery');
        let daysSinceReference = null;
        let isWithinWindow = false;
        let referenceDate = null;

        if (RETURN_WINDOW_MODE === 'order') {
            // Calculate from order date
            referenceDate = order.created_at;
            if (referenceDate) {
                const orderDate = new Date(referenceDate);
                daysSinceReference = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
                isWithinWindow = daysSinceReference <= RETURN_WINDOW_DAYS;
            }
        } else {
            // Calculate from delivery date (default behavior)
            if (deliveredDate) {
                referenceDate = deliveredDate;
                const delivered = new Date(deliveredDate);
                daysSinceReference = (Date.now() - delivered.getTime()) / (1000 * 60 * 60 * 24);
                isWithinWindow = daysSinceReference <= RETURN_WINDOW_DAYS;
            } else if (isFulfilled) {
                // No delivery date available yet — allow if fulfilled (pickup pending)
                isWithinWindow = true;
            }
        }

        const windowTypeText = RETURN_WINDOW_MODE === 'order' ? 'order date' : 'delivery';
        const eligibilityMessage = RETURN_WINDOW_MODE === 'order'
            ? (!isWithinWindow
                ? `Return/exchange window has closed. Requests must be raised within ${RETURN_WINDOW_DAYS} days of order date.`
                : 'Order is eligible for exchange/return')
            : (!isFulfilled
                ? 'Order must be delivered before exchange/return'
                : !isWithinWindow
                    ? `Return/exchange window has closed. Requests must be raised within ${RETURN_WINDOW_DAYS} days of delivery.`
                    : 'Order is eligible for exchange/return');

        console.log('Eligibility:', { isFulfilled, deliveredDate, referenceDate, daysSinceReference, isWithinWindow, returnWindowMode: RETURN_WINDOW_MODE });

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
            isEligible: isFulfilled && isWithinWindow,
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

        if (request.status !== 'waiting_payment' && request.status !== 'pending') {
            console.log(`[${requestId}] ℹ️ Request already fully processed (Status: ${request.status})`);
            return { success: true, alreadyProcessed: true };
        }

        // 1. Prepare Updates
        const updates = {
            paymentId: paymentId,
            paymentAmount: paymentAmount,
            status: 'pending' // Default status after payment
        };

        // 2. Auto-Pickup: only for paid non-fee-waived requests.
        // Fee-waived (defective/wrong_item) stay 'pending' for admin review before pickup.
        const isFeeWaived = request.reason === 'defective' || request.reason === 'wrong_item';
        let awbNumber = null;
        let shipmentId = null;
        let pickupDate = null;

        if (!isFeeWaived && process.env.SHIPROCKET_EMAIL) {
            console.log(`[${requestId}] Initiating Shiprocket Pickup (Background)...`);
            try {
                const srResponse = await createShiprocketReturnOrder({
                    requestId,
                    orderNumber: request.orderNumber,
                    customerPhone: request.customerPhone,
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
        } else if (isFeeWaived) {
            console.log(`[${requestId}] Fee-waived reason (${request.reason}): keeping pending for admin review.`);
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
    const allowExchanges = await getSetting('allow_exchanges', true);
    if (!allowExchanges) {
        return res.status(403).json({ error: 'Exchanges are currently disabled by the administrator.' });
    }

    let requestId = await generateUniqueRequestId();
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

        // ── One request per order guard ──────────────────────────────────────────
        const existingRequests = await getRequestsByOrderNumber(req.body.orderNumber);
        const activeExisting = existingRequests.filter(r => r.status !== 'rejected');
        let reuseRequestId = null; // Will be set if resubmitting a waiting_payment request
        if (activeExisting.length > 0) {
            if (activeExisting[0].status === 'waiting_payment') {
                reuseRequestId = activeExisting[0].requestId;
                console.log(`[${requestId}] ♻️  Reusing REQ ID ${reuseRequestId} (was waiting_payment)`);
            } else {
                console.log(`[${requestId}] ❌ Duplicate blocked — ${activeExisting[0].requestId} (${activeExisting[0].status})`);
                return res.status(400).json({
                    error: `A request (${activeExisting[0].requestId}) already exists for this order. Only one request is allowed per order.`
                });
            }
        }
        // ────────────────────────────────────────────────────────────────────────

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
        // Fee is ONLY waived for defective/wrong items (requires manual review)
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


        // Shiprocket Return Order (Auto-Pickup) Logic:
        // - PAID reasons: auto-initiate pickup at submission
        // - FEE-WAIVED reasons (damaged/wrong_item): go to admin for review first, pickup triggered upon admin approval
        let awbNumber = null;
        let shipmentId = null;
        let pickupDate = null;

        if (!isFeeWaived && !needsPayment && process.env.SHIPROCKET_EMAIL) {
            console.log(`[${requestId}] Auto-Pickup: initiating Shiprocket for paid reason: ${req.body.reason}`);
            try {
                const srResponse = await createShiprocketReturnOrder({
                    requestId,
                    orderNumber: req.body.orderNumber,
                    customerPhone: customerPhone,
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
        } else if (isFeeWaived) {
            console.log(`[${requestId}] Reason (${req.body.reason}) is fee-waived. Deferring pickup for manual admin review.`);
        }

        try {
            console.log(`[${requestId}] Saving Request to Database...`);
            const requestData = {
                ...req.body,
                requestId,
                email,
                customerEmail: email,
                customerName,
                customerPhone,
                items,
                images: imageUrls,
                type: 'exchange',
                shippingAddress: originalAddressFormatted,
                awbNumber,
                shipmentId,
                pickupDate,
                paymentId: req.body.paymentId || null,
                paymentAmount: req.body.paymentAmount || 0,
                status: needsPayment ? 'waiting_payment' : (isFeeWaived ? 'pending' : ((awbNumber || shipmentId) ? 'scheduled' : 'pending'))
            };

            console.log(`[${requestId}] Final Status: ${requestData.status}, AWB: ${awbNumber}`);
            if (reuseRequestId) {
                // Resubmission — update existing record, keep same REQ ID
                requestData.requestId = reuseRequestId;
                await updateRequestData(reuseRequestId, requestData);
            } else {
                await createRequest(requestData);
            }
        } catch (dbError) {
            console.error(`[${requestId}] ❌ Database Insert Failed:`, dbError.message);
            if (dbError.message.includes('column "images"')) {
                return res.status(500).json({ error: 'Database mismatch: Please add "images" column.' });
            }
            throw dbError;
        }

        // If resubmitting, use the reused REQ ID for notifications and response
        if (reuseRequestId) requestId = reuseRequestId;

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
    const allowReturns = await getSetting('allow_returns', true);
    if (!allowReturns) {
        return res.status(403).json({ error: 'Returns are currently disabled by the administrator.' });
    }

    let requestId = await generateUniqueRequestId();
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

        // ── One request per order guard ──────────────────────────────────────────
        const existingRequests = await getRequestsByOrderNumber(req.body.orderNumber);
        const activeExisting = existingRequests.filter(r => r.status !== 'rejected');
        let reuseRequestId = null; // Will be set if resubmitting a waiting_payment request
        if (activeExisting.length > 0) {
            if (activeExisting[0].status === 'waiting_payment') {
                // Reuse same REQ ID — update existing record instead of creating new
                reuseRequestId = activeExisting[0].requestId;
                console.log(`[${requestId}] ♻️  Reusing REQ ID ${reuseRequestId} (was waiting_payment)`);
            } else {
                console.log(`[${requestId}] ❌ Duplicate blocked — existing request ${activeExisting[0].requestId} for order ${req.body.orderNumber}`);
                return res.status(400).json({
                    error: `A return/exchange request (${activeExisting[0].requestId}) already exists for this order. Only one request is allowed per order.`
                });
            }
        }
        // ────────────────────────────────────────────────────────────────────────

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

        // Verify Payment logic for Return
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

        // Shiprocket Return Order (Auto-Pickup) Logic:
        // - PAID reasons: auto-initiate pickup at submission
        // - FEE-WAIVED reasons (damaged/wrong_item): go to admin for review first, pickup triggered upon admin approval
        let awbNumber = null;
        let shipmentId = null;
        let pickupDate = null;

        if (!isFeeWaivedReturn && !needsPayment && process.env.SHIPROCKET_EMAIL) {
            console.log(`[${requestId}] Auto-Pickup: initiating Shiprocket for paid reason: ${req.body.reason}`);
            try {
                const srResponse = await createShiprocketReturnOrder({
                    requestId,
                    orderNumber: req.body.orderNumber,
                    customerPhone: customerPhone,
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
        } else if (isFeeWaivedReturn) {
            console.log(`[${requestId}] Reason (${req.body.reason}) is fee-waived. Deferring pickup for manual admin review.`);
        }

        try {
            console.log(`[${requestId}] Saving Request to Database...`);
            const requestData = {
                ...req.body,
                requestId,
                email,
                customerEmail: email,
                customerName,
                customerPhone,
                items,
                images: imageUrls,
                type: 'return',
                shippingAddress: originalAddressFormatted,
                awbNumber,
                shipmentId,
                pickupDate,
                paymentId: req.body.paymentId || null,
                paymentAmount: req.body.paymentAmount || 0,
                status: needsPayment ? 'waiting_payment' : (isFeeWaivedReturn ? 'pending' : ((awbNumber || shipmentId) ? 'scheduled' : 'pending'))
            };

            console.log(`[${requestId}] Final Status (Return): ${requestData.status}, AWB: ${awbNumber}`);
            if (reuseRequestId) {
                // Resubmission — update existing record, keep same REQ ID
                requestData.requestId = reuseRequestId;
                await updateRequestData(reuseRequestId, requestData);
            } else {
                await createRequest(requestData);
            }
        } catch (dbError) {
            console.error(`[${requestId}] ❌ Database Insert Failed:`, dbError.message);
            if (dbError.message.includes('column "images"')) {
                return res.status(500).json({ error: 'Database mismatch: Please add "images" column.' });
            }
            throw dbError;
        }

        // If resubmitting, use the reused REQ ID for notifications and response
        if (reuseRequestId) requestId = reuseRequestId;

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

// Track request (Return/Exchange) — accepts REQ ID or Order Number
app.get('/api/track-request/:identifier', async (req, res) => {
    const { identifier } = req.params;

    // Helper to enrich a request with live Shiprocket tracking data
    async function enrichWithTracking(request) {
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
                if (err.message.toLowerCase().includes('cancelled') || err.message.toLowerCase().includes('canceled')) {
                    console.log(`[Tracking API] Return Shipment (${request.awbNumber}) is cancelled in Shiprocket.`);
                    request.shipment = { status: 'Cancelled', edd: null, activities: [] };
                } else {
                    console.error(`[Tracking API] Return Shipment (${request.awbNumber}) failed:`, err.message);
                }
            }
        }
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
                if (err.message.toLowerCase().includes('cancelled') || err.message.toLowerCase().includes('canceled')) {
                    console.log(`[Tracking API] Forward Shipment (${request.forwardAwbNumber}) is cancelled in Shiprocket.`);
                    request.forwardShipment = { awb: request.forwardAwbNumber, status: 'Cancelled', edd: null, activities: [] };
                } else {
                    console.error(`[Tracking API] Forward Shipment (${request.forwardAwbNumber}) failed:`, err.message);
                }
            }
        }
        return request;
    }

    try {
        // Detect: REQ IDs always start with 'REQ-'; everything else treated as an order number
        const isReqId = identifier.toUpperCase().startsWith('REQ-');

        if (isReqId) {
            // --- Normal path: single request by REQ ID ---
            const request = await getRequestById(identifier);
            if (!request) return res.status(404).json({ error: 'Request not found' });
            await enrichWithTracking(request);
            return res.json(request);
        } else {
            // --- Order number path: may return multiple requests ---
            const requests = await getRequestsByOrderNumber(identifier);
            if (!requests || requests.length === 0) {
                return res.status(404).json({ error: 'No return or exchange request found for this order number' });
            }
            // Enrich all with live tracking data
            const enriched = await Promise.all(requests.map(enrichWithTracking));
            // If exactly one, return as single object (keeps frontend backward compatible)
            if (enriched.length === 1) return res.json(enriched[0]);
            // Multiple: return as array under 'requests' key
            return res.json({ multiple: true, requests: enriched });
        }
    } catch (error) {
        console.error(`[Tracking Error] [${identifier}]:`, error);
        res.status(500).json({
            error: 'Failed to track request',
            details: error.message
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
                // Wrap in additional try/catch specifically for the API call to ensure we log the AWB
                const trackingData = await shiprocketAPI(`/courier/track/awb/${trackingNumber}`);
                console.log(`Shiprocket Tracking for ${trackingNumber}:`, trackingData?.tracking_data ? 'Success' : 'No Data');

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

// Admin authentication middleware with JWT
function authenticateAdmin(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded || decoded.role !== 'admin') {
        trackSuspicious(req.ip, 'invalid_admin_token');
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = decoded;
    next();
}

// Admin login with JWT
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;

    if (!password) {
        return res.status(400).json({ error: 'Password required' });
    }

    if (password === process.env.ADMIN_PASSWORD) {
        const token = generateToken({ role: 'admin', timestamp: Date.now() });
        res.json({ success: true, token });
    } else {
        trackSuspicious(req.ip, 'failed_admin_login');
        res.status(401).json({ error: 'Invalid password' });
    }
});

// Admin: Get Settings
app.get('/api/admin/settings', authenticateAdmin, async (req, res) => {
    try {
        const settings = {
            return_window_days: await getSetting('return_window_days', 2),
            return_window_mode: await getSetting('return_window_mode', 'delivery'),
            allow_returns: await getSetting('allow_returns', true),
            allow_exchanges: await getSetting('allow_exchanges', true),
            auto_approve_reasons: await getSetting('auto_approve_reasons', ['size', 'fit']),
            warehouse_location: await getSetting('warehouse_location', null),
            cutoff_date_enabled: await getSetting('cutoff_date_enabled', false),
            cutoff_date: await getSetting('cutoff_date', null)
        };
        res.json(settings);
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

// Admin: Get Shiprocket Locations
app.get('/api/admin/shiprocket-locations', authenticateAdmin, async (req, res) => {
    try {
        const token = await getShiprocketToken();
        const response = await fetchWithRetry('https://apiv2.shiprocket.in/v1/external/settings/company/pickup', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Shiprocket API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();

        // Shiprocket returns an array of pickup locations
        if (data && data.data && data.data.shipping_address) {
            res.json({ success: true, locations: data.data.shipping_address });
        } else {
            res.json({ success: true, locations: [] });
        }
    } catch (error) {
        console.error('Get Shiprocket locations error:', error);
        res.status(500).json({ error: 'Failed to fetch Shiprocket pickup locations' });
    }
});

// Admin: Update Settings
app.post('/api/admin/settings', authenticateAdmin, async (req, res) => {
    try {
        const { updates } = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Invalid updates object' });
        }

        for (const [key, value] of Object.entries(updates)) {
            await updateSetting(key, value);
        }

        res.json({ success: true, message: 'Settings updated' });
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// ==================== AGENT ENDPOINTS (Read-only + Notes) ====================

// Agent auth middleware with JWT
function authenticateAgent(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded || decoded.role !== 'agent') {
        trackSuspicious(req.ip, 'invalid_agent_token');
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = decoded;
    next();
}

// Agent login with JWT
app.post('/api/agent/login', (req, res) => {
    const { password } = req.body;
    const agentPass = process.env.AGENT_PASSWORD;

    if (!password) {
        return res.status(400).json({ error: 'Password required' });
    }
    if (!agentPass) return res.status(503).json({ error: 'Agent access not configured' });
    if (password !== agentPass) {
        trackSuspicious(req.ip, 'failed_agent_login');
        return res.status(401).json({ error: 'Invalid password' });
    }

    const token = generateToken({ role: 'agent', timestamp: Date.now() });
    res.json({ success: true, token });
});

// Agent — read-only request list
app.get('/api/agent/requests', authenticateAgent, async (req, res) => {
    try {
        const { status, type, search, page, limit } = req.query;
        const result = await getAllRequests({ status, type, search, page, limit });
        res.json({ requests: result.data, pagination: result.pagination });
    } catch (error) {
        console.error('Agent get requests error:', error);
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

// Agent — read-only stats
app.get('/api/agent/stats', authenticateAgent, async (req, res) => {
    try {
        const stats = await getRequestStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Agent — save notes on a request
app.post('/api/agent/save-notes', authenticateAgent, async (req, res) => {
    try {
        const { requestId, notes } = req.body;
        if (!requestId) return res.status(400).json({ error: 'requestId required' });
        await saveAgentNotes(requestId, notes || '');
        res.json({ success: true });
    } catch (error) {
        console.error('Agent save notes error:', error);
        res.status(500).json({ error: 'Failed to save notes' });
    }
});

// ==========================================================================

// Get all requests (admin)
app.get('/api/admin/requests', authenticateAdmin, async (req, res) => {
    try {
        const { status, type, date, search, page, limit } = req.query;

        const result = await getAllRequests({ status, type, date, search, page, limit });
        const stats = await getRequestStats();

        res.json({ requests: result.data, stats, pagination: result.pagination });
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

            if (!process.env.SHIPROCKET_EMAIL) {
                return res.status(400).json({ error: 'Shiprocket not configured on server' });
            }

            // Try to fetch Shopify order but don't block on failure —
            // createShiprocketReturnOrder will re-fetch it internally as well.
            let shopifyOrder = null;
            try {
                let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(requestDetails.orderNumber)}&status=any&limit=1`);
                // Fuzzy retry with/without '#'
                if (!shopifyData.orders || shopifyData.orders.length === 0) {
                    const alt = requestDetails.orderNumber.startsWith('#')
                        ? requestDetails.orderNumber.substring(1)
                        : '#' + requestDetails.orderNumber;
                    shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(alt)}&status=any&limit=1`);
                }
                shopifyOrder = shopifyData.orders && shopifyData.orders[0];
                if (!shopifyOrder) console.warn(`[${requestId}] Shopify order not found for ${requestDetails.orderNumber} — Shiprocket will use stored request data as fallback.`);
            } catch (err) {
                console.warn(`[${requestId}] Shopify fetch failed, proceeding with stored data:`, err.message);
            }

            try {
                const shiprocketData = await createShiprocketReturnOrder({
                    ...requestDetails,
                    requestId
                }, shopifyOrder); // passes null if not found — function handles internally

                if (shiprocketData && shiprocketData.shipment_id) {
                    updates.shipmentId = shiprocketData.shipment_id;
                    updates.awbNumber = shiprocketData.awb_code;
                    updates.pickupDate = shiprocketData.pickup_scheduled_date;
                    updates.status = 'scheduled';
                    updates.adminNotes = adminNotes + `\nPickup scheduled: AWB ${shiprocketData.awb_code || 'Pending'}`;

                    const request = await updateRequestStatus(requestId, updates);
                    return res.json({ success: true, message: 'Pickup initiated and status updated to scheduled', request });
                } else {
                    throw new Error('Shiprocket did not return shipment data');
                }
            } catch (srError) {
                console.error(`[${requestId}] Shiprocket initiation failed:`, srError);
                return res.status(500).json({ error: 'Failed to initiate Shiprocket pickup: ' + srError.message });
            }
        }

        // 2. Final Approval -> Quality Check Passed -> Process Resolution
        // Trigger Forward Shipment on Shiprocket only (no Shopify exchange order)
        if (requestDetails.type === 'exchange' && requestDetails.status !== 'approved') {
            console.log(`[${requestId}] Finalizing exchange resolution...`);

            // Create Shiprocket forward shipment (Shopify exchange order creation intentionally skipped)
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

// ── Admin: Manually create a request (bypasses eligibility + duplicate checks) ──
app.post('/api/admin/create-request', authenticateAdmin, async (req, res) => {
    const requestId = await generateUniqueRequestId();
    console.log(`[ADMIN CREATE] ${requestId} — Manual request creation started`);

    try {
        const { orderNumber, type, reason, comments, items, overrideExisting } = req.body;

        if (!orderNumber || !type || !reason) {
            return res.status(400).json({ error: 'orderNumber, type, and reason are required' });
        }
        if (!['return', 'exchange'].includes(type)) {
            return res.status(400).json({ error: 'type must be "return" or "exchange"' });
        }

        // ── Fetch order from Shopify ──────────────────────────────────────────
        const shopifyResponse = await fetch(
            `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/orders.json?name=${encodeURIComponent(orderNumber)}&status=any&fields=id,name,email,customer,line_items,fulfillment_status,fulfillments`,
            { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN } }
        );
        const shopifyData = await shopifyResponse.json();
        const order = shopifyData.orders && shopifyData.orders[0];
        if (!order) {
            return res.status(404).json({ error: `Order ${orderNumber} not found in Shopify` });
        }

        const customerName = order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : 'N/A';
        const customerEmail = order.customer ? order.customer.email : (order.email || '');
        const customerPhone = order.customer ? order.customer.phone : '';

        // ── Optional: block if active request already exists (unless overrideExisting=true) ──
        if (!overrideExisting) {
            const existing = await getRequestsByOrderNumber(order.name);
            const active = existing.filter(r => r.status !== 'rejected' && r.status !== 'waiting_payment');
            if (active.length > 0) {
                return res.status(409).json({
                    error: `Order already has an active request (${active[0].requestId}). Pass overrideExisting: true to create anyway.`,
                    existingRequestId: active[0].requestId
                });
            }
        }

        // ── Build items list ──────────────────────────────────────────────────
        let parsedItems = [];
        if (items && items.length > 0) {
            parsedItems = items;
        } else {
            // Default: use all line items from Shopify
            parsedItems = (order.line_items || []).map(li => ({
                name: li.title,
                variant: li.variant_title || 'Default',
                quantity: li.quantity,
                price: li.price,
                image: null,
                lineItemId: li.id
            }));
        }

        // ── Schedule pickup via Shiprocket ────────────────────────────────────
        let awbNumber = null, shipmentId = null, pickupDate = null;
        try {
            const shiprocketToken = await getShiprocketToken();
            if (shiprocketToken) {
                const pickupResult = await schedulePickup(shiprocketToken, requestId, order, parsedItems, type);
                if (pickupResult) {
                    awbNumber = pickupResult.awbNumber;
                    shipmentId = pickupResult.shipmentId;
                    pickupDate = pickupResult.pickupDate;
                }
            }
        } catch (srErr) {
            console.warn(`[ADMIN CREATE] Shiprocket booking failed (non-fatal):`, srErr.message);
        }

        // ── Insert into DB ────────────────────────────────────────────────────
        const shippingAddress = order.fulfillments && order.fulfillments[0] && order.fulfillments[0].destination
            ? `${order.fulfillments[0].destination.address1 || ''}, ${order.fulfillments[0].destination.city || ''} - ${order.fulfillments[0].destination.zip || ''}`
            : '';

        await createRequest({
            requestId,
            orderNumber: order.name,
            email: customerEmail,
            customerName,
            customerEmail,
            customerPhone,
            type,
            status: (awbNumber || shipmentId) ? 'scheduled' : 'pending',
            reason,
            comments: comments || '',
            items: parsedItems,
            shippingAddress,
            awbNumber,
            shipmentId,
            pickupDate,
            adminNotes: `Manually created by admin on ${new Date().toLocaleDateString('en-IN')}`
        });

        console.log(`[ADMIN CREATE] ${requestId} ✅ Created successfully (AWB: ${awbNumber || 'N/A'})`);

        res.json({
            success: true,
            requestId,
            awbNumber: awbNumber || null,
            pickupDate: pickupDate || null,
            status: (awbNumber || shipmentId) ? 'scheduled' : 'pending',
            message: `Request ${requestId} created successfully`
        });

    } catch (error) {
        console.error(`[ADMIN CREATE] Error:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

// ── Admin: Lookup order for manual request creation (no eligibility check) ──
app.post('/api/admin/lookup-order-force', authenticateAdmin, async (req, res) => {
    try {
        const { orderNumber } = req.body;
        if (!orderNumber) return res.status(400).json({ error: 'orderNumber required' });

        let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&status=any&fields=id,name,email,customer,line_items,fulfillment_status,fulfillments,financial_status`);

        if (!shopifyData.orders || shopifyData.orders.length === 0) {
            const retryOrderNumber = orderNumber.startsWith('#') ? orderNumber.substring(1) : '#' + orderNumber;
            shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(retryOrderNumber)}&status=any&fields=id,name,email,customer,line_items,fulfillment_status,fulfillments,financial_status`);
        }
        const order = shopifyData.orders && shopifyData.orders[0];

        if (!order) return res.status(404).json({ error: `Order ${orderNumber} not found` });

        // Check for existing active request
        const existingRequests = await getRequestsByOrderNumber(order.name);
        const active = existingRequests.filter(r => r.status !== 'rejected');

        res.json({
            found: true,
            order: {
                name: order.name,
                email: order.customer ? order.customer.email : order.email,
                customerName: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : 'N/A',
                customerPhone: order.customer ? order.customer.phone : '',
                fulfillmentStatus: order.fulfillment_status,
                lineItems: (order.line_items || []).map(li => ({
                    id: li.id,
                    name: li.title,
                    variant: li.variant_title || 'Default',
                    quantity: li.quantity,
                    price: li.price
                }))
            },
            existingRequests: active.map(r => ({ requestId: r.requestId, status: r.status, type: r.type }))
        });
    } catch (error) {
        console.error('Admin lookup-order-force error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ── Admin: Create Request manually (Bypass rules, overrides) ──
app.post('/api/admin/create-request', authenticateAdmin, async (req, res) => {
    try {
        const { orderNumber, type, reason, comments, items, overrideExisting } = req.body;

        if (!orderNumber || !type || !reason || !items || items.length === 0) {
            return res.status(400).json({ error: 'Missing required configuration (type, reason, items).' });
        }

        const requestId = await generateUniqueRequestId();

        // Fetch Order for full details
        let shopifyOrder = null;
        let originalAddressFormatted = '';
        try {
            let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderNumber)}&status=any&limit=1`);

            if (!shopifyData.orders || shopifyData.orders.length === 0) {
                const retryOrderNumber = orderNumber.startsWith('#') ? orderNumber.substring(1) : '#' + orderNumber;
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
            console.error(`[ADMIN CREATE] Failed to fetch Shopify order:`, err);
        }

        if (!shopifyOrder) return res.status(404).json({ error: 'Order not found in Shopify' });

        // Duplicate Guard
        const existingRequests = await getRequestsByOrderNumber(shopifyOrder.name);
        const active = existingRequests.filter(r => r.status !== 'rejected');

        if (active.length > 0 && !overrideExisting) {
            return res.status(409).json({
                error: `Order already has an active request (${active[0].requestId}). Check 'Override Existing Request' to proceed anyway.`
            });
        }

        const customerName = shopifyOrder.customer ? `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim() : 'Customer';
        const customerPhone = shopifyOrder.shipping_address?.phone || shopifyOrder.customer?.phone || '9999999999';
        const email = shopifyOrder.email || 'returns@offcomfort.com';

        const requestData = {
            requestId,
            orderNumber: shopifyOrder.name,
            email,
            customerEmail: email,
            customerName,
            customerPhone,
            items,
            images: [],
            reason,
            comments: comments || '',
            type,
            shippingAddress: originalAddressFormatted,
            status: 'pending', // Admins manually approve it on the dashboard subsequently
            paymentAmount: 0,
            paymentId: null,
            adminNotes: 'Manually created by Admin'
        };

        await createRequest(requestData);

        return res.json({
            success: true,
            requestId,
            status: 'pending'
        });

    } catch (error) {
        console.error('Admin create-request error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Sync Status Endpoint

app.post('/api/admin/sync-status', authenticateAdmin, async (req, res) => {
    try {
        // Get relevant statuses where shipment is active
        const allRequestsResult = await getAllRequests({});

        let activeRequests = allRequestsResult.data.filter(r =>
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
                        try {
                            trackingData = await shiprocketAPI(`/courier/track/awb/${req.awbNumber}`);
                        } catch (e) {
                            console.warn(`[Sync] AWB ${req.awbNumber} (${req.requestId}) fetch failed: ${e.message}`);
                            // Log issue directly into admin notes as requested
                            const note = `\n[Sync Log ${new Date().toLocaleDateString('en-IN')}] Tracking API error: ${e.message}`;
                            await updateRequestStatus(req.requestId, { adminNotes: (req.adminNotes || '') + note });
                            continue;
                        }
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
                            } else if (statusUpper.includes('PICKED UP') && !statusUpper.includes('GENERATED')) {
                                // Only mark as picked_up when the courier has ACTUALLY collected the parcel
                                newStatus = 'picked_up';
                            } else if (statusUpper.includes('IN TRANSIT') || statusUpper.includes('SHIPPED') || statusUpper.includes('OUT FOR DELIVERY')) {
                                newStatus = 'in_transit';
                            } else if (statusUpper.includes('SCHEDULED') || statusUpper.includes('GENERATED') || statusUpper.includes('AWB ASSIGNED') || statusUpper.includes('PICKUP GENERATED')) {
                                // PICKUP GENERATED = pickup request filed, item NOT yet with courier
                                newStatus = 'scheduled';
                            } else if (statusUpper.includes('RTO') || statusUpper.includes('REJECTED') || statusUpper.includes('CANCELLED')) {
                                // Record negative status directly into admin notes as requested
                                const note = `\n[Sync Log ${new Date().toLocaleDateString('en-IN')}] Shiprocket status: ${currentStatus}`;
                                if (!req.adminNotes || !req.adminNotes.includes(currentStatus)) {
                                    await updateRequestStatus(req.requestId, { adminNotes: (req.adminNotes || '') + note });
                                }
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
                            else if (currentStatus.includes('PICKED UP') && !currentStatus.includes('GENERATED')) newForwardStatus = 'picked_up';
                            else if (currentStatus.includes('IN TRANSIT') || currentStatus.includes('SHIPPED') || currentStatus.includes('OUT FOR DELIVERY')) newForwardStatus = 'in_transit';
                            else if (currentStatus.includes('PICKUP GENERATED') || currentStatus.includes('AWB ASSIGNED') || currentStatus.includes('SCHEDULED')) newForwardStatus = 'scheduled';

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

// Bulk Initiate Pickup (Admin)
app.post('/api/admin/bulk-initiate-pickup', authenticateAdmin, async (req, res) => {
    try {
        const { requestIds } = req.body;
        if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
            return res.status(400).json({ error: 'Invalid or missing request IDs' });
        }

        if (!process.env.SHIPROCKET_EMAIL) {
            return res.status(400).json({ error: 'Shiprocket not configured on server' });
        }

        const results = {
            total: requestIds.length,
            successful: [],
            failed: []
        };

        for (const requestId of requestIds) {
            try {
                const requestDetails = await getRequestById(requestId);
                if (!requestDetails) {
                    results.failed.push({ id: requestId, error: 'Request not found' });
                    continue;
                }

                if (requestDetails.status !== 'pending') {
                    results.failed.push({ id: requestId, error: `Invalid status: ${requestDetails.status}` });
                    continue;
                }

                console.log(`[${requestId}] Admin BULK authorized pickup. Initiating Shiprocket...`);

                let shopifyOrder = null;
                try {
                    let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(requestDetails.orderNumber)}&status=any&limit=1`);
                    if (!shopifyData.orders || shopifyData.orders.length === 0) {
                        const alt = requestDetails.orderNumber.startsWith('#')
                            ? requestDetails.orderNumber.substring(1)
                            : '#' + requestDetails.orderNumber;
                        shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(alt)}&status=any&limit=1`);
                    }
                    shopifyOrder = shopifyData.orders && shopifyData.orders[0];
                } catch (err) {
                    console.warn(`[${requestId}] Bulk Shopify fetch failed:`, err.message);
                }

                const shiprocketData = await createShiprocketReturnOrder({
                    ...requestDetails,
                    requestId
                }, shopifyOrder);

                if (shiprocketData && shiprocketData.shipment_id) {
                    let adminNotes = requestDetails.adminNotes || '';
                    adminNotes += `\nPickup scheduled (Bulk Action): AWB ${shiprocketData.awb_code || 'Pending'}`;

                    await updateRequestStatus(requestId, {
                        shipmentId: shiprocketData.shipment_id,
                        awbNumber: shiprocketData.awb_code,
                        pickupDate: shiprocketData.pickup_scheduled_date,
                        status: 'scheduled',
                        adminNotes
                    });

                    results.successful.push(requestId);
                } else {
                    throw new Error('Shiprocket did not return shipment data');
                }

            } catch (error) {
                console.error(`[${requestId}] Bulk initiate error:`, error.message);
                results.failed.push({ id: requestId, error: error.message });
            }
        }

        res.json({
            success: true,
            results,
            message: `Processed ${results.total} requests: ${results.successful.length} successful, ${results.failed.length} failed.`
        });

    } catch (error) {
        console.error('Bulk initiate pickup error:', error);
        res.status(500).json({ error: 'Internal server error while processing batch' });
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
            // Dedup guard: Razorpay often fires the same webhook twice simultaneously
            if (storage.processingPayments.has(paymentId)) {
                console.log(`[${requestId}] ⏭️ Webhook duplicate: payment ${paymentId} already being processed. Skipping.`);
            } else {
                storage.processingPayments.add(paymentId);
                console.log(`[${requestId}] 🛡️ Webhook Safety Net: Processing payment ${paymentId} (${amount})`);
                try {
                    await finalizeRequestAfterPayment(requestId, paymentId, amount);
                } finally {
                    storage.processingPayments.delete(paymentId);
                }
            }
        } else {
            console.log(`[Webhook] Payment ${paymentId} received but no requestId found in notes.`);
        }
    }

    res.json({ status: 'ok' });
});

// ==================== HEALTH CHECK ====================

app.get('/', (req, res) => {
    // Minimal health check - no sensitive information exposed
    res.json({
        service: 'Offcomfrt Returns & Exchanges',
        status: 'running',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// ==================== INFLUENCER ADMIN ENDPOINTS ====================

// List all influencers (Protected by Admin Auth)
app.get('/api/influencer-admin/list', authenticateAdmin, async (req, res) => {
    try {
        const influencers = await getAllInfluencers();
        res.json({ success: true, influencers });
    } catch (error) {
        console.error('List influencers error:', error);
        res.status(500).json({ error: 'Failed to fetch influencers' });
    }
});

// Add new influencer (Protected by Admin Auth)
app.post('/api/influencer-admin/add', authenticateAdmin, async (req, res) => {
    try {
        const { name, referralCode, commissionRate, phone } = req.body;
        if (!name || !referralCode) {
            return res.status(400).json({ error: 'Name and referral code are required' });
        }

        // Generate a secure unique token for the link
        const linkToken = crypto.randomBytes(16).toString('hex');

        const influencer = await createInfluencer({
            name,
            referralCode,
            linkToken,
            phone,
            commissionRate: commissionRate !== undefined ? parseFloat(commissionRate) : 10.00
        });
        res.json({ success: true, influencer });
    } catch (error) {
        console.error('Add influencer error:', error);
        res.status(500).json({ error: 'Failed to add influencer. Code might already exist.' });
    }
});

// Update influencer (Protected by Admin Auth)
app.patch('/api/influencer-admin/update/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, referralCode, commissionRate, phone } = req.body;
        const updated = await updateInfluencer(id, { name, referralCode, commissionRate, phone });
        res.json({ success: true, influencer: updated });
    } catch (error) {
        console.error('Update influencer error:', error);
        res.status(500).json({ error: 'Failed to update influencer' });
    }
});

// Remove influencer (Protected by Admin Auth)
app.delete('/api/influencer-admin/remove/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await deleteInfluencer(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove influencer error:', error);
        res.status(500).json({ error: 'Failed to remove influencer' });
    }
});

// ==================== INFLUENCER PORTAL ENDPOINTS ====================

// Verify Influencer Token & Get Profile
app.get('/api/influencer/auth/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const influencer = await getInfluencerByToken(token);

        if (!influencer) {
            return res.status(401).json({ error: 'Invalid or inactive influencer link' });
        }

        res.json({
            success: true,
            influencer: {
                name: influencer.name,
                referralCode: influencer.referral_code,
                hasPhone: !!influencer.phone
            }
        });
    } catch (error) {
        console.error('Influencer auth error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify Phone Number for Influencer Login
app.post('/api/influencer/verify', async (req, res) => {
    try {
        const { token, phone } = req.body;
        const influencer = await getInfluencerByToken(token);

        if (!influencer) {
            return res.status(401).json({ error: 'Invalid or inactive influencer link' });
        }

        // Match phone (clean non-digits for robust comparison)
        const cleanDbPhone = (influencer.phone || '').replace(/\D/g, '');
        const cleanInputPhone = (phone || '').replace(/\D/g, '');

        if (cleanInputPhone === cleanDbPhone && cleanDbPhone.length > 0) {
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Incorrect phone number. Please check and try again.' });
        }
    } catch (error) {
        console.error('Influencer verify error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Get Performance Stats for Influencer (with pagination + date range)
app.get('/api/influencer/stats/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { range } = req.query; // '30d', '90d', or 'all'

        const influencer = await getInfluencerByToken(token);

        if (!influencer) {
            return res.status(401).json({ error: 'Invalid or inactive influencer link' });
        }

        const referralCode = influencer.referral_code;
        const commissionRate = parseFloat(influencer.commission_rate || 10);
        console.log(`[Influencer Stats] Fetching stats for ${influencer.name} (Code: ${referralCode}, Range: ${range || 'all'})`);

        // Determine date cutoff based on range
        let createdAtMin = null;
        if (range === '30d') {
            const d = new Date();
            d.setDate(d.getDate() - 30);
            createdAtMin = d.toISOString();
        } else if (range === '90d') {
            const d = new Date();
            d.setDate(d.getDate() - 90);
            createdAtMin = d.toISOString();
        }

        // Paginated Shopify fetch — collects ALL matching orders, not just last 250
        let allOrders = [];
        let pageInfo = null;
        let hasNextPage = true;
        const baseQuery = `orders.json?status=paid&limit=250&fields=id,name,total_price,discount_codes,created_at,currency${createdAtMin ? '&created_at_min=' + encodeURIComponent(createdAtMin) : ''}`;
        let nextUrl = baseQuery;

        while (hasNextPage) {
            const shopifyData = await shopifyAPI(nextUrl);
            const batch = shopifyData.orders || [];
            allOrders = allOrders.concat(batch);

            // Shopify REST pagination via Link header (handled by shopifyAPI if it supports it)
            // If shopifyAPI returns a nextUrl cursor, use it; otherwise stop after one batch
            if (shopifyData.nextUrl && batch.length === 250) {
                nextUrl = shopifyData.nextUrl;
            } else if (batch.length === 250 && !createdAtMin) {
                // Try cursor-based: use page_info if available
                hasNextPage = false; // shopifyAPI does not expose page_info — stop safely
            } else {
                hasNextPage = false;
            }
        }

        // Filter orders by this influencer's discount code
        const attributedOrders = allOrders.filter(order => {
            if (!order.discount_codes || order.discount_codes.length === 0) return false;
            return order.discount_codes.some(dc => dc.code.toUpperCase() === referralCode.toUpperCase());
        });

        // Sort newest first
        attributedOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // Calculate Stats
        const totalRevenue = attributedOrders.reduce((sum, order) => sum + parseFloat(order.total_price), 0);
        const orderCount = attributedOrders.length;
        const aov = orderCount > 0 ? (totalRevenue / orderCount) : 0;
        const estimatedEarnings = totalRevenue * (commissionRate / 100);

        // Anonymize orders for the portal feed (most recent 20)
        const recentConversions = attributedOrders.slice(0, 20).map(order => ({
            id: order.id,
            name: order.name,
            total: order.total_price,
            currency: order.currency,
            date: order.created_at
        }));

        res.json({
            success: true,
            stats: {
                totalRevenue: totalRevenue.toFixed(2),
                orderCount,
                aov: aov.toFixed(2),
                estimatedEarnings: estimatedEarnings.toFixed(2),
                commissionRate,
                currency: attributedOrders[0]?.currency || 'INR'
            },
            recentConversions
        });

    } catch (error) {
        console.error('Influencer stats error:', error);
        res.status(500).json({ error: 'Failed to fetch performance data' });
    }
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler - Sanitized for production
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', { 
        message: err.message, 
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip
    });
    
    // Don't expose error details in production
    const response = { error: 'Internal server error' };
    if (!isProduction) {
        response.details = err.message;
    }
    
    res.status(500).json(response);
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
