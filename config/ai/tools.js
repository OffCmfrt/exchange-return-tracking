/**
 * AI Copilot tool registry (exchange-return-tracking system).
 *
 * Server-internal functions (shopifyAPI, schedulePickup, getDelhiveryTracking,
 * createShopifyDiscountCode, getLeaderboard, getAnalyticsForInfluencer,
 * getShiprocketToken) are not exported from server.js, so they are injected via
 * ctx.deps at execution time (see server.js AI route wiring).
 *
 * Tools marked requiresConfirmation are NEVER executed by the agent loop; they
 * become pending actions and run only after an explicit admin confirm.
 */

const axios = require('axios');
const dbHelpers = require('../db-helpers');
const marketingDB = require('../marketing-db-helpers');
const supabase = require('../supabase');

const MAX_ROWS = 100;

const SQL_BLOCKLIST = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|do|call|execute|prepare|listen|notify|set|reset|comment|refresh|reindex|cluster|lock|merge)\b/i;

function validateReadOnlySql(sql) {
    if (!sql || typeof sql !== 'string') return 'SQL query is required';
    const trimmed = sql.trim();
    if (trimmed.includes(';')) return 'Multiple statements / semicolons are not allowed';
    const noComments = trimmed.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!/^(select|with)\b/i.test(noComments)) return 'Only SELECT queries are allowed';
    if (SQL_BLOCKLIST.test(noComments)) return 'Query contains a blocked keyword — only read-only SELECT queries are allowed';
    return null;
}

const tools = [
    {
        name: 'get_request',
        description: 'Get a single return/exchange request by its request ID (e.g. REQ-12345). Returns full details, status, items, customer, tracking AWB.',
        parameters: {
            type: 'object',
            properties: { requestId: { type: 'string', description: 'Request ID like REQ-12345' } },
            required: ['requestId']
        },
        requiresConfirmation: false,
        async execute({ requestId }) {
            const req = await dbHelpers.getRequestById(requestId);
            if (!req) return { error: `Request ${requestId} not found` };
            return req;
        }
    },
    {
        name: 'search_requests',
        description: 'Search/list return-exchange requests. Filter by status, type (return/exchange), a free-text search (order number, customer name/email/phone), or carrier. Returns up to 50.',
        parameters: {
            type: 'object',
            properties: {
                status: { type: 'string', description: 'e.g. pending, approved, rejected, pickup_pending, scheduled, waiting_payment' },
                type: { type: 'string', enum: ['return', 'exchange'], description: 'Request type' },
                search: { type: 'string', description: 'Order number, customer name, email or phone fragment' },
                carrier: { type: 'string', description: 'Carrier filter (delhivery/shiprocket)' },
                limit: { type: 'integer', description: 'Max rows (default 25, max 50)' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ status, type, search, carrier, limit }) {
            const result = await dbHelpers.getAllRequests({
                status, type, search, carrier,
                limit: Math.min(parseInt(limit) || 25, 50),
                page: 1
            });
            return { count: result.data.length, total: result.pagination?.total, requests: result.data };
        }
    },
    {
        name: 'get_request_stats',
        description: 'Get aggregate return/exchange request statistics: totals by status (pending, approved, rejected, pickup pending, scheduled, waiting payment, etc).',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresConfirmation: false,
        async execute() {
            return await dbHelpers.getRequestStats();
        }
    },
    {
        name: 'update_request_status',
        description: 'Update a return/exchange request status (e.g. approved, rejected). Optionally set admin notes. Requires admin confirmation.',
        parameters: {
            type: 'object',
            properties: {
                requestId: { type: 'string', description: 'Request ID like REQ-12345' },
                status: { type: 'string', description: 'New status: approved, rejected, pickup_pending, scheduled, completed, etc.' },
                adminNotes: { type: 'string', description: 'Optional admin note' }
            },
            required: ['requestId', 'status']
        },
        requiresConfirmation: true,
        summary: (a) => `Set request ${a.requestId} status to "${a.status}"${a.adminNotes ? ' with a note' : ''}`,
        async execute({ requestId, status, adminNotes }) {
            const existing = await dbHelpers.getRequestById(requestId);
            if (!existing) throw new Error(`Request ${requestId} not found`);
            const updates = { status };
            if (adminNotes) updates.adminNotes = adminNotes;
            const updated = await dbHelpers.updateRequestStatus(requestId, updates);
            return { requestId, previousStatus: existing.status, newStatus: status, ok: true, updated: updated ? true : false };
        }
    },
    {
        name: 'book_return_pickup',
        description: 'Schedule a reverse (return) pickup for a request via the configured carrier (Shiprocket/Delhivery). Fetches the Shopify order automatically. Requires admin confirmation.',
        parameters: {
            type: 'object',
            properties: {
                requestId: { type: 'string', description: 'Request ID like REQ-12345' },
                carrier: { type: 'string', enum: ['delhivery', 'shiprocket'], description: 'Optional carrier override' }
            },
            required: ['requestId']
        },
        requiresConfirmation: true,
        summary: (a) => `Book a return pickup for request ${a.requestId}${a.carrier ? ` via ${a.carrier}` : ''}`,
        async execute({ requestId, carrier }, ctx) {
            const deps = ctx.deps || {};
            const request = await dbHelpers.getRequestById(requestId);
            if (!request) throw new Error(`Request ${requestId} not found`);

            const shopifyAPI = deps.shopifyAPI;
            const schedulePickup = deps.schedulePickup;
            const getShiprocketToken = deps.getShiprocketToken;
            if (!shopifyAPI || !schedulePickup) throw new Error('Pickup scheduling is not available in this context');

            const orderName = request.orderNumber || request.order_number;
            const data = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderName)}&status=any&fields=id,name,email,customer,line_items`);
            const order = data.orders && data.orders[0];
            if (!order) throw new Error(`Shopify order ${orderName} not found`);

            const items = Array.isArray(request.items) && request.items.length
                ? request.items
                : (order.line_items || []).map(li => ({ name: li.title, variant: li.variant_title || 'Default', quantity: li.quantity, price: li.price, lineItemId: li.id }));

            const token = getShiprocketToken ? await getShiprocketToken() : null;
            const result = await schedulePickup(token, requestId, order, items, request.type || 'return', carrier || null);
            if (!result) throw new Error('Carrier did not return a pickup result');
            return {
                requestId,
                awb: result.awbNumber,
                shipmentId: result.shipmentId,
                pickupDate: result.pickupDate,
                carrier: result.carrier,
                fallbackReason: result.fallbackReason || null
            };
        }
    },
    {
        name: 'track_shipment',
        description: 'Track a shipment by AWB / waybill number (Delhivery). Returns the normalized tracking timeline and current status.',
        parameters: {
            type: 'object',
            properties: { awb: { type: 'string', description: 'AWB / waybill number' } },
            required: ['awb']
        },
        requiresConfirmation: false,
        async execute({ awb }, ctx) {
            const getDelhiveryTracking = (ctx.deps || {}).getDelhiveryTracking;
            if (!getDelhiveryTracking) throw new Error('Tracking is not available in this context');
            const data = await getDelhiveryTracking(awb);
            if (!data) return { error: `No tracking data found for AWB ${awb}` };
            return { awb, tracking: data };
        }
    },
    {
        name: 'shopify_search_orders',
        description: 'Search Shopify orders by order name/number (e.g. #1234) or list recent orders. Returns live Shopify Admin API data.',
        parameters: {
            type: 'object',
            properties: {
                orderName: { type: 'string', description: 'Order name like #1234 (omit to list recent)' },
                limit: { type: 'integer', description: 'Max orders when listing recent (default 10, max 25)' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ orderName, limit }, ctx) {
            const shopifyAPI = (ctx.deps || {}).shopifyAPI;
            if (!shopifyAPI) throw new Error('Shopify is not available in this context');
            const fields = 'id,name,created_at,total_price,currency,financial_status,fulfillment_status,customer,line_items';
            let endpoint;
            if (orderName) {
                endpoint = `orders.json?name=${encodeURIComponent(String(orderName).replace(/^#/, ''))}&status=any&fields=${fields}`;
            } else {
                endpoint = `orders.json?status=any&limit=${Math.min(parseInt(limit) || 10, 25)}&fields=${fields}`;
            }
            const data = await shopifyAPI(endpoint);
            const orders = (data.orders || []).map(o => ({
                id: o.id, name: o.name, createdAt: o.created_at, total: o.total_price, currency: o.currency,
                financialStatus: o.financial_status, fulfillmentStatus: o.fulfillment_status,
                customer: o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : null,
                phone: o.customer?.phone || null,
                items: (o.line_items || []).map(li => `${li.title} x${li.quantity}`)
            }));
            return { count: orders.length, orders };
        }
    },
    {
        name: 'get_leaderboard',
        description: 'Get the influencer leaderboard (top influencers by performance). Range can be all, month, week.',
        parameters: {
            type: 'object',
            properties: {
                range: { type: 'string', enum: ['all', 'month', 'week'], description: 'Time range (default all)' },
                limit: { type: 'integer', description: 'Top N (default 10, max 25)' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ range, limit }, ctx) {
            const getLeaderboard = (ctx.deps || {}).getLeaderboard;
            if (!getLeaderboard) throw new Error('Leaderboard is not available in this context');
            const rows = await getLeaderboard(range || 'all', Math.min(parseInt(limit) || 10, 25));
            return { count: (rows || []).length, leaderboard: rows };
        }
    },
    {
        name: 'get_influencer_stats',
        description: 'Get performance analytics for a single influencer by their internal ID. Returns orders, revenue, commission for a time range.',
        parameters: {
            type: 'object',
            properties: {
                influencerId: { type: 'string', description: 'Influencer internal ID' },
                range: { type: 'string', enum: ['all', 'month', 'week'], description: 'Time range (default all)' }
            },
            required: ['influencerId']
        },
        requiresConfirmation: false,
        async execute({ influencerId, range }, ctx) {
            const getAnalyticsForInfluencer = (ctx.deps || {}).getAnalyticsForInfluencer;
            const influencer = await dbHelpers.getInfluencerById(influencerId);
            if (!influencer) throw new Error(`Influencer ${influencerId} not found`);
            if (!getAnalyticsForInfluencer) return { influencer };
            const analytics = await getAnalyticsForInfluencer(influencer, range || 'all');
            return { influencer: { id: influencer.id, name: influencer.name, referralCode: influencer.referral_code || influencer.referralCode }, analytics };
        }
    },
    {
        name: 'list_influencers',
        description: 'List all influencers (name, referral code, status). Optionally filter to only pending applications.',
        parameters: {
            type: 'object',
            properties: { pendingOnly: { type: 'boolean', description: 'If true, only pending influencer applications' } },
            required: []
        },
        requiresConfirmation: false,
        async execute({ pendingOnly }) {
            const rows = pendingOnly ? await dbHelpers.listPendingInfluencers() : await dbHelpers.getAllInfluencers();
            const list = (rows || []).slice(0, MAX_ROWS).map(i => ({
                id: i.id, name: i.name, email: i.email, phone: i.phone,
                referralCode: i.referral_code || i.referralCode, status: i.status
            }));
            return { count: list.length, influencers: list };
        }
    },
    {
        name: 'get_marketing_stats',
        description: 'Get marketing dashboard customer statistics (total customers, segments, tiers, revenue) and campaign counts.',
        parameters: { type: 'object', properties: {}, required: [] },
        requiresConfirmation: false,
        async execute() {
            const [customerStats, campaigns] = await Promise.all([
                marketingDB.getCustomerStats().catch(() => null),
                marketingDB.getMarketingCampaigns({ limit: 1 }).catch(() => null)
            ]);
            return { customerStats, totalCampaigns: campaigns?.pagination?.total || 0 };
        }
    },
    {
        name: 'get_campaign_stats',
        description: 'List marketing campaigns with their status and metrics. Optionally filter by status.',
        parameters: {
            type: 'object',
            properties: {
                status: { type: 'string', description: 'Filter by campaign status (draft, active, completed)' },
                limit: { type: 'integer', description: 'Max campaigns (default 20, max 50)' }
            },
            required: []
        },
        requiresConfirmation: false,
        async execute({ status, limit }) {
            const result = await marketingDB.getMarketingCampaigns({ status, limit: Math.min(parseInt(limit) || 20, 50), page: 1 });
            return { count: result.data.length, total: result.pagination?.total, campaigns: result.data };
        }
    },
    {
        name: 'create_discount_code',
        description: 'Create a Shopify discount code (percentage or fixed amount). Requires admin confirmation.',
        parameters: {
            type: 'object',
            properties: {
                code: { type: 'string', description: 'Discount code text, e.g. WELCOME10' },
                value: { type: 'number', description: 'Discount value (e.g. 10 for 10% or ₹10)' },
                valueType: { type: 'string', enum: ['percentage', 'fixed_amount'], description: 'Type of discount' },
                usageLimit: { type: 'integer', description: 'Optional total usage limit' },
                title: { type: 'string', description: 'Optional internal title' }
            },
            required: ['code', 'value', 'valueType']
        },
        requiresConfirmation: true,
        summary: (a) => `Create Shopify discount code "${a.code}" — ${a.value}${a.valueType === 'percentage' ? '%' : ' off'}${a.usageLimit ? `, limit ${a.usageLimit}` : ''}`,
        async execute({ code, value, valueType, usageLimit, title }, ctx) {
            const createShopifyDiscountCode = (ctx.deps || {}).createShopifyDiscountCode;
            if (!createShopifyDiscountCode) throw new Error('Discount creation is not available in this context');
            const result = await createShopifyDiscountCode(code, value, valueType, usageLimit || null, title || code);
            return { created: true, ...result };
        }
    },
    {
        name: 'send_marketing_message',
        description: 'Send a WhatsApp template message to a customer via Meta Cloud API. Requires admin confirmation. Template must already be approved in Meta.',
        parameters: {
            type: 'object',
            properties: {
                phone: { type: 'string', description: 'Customer phone (with or without country code)' },
                templateName: { type: 'string', description: 'Approved Meta template name' },
                parameters: { type: 'array', items: { type: 'string' }, description: 'Ordered template body parameters' },
                language: { type: 'string', description: 'Template language code (default en)' }
            },
            required: ['phone', 'templateName']
        },
        requiresConfirmation: true,
        summary: (a) => `Send WhatsApp template "${a.templateName}" to ${a.phone}`,
        async execute({ phone, templateName, parameters, language }) {
            const metaWhatsApp = require('../meta-whatsapp');
            const result = await metaWhatsApp.sendTemplateMessage(phone, templateName, parameters || [], language || 'en');
            return { sent: true, result };
        }
    },
    {
        name: 'query_whatsapp_bot',
        description: 'Query the WhatsApp bot system (separate server) for support tickets, WhatsApp messages, abandoned carts, customers or stats. Use this to answer questions about customer chats/tickets.',
        parameters: {
            type: 'object',
            properties: {
                resource: { type: 'string', enum: ['stats', 'tickets', 'messages', 'carts', 'customers'], description: 'What to fetch from the WhatsApp bot' },
                query: { type: 'string', description: 'Optional filter: phone for messages, search text for tickets/customers, status for carts' },
                limit: { type: 'integer', description: 'Max rows (default 20, max 50)' }
            },
            required: ['resource']
        },
        requiresConfirmation: false,
        async execute({ resource, query, limit }) {
            const baseUrl = process.env.WHATSAPP_BOT_URL || process.env.WHATSAPP_BOT_API_URL;
            const token = process.env.WHATSAPP_INTERNAL_TOKEN;
            if (!baseUrl) throw new Error('WHATSAPP_BOT_URL is not configured on this server');
            const response = await axios.get(`${baseUrl.replace(/\/$/, '')}/api/internal/ai-data`, {
                params: { resource, query: query || '', limit: Math.min(parseInt(limit) || 20, 50) },
                headers: { 'x-internal-token': token || '' },
                timeout: 15000
            });
            return response.data;
        }
    },
    {
        name: 'run_sql_read',
        description: 'Run a read-only SQL SELECT against the returns/marketing database via Supabase RPC. Key tables: requests, influencers, shipments, payouts, reel_targets, product_requests, marketing_customers, marketing_campaigns, marketing_templates, store_settings. Only SELECT allowed; capped at 100 rows. Requires the exec_read_sql RPC to be installed (see migration).',
        parameters: {
            type: 'object',
            properties: { sql: { type: 'string', description: 'A single SELECT statement (no semicolons)' } },
            required: ['sql']
        },
        requiresConfirmation: false,
        async execute({ sql }) {
            const validationError = validateReadOnlySql(sql);
            if (validationError) throw new Error(validationError);
            const wrapped = `SELECT * FROM (${sql.trim()}) AS ai_sub LIMIT ${MAX_ROWS}`;
            const { data, error } = await supabase.rpc('exec_read_sql', { query: wrapped });
            if (error) throw new Error(`SQL error: ${error.message}. (Ensure the exec_read_sql RPC is installed from the AI migration.)`);
            const rows = Array.isArray(data) ? data.slice(0, MAX_ROWS) : data;
            return { rowCount: Array.isArray(rows) ? rows.length : 0, rows, truncatedAt: MAX_ROWS };
        }
    }
];

const toolMap = new Map(tools.map(t => [t.name, t]));

function getTool(name) {
    return toolMap.get(name) || null;
}

function getToolSchemas() {
    return tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
}

function summarizeTool(name, args) {
    const tool = getTool(name);
    if (!tool) return name;
    if (typeof tool.summary === 'function') {
        try { return tool.summary(args || {}); } catch { return name; }
    }
    return `${name}(${JSON.stringify(args || {})})`;
}

module.exports = { tools, getTool, getToolSchemas, summarizeTool, validateReadOnlySql };
