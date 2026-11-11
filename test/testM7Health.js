const assert = require('assert');
const { createHealthRouter } = require('../src/routes/healthRoutes');

const router = createHealthRouter({
    version: 'test',
    getBreakers: () => ({ 'ekart:read': { state: 'open', rollingCounts: { failures: 8 }, openUntil: '2026-01-01T00:00:00.000Z' } })
});
const layer = router.stack.find(item => item.route && item.route.path === '/health');
const handler = layer.route.stack[0].handle;
const res = {
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    json(value) { this.body = value; return this; }
};
handler({}, res);
assert.strictEqual(res.body.status, 'ok');
assert.strictEqual(typeof res.body.uptimeSec, 'number');
assert.strictEqual(res.body.nodeVersion, process.version);
for (const key of ['heapUsedMB', 'heapTotalMB', 'rssMB']) assert.strictEqual(typeof res.body.memory[key], 'number');
assert.deepStrictEqual(res.body.breakers['ekart:read'], { state: 'open', rollingCounts: { failures: 8 }, openUntil: '2026-01-01T00:00:00.000Z' });
assert.strictEqual(res.headers['Cache-Control'], 'no-store');
console.log('PASS M7 /health returns liveness, runtime, memory, and breaker state without probes');
