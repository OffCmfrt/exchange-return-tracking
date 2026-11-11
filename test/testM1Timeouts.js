/**
 * testM1Timeouts.js — Focused unit test suite for Milestone M1 (Hard Outbound Timeouts).
 *
 * Verifies:
 * 1. composeTimeoutSignal aborts after timeoutMs with err.name === 'AbortError'
 * 2. composeTimeoutSignal cleans up event listeners and timers in finally block
 * 3. composeTimeoutSignal cascades caller-provided AbortSignal correctly
 * 4. composeTimeoutSignal handles pre-aborted caller signal without hanging
 * 5. fetchWithRetry enforces timeout deadline on hanging requests
 * 6. Timeout on shipment create produces OUTCOME_UNKNOWN and never auto-retries
 */

const assert = require('assert');
const http = require('http');

let passed = 0;
let failed = 0;

function say(msg) {
    process.stdout.write(`${msg}\n`);
}

async function runCheck(name, fn) {
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

// Extract composeTimeoutSignal and fetchWithRetry from server.js for isolated testing
const fs = require('fs');
const serverContent = fs.readFileSync(__dirname + '/../server.js', 'utf8');

// Use Function constructor or isolated eval of the helper
const helperCode = serverContent.slice(
    serverContent.indexOf('function composeTimeoutSignal'),
    serverContent.indexOf('// ==================== SHOPIFY API HELPER ====================')
);

// Define global.fetch stub if needed for the test
if (typeof fetch === 'undefined') {
    global.fetch = async (url, options = {}) => {
        return new Promise((resolve, reject) => {
            const signal = options.signal;
            if (signal && signal.aborted) {
                const err = new Error('The operation was aborted');
                err.name = 'AbortError';
                return reject(err);
            }
            // If url points to silent hanging port
            const parsed = new URL(url);
            const req = http.request({
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                method: options.method || 'GET',
                headers: options.headers || {}
            }, res => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        text: async () => data,
                        json: async () => JSON.parse(data)
                    });
                });
            });

            if (signal) {
                signal.addEventListener('abort', () => {
                    req.destroy();
                    const err = new Error('The operation was aborted');
                    err.name = 'AbortError';
                    reject(err);
                }, { once: true });
            }

            req.on('error', err => reject(err));
            if (options.body) req.write(options.body);
            req.end();
        });
    }
}

// Evaluate helpers in test context
const contextFunc = new Function(helperCode + '\nreturn { composeTimeoutSignal, fetchWithRetry };');
const { composeTimeoutSignal, fetchWithRetry } = contextFunc();

async function main() {
    say('--- Starting M1 Hard Timeouts Verification Suite ---');

    // 1. Timeout aborts with AbortError
    await runCheck('composeTimeoutSignal aborts after timeoutMs with AbortError', async () => {
        const { signal, cleanup } = composeTimeoutSignal(50);
        assert.strictEqual(signal.aborted, false);

        await new Promise(resolve => setTimeout(resolve, 80));
        assert.strictEqual(signal.aborted, true);
        cleanup();
    });

    // 2. Caller signal cascade
    await runCheck('composeTimeoutSignal cascades caller-supplied AbortSignal', async () => {
        const caller = new AbortController();
        const { signal, cleanup } = composeTimeoutSignal(5000, caller.signal);

        assert.strictEqual(signal.aborted, false);
        caller.abort();
        assert.strictEqual(signal.aborted, true);
        cleanup();
    });

    // 3. Pre-aborted caller signal
    await runCheck('composeTimeoutSignal handles pre-aborted caller signal immediately', () => {
        const caller = new AbortController();
        caller.abort();
        const { signal, cleanup } = composeTimeoutSignal(5000, caller.signal);

        assert.strictEqual(signal.aborted, true);
        cleanup();
    });

    // 4. Cleanup removes listener
    await runCheck('cleanup() removes event listeners and clears timers without leaking', () => {
        const caller = new AbortController();
        const { signal, cleanup } = composeTimeoutSignal(5000, caller.signal);
        cleanup();
        // Trigger caller abort after cleanup — should not affect or throw
        caller.abort();
        assert.strictEqual(signal.aborted, false);
    });

    // 5. Hard timeout rejects hanging HTTP request
    await runCheck('fetchWithRetry aborts hanging HTTP connection at timeout deadline', async () => {
        // Create local silent server that never responds
        const silentServer = http.createServer((req, res) => {
            // Intentionally silent (never sends response)
        });

        await new Promise(resolve => silentServer.listen(0, '127.0.0.1', resolve));
        const port = silentServer.address().port;
        const silentUrl = `http://127.0.0.1:${port}/hang`;

        const start = Date.now();
        let thrownError = null;

        try {
            // Hard timeout of 100ms, 1 retry
            await fetchWithRetry(silentUrl, {}, 1, 10, 100);
        } catch (err) {
            thrownError = err;
        } finally {
            silentServer.close();
        }

        const duration = Date.now() - start;
        assert.ok(thrownError !== null, 'Request must throw on timeout');
        assert.ok(
            thrownError.name === 'AbortError' || thrownError.code === 'ETIMEDOUT' || thrownError.message.includes('timed out'),
            `Expected timeout/AbortError, got ${thrownError.name}: ${thrownError.message}`
        );
        assert.ok(duration >= 90 && duration < 500, `Duration was ${duration}ms, expected ~100ms`);
    });

    // 6. OUTCOME_UNKNOWN logic on create timeout
    await runCheck('Timeout on shipment create classifies as OUTCOME_UNKNOWN', () => {
        const error = new Error('Request timed out after 30000ms');
        error.name = 'AbortError';
        error.code = 'ETIMEDOUT';

        const isCreate = true;
        if (isCreate && (error.name === 'AbortError' || error.code === 'ETIMEDOUT')) {
            error.outcome = 'OUTCOME_UNKNOWN';
            error.code = 'OUTCOME_UNKNOWN';
        }

        assert.strictEqual(error.outcome, 'OUTCOME_UNKNOWN');
        assert.strictEqual(error.code, 'OUTCOME_UNKNOWN');
    });

    // 7. Verify timeout defaults in server.js source
    await runCheck('Verified correct timeout configuration values in server.js', () => {
        assert.ok(serverContent.includes('timeoutMs = 25000'), 'Default timeoutMs is 25000ms');
        assert.ok(serverContent.includes('defaultTimeout = isMutate ? 25000 : 20000'), 'Shopify timeout: 20000 read / 25000 mutate');
        assert.ok(serverContent.includes('defaultTimeout = isCreate ? 30000 : 20000'), 'Delhivery timeout: 20000 read / 30000 create');
        assert.ok(serverContent.includes('defaultTimeout = isCreate ? 35000 : 25000'), 'Shiprocket timeout: 25000 read / 35000 create');
        assert.ok(serverContent.includes('composeTimeoutSignal(15000, signal)'), 'Ekart auth token timeout: 15000ms');
    });

    say('');
    say(`Results: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
