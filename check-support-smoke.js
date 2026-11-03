// ============================================================================
// Smoke test for Customer Support & Tickets System modules
// ============================================================================

const assert = require('assert');
const {
  REASONS,
  PREFERENCES,
  CONTACT_OPTIONS,
  RESOLUTION_TYPES,
  checkEligibility,
  buildCatalog,
  normalizePhone,
  last10Digits,
  generateTicketNumber,
  deriveGroup,
  createSupportService
} = require('./services/support');

console.log('--- Running Support System Smoke Tests ---');

// 1. Phone normalisation
assert.strictEqual(normalizePhone('+91 99999 88888'), '919999988888');
assert.strictEqual(normalizePhone('9999988888'), '919999988888');
assert.strictEqual(last10Digits('+91-99999-88888'), '9999988888');
console.log('✅ Phone normalisation verified');

// 2. Ticket number format: TKT-YYMMDD-NNNN
const tktNum = generateTicketNumber();
assert.match(tktNum, /^TKT-\d{6}-\d{4}$/, `Expected TKT-YYMMDD-NNNN, got ${tktNum}`);
console.log(`✅ Ticket number format verified (${tktNum})`);

// 3. Group derivation
assert.strictEqual(deriveGroup({ status: 'resolved' }), 'closed');
assert.strictEqual(deriveGroup({ status: 'closed' }), 'closed');
assert.strictEqual(deriveGroup({ status: 'open', last_agent_at: null, last_customer_at: '2026-11-03T10:00:00Z' }), 'open');
assert.strictEqual(deriveGroup({
  status: 'open',
  last_agent_at: '2026-11-03T11:00:00Z',
  last_customer_at: '2026-11-03T10:00:00Z'
}), 'awaiting');
assert.strictEqual(deriveGroup({
  status: 'open',
  last_agent_at: '2026-11-03T10:00:00Z',
  last_customer_at: '2026-11-03T11:00:00Z'
}), 'open');
console.log('✅ Group derivation rules verified');

// 4. Catalog & Eligibility
assert.strictEqual(REASONS.length, 7);
assert.strictEqual(RESOLUTION_TYPES.length, 14);

// Stage: unshipped
const unshipOrderElig = checkEligibility('order', 'cancel_order', 'unshipped');
assert.strictEqual(unshipOrderElig.eligible, true);
const unshipReturnElig = checkEligibility('return', 'return_request', 'unshipped');
assert.strictEqual(unshipReturnElig.eligible, false);

// Stage: shipped
const shippedCancelElig = checkEligibility('order', 'cancel_order', 'shipped');
assert.strictEqual(shippedCancelElig.eligible, false);

// Stage: delivered
const deliveredReturnElig = checkEligibility('return', 'return_request', 'delivered', {
  deliveredAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) // 2 days ago
});
assert.strictEqual(deliveredReturnElig.eligible, true);

const expiredReturnElig = checkEligibility('return', 'return_request', 'delivered', {
  deliveredAt: new Date(Date.now() - 10 * 24 * 3600 * 1000) // 10 days ago (window: 7 days)
});
assert.strictEqual(expiredReturnElig.eligible, false);

// Full catalog build
const cat = buildCatalog({ stage: 'delivered' });
assert.strictEqual(Array.isArray(cat.reasons), true);
assert.strictEqual(cat.limits.max_images, 3);
console.log('✅ Catalog taxonomy and stage eligibility matrix verified');

// 5. Risk and Cost models
const mockSupabase = {
  from: () => ({
    select: () => ({
      eq: () => ({ single: async () => ({ data: null, error: null }) }),
      or: () => async () => ({ data: [], error: null })
    })
  })
};

const service = createSupportService({ supabase: mockSupabase });

service.riskFor({
  order: { payment: 'COD', total: 3000, stage: 'shipped' },
  customer: { history: { rto: 1, open_tickets: 2 } },
  ticket: { sub: 'missing_item', reopen_count: 1 }
}).then(risk => {
  // COD(+2) + high_value(+1) + past_rto(+1) + proof_needed(+2) + reopened(+1) + multiple_tickets(+1) = 8 -> high
  assert.strictEqual(risk.level, 'high');
  assert.strictEqual(risk.score, 8);
  console.log(`✅ Risk engine verified (Score: ${risk.score}, Level: ${risk.level})`);
  return service.costFor({
    order: { payment: 'COD', total: 3000 },
    ticket: { preference: 'exchange' }
  });
}).then(cost => {
  assert.strictEqual(cost.options.length, 4);
  assert.ok(cost.recommendation.length > 0);
  console.log(`✅ Cost engine verified (${cost.options.length} options, recommendation: "${cost.recommendation}")`);
  console.log('\n🎉 ALL SUPPORT SYSTEM SMOKE TESTS PASSED SUCCESSFULLY! 🎉\n');
}).catch(err => {
  console.error('❌ Smoke test failed:', err);
  process.exit(1);
});
