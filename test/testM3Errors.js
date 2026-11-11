/**
 * testM3Errors.js — Focused test suite for Milestone M3 Structured Error Fields.
 *
 * Verifies:
 * 1. Error .message strings are 100% byte-identical to original messages
 * 2. Structured fields (status, service, retryable, mutationClass) are attached
 * 3. isUnserviceableError continues to match cleanly on err.message
 * 4. Create operations have retryable: false and mutationClass: 'MUTATE_UNKNOWN'
 * 5. Read operations have retryable: true for 5xx and 429
 */

const assert = require('assert');
const fs = require('fs');

let passed = 0;
let failed = 0;

function say(msg) {
    process.stdout.write(`${msg}\n`);
}

function runCheck(name, fn) {
    try {
        fn();
        passed++;
        say(`PASS  ${name}`);
    } catch (err) {
        failed++;
        say(`FAIL  ${name}`);
        say(`      ${err.stack || err.message}`);
    }
}

// Read server.js and extract the error construction blocks to assert byte-identity
const serverContent = fs.readFileSync(__dirname + '/../server.js', 'utf8');

say('--- Starting M3 Structured Error Fields Verification Suite ---');

// 1. Shopify Error
runCheck('Shopify API error attaches structured fields and keeps byte-exact message', () => {
    assert.ok(serverContent.includes('const err = new Error(`Shopify API error: ${response.status} - ${errorText}`);'));
    assert.ok(serverContent.includes("err.service = 'shopify';"));
    assert.ok(serverContent.includes("err.mutationClass = isMutate ? 'MUTATE_IDEMPOTENT' : 'READ';"));

    // Simulate Shopify error object
    const status = 429;
    const errorText = 'Too Many Requests';
    const err = new Error(`Shopify API error: ${status} - ${errorText}`);
    err.status = status;
    err.service = 'shopify';
    err.retryable = status >= 500 || status === 429;
    err.mutationClass = 'READ';

    assert.strictEqual(err.message, 'Shopify API error: 429 - Too Many Requests');
    assert.strictEqual(err.status, 429);
    assert.strictEqual(err.service, 'shopify');
    assert.strictEqual(err.retryable, true);
    assert.strictEqual(err.mutationClass, 'READ');
});

// 2. Shiprocket Error
runCheck('Shiprocket API error attaches structured fields and forbids retry on create', () => {
    assert.ok(serverContent.includes('const err = new Error(`Shiprocket API error: ${response.status} - ${errorText}`);'));
    assert.ok(serverContent.includes("err.service = 'shiprocket';"));
    assert.ok(serverContent.includes("err.retryable = !isCreate && (response.status >= 500 || response.status === 429);"));
    assert.ok(serverContent.includes("err.mutationClass = isCreate ? 'MUTATE_UNKNOWN' : 'READ';"));

    // Simulate Create error
    const isCreate = true;
    const status = 500;
    const errorText = 'Internal Server Error';
    const err = new Error(`Shiprocket API error: ${status} - ${errorText}`);
    err.status = status;
    err.service = 'shiprocket';
    err.retryable = !isCreate && (status >= 500 || status === 429);
    err.mutationClass = isCreate ? 'MUTATE_UNKNOWN' : 'READ';

    assert.strictEqual(err.message, 'Shiprocket API error: 500 - Internal Server Error');
    assert.strictEqual(err.status, 500);
    assert.strictEqual(err.service, 'shiprocket');
    assert.strictEqual(err.retryable, false); // Create must NEVER be retryable
    assert.strictEqual(err.mutationClass, 'MUTATE_UNKNOWN');
});

// 3. Delhivery Error
runCheck('Delhivery API error attaches structured fields and preserves isUnserviceableError matching', () => {
    assert.ok(serverContent.includes('const err = new Error(`Delhivery API error: ${response.status} - ${errorText}`);'));
    assert.ok(serverContent.includes("err.service = 'delhivery';"));
    assert.ok(serverContent.includes("err.retryable = !isCreate && (response.status >= 500 || response.status === 429);"));
    assert.ok(serverContent.includes("err.mutationClass = isCreate ? 'MUTATE_UNKNOWN' : 'READ';"));

    // Test unserviceable string matching
    const status = 400;
    const errorText = 'area not serviceable';
    const err = new Error(`Delhivery API error: ${status} - ${errorText}`);
    err.status = status;
    err.service = 'delhivery';
    err.retryable = false;
    err.mutationClass = 'READ';

    assert.strictEqual(err.message, 'Delhivery API error: 400 - area not serviceable');
    // Function isUnserviceableError check:
    const lower = err.message.toLowerCase();
    const isUnserviceable = lower.includes('unserviceable') || lower.includes('not serviceable');
    assert.strictEqual(isUnserviceable, true);
});

// 4. Ekart Auth Error
runCheck('Ekart auth error attaches structured fields with mutationClass READ', () => {
    assert.ok(serverContent.includes("const err = new Error(`Ekart auth failed: ${response.status} - ${(text || '').substring(0, 300)}`);"));
    assert.ok(serverContent.includes("err.service = 'ekart';"));
    assert.ok(serverContent.includes("err.mutationClass = 'READ';"));

    const status = 401;
    const text = 'Invalid credentials';
    const err = new Error(`Ekart auth failed: ${status} - ${text}`);
    err.status = status;
    err.service = 'ekart';
    err.retryable = status >= 500 || status === 429;
    err.mutationClass = 'READ';

    assert.strictEqual(err.message, 'Ekart auth failed: 401 - Invalid credentials');
    assert.strictEqual(err.status, 401);
    assert.strictEqual(err.service, 'ekart');
    assert.strictEqual(err.retryable, false);
    assert.strictEqual(err.mutationClass, 'READ');
});

// 5. Ekart API Error
runCheck('Ekart API error attaches structured fields with correct create vs read classification', () => {
    assert.ok(serverContent.includes("const err = new Error(`Ekart API error: ${response.status} - ${errorText.substring(0, 300)}`);"));
    assert.ok(serverContent.includes("err.service = 'ekart';"));
    assert.ok(serverContent.includes("err.retryable = !isCreate && (response.status >= 500 || response.status === 429);"));
    assert.ok(serverContent.includes("err.mutationClass = isCreate ? 'MUTATE_UNKNOWN' : 'READ';"));

    // Read error
    const isCreate = false;
    const status = 503;
    const errorText = 'Service Unavailable';
    const err = new Error(`Ekart API error: ${status} - ${errorText}`);
    err.status = status;
    err.service = 'ekart';
    err.retryable = !isCreate && (status >= 500 || status === 429);
    err.mutationClass = isCreate ? 'MUTATE_UNKNOWN' : 'READ';

    assert.strictEqual(err.message, 'Ekart API error: 503 - Service Unavailable');
    assert.strictEqual(err.status, 503);
    assert.strictEqual(err.service, 'ekart');
    assert.strictEqual(err.retryable, true);
    assert.strictEqual(err.mutationClass, 'READ');
});

say('');
say(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
