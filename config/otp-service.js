// ============================================================================
// Phone OTP Login Service (Renflair / Message Central VerifyNow + Shopify
// classic accounts)
//
// Providers (first configured wins):
//   1. Renflair (sms.renflair.in) - we generate the OTP locally, Renflair
//      only delivers it: GET /V1.php?API={key}&PHONE={phone}&OTP={otp}
//      -> { status: "SUCCESS" }. Verify compares against our own store.
//   2. Message Central VerifyNow (cpaas.messagecentral.com) - they generate
//      and verify the OTP; automatic fallback when RENFLAIR_API_KEY is unset.
//   Both routes deliver in India WITHOUT DLT registration. (MSG91 and
//   2factor.in were dropped: their local SMS routes require paid DLT
//   registration before any SMS delivers in India.)
//
// VerifyNow API contract (v3, per the official onboarding guide):
//   send:   POST /verification/v3/send?countryCode=91&customerId&flowType=SMS&type=OTP&mobileNumber&otpLength
//   verify: GET  /verification/v3/validateOtp?verificationId&code&flowType=SMS&customerId
//   Auth: the authToken is issued by the Message Central console
//   (Developer Guide > API Credentials) and used verbatim via MC_AUTH_TOKEN.
//   Optional fallback: MC_PASSWORD + MC_ACCOUNT_EMAIL fetch a token via
//   POST /auth/v1/authentication/token.
//
// Flow:
//   1. /api/auth/otp/send   -> VerifyNow sends the OTP
//                              (dev mode: logs to console when unconfigured)
//   2. /api/auth/otp/verify -> VerifyNow validateOtp checks the OTP, then:
//        a. Find Shopify customer by phone (Admin API) - create if missing.
//           Phone-only customers get an email resolved from real sources
//           (Shopify order checkout emails -> local DB requests/abandoned
//           carts) before falling back to a synthetic <phone>@<store> email.
//        b. For NEW or DISABLED accounts: generate activation URL, activate
//           server-side, return {action, email, password} for theme to submit
//           to /account/login (same-origin -> Shopify issues session cookie).
//        c. For ENABLED accounts (re-login): use Storefront API to create a
//           customerAccessToken directly, returning {accessToken, redirect}
//           so the theme can set the session cookie via JS.
//
// Note: The Storefront API approach for enabled accounts means OTP login
// works every time, regardless of whether the account has been activated
// before. No more "already_active" errors blocking re-login.
//
// Env vars:
//   SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN      (already present)
//   RENFLAIR_API_KEY                         (Renflair panel key; enables
//                                             Renflair as primary provider)
//   RENFLAIR_BASE_URL                        (optional override)
//   MC_CUSTOMER_ID                           (Message Central console)
//   MC_AUTH_TOKEN                            (console > Developer Guide >
//                                             API Credentials > Auth Token)
//   MC_PASSWORD / MC_ACCOUNT_EMAIL           (optional fallback: fetch a token
//                                             at runtime instead of using the
//                                             static one from the console)
//   MC_BASE_URL                              (optional override)
//   OTP_CUSTOMER_EMAIL_DOMAIN                (optional; domain for synthetic
//                                             emails of new phone-only accounts,
//                                             defaults to SHOPIFY_STORE)
// ============================================================================

const crypto = require('crypto');
const shopperHubDb = require('./shopper-hub-db');

const SHOPIFY_API_VERSION = '2024-01';
const STOREFRONT_USER_AGENT = 'Mozilla/5.0 (compatible; OFFCOMFRT-OTP/1.0)';

const OTP_LENGTH = 6;                        // digits (VerifyNow generates its own; Renflair mode locally)
const OTP_TTL_MS = 5 * 60 * 1000;            // OTP valid for 5 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;    // 1 minute between sends
const OTP_MAX_SENDS_PER_HOUR = 3;            // per phone number
const OTP_MAX_VERIFY_ATTEMPTS = 5;           // before the OTP is invalidated

// In-memory OTP session store: phone -> session record.
// OTPs are short-lived so in-memory storage is fine for a single Render instance.
const otpStore = new Map();

// Prune expired entries so the Map doesn't grow unbounded
setInterval(() => {
    const now = Date.now();
    for (const [phone, record] of otpStore) {
        // Drop records whose OTP expired AND whose send history fully aged out
        const recentSends = record.sendTimes.filter(ts => now - ts < 60 * 60 * 1000);
        if (record.expiresAt < now && recentSends.length === 0) {
            otpStore.delete(phone);
        } else {
            record.sendTimes = recentSends;
        }
    }
}, 10 * 60 * 1000).unref();

// Structured error so routes can map codes -> HTTP statuses
class OtpError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

// ------------------------------ helpers -------------------------------------

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Normalize user input to a 12-digit Indian number with country code
 * (e.g. "98765 43210", "09876543210", "+91 9876543210" -> "919876543210").
 * Returns null when the input is not a valid Indian mobile.
 */
function normalizeIndianPhone(input) {
    if (!input) return null;
    const cleaned = String(input).replace(/[^\d]/g, '');
    let digits = null;
    if (cleaned.length === 10) {
        digits = '91' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
        digits = '91' + cleaned.substring(1);
    } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
        digits = cleaned;
    }
    if (!digits) return null;
    // Indian mobiles start with 6-9 after the country code
    if (!/^[6-9]/.test(digits.substring(2))) return null;
    return digits;
}

function isVerifyNowConfigured() {
    return !!(process.env.MC_CUSTOMER_ID &&
        (process.env.MC_AUTH_TOKEN || (process.env.MC_PASSWORD && process.env.MC_ACCOUNT_EMAIL)));
}

function mcBase() {
    return process.env.MC_BASE_URL || 'https://cpaas.messagecentral.com';
}

function isRenflairConfigured() {
    return !!process.env.RENFLAIR_API_KEY;
}

function renflairBase() {
    return process.env.RENFLAIR_BASE_URL || 'https://sms.renflair.in';
}

// ------------------------------ Renflair -------------------------------------

// Renflair only delivers the SMS; we generate and verify the OTP ourselves.
// Their V1.php takes the OTP in the query string and answers
// { status: "SUCCESS" }. The phone format isn't documented, so try the
// 10-digit form first and the 91-prefixed form second - both attempts are
// logged, so a format rejection is diagnosable in a single request.
async function sendRenflairSms(phone, otp) {
    let lastBody = null;
    for (const phoneFormat of [phone.substring(2), phone]) {
        const url = `${renflairBase()}/V1.php?API=${encodeURIComponent(process.env.RENFLAIR_API_KEY)}` +
            `&PHONE=${encodeURIComponent(phoneFormat)}&OTP=${encodeURIComponent(otp)}`;
        let response;
        try {
            response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        } catch (err) {
            console.error(`[OTP] Renflair send request failed (PHONE=${phoneFormat}):`, err.message);
            continue;
        }
        let data = null;
        try { data = await response.json(); } catch { /* non-JSON response */ }
        lastBody = data;
        console.log(`[OTP] Renflair send response (PHONE=${phoneFormat}) | status: ${response.status} | body: ${JSON.stringify(data)}`);
        if (response.status === 200 && data && String(data.status).toUpperCase() === 'SUCCESS') {
            return true;
        }
    }
    console.error(`[OTP] Renflair send failed for +${phone} | last body: ${JSON.stringify(lastBody)}`);
    return false;
}

// ------------------------------ Message Central ------------------------------

// VerifyNow auth tokens are JWTs valid for days; cache and refresh on expiry
// so every OTP send doesn't burn an extra token call.
let cachedToken = { value: null, expiresAt: 0 };

async function getAuthToken(forceRefresh = false) {
    // Preferred: the long-lived token issued by the console (API Credentials
    // page). No password exchange needed.
    if (process.env.MC_AUTH_TOKEN) {
        return process.env.MC_AUTH_TOKEN;
    }

    const now = Date.now();
    if (!forceRefresh && cachedToken.value && cachedToken.expiresAt > now) {
        return cachedToken.value;
    }

    const params = new URLSearchParams({
        customerId: process.env.MC_CUSTOMER_ID,
        key: Buffer.from(process.env.MC_PASSWORD).toString('base64'),
        scope: 'NEW',
        country: '91',
        email: process.env.MC_ACCOUNT_EMAIL
    });

    let response;
    try {
        response = await fetch(`${mcBase()}/auth/v1/authentication/token?${params.toString()}`, {
            method: 'POST',
            signal: AbortSignal.timeout(15000)
        });
    } catch (err) {
        console.error('[OTP] VerifyNow token request failed:', err.message);
        throw new OtpError('provider_error', 'Could not send OTP right now. Please try again.', 502);
    }

    let data = null;
    try { data = await response.json(); } catch { /* non-JSON response */ }
    const token = data?.data?.authToken || data?.authToken || null;

    if (response.status !== 200 || !token) {
        console.error('[OTP] VerifyNow token rejected:', response.status, JSON.stringify(data));
        throw new OtpError('provider_error', 'Could not send OTP right now. Please try again.', 502);
    }

    // Tokens last days server-side; refresh daily to stay safely inside
    cachedToken = { value: token, expiresAt: now + 20 * 60 * 60 * 1000 };
    return token;
}

async function sendOtp(phone) {
    const now = Date.now();
    const existing = otpStore.get(phone);

    if (existing) {
        if (existing.cooldownUntil > now) {
            const retryInSeconds = Math.ceil((existing.cooldownUntil - now) / 1000);
            throw new OtpError('resend_too_soon', `Please wait ${retryInSeconds}s before requesting another OTP`, 429);
        }
        const sendsLastHour = existing.sendTimes.filter(ts => now - ts < 60 * 60 * 1000);
        if (sendsLastHour.length >= OTP_MAX_SENDS_PER_HOUR) {
            throw new OtpError('send_limit', 'Too many OTP requests for this number. Try again after an hour.', 429);
        }
    }

    let sessionId = null;
    let devOtp = null;

    const provider = isRenflairConfigured() ? 'renflair'
        : isVerifyNowConfigured() ? 'verifynow' : 'dev';
    console.log(`[OTP] send request for +${phone} | provider: ${provider}`);

    if (provider === 'renflair') {
        // We generate the OTP; Renflair only delivers the SMS. Verification
        // later compares against our own store (same as dev mode).
        devOtp = String(crypto.randomInt(100000, 1000000));
        if (!await sendRenflairSms(phone, devOtp)) {
            throw new OtpError('provider_error', 'Could not send OTP right now. Please try again.', 502);
        }
        console.log(`[OTP] Renflair accepted send for +${phone}`);
    } else if (provider === 'verifynow') {
        // VerifyNow generates the OTP itself and returns a verificationId
        // that validateOtp needs later. mobileNumber is sent WITHOUT the
        // country code (countryCode is a separate param).
        const params = new URLSearchParams({
            countryCode: '91',
            customerId: process.env.MC_CUSTOMER_ID,
            flowType: 'SMS',
            type: 'OTP',
            mobileNumber: phone.substring(2),
            otpLength: String(OTP_LENGTH)
        });
        const url = `${mcBase()}/verification/v3/send?${params.toString()}`;

        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { authToken: await getAuthToken() },
                signal: AbortSignal.timeout(15000)
            });
        } catch (err) {
            console.error('[OTP] VerifyNow send request failed:', err.message);
            throw new OtpError('provider_error', 'Could not send OTP right now. Please try again.', 502);
        }

        let data = null;
        try { data = await response.json(); } catch { /* non-JSON response */ }

        // Token expired mid-flight (password-mode only - a static console
        // token can't be refreshed): fetch a fresh one and retry the send
        if ((response.status === 401 || response.status === 403) && !process.env.MC_AUTH_TOKEN) {
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: { authToken: await getAuthToken(true) },
                    signal: AbortSignal.timeout(15000)
                });
                try { data = await response.json(); } catch { /* non-JSON */ }
            } catch (err) {
                console.error('[OTP] VerifyNow send retry failed:', err.message);
                throw new OtpError('provider_error', 'Could not send OTP right now. Please try again.', 502);
            }
        }

        const ok = response.status === 200 && !!data && data.message === 'SUCCESS' && data.data?.verificationId;
        if (!ok) {
            console.error('[OTP] VerifyNow send failed:', response.status, JSON.stringify(data));
            throw new OtpError('provider_error', 'Could not send OTP right now. Please try again.', 502);
        }
        sessionId = data.data.verificationId;
        console.log(`[OTP] VerifyNow accepted send for +${phone} | verificationId: ${sessionId}`);
    } else {
        // Dev mode: no VerifyNow credentials - generate the OTP locally and log it.
        devOtp = String(Math.floor(100000 + Math.random() * 900000));
        console.log(`[OTP][DEV] OTP for +${phone}: ${devOtp}`);
    }

    const record = existing || { sendTimes: [], attempts: 0 };
    record.sessionId = sessionId;
    record.otpHash = devOtp ? sha256(devOtp) : null;
    record.expiresAt = now + OTP_TTL_MS;
    record.cooldownUntil = now + OTP_RESEND_COOLDOWN_MS;
    record.attempts = 0;
    record.sendTimes = [...(record.sendTimes || []), now];
    otpStore.set(phone, record);

    return {
        via: provider,
        expiresInSeconds: Math.round(OTP_TTL_MS / 1000),
        resendInSeconds: Math.round(OTP_RESEND_COOLDOWN_MS / 1000),
        // Only expose the code in dev mode - in Renflair mode the OTP went
        // out by SMS and must never appear in the API response.
        devOtp: provider === 'dev' && devOtp && process.env.NODE_ENV !== 'production' ? devOtp : undefined
    };
}

async function verifyOtp(phone, otp) {
    const now = Date.now();
    const record = otpStore.get(phone);

    if (!record || record.expiresAt < now) {
        throw new OtpError('otp_expired', 'OTP expired. Please request a new one.', 410);
    }
    if (record.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
        otpStore.delete(phone);
        throw new OtpError('otp_locked', 'Too many incorrect attempts. Please request a new OTP.', 429);
    }
    record.attempts += 1;

    let ok = false;

    const provider = isRenflairConfigured() ? 'renflair'
        : isVerifyNowConfigured() ? 'verifynow' : 'dev';

    if (provider === 'verifynow') {
        if (!record.sessionId) {
            throw new OtpError('otp_expired', 'OTP expired. Please request a new one.', 410);
        }

        // validateOtp (v3): verificationId from the send call + the user's
        // code. NOTE: the guide labels this POST but its own cURL is a bare
        // GET - GET is what the endpoint accepts (POST returns 401).
        const params = new URLSearchParams({
            verificationId: record.sessionId,
            code: String(otp),
            flowType: 'SMS',
            customerId: process.env.MC_CUSTOMER_ID
        });
        const url = `${mcBase()}/verification/v3/validateOtp?${params.toString()}`;

        let response;
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: { authToken: await getAuthToken() },
                signal: AbortSignal.timeout(15000)
            });
        } catch (err) {
            console.error('[OTP] VerifyNow verify request failed:', err.message);
            throw new OtpError('provider_error', 'Could not verify OTP right now. Please try again.', 502);
        }

        let data = null;
        try { data = await response.json(); } catch { /* non-JSON response */ }
        ok = response.status === 200 && !!data &&
            data.data?.verificationStatus === 'VERIFICATION_COMPLETED';

        console.log(`[OTP] VerifyNow verify response for +${phone} | status: ${response.status} | body: ${JSON.stringify(data)}`);

        if (!ok) {
            console.warn(`[OTP] Verify rejected for +${phone} (attempt ${record.attempts}/${OTP_MAX_VERIFY_ATTEMPTS})`);
        }
    } else {
        // Renflair & dev mode: compare against the locally generated OTP
        ok = record.otpHash === sha256(String(otp));
    }

    if (!ok) {
        const remaining = OTP_MAX_VERIFY_ATTEMPTS - record.attempts;
        throw new OtpError('otp_invalid', remaining > 0
            ? `Incorrect OTP. ${remaining} attempt(s) remaining.`
            : 'Incorrect OTP. Please request a new one.', 401);
    }

    otpStore.delete(phone); // single-use
    return true;
}

// ------------------------------ Shopify -------------------------------------

async function shopifyAdmin(endpoint, options = {}) {
    const token = process.env.SHOPIFY_ACCESS_TOKEN;
    const shop = process.env.SHOPIFY_STORE;
    if (!token || !shop) {
        throw new OtpError('not_configured', 'Shopify credentials are not configured', 500);
    }

    const url = endpoint.startsWith('http')
        ? endpoint
        : `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
            ...options.headers
        },
        signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new OtpError('shopify_error', `Shopify API error: ${response.status} - ${errorText}`, 502);
    }

    return response.status === 204 ? {} : response.json();
}

async function findCustomerByPhone(phone) {
    const e164 = `+${phone}`;
    // Try E.164 first, then the bare digits (stores store phone formats inconsistently)
    for (const query of [e164, phone]) {
        const data = await shopifyAdmin(`customers.json?phone=${encodeURIComponent(query)}&limit=1`);
        const customer = data.customers?.[0];
        if (customer) return customer;
    }
    return null;
}

function syntheticEmail(phone) {
    const domain = process.env.OTP_CUSTOMER_EMAIL_DOMAIN || process.env.SHOPIFY_STORE;
    return `${phone}@${domain}`;
}

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Lazily load the Supabase client (module throws only if required without env)
let _supabase = null;
function getSupabase() {
    if (_supabase === undefined) return null;
    if (_supabase === null) {
        try { _supabase = require('./supabase'); } catch { _supabase = undefined; }
        if (_supabase === null) _supabase = undefined;
    }
    return _supabase || null;
}

// Search Shopify orders by the checkout phone (covers GoKwik + Shiprocket
// shipments, since every shipped order originates from a Shopify order).
// NOTE: the `phone:` search qualifier is unreliable (can behave like no
// filter), so fetch recent orders and validate each one's phone ourselves.
async function emailFromShopifyOrders(phone) {
    const bare = phone.replace(/\D/g, '').slice(-10);
    const query = {
        query: `{ orders(first: 50, query: "phone:${phone}", sortKey: CREATED_AT, reverse: true) {
            nodes { email phone customer { phone } shippingAddress { phone } billingAddress { phone } } } }`
    };

    let nodes = [];
    try {
        const data = await shopifyAdmin('graphql.json', {
            method: 'POST',
            body: JSON.stringify(query)
        });
        nodes = data?.data?.orders?.nodes || [];
    } catch (err) {
        console.warn('[OTP] Shopify order email lookup failed:', err.message);
        return null;
    }

    for (const order of nodes) {
        const candidates = [
            order.phone,
            order.customer?.phone,
            order.shippingAddress?.phone,
            order.billingAddress?.phone
        ];
        const matched = candidates.some(p => (p || '').replace(/\D/g, '').slice(-10) === bare);
        if (matched && isValidEmail(order.email)) {
            return order.email;
        }
    }
    return null;
}

// Search our own Supabase tables that store phone + email together
async function emailFromLocalDb(phone) {
    const supabase = getSupabase();
    if (!supabase) return null;
    const bare = phone.replace(/\D/g, '').slice(-10);
    const variants = [`+91${bare}`, bare, phone];

    // 1. Return/exchange requests
    try {
        const { data, error } = await supabase
            .from('requests')
            .select('customer_email, customer_phone')
            .in('customer_phone', variants)
            .not('customer_email', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);
        if (!error && data?.[0]?.customer_email && isValidEmail(data[0].customer_email)) {
            return data[0].customer_email.trim();
        }
    } catch (err) {
        console.warn('[OTP] requests table email lookup failed:', err.message);
    }

    // 2. GoKwik / Shopify abandoned carts (often hold the checkout email)
    try {
        const { data, error } = await supabase
            .from('marketing_abandoned_carts')
            .select('customer_email, customer_phone')
            .not('customer_phone', 'is', null)
            .not('customer_email', 'is', null)
            .order('created_at', { ascending: false })
            .limit(200);
        if (!error && Array.isArray(data)) {
            const match = data.find(c => {
                const digits = (c.customer_phone || '').replace(/\D/g, '').slice(-10);
                return digits === bare && isValidEmail(c.customer_email);
            });
            if (match) return match.customer_email.trim();
        }
    } catch (err) {
        console.warn('[OTP] abandoned-carts email lookup failed:', err.message);
    }

    // 3. WhatsApp Shoppers Hub DB (store_shoppers holds all WhatsApp-bot
    // customer records - phone + email together)
    try {
        const shopperEmail = await shopperHubDb.findShopperEmailByPhone(phone);
        if (shopperEmail && isValidEmail(shopperEmail)) return shopperEmail;
    } catch (err) {
        console.warn('[OTP] Shoppers Hub email lookup failed:', err.message);
    }

    return null;
}

/**
 * Resolve a real email for a phone-only customer before resorting to the
 * synthetic one. Chain: Shopify orders -> local DB (requests, abandoned
 * carts, Shoppers Hub) -> null (caller falls back to syntheticEmail).
 * Never throws.
 */
async function resolveRealEmail(phone) {
    const fromOrders = await emailFromShopifyOrders(phone);
    if (fromOrders) return { email: fromOrders, source: 'shopify_orders' };

    const fromDb = await emailFromLocalDb(phone);
    if (fromDb) return { email: fromDb, source: 'local_db' };

    return null;
}

async function createCustomer(phone, email) {
    const payload = {
        customer: {
            email: email || syntheticEmail(phone),
            phone: `+${phone}`,
            first_name: 'Customer',
            tags: 'otp-login',
            send_email_invite: false
        }
    };

    try {
        const data = await shopifyAdmin('customers.json', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        return data.customer;
    } catch (err) {
        // Email collision (shouldn't happen, but recover gracefully)
        if (err.message.includes('422')) {
            const byEmail = await shopifyAdmin(`customers.json?email=${encodeURIComponent(syntheticEmail(phone))}&limit=1`);
            if (byEmail.customers?.[0]) return byEmail.customers[0];
        }
        throw err;
    }
}

async function generateActivationUrl(customerId) {
    const data = await shopifyAdmin(`customers/${customerId}/account_activation_url.json`, {
        method: 'POST'
    });
    // Shopify returns the URL as a plain string under account_activation_url
    const raw = data.account_activation_url;
    const activationUrl = typeof raw === 'string' ? raw : raw?.activation_url;
    if (!activationUrl) {
        throw new OtpError('activation_url_failed', 'Could not generate an account activation link', 502);
    }
    return activationUrl;
}

/**
 * Generate an activation URL for invited/declined/disabled accounts.
 */
// Extract hidden form inputs from a Shopify storefront page
function parseHiddenInputs(html) {
    const hidden = {};
    const matches = html.match(/<input[^>]*type=["']hidden["'][^>]*>/gi) || [];
    for (const tag of matches) {
        const nameMatch = tag.match(/name=["']([^"']+)["']/i);
        const valueMatch = tag.match(/value=["']([^"']*)["']/i);
        if (nameMatch) hidden[nameMatch[1]] = valueMatch ? valueMatch[1] : '';
    }
    return hidden;
}

function randomPassword() {
    return crypto.randomBytes(18).toString('base64url');
}

/**
 * Activate (or re-set the password of) an account using the one-time
 * activation URL. GETs the activation page, copies its hidden form fields,
 * then POSTs the new password back to the same URL.
 */
async function activateAccount(activationUrl, password) {
    let page;
    try {
        page = await fetch(activationUrl, {
            headers: { 'User-Agent': STOREFRONT_USER_AGENT },
            redirect: 'manual',
            signal: AbortSignal.timeout(20000)
        });
    } catch (err) {
        throw new OtpError('storefront_error', 'Could not reach the store to activate the account', 502);
    }

    // A redirect here means the link was already consumed/expired
    if (page.status !== 200) {
        throw new OtpError('activation_link_invalid', 'Activation link expired. Please try logging in again.', 502);
    }

    const html = await page.text();
    const hidden = parseHiddenInputs(html);
    if (!hidden.form_type) {
        throw new OtpError('activation_link_invalid', 'Unexpected activation page format', 502);
    }

    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(hidden)) form.append(name, value);
    form.append('customer[password]', password);
    form.append('customer[password_confirmation]', password);

    let result;
    try {
        result = await fetch(activationUrl, {
            method: 'POST',
            headers: {
                'User-Agent': STOREFRONT_USER_AGENT,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: form.toString(),
            redirect: 'manual',
            signal: AbortSignal.timeout(20000)
        });
    } catch (err) {
        throw new OtpError('storefront_error', 'Could not reach the store to activate the account', 502);
    }

    // Success: Shopify 302s to the account page. A 200 re-renders the form with errors.
    if (result.status >= 300 && result.status < 400) return true;

    const body = await result.text().catch(() => '');
    const errorMatch = body.match(/errors">\s*<li[^>]*>([^<]+)</i) || body.match(/class="error[^"]*"[^>]*>([^<]+)</i);
    throw new OtpError('activation_failed',
        errorMatch ? `Account activation failed: ${errorMatch[1].trim()}` : 'Account activation failed', 502);
}

/**
 * Attach guest orders placed with this phone (GoKwik / guest checkout)
 * to the customer so they appear on the /account order history page.
 * Only orders with NO customer attached are linked - orders already
 * belonging to another customer record are left untouched.
 * Best-effort: never throws.
 */
async function linkOrdersToCustomer(phone, customerId) {
    const bare = phone.replace(/\D/g, '').slice(-10);

    let nodes = [];
    try {
        const data = await shopifyAdmin('graphql.json', {
            method: 'POST',
            body: JSON.stringify({
                query: `{ orders(first: 50, query: "phone:${phone}", sortKey: CREATED_AT, reverse: true) {
                    nodes {
                        id name phone
                        customer { id }
                        shippingAddress { phone }
                        billingAddress { phone }
                    } } }`
            })
        });
        nodes = data?.data?.orders?.nodes || [];
    } catch (err) {
        console.warn('[OTP] Order-link lookup failed (non-fatal):', err.message);
        return 0;
    }

    // The `phone:` qualifier is unreliable - validate every order ourselves
    // (phone may live on the order, the customer, or either address)
    const guestOrderIds = nodes
        .filter(o => {
            const candidates = [
                o.phone,
                o.customer?.phone,
                o.shippingAddress?.phone,
                o.billingAddress?.phone
            ];
            return candidates.some(p => (p || '').replace(/\D/g, '').slice(-10) === bare) && !o.customer;
        })
        .map(o => o.id);

    if (!guestOrderIds.length) return 0;

    try {
        const data = await shopifyAdmin('graphql.json', {
            method: 'POST',
            body: JSON.stringify({
                query: `mutation {
                    customerAssociateOrders(
                        customerId: "gid://shopify/Customer/${customerId}",
                        orderIds: [${guestOrderIds.map(id => `"${id}"`).join(',')}]
                    ) { userErrors { field message } }
                }`
            })
        });
        const userErrors = data?.data?.customerAssociateOrders?.userErrors || [];
        if (userErrors.length) {
            console.warn(`[OTP] Order-link userErrors for customer ${customerId}:`, JSON.stringify(userErrors));
        } else {
            console.log(`[OTP] Linked ${guestOrderIds.length} guest order(s) to customer ${customerId} (+${phone})`);
        }
        return guestOrderIds.length;
    } catch (err) {
        console.warn('[OTP] Order-link mutation failed (non-fatal):', err.message);
        return 0;
    }
}

/**
 * For already-enabled accounts: update password via Admin API and return
 * credentials for the standard /account/login form submission.
 * This allows OTP login to work on subsequent attempts without needing
 * activation URLs (which only work for disabled/invited accounts).
 */
async function loginEnabledAccount(customerId, email, phone) {
    const shop = process.env.SHOPIFY_STORE;
    const newPassword = randomPassword();

    try {
        // Update password via Admin API (works for enabled accounts)
        await shopifyAdmin(`customers/${customerId}.json`, {
            method: 'PUT',
            body: JSON.stringify({
                customer: {
                    id: customerId,
                    password: newPassword,
                    password_confirmation: newPassword
                }
            })
        });

        console.log(`[OTP] Updated password for enabled customer ${customerId} (+${phone})`);

        // Small delay to ensure Shopify processes the password update
        await new Promise(resolve => setTimeout(resolve, 1000));

        return {
            type: 'credentials',
            action: '/account/login',
            email: email,
            password: newPassword,
            redirect: '/account'
        };
    } catch (err) {
        console.error('[OTP] Password update failed for enabled account:', err.message);
        throw new OtpError('login_failed', 'Could not complete login. Please try again.', 502);
    }
}

/**
 * Full verify-otp backend flow: find/create customer, handle login based on
 * account state, return credentials for the theme to establish session.
 */
async function issueStorefrontLogin(phone) {
    const shop = process.env.SHOPIFY_STORE;
    if (!shop) throw new OtpError('not_configured', 'SHOPIFY_STORE is not configured', 500);

    let customer = await findCustomerByPhone(phone);
    if (!customer) {
        // Brand-new customer: try to attach a real email from day one
        const resolved = await resolveRealEmail(phone);
        customer = await createCustomer(phone, resolved?.email);
        console.log(`[OTP] Created Shopify customer ${customer.id} for +${phone} | email: ${resolved ? `real (${resolved.source})` : 'synthetic'}`);
    }

    // Handle already-enabled accounts (re-login via OTP)
    // Update password via Admin API and return credentials for login form
    if (customer.state === 'enabled') {
        // Ensure customer has an email (resolve real or use synthetic)
        let email = customer.email;
        if (!email) {
            const resolved = await resolveRealEmail(phone);
            email = resolved?.email || syntheticEmail(phone);

            try {
                const data = await shopifyAdmin(`customers/${customer.id}.json`, {
                    method: 'PUT',
                    body: JSON.stringify({ customer: { id: customer.id, email } })
                });
                customer = data.customer || { ...customer, email };
            } catch (err) {
                if (resolved && err.message.includes('422')) {
                    console.warn(`[OTP] Resolved email ${resolved.email} already taken; using synthetic for customer ${customer.id}`);
                    email = syntheticEmail(phone);
                    const data = await shopifyAdmin(`customers/${customer.id}.json`, {
                        method: 'PUT',
                        body: JSON.stringify({ customer: { id: customer.id, email } })
                    });
                    customer = data.customer || { ...customer, email };
                } else {
                    throw err;
                }
            }
        }

        // Update password and return credentials for login form
        const loginData = await loginEnabledAccount(customer.id, email, phone);

        // Link guest orders (best-effort)
        await linkOrdersToCustomer(phone, customer.id);

        return loginData;
    }

    // For new or disabled accounts: use activation flow
    // Phone-only customers (common with GoKwik checkout) have no email,
    // but classic-account login needs one. Resolution order: real email
    // from Shopify orders / our DB -> synthetic email as last resort.
    if (!customer.email) {
        const resolved = await resolveRealEmail(phone);
        const email = resolved?.email || syntheticEmail(phone);

        try {
            const data = await shopifyAdmin(`customers/${customer.id}.json`, {
                method: 'PUT',
                body: JSON.stringify({ customer: { id: customer.id, email } })
            });
            customer = data.customer || { ...customer, email };
        } catch (err) {
            // Real email already belongs to another customer record -
            // fall back to the unique synthetic one instead of failing
            if (resolved && err.message.includes('422')) {
                console.warn(`[OTP] Resolved email ${resolved.email} already taken; using synthetic for customer ${customer.id}`);
                const fallback = syntheticEmail(phone);
                const data = await shopifyAdmin(`customers/${customer.id}.json`, {
                    method: 'PUT',
                    body: JSON.stringify({ customer: { id: customer.id, email: fallback } })
                });
                customer = data.customer || { ...customer, email: fallback };
            } else {
                throw err;
            }
        }
        console.log(`[OTP] ${resolved ? `Resolved real email from ${resolved.source}` : 'Assigned synthetic email'} for customer ${customer.id} (+${phone})`);
    }

    const password = randomPassword();
    const activationUrl = await generateActivationUrl(customer.id);
    await activateAccount(activationUrl, password);

    // Make guest orders placed with this phone visible in the account's
    // order history (best-effort; never blocks the login)
    await linkOrdersToCustomer(phone, customer.id);

    return {
        type: 'credentials',
        action: '/account/login',
        email: customer.email,
        password,
        redirect: '/account'
    };
}

module.exports = {
    normalizeIndianPhone,
    sendOtp,
    verifyOtp,
    issueStorefrontLogin,
    resolveRealEmail,
    OtpError
};
