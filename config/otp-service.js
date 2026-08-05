// ============================================================================
// Phone OTP Login Service (MSG91 + Shopify classic customer accounts)
//
// Flow:
//   1. /api/auth/otp/send   -> MSG91 sends the OTP (dev mode: logs to console)
//   2. /api/auth/otp/verify -> MSG91 verifies the OTP, then:
//        a. Find Shopify customer by phone (Admin API) - create if missing
//        b. Generate a one-time account activation URL via Admin API
//           (customerGenerateAccountActivationUrl equivalent - NO email needed,
//           unlike the password-reset-token trick which requires intercepting
//           the reset email Shopify sends)
//        c. Activate the account server-side by POSTing the storefront
//           activation form with a random password
//        d. Return { action, email, password } so the storefront JS submits a
//           normal /account/login form (same-origin -> Shopify issues the
//           _secure_customer_session cookie directly in the browser)
//
// Limitation: customers whose legacy account is ALREADY activated
// (state === 'enabled') keep their own password and must use email login.
//
// Env vars:
//   SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN      (already present)
//   MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID    (DLT-approved template)
//   MSG91_BASE_URL                           (optional override)
//   OTP_CUSTOMER_EMAIL_DOMAIN                (optional; domain for synthetic
//                                             emails of new phone-only accounts,
//                                             defaults to SHOPIFY_STORE)
// ============================================================================

const crypto = require('crypto');

const SHOPIFY_API_VERSION = '2024-01';
const STOREFRONT_USER_AGENT = 'Mozilla/5.0 (compatible; OFFCOMFRT-OTP/1.0)';

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

function isMsg91Configured() {
    return !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_OTP_TEMPLATE_ID);
}

function msg91Base() {
    return process.env.MSG91_BASE_URL || 'https://control.msg91.com';
}

// ------------------------------ MSG91 ---------------------------------------

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

    const configured = isMsg91Configured();
    console.log(`[OTP] send request for +${phone} | MSG91 configured: ${configured}` +
        (configured ? ` | template_id: ${process.env.MSG91_OTP_TEMPLATE_ID} | authkey set: ${String(Boolean(process.env.MSG91_AUTH_KEY)).slice(0, 4)}` : ''));

    if (configured) {
        const url = `${msg91Base()}/api/v5/otp?type=text&template_id=${encodeURIComponent(process.env.MSG91_OTP_TEMPLATE_ID)}&mobile=${phone}`;
        let response;
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: { authkey: process.env.MSG91_AUTH_KEY },
                signal: AbortSignal.timeout(15000)
            });
        } catch (err) {
            console.error('[OTP] MSG91 send request failed:', err.message);
            throw new OtpError('provider_error', 'Could not send OTP right now. Please try again.', 502);
        }

        let data = null;
        try { data = await response.json(); } catch { /* non-JSON response */ }

        if (response.status !== 200 || !data || data.type !== 'success') {
            console.error('[OTP] MSG91 send failed:', response.status, JSON.stringify(data));
            throw new OtpError('provider_error', 'Could not send OTP right now. Please try again.', 502);
        }
        sessionId = data.session_id || null;
        console.log(`[OTP] MSG91 accepted send for +${phone} | session_id: ${sessionId || 'none'}`);
    } else {
        // Dev mode: no MSG91 credentials - generate the OTP locally and log it.
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
        via: configured ? 'msg91' : 'dev',
        expiresInSeconds: Math.round(OTP_TTL_MS / 1000),
        resendInSeconds: Math.round(OTP_RESEND_COOLDOWN_MS / 1000),
        devOtp: devOtp && process.env.NODE_ENV !== 'production' ? devOtp : undefined
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

    if (isMsg91Configured()) {
        // Prefer session_id; fall back to mobile for MSG91 accounts that
        // respond without a session id
        const params = new URLSearchParams({ otp: String(otp) });
        if (record.sessionId) params.append('session_id', record.sessionId);
        else params.append('mobile', phone);

        let response;
        try {
            response = await fetch(`${msg91Base()}/api/v5/otp/verify?${params.toString()}`, {
                method: 'GET',
                headers: { authkey: process.env.MSG91_AUTH_KEY },
                signal: AbortSignal.timeout(15000)
            });
        } catch (err) {
            console.error('[OTP] MSG91 verify request failed:', err.message);
            throw new OtpError('provider_error', 'Could not verify OTP right now. Please try again.', 502);
        }

        let data = null;
        try { data = await response.json(); } catch { /* non-JSON response */ }
        ok = response.status === 200 && !!data && data.type === 'success';

        if (!ok) {
            console.warn(`[OTP] Verify rejected for +${phone} (attempt ${record.attempts}/${OTP_MAX_VERIFY_ATTEMPTS})`);
        }
    } else {
        // Dev mode: compare against the locally generated OTP
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

async function createCustomer(phone) {
    const payload = {
        customer: {
            email: syntheticEmail(phone),
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
    const activationUrl = data.account_activation_url?.activation_url;
    if (!activationUrl) {
        throw new OtpError('activation_url_failed', 'Could not generate an account activation link', 502);
    }
    return activationUrl;
}

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
 * Full verify-otp backend flow: find/create customer, activate account,
 * return the storefront login credentials for the theme to submit.
 */
async function issueStorefrontLogin(phone) {
    const shop = process.env.SHOPIFY_STORE;
    if (!shop) throw new OtpError('not_configured', 'SHOPIFY_STORE is not configured', 500);

    let customer = await findCustomerByPhone(phone);
    if (!customer) {
        customer = await createCustomer(phone);
        console.log(`[OTP] Created Shopify customer ${customer.id} for +${phone}`);
    }

    // Already-activated accounts have a password we cannot override -
    // those users must log in with email + password.
    if (customer.state === 'enabled') {
        throw new OtpError('already_active',
            'This account already has a password. Please use email + password login.', 409);
    }

    if (!customer.email) {
        throw new OtpError('no_email', 'This account has no email on file. Please contact support.', 409);
    }

    const password = randomPassword();
    const activationUrl = await generateActivationUrl(customer.id);
    await activateAccount(activationUrl, password);

    return {
        action: `https://${shop}/account/login`,
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
    OtpError
};
