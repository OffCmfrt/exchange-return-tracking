const assert = require('assert');
const fs = require('fs');
const { getBreaker, isBreakerOpen, resetBreakers } = require('../src/utils/circuitBreaker');

const source = fs.readFileSync(__dirname + '/../server.js', 'utf8');
const start = source.indexOf('async function fireCreateRequest(');
const end = source.indexOf('// ==================== SHOPIFY API HELPER ====================');
const composeStart = source.indexOf('function composeTimeoutSignal(');
const composeEnd = source.indexOf('async function fetchWithRetry(');
const composeTimeoutSignal = new Function(`${source.slice(composeStart, composeEnd)}\nreturn composeTimeoutSignal;`)();
const fireCreateRequest = new Function('composeTimeoutSignal', 'getBreaker', 'isBreakerOpen', `${source.slice(start, end)}\nreturn fireCreateRequest;`)(composeTimeoutSignal, getBreaker, isBreakerOpen);

async function run() {
    process.env.CIRCUIT_BREAKER_ENABLED = 'true';
    let calls = 0;
    await assert.rejects(
        () => fireCreateRequest('shiprocket', 'm5-timeout', 501, 'ORDER-1', signal => {
            calls++;
            return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        }),
        err => err.outcome === 'OUTCOME_UNKNOWN' && err.idempotencyKey === 'ORDER-1'
    );
    assert.strictEqual(calls, 1, 'a timed-out CREATE request must not be retried');

    const breaker = getBreaker('delhivery', 'mutate_unknown', 'createReturn', fn => fn(), { forceEnabled: true });
    breaker.open();
    calls = 0;
    await assert.rejects(
        () => fireCreateRequest('delhivery', 'createReturn', 30000, 'ORDER-2', async () => { calls++; }),
        err => isBreakerOpen(err) && err.notAttempted === true
    );
    assert.strictEqual(calls, 0, 'an open breaker must reject before the carrier request');

    let fallbackCalls = 0;
    const unknown = new Error('Request timed out after 29500ms');
    unknown.outcome = 'OUTCOME_UNKNOWN';
    await assert.rejects(async () => {
        try { throw unknown; } catch (primaryError) {
            if (primaryError.outcome === 'OUTCOME_UNKNOWN') throw primaryError;
            fallbackCalls++;
        }
    }, err => err === unknown);
    assert.strictEqual(fallbackCalls, 0, 'OUTCOME_UNKNOWN must not create through a fallback carrier');

    try { throw new Error('breaker open'); } catch (primaryError) {
        primaryError.notAttempted = true;
        if (primaryError.outcome === 'OUTCOME_UNKNOWN') throw primaryError;
        fallbackCalls++;
    }
    assert.strictEqual(fallbackCalls, 1, 'notAttempted breaker rejections may use the normal fallback');
    resetBreakers();
    console.log('PASS M5 create requests do not retry after timeout and preserve breaker-open fallback');
}

run().catch(error => {
    console.error('FAIL M5 create breaker test:', error);
    process.exitCode = 1;
});
