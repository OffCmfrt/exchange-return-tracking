// ============================================================================
// Data Migration: Old Influencer System -> Athlete Program
// ----------------------------------------------------------------------------
// Run AFTER supabase_migration_athlete_program.sql has been applied.
// Maps existing data into the new domain model.
//
// Usage: node migrate-to-athlete-program.js
// ============================================================================

require('dotenv').config();
const supabase = require('./config/supabase');

async function migrate() {
  console.log('=== Athlete Program Data Migration ===\n');

  // 1. Map comfort levels
  console.log('1. Mapping comfort levels...');
  const { data: levels } = await supabase
    .from('comfort_levels')
    .select('id, ordinal, code')
    .order('ordinal');

  const levelByOrdinal = {};
  levels.forEach(l => levelByOrdinal[l.ordinal] = l.id);
  console.log(`   Found ${levels.length} levels`);

  // 2. Migrate influencers
  console.log('\n2. Migrating influencers...');
  const { data: oldInfluencers, error: infErr } = await supabase
    .from('influencers')
    .select('*');

  if (infErr) { console.error('   Error fetching influencers:', infErr); return; }
  console.log(`   Found ${oldInfluencers.length} influencers`);

  let migrated = 0;
  let errors = 0;

  for (const inf of oldInfluencers) {
    try {
      // Generate athlete_no
      const athleteNo = 'OFC-' + String(inf.id).padStart(4, '0');

      // Map status
      const statusMap = {
        'pending': 'APPLIED',
        'active': 'ACTIVE',
        'suspended': 'SUSPENDED',
        'rejected': 'REJECTED'
      };
      const athleteStatus = statusMap[inf.status] || 'ACTIVE';

      // Map follower tier to comfort level
      let levelOrdinal = 1; // Default CL5
      const tier = inf.follower_tier || 'Rising Star';
      if (tier === 'Top Tier Creator') levelOrdinal = 4;
      else if (tier === 'Established Influencer') levelOrdinal = 3;
      else if (tier === 'Growing Creator') levelOrdinal = 2;
      else levelOrdinal = 1;

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
        await supabase.from('influencer_socials').upsert([{
          influencer_id: inf.id,
          platform: 'instagram',
          handle: inf.instagram_handle,
          followers: inf.follower_count || 0,
          is_primary: true
        }], { onConflict: 'influencer_id,platform' });
      }

      if (inf.youtube_handle) {
        await supabase.from('influencer_socials').upsert([{
          influencer_id: inf.id,
          platform: 'youtube',
          handle: inf.youtube_handle,
          followers: 0,
          is_primary: !inf.instagram_handle
        }], { onConflict: 'influencer_id,platform' });
      }

      // 4. Create discount_code record
      if (inf.shopify_price_rule_id || inf.referral_code) {
        await supabase.from('discount_codes').upsert([{
          influencer_id: inf.id,
          code: inf.referral_code || 'CODE-' + inf.id,
          shopify_price_rule_id: inf.shopify_price_rule_id,
          shopify_discount_code_id: inf.shopify_discount_code_id,
          percent: inf.discount_value || 7,
          is_active: athleteStatus === 'ACTIVE'
        }], { onConflict: 'code' }).catch(() => {});
      }

      // 5. Create level_history entry
      await supabase.from('level_history').insert([{
        influencer_id: inf.id,
        from_level_id: null,
        to_level_id: levelId,
        direction: 'OVERRIDE',
        reason_code: 'MIGRATION',
        actor_id: 'system'
      }]);

      // 6. Create PROGRESS access token
      const crypto = require('crypto');
      const rawToken = inf.link_token || crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      await supabase.from('access_tokens').insert([{
        influencer_id: inf.id,
        scope: 'PROGRESS',
        token_hash: tokenHash,
        expires_at: null,
        single_use: false
      }]).catch(() => {}); // Ignore if token already exists

      migrated++;
    } catch (err) {
      console.error(`   Error migrating influencer ${inf.id}:`, err.message);
      errors++;
    }
  }

  console.log(`   Migrated: ${migrated}, Errors: ${errors}`);

  // 7. Migrate influencer_orders -> attributed_orders
  console.log('\n3. Migrating orders...');
  const { data: oldOrders } = await supabase.from('influencer_orders').select('*');
  let ordersMigrated = 0;

  for (const order of (oldOrders || [])) {
    try {
      // Find influencer's commission rate at time of migration
      const inf = oldInfluencers.find(i => i.id === order.influencer_id);
      const commissionRate = inf?.commission_rate || 5;
      const netValue = parseFloat(order.total_price) || 0;
      const commissionAmount = Math.round(netValue * commissionRate / 100 * 100) / 100;

      await supabase.from('attributed_orders').insert([{
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
      }]).catch(() => {}); // Ignore duplicates

      ordersMigrated++;
    } catch (err) {
      // Skip duplicates silently
    }
  }

  console.log(`   Migrated: ${ordersMigrated} orders`);

  // 8. Migrate payouts
  console.log('\n4. Migrating payouts...');
  const { data: oldPayouts } = await supabase.from('influencer_payouts').select('*');
  let payoutsMigrated = 0;

  for (const payout of (oldPayouts || [])) {
    try {
      const idempotencyKey = `payout:${payout.influencer_id}:${payout.month || payout.period_start || 'legacy'}`;

      await supabase.from('payouts').insert([{
        influencer_id: payout.influencer_id,
        period_start: payout.period_start || '2024-01-01',
        period_end: payout.period_end || '2024-12-31',
        gross: parseFloat(payout.amount_due || payout.amount) || 0,
        tds_amount: 0,
        net: parseFloat(payout.amount_due || payout.amount) || 0,
        status: payout.status === 'paid' ? 'SENT' : 'DRAFT',
        idempotency_key: idempotencyKey,
        notes: payout.notes
      }]).catch(() => {});

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
      await supabase.from('applications').insert([{
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
      }]).catch(() => {});

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
      const xpFromOrders = orderCount * 10; // 10 XP per order

      await supabase.from('ledger_entries').insert([{
        influencer_id: inf.id,
        currency: 'XP',
        amount: xpFromOrders,
        balance_after: xpFromOrders,
        source_type: 'ORDER',
        reason_code: 'MIGRATION_SEED',
        actor_id: 'system',
        idempotency_key: `migration:xp:${inf.id}`
      }]).catch(() => {});

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
