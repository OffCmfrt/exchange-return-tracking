/**
 * Dry-run version: Check which pending orders exist in Delhivery WITHOUT updating
 * 
 * Use this FIRST to see what will be recovered before running the actual recovery script
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Delhivery API helper
async function delhiveryAPI(endpoint) {
  const response = await fetch(`https://track.delhivery.com/api${endpoint}`, {
    headers: {
      'Authorization': `Token ${process.env.DELHIVERY_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Delhivery API error: ${response.status} ${response.statusText}`);
  }
  
  return await response.json();
}

async function main() {
  console.log('🔍 DRY RUN - Checking pending orders in Delhivery (NO updates will be made)\n');
  console.log('='.repeat(70));
  
  // Get orders without AWB numbers in pending/pickup_pending status
  const { data: orders, error } = await supabase
    .from('requests')
    .select('request_id, order_number, status, carrier, type, created_at, awb_number')
    .in('status', ['pending', 'pickup_pending'])
    .is('awb_number', null)
    .order('created_at', { ascending: false })
    .limit(200);
  
  if (error) {
    console.error('❌ Database query failed:', error.message);
    process.exit(1);
  }
  
  console.log(`📊 Found ${orders.length} orders in pending/pickup_pending status without AWB\n`);
  
  if (orders.length === 0) {
    console.log('✅ No orders need recovery. Exiting.');
    return;
  }
  
  let foundCount = 0;
  let notFoundCount = 0;
  const results = [];
  
  console.log('\n📋 CHECKING ORDERS:\n');
  
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    console.log(`\n[${i + 1}/${orders.length}] ${order.request_id}`);
    console.log(`   Type: ${order.type}, Status: ${order.status}, Created: ${new Date(order.created_at).toLocaleDateString('en-IN')}`);
    
    try {
      // For forward shipments (exchanges), use fws- prefix
      const searchRef = order.type === 'exchange' ? `fws-${order.request_id}` : order.request_id;
      console.log(`   🔍 Searching Delhivery for: ${searchRef}`);
      
      // Query Delhivery
      const trackingData = await delhiveryAPI(`/v1/packages/json/?refnum=${searchRef}`);
      
      if (trackingData && trackingData.packages && trackingData.packages.length > 0) {
        const pkg = trackingData.packages[0];
        const waybill = pkg.waybill_code || pkg.awb;
        const currentStatus = pkg.current_status || 'Unknown';
        
        if (waybill) {
          console.log(`   ✅ FOUND in Delhivery`);
          console.log(`      AWB: ${waybill}`);
          console.log(`      Delhivery Status: ${currentStatus}`);
          console.log(`      Reference: ${pkg.refnum}`);
          
          // Map to internal status
          let wouldUpdateTo = 'pickup_booked';
          const statusUpper = currentStatus.toUpperCase();
          if (statusUpper.includes('PICKED UP') || statusUpper.includes('PICKUP')) {
            wouldUpdateTo = 'picked_up';
          } else if (statusUpper.includes('IN TRANSIT') || statusUpper.includes('SHIPPED')) {
            wouldUpdateTo = 'in_transit';
          } else if (statusUpper.includes('DELIVERED')) {
            wouldUpdateTo = 'delivered';
          } else if (statusUpper.includes('SCHEDULED')) {
            wouldUpdateTo = 'scheduled';
          }
          
          console.log(`      → Would update DB status to: ${wouldUpdateTo}`);
          
          foundCount++;
          results.push({
            requestId: order.request_id,
            found: true,
            waybill,
            delhiveryStatus: currentStatus,
            wouldUpdateTo: wouldUpdateTo
          });
        }
      } else {
        console.log(`   ❌ Not found in Delhivery`);
        notFoundCount++;
        results.push({
          requestId: order.request_id,
          found: false
        });
      }
    } catch (error) {
      console.error(`   ⚠️  Error: ${error.message}`);
      notFoundCount++;
      results.push({
        requestId: order.request_id,
        found: false,
        error: error.message
      });
    }
    
    // Add delay to avoid rate limiting
    if (i < orders.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 DRY RUN SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total orders checked: ${orders.length}`);
  console.log(`✅ Found in Delhivery (will be recovered): ${foundCount}`);
  console.log(`❌ Not found in Delhivery: ${notFoundCount}`);
  console.log('='.repeat(70));
  
  if (foundCount > 0) {
    console.log('\n📋 ORDERS THAT WILL BE RECOVERED:');
    results
      .filter(r => r.found)
      .forEach(r => {
        console.log(`   ${r.requestId}`);
        console.log(`      → AWB: ${r.waybill}, Status: ${r.delhiveryStatus} → ${r.wouldUpdateTo}`);
      });
  }
  
  if (notFoundCount > 0) {
    console.log('\n⚠️  ORDERS NOT IN DELHIVERY (won\'t be updated):');
    results
      .filter(r => !r.found)
      .forEach(r => {
        console.log(`   ${r.requestId}`);
      });
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('💡 NEXT STEPS:');
  console.log('='.repeat(70));
  console.log('1. Review the orders above');
  console.log('2. If everything looks correct, run the actual recovery:');
  console.log('   node recover-pending-delhivery-orders.js');
  console.log('3. For orders NOT found in Delhivery, you can safely initiate pickup');
  console.log('');
}

// Run the script
main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
