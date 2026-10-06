// ============================================================================
// Data Migration: Old Influencer System -> Athlete Program
// ----------------------------------------------------------------------------
// Run AFTER supabase_migration_athlete_program.sql has been applied.
// Maps existing data into the new domain model.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node migrate-to-athlete-program.js
// ============================================================================

require('dotenv').config();
const supabase = require('./config/supabase');

async function migrate() {
  console.log('=== Athlete Program Data Migration ===\n');

  // 1. Map comfort levels
  console.log('1. Mapping comfort levels...');
  const { data: levels, error: lvlErr } = await supabase
    .from('comfort_levels')
    .select('id, ordinal, code')
    .order('ordinal');

  if (lvlErr) { console.error('   Error:', lvlErr.message); return; }
  const levelByOrdinal = {};
  levels.forEach(l => levelByOrdinal[l.ordinal] = l.id);
  console.log(`   Found ${levels.length} levels`);

  // 2. Migrate influencers
  console.log('\n2. Migrating influencers...');
  const { data: oldInfluencers, error: infErr } = await supabase
    .from('influencers')
    .select('*');

  if (infErr) { console.error('   Error fetching influencers:', infErr.message); return; }
  console.log(`   Found ${oldInfluencers.length} influencers`);

  let migrated = 0;
  let errors = 0;

  for (const inf of oldInfluencers) {
    try {
      const athleteNo = 'OFC-' + String(inf.id).padStart(4, '0');

      const statusMap = {
        'pending': 'APPLIED',
        'active': 'ACTIVE',
        'suspended': 'SUSPENDED',
        'rejected': 'REJECTED'
      };
      const athleteStatus = statusMap[inf.status] || 'ACTIVE';

      let levelOrdinal = 1;
      const tier = inf.follower_tier || 'Rising Star';
      if (tier === 'Top Tier Creator') levelOrdinal = 4;
      else if (tier === 'Established Influencer') levelOrdinal = 3;
      else if (tier === 'Growing Creator') levelOrdinal = 2;

      const levelId = levelByOrdinal[levelOrdinal];

      // Update influencer with new fields
      const { error: updateErr } = await supabase
        .from('influencers')
        .update({
          athlete_no: athleteNo,
          athlete_status: athleteStatus,
          level_id: levelId,
          xp_total: 0,
          coin_balance: 0,
          standing_score: 70,
          joined_at: inf.approved_at || inf.applied_at || new Date().toISOString(),
          level_since: new Date().toISOString()
        })
        .eq('id', inf.id);

      if (updateErr) {
        console.error(`   Error updating influencer ${inf.id}:`, updateErr.message);
        errors++;
        continue;
      }

      // 3. Create social records
      if (inf.instagram_handle) {
        const { error: socialErr } = await supabase.from('influencer_socials').upsert([{
          influencer_id: inf.id,
          platform: 'instagram',
          handle: inf.instagram_handle,
          followers: inf.follower_count || 0,
          is_primary: true
        }], { onConflict: 'influencer_id,platform' });
        if (socialErr) console.log(`   Social skip (ig) ${inf.id}: ${socialErr.message}`);
      }

      if (inf.youtube_handle) {
        const { error: socialErr } = await supabase.from('influencer_socials').upsert([{
          influencer_id: inf.id,
          platform: 'youtube',
          handle: inf.youtube_handle,
          followers: 0,
          is_primary: !inf.instagram_handle
        }], { onConflict: 'influencer_id,platform' });
        if (socialErr) console.log(`   Social skip (yt) ${inf.id}: ${socialErr.message}`);
      }

      // 4. Create discount_code record
      if (inf.shopify_price_rule_id || inf.referral_code) {
        const { error: dcErr } = await supabase.from('discount_codes').upsert([{
          influencer_id: inf.id,
          code: inf.referral_code || 'CODE-' + inf.id,
          shopify_price_rule_id: inf.shopify_price_rule_id,
          shopify_discount_code_id: inf.shopify_discount_code_id,
          percent: inf.discount_value || 7,
          is_active: athleteStatus === 'ACTIVE'
        }], { onConflict: 'code' });
        if (dcErr) console.log(`   Discount skip ${inf.id}: ${dcErr.message}`);
      }

      // 5. Create level_history entry
      const { error: lhErr } = await supabase.from('level_history').insert([{
        influencer_id: inf.id,
        from_level_id: null,
        to_level_id: levelId,
        direction: 'OVERRIDE',
        reason_code: 'MIGRATION',
        actor_id: 'system'
      }]);
      if (lhErr) console.log(`   Level history skip ${inf.id}: ${lhErr.message}`);

      // 6. Create PROGRESS access token
      const crypto = require('crypto');
      const rawToken = inf.link_token || crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      const { error: tokErr } = await supabase.from('access_tokens').insert([{
        influencer_id: inf.id,
        scope: 'PROGRESS',
        token_hash: tokenHash,
        expires_at: null,
        single_use: false
      }]);
      if (tokErr) console.log(`   Token skip ${inf.id}: ${tokErr.message}`);

      migrated++;
      if (migrated % 10 === 0) console.log(`   ... ${migrated}/${oldInfluencers.length}`);
    } catch (err) {
      console.error(`   Error migrating influencer ${inf.id}:`, err.message);
      errors++;
    }
  }

  console.log(`   Migrated: ${migrated}, Errors: ${errors}`);

  // 7. Migrate influencer_orders -> attributed_orders (batch with pagination)
  console.log('\n3. Migrating orders...');
  let allOrders = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data: pageOrders, error: pageErr } = await supabase
      .from('influencer_orders')
      .select('*')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (pageErr) { console.error('   Page error:', pageErr.message); break; }
    if (!pageOrders || pageOrders.length === 0) break;
    allOrders = allOrders.concat(pageOrders);
    if (pageOrders.length < PAGE_SIZE) break;
    page++;
  }
  const oldOrders = allOrders;
  console.log(`   Fetched ${oldOrders.length} orders in ${page + 1} pages`);
  let ordersMigrated = 0;
  let ordersSkipped = 0;

  if (oldOrders && oldOrders.length > 0) {
    // Build all order records
    const orderRecords = oldOrders.map(order => {
      const inf = oldInfluencers.find(i => i.id === order.influencer_id);
      const commissionRate = inf?.commission_rate || 5;
      const netValue = parseFloat(order.total_price) || 0;
      const commissionAmount = Math.round(netValue * commissionRate / 100 * 100) / 100;
      return {
        influencer_id: order.influencer_id,
        shopify_order_id: order.shopify_order_id,
        code_used: order.referral_code,
        attribution_method: 'CODE',
        net_value: netValue,
        placed_at: order.order_created_at,
        is_cancelled: !!order.cancelled_at,
        refunded_amount: 0,
        is_self_purchase: false,
        commission_rate: commissionRate,
        commission_amount: commissionAmount,
        commission_status: order.cancelled_at ? 'REVERSED' : 'EARNED',
        currency: order.currency || 'INR',
        customer_name: order.customer_name,
        financial_status: order.financial_status,
        fulfillment_status: order.fulfillment_status
      };
    });

    // Batch insert in groups of 100
    const BATCH = 100;
    for (let i = 0; i < orderRecords.length; i += BATCH) {
      const batch = orderRecords.slice(i, i + BATCH);
      const { error: batchErr } = await supabase.from('attributed_orders').upsert(batch, { onConflict: 'shopify_order_id' });
      if (batchErr) {
        // If batch upsert fails, try one-by-one
        for (const rec of batch) {
          const { error: singleErr } = await supabase.from('attributed_orders').upsert([rec], { onConflict: 'shopify_order_id' });
          if (singleErr) {
            ordersSkipped++;
          } else {
            ordersMigrated++;
          }
        }
      } else {
        ordersMigrated += batch.length;
      }
      if ((i + BATCH) % 500 === 0) console.log(`   ... ${Math.min(i + BATCH, orderRecords.length)}/${orderRecords.length}`);
    }
  }

  console.log(`   Migrated: ${ordersMigrated}, Skipped: ${ordersSkipped}`);

  // 8. Migrate payouts
  console.log('\n4. Migrating payouts...');
  const { data: oldPayouts } = await supabase.from('influencer_payouts').select('*').range(0, 10000);
  let payoutsMigrated = 0;

  for (const payout of (oldPayouts || [])) {
    try {
      const idempotencyKey = `payout:${payout.influencer_id}:${payout.month || payout.period_start || 'legacy'}`;

      const { error: payErr } = await supabase.from('payouts').insert([{
        influencer_id: payout.influencer_id,
        period_start: payout.period_start || '2024-01-01',
        period_end: payout.period_end || '2024-12-31',
        gross: parseFloat(payout.amount_due || payout.amount) || 0,
        tds_amount: 0,
        net: parseFloat(payout.amount_due || payout.amount) || 0,
        status: payout.status === 'paid' ? 'SENT' : 'DRAFT',
        idempotency_key: idempotencyKey,
        notes: payout.notes
      }]);
      if (payErr && !payErr.message.includes('duplicate')) {
        console.log(`   Payout skip: ${payErr.message}`);
      }
      payoutsMigrated++;
    } catch (err) {
      // Skip duplicates
    }
  }

  console.log(`   Migrated: ${payoutsMigrated} payouts`);

  // 9. Migrate pending applications
  console.log('\n5. Migrating pending applications...');
  const { data: pendingInfluencers } = await supabase
    .from('influencers')
    .select('*')
    .eq('status', 'pending');

  let appsMigrated = 0;
  for (const inf of (pendingInfluencers || [])) {
    try {
      const { error: appErr } = await supabase.from('applications').insert([{
        payload: {
          name: inf.name,
          platform: 'instagram',
          followers: inf.follower_count || 0,
          niche: inf.niche,
          city: inf.city,
          why_join: inf.why_join || ''
        },
        email: inf.email || 'migrated-' + inf.id + '@placeholder.com',
        phone: inf.phone || '0000000000',
        primary_handle: inf.instagram_handle || '',
        auto_score: 0,
        status: 'APPLIED',
        influencer_id: inf.id
      }]);
      if (appErr) console.log(`   App skip ${inf.id}: ${appErr.message}`);
      appsMigrated++;
    } catch (err) {
      // Skip
    }
  }

  console.log(`   Migrated: ${appsMigrated} applications`);

  // 10. Seed XP for active influencers based on order history
  console.log('\n6. Seeding XP from order history...');
  const { data: activeInfluencers } = await supabase
    .from('influencers')
    .select('id')
    .in('athlete_status', ['ACTIVE', 'SUSPENDED']);

  let xpSeeded = 0;
  for (const inf of (activeInfluencers || [])) {
    const { data: orders } = await supabase
      .from('attributed_orders')
      .select('id')
      .eq('influencer_id', inf.id);

    const orderCount = orders?.length || 0;
    if (orderCount > 0) {
      const xpFromOrders = orderCount * 10;

      const { error: xpErr } = await supabase.from('ledger_entries').insert([{
        influencer_id: inf.id,
        currency: 'XP',
        amount: xpFromOrders,
        balance_after: xpFromOrders,
        source_type: 'ORDER',
        reason_code: 'MIGRATION_SEED',
        actor_id: 'system',
        idempotency_key: `migration:xp:${inf.id}`
      }]);
      if (xpErr) console.log(`   XP skip ${inf.id}: ${xpErr.message}`);

      await supabase.from('influencers')
        .update({ xp_total: xpFromOrders })
        .eq('id', inf.id);

      xpSeeded++;
    }
  }

  console.log(`   Seeded XP for: ${xpSeeded} influencers`);

  console.log('\n=== Migration Complete ===');
  console.log(`   Influencers: ${migrated}/${oldInfluencers.length}`);
  console.log(`   Orders: ${ordersMigrated}`);
  console.log(`   Payouts: ${payoutsMigrated}`);
  console.log(`   Applications: ${appsMigrated}`);
  console.log(`   XP Seeded: ${xpSeeded}`);
  console.log(`   Errors: ${errors}`);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
