const assert = require('assert');
const fs = require('fs');
const breakerApi = require('../src/utils/circuitBreaker');

const source = fs.readFileSync(__dirname + '/../server.js', 'utf8');
const compose = new Function(`${source.slice(source.indexOf('function composeTimeoutSignal('), source.indexOf('async function fetchWithRetry('))}\nreturn composeTimeoutSignal;`)();
const ekartCode = source.slice(source.indexOf('const EKART_BASE_URL ='), source.indexOf('// Today / tomorrow in IST'));

function buildEkart(fetch, fetchWithRetry) {
    return new Function('composeTimeoutSignal', 'getBreaker', 'isBreakerOpen', 'fetch', 'fetchWithRetry', `${ekartCode}\nreturn { getEkartToken, ekartAPI };`)(compose, breakerApi.getBreaker, breakerApi.isBreakerOpen, fetch, fetchWithRetry);
}

async function run() {
    process.env.CIRCUIT_BREAKER_ENABLED = 'false';
    process.env.EKART_CLIENT_ID = 'client'; process.env.EKART_USERNAME = 'user'; process.env.EKART_PASSWORD = 'pass';
    let tokenCalls = 0;
    let api = buildEkart(async () => {
        tokenCalls++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { ok: true, text: async () => JSON.stringify({ access_token: 'token', expires_in: 3600 }) };
    }, async () => ({ ok: true, text: async () => '{}' }));
    await Promise.all(Array.from({ length: 10 }, () => api.getEkartToken()));
    assert.strictEqual(tokenCalls, 1, '10 concurrent token requests must issue one token request');

    tokenCalls = 0;
    api = buildEkart(async () => {
        tokenCalls++;
        return tokenCalls === 1
            ? { ok: false, status: 500, text: async () => 'down' }
            : { ok: true, text: async () => JSON.stringify({ access_token: 'recovered', expires_in: 3600 }) };
    }, async () => ({ ok: true, text: async () => '{}' }));
    await assert.rejects(() => api.getEkartToken());
    assert.strictEqual(await api.getEkartToken(), 'recovered');
    assert.strictEqual(tokenCalls, 2, 'failed in-flight token request must clear for recovery');

    let reads = 0;
    api = buildEkart(async () => ({ ok: true, text: async () => JSON.stringify({ access_token: 'token', expires_in: 3600 }) }), async () => {
        reads++;
        return reads < 3 ? { ok: false, status: 500, text: async () => 'down' } : { ok: true, text: async () => '{}' };
    });
    await api.ekartAPI('/api/v1/track/AWB');
    assert.strictEqual(reads, 3, 'READ retries 5xx twice');

    reads = 0;
    api = buildEkart(async () => ({ ok: true, text: async () => JSON.stringify({ access_token: 'token', expires_in: 3600 }) }), async () => {
        reads++; return { ok: false, status: 500, text: async () => 'down' };
    });
    await assert.rejects(() => api.ekartAPI('/api/v1/package/create', { method: 'PUT' }));
    assert.strictEqual(reads, 1, 'CREATE does not retry 5xx');

    const expected = { 'shopify:read': 2, 'delhivery:read': 3, 'ekart:read': 3, 'shiprocket:read': 2, 'shiprocket:mutate_unknown': 1, 'delhivery:mutate_unknown': 2, 'ekart:mutate_unknown': 2 };
    for (const [key, capacity] of Object.entries(expected)) assert.strictEqual(breakerApi.SERVICE_PROFILES[key].maxConcurrency, capacity, `${key} capacity`);
    console.log('PASS M6 single-flight, recovery, READ-only retry, and configured concurrency caps');
}
run().catch(error => { console.error('FAIL M6:', error); process.exitCode = 1; });
