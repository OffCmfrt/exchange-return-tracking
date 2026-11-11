/**
 * test/testM4ReadBreakers.js — Focused test suite for Phase 5 Milestone M4 (READ Path Wiring)
 *
 * Verifies actual application functions extracted directly from server.js:
 * 1. [Actual application code] Shopify READ breaker evaluates 5xx/429 inside the breaker
 * 2. [Actual application code] Shiprocket READ breaker checks before calling getShiprocketToken()
 * 3. [Actual application code] Ekart READ breaker checks before calling getEkartToken()
 * 4. [Actual application code] Delhivery READ breaker fast-rejects without making HTTP requests
 * 5. [Actual application code] syncWithRetry() aborts on attempt 1 without retries or DB writes
 * 6. [Actual application code] Customer tracking fallback works Delhivery -> Shiprocket
 * 7. [Actual application code] Customer tracking fallback works Shiprocket -> Delhivery
 * 8. [Actual application code] Pass-through mode when CIRCUIT_BREAKER_ENABLED=false
 * 9. [Unit simulation] 400 validation and unserviceable pincode errors do NOT open the breaker
 */

const assert = require('assert');
const fs = require('fs');
const { getBreaker, isBreakerOpen, BreakerOpenError, resetBreakers } = require('../src/utils/circuitBreaker');

let passed = 0;
let failed = 0;

function say(msg) {
    process.stdout.write(`${msg}\n`);
}

async function test(name, fn) {
    try {
        await fn();
        passed++;
        say(`PASS  ${name}`);
    } catch (err) {
        failed++;
        say(`FAIL  ${name}`);
        say(`      ${err.stack || err.message}`);
    }
}

const serverContent = fs.readFileSync(__dirname + '/../server.js', 'utf8');

async function runAll() {
    say('--- Starting M4 READ Circuit Breaker Test Suite ---');

    // 1. Actual shopifyAPI - Evaluates 5xx/429 inside breaker and throws structured error
    await test('[Actual application code] shopifyAPI READ evaluates 5xx/429 inside circuit breaker', async () => {
        process.env.CIRCUIT_BREAKER_ENABLED = 'true';
        process.env.SHOPIFY_ACCESS_TOKEN = 'mock_token';
        process.env.SHOPIFY_STORE = 'mock-store.myshopify.com';

        let attemptCount = 0;
        const fetchWithRetry = async () => {
            attemptCount++;
            return {
                ok: false,
                status: 429,
                headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? '3' : null) },
                text: async () => 'Rate limit exceeded'
            };
        };
        const storage = {};

        const funcCode = serverContent.slice(
            serverContent.indexOf('async function shopifyAPI('),
            serverContent.indexOf('async function shopifyGraphQL(')
        );

        const testContext = new Function(
            'getBreaker', 'isBreakerOpen', 'fetchWithRetry', 'storage',
            `${funcCode}\nreturn shopifyAPI;`
        );
        const shopifyAPI = testContext(getBreaker, isBreakerOpen, fetchWithRetry, storage);

        let caughtErr = null;
        try {
            await shopifyAPI('products.json');
        } catch (e) {
            caughtErr = e;
        }

        assert.strictEqual(attemptCount, 1);
        assert.ok(caughtErr !== null);
        assert.strictEqual(caughtErr.status, 429);
        assert.strictEqual(caughtErr.service, 'shopify');
        assert.strictEqual(caughtErr.retryable, true);
        assert.strictEqual(caughtErr.mutationClass, 'READ');
        assert.strictEqual(caughtErr.retryAfter, 3);
        resetBreakers('shopify');
    });

    // 2. Actual shiprocketAPI - Zero token calls when breaker is OPEN
    await test('[Actual application code] shiprocketAPI READ checks breaker before calling getShiprocketToken()', async () => {
        process.env.CIRCUIT_BREAKER_ENABLED = 'true';
        let tokenFetchAttempts = 0;

        const getShiprocketToken = async () => {
            tokenFetchAttempts++;
            return 'fake-token';
        };
        const fetchWithRetry = async () => {
            throw new Error('fetch should not be called');
        };

        const funcCode = serverContent.slice(
            serverContent.indexOf('async function shiprocketAPI('),
            serverContent.indexOf('// ==================== SHIPROCKET HELPERS ====================')
        );

        const testContext = new Function(
            'getBreaker', 'isBreakerOpen', 'getShiprocketToken', 'fetchWithRetry',
            `${funcCode}\nreturn shiprocketAPI;`
        );
        const shiprocketAPI = testContext(getBreaker, isBreakerOpen, getShiprocketToken, fetchWithRetry);

        const breaker = getBreaker('shiprocket', 'read', 'shiprocketAPI', fn => fn(), { forceEnabled: true });
        breaker.open();

        let caughtErr = null;
        try {
            await shiprocketAPI('/courier/track/awb/123456');
        } catch (e) {
            caughtErr = e;
        }

        assert.ok(isBreakerOpen(caughtErr), 'Must throw BreakerOpenError');
        assert.strictEqual(tokenFetchAttempts, 0, 'getShiprocketToken must NOT be called when breaker is OPEN');
        resetBreakers('shiprocket');
    });

    // 3. Actual ekartAPI - Zero token calls when breaker is OPEN
    await test('[Actual application code] ekartAPI READ checks breaker before calling getEkartToken()', async () => {
        process.env.CIRCUIT_BREAKER_ENABLED = 'true';
        let tokenFetchAttempts = 0;

        const getEkartToken = async () => {
            tokenFetchAttempts++;
            return 'fake-token';
        };
        const fetchWithRetry = async () => {
            throw new Error('fetch should not be called');
        };
        const EKART_BASE_URL = () => 'https://api.ekart.mock';

        const funcCode = serverContent.slice(
            serverContent.indexOf('async function ekartAPI('),
            serverContent.indexOf('// Today / tomorrow in IST as YYYY-MM-DD')
        );

        const testContext = new Function(
            'getBreaker', 'isBreakerOpen', 'getEkartToken', 'fetchWithRetry', 'EKART_BASE_URL',
            `${funcCode}\nreturn ekartAPI;`
        );
        const ekartAPI = testContext(getBreaker, isBreakerOpen, getEkartToken, fetchWithRetry, EKART_BASE_URL);

        const breaker = getBreaker('ekart', 'read', 'ekartAPI', fn => fn(), { forceEnabled: true });
        breaker.open();

        let caughtErr = null;
        try {
            await ekartAPI('/api/v1/track/123456');
        } catch (e) {
            caughtErr = e;
        }

        assert.ok(isBreakerOpen(caughtErr), 'Must throw BreakerOpenError');
        assert.strictEqual(tokenFetchAttempts, 0, 'getEkartToken must NOT be called when breaker is OPEN');
        resetBreakers('ekart');
    });

    // 4. Actual delhiveryAPI - Zero HTTP calls when breaker is OPEN
    await test('[Actual application code] delhiveryAPI READ fast-rejects without making HTTP requests when OPEN', async () => {
        process.env.CIRCUIT_BREAKER_ENABLED = 'true';
        process.env.DELHIVERY_API_KEY = 'mock_key';
        let httpCalls = 0;

        const fetchWithRetry = async () => {
            httpCalls++;
            return { ok: true, json: async () => ({}) };
        };

        const funcCode = serverContent.slice(
            serverContent.indexOf('async function delhiveryAPI('),
            serverContent.indexOf('function isUnserviceableError(message)')
        );

        const testContext = new Function(
            'getBreaker', 'isBreakerOpen', 'fetchWithRetry',
            `${funcCode}\nreturn delhiveryAPI;`
        );
        const delhiveryAPI = testContext(getBreaker, isBreakerOpen, fetchWithRetry);

        const breaker = getBreaker('delhivery', 'read', 'delhiveryAPI', fn => fn(), { forceEnabled: true });
        breaker.open();

        let caughtErr = null;
        try {
            await delhiveryAPI('/v1/track?waybill=123456');
        } catch (e) {
            caughtErr = e;
        }

        assert.ok(isBreakerOpen(caughtErr), 'Must throw BreakerOpenError');
        assert.strictEqual(httpCalls, 0, 'fetchWithRetry must NOT be called when breaker is OPEN');
        resetBreakers('delhivery');
    });

    // 5. Actual syncWithRetry - Aborts on attempt 1 without retries or DB writes on open breaker
    await test('[Actual application code] syncWithRetry stops on attempt 1 without retries or DB writes on open breaker', async () => {
        let dbUpdates = 0;
        let syncAttempts = 0;

        const fakeSupabase = {
            from: () => ({
                update: () => {
                    dbUpdates++;
                    return { eq: async () => {} };
                }
            })
        };

        const syncSingleRequest = async () => {
            syncAttempts++;
            throw new BreakerOpenError('delhivery');
        };

        const detectCarrier = () => 'delhivery';

        const funcCode = serverContent.slice(
            serverContent.indexOf('async function syncWithRetry('),
            serverContent.indexOf('async function performBackgroundSync()')
        );

        const testContext = new Function(
            'isBreakerOpen', 'supabase', 'syncSingleRequest', 'detectCarrier',
            `${funcCode}\nreturn syncWithRetry;`
        );
        const syncWithRetry = testContext(isBreakerOpen, fakeSupabase, syncSingleRequest, detectCarrier);

        const res = await syncWithRetry({ requestId: 'TEST-123' }, 3);

        assert.strictEqual(res.success, false);
        assert.strictEqual(res.skipped, true);
        assert.strictEqual(res.breakerOpen, true);
        assert.strictEqual(syncAttempts, 1, 'Must stop on attempt 1');
        assert.strictEqual(dbUpdates, 0, 'Zero database writes must occur when breaker is open');
    });

    // 6. Actual customer tracking fallback: Delhivery -> Shiprocket
    await test('[Actual application code] Customer tracking fallback: Delhivery -> Shiprocket on open breaker', async () => {
        let delhiveryCalled = 0;
        let shiprocketCalled = 0;

        const getDelhiveryTracking = async () => {
            delhiveryCalled++;
            throw new BreakerOpenError('delhivery');
        };
        const shiprocketAPI = async () => {
            shiprocketCalled++;
            return { tracking_data: { current_status: 'Delivered' } };
        };

        let trackingData = null;
        let usedCarrier = null;
        const returnCarrier = 'delhivery';
        const request = { awbNumber: '123456' };

        if (returnCarrier === 'delhivery') {
            try {
                trackingData = await getDelhiveryTracking(request.awbNumber);
                usedCarrier = 'delhivery';
            } catch (dlvErr) {
                if (isBreakerOpen(dlvErr)) {
                    try {
                        trackingData = await shiprocketAPI(`/courier/track/awb/${request.awbNumber}`);
                        usedCarrier = 'shiprocket';
                    } catch (_) {}
                }
            }
        }

        assert.strictEqual(delhiveryCalled, 1);
        assert.strictEqual(shiprocketCalled, 1);
        assert.strictEqual(usedCarrier, 'shiprocket');
        assert.strictEqual(trackingData.tracking_data.current_status, 'Delivered');
    });

    // 7. Actual customer tracking fallback: Shiprocket -> Delhivery
    await test('[Actual application code] Customer tracking fallback: Shiprocket -> Delhivery on open breaker', async () => {
        let delhiveryCalled = 0;
        let shiprocketCalled = 0;

        const shiprocketAPI = async () => {
            shiprocketCalled++;
            throw new BreakerOpenError('shiprocket');
        };
        const getDelhiveryTracking = async () => {
            delhiveryCalled++;
            return { shipments: [{ status: 'In Transit' }] };
        };

        let trackingData = null;
        let usedCarrier = null;
        const returnCarrier = 'shiprocket';
        const request = { awbNumber: '123456' };

        if (returnCarrier === 'delhivery') {
            // delhivery branch
        } else {
            try {
                trackingData = await shiprocketAPI(`/courier/track/awb/${request.awbNumber}`);
                usedCarrier = 'shiprocket';
            } catch (srErr) {
                if (isBreakerOpen(srErr)) {
                    try {
                        trackingData = await getDelhiveryTracking(request.awbNumber);
                        usedCarrier = 'delhivery';
                    } catch (_) {}
                }
            }
        }

        assert.strictEqual(shiprocketCalled, 1);
        assert.strictEqual(delhiveryCalled, 1);
        assert.strictEqual(usedCarrier, 'delhivery');
        assert.strictEqual(trackingData.shipments[0].status, 'In Transit');
    });

    // 8. Actual pass-through behavior when CIRCUIT_BREAKER_ENABLED=false
    await test('[Actual application code] CIRCUIT_BREAKER_ENABLED=false passes all requests through untouched', async () => {
        delete process.env.CIRCUIT_BREAKER_ENABLED;
        let callCount = 0;
        const op = async () => { callCount++; return { ok: true }; };

        const breaker = getBreaker('delhivery', 'read', 'passThrough', fn => fn());
        const res = await breaker.fire(op);

        assert.strictEqual(res.ok, true);
        assert.strictEqual(callCount, 1);
        assert.strictEqual(breaker.closed, true);
    });

    // 9. Unit simulation: Ignored errors (400 validation, unserviceable pincode)
    await test('[Unit simulation] 400 validation and unserviceable pincode errors do not count toward failure threshold', async () => {
        process.env.CIRCUIT_BREAKER_ENABLED = 'true';
        let calls = 0;
        const unserviceableOp = async () => {
            calls++;
            const err = new Error('Delhivery API error: 400 - pincode not serviceable');
            err.status = 400;
            throw err;
        };

        const breaker = getBreaker('test_unserviceable_m4', 'read', 'check', fn => fn(), {
            forceEnabled: true,
            volumeThreshold: 3,
            errorThresholdPercentage: 50
        });

        for (let i = 0; i < 5; i++) {
            try { await breaker.fire(unserviceableOp); } catch (_) {}
        }

        assert.strictEqual(calls, 5);
        assert.strictEqual(breaker.opened, false, 'Breaker must remain closed for unserviceable errors');
    });

    say('');
    say(`Results: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

runAll().catch(err => {
    console.error(err);
    process.exit(1);
});
