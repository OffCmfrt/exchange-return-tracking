/**
 * Recovery Script: Fix orders that exist in Delhivery but are stuck in "pending review" (pending/pickup_pending) status
 * 
 * Problem: Orders were already initiated in Delhivery but database shows them as:
 * - Status: "pending" (Pending Review) or "pickup_pending" 
 * - Missing AWB number
 * - Re-initiating creates duplicate orders in Delhivery
 * 
 * Solution: Query Delhivery for existing orders, recover AWB, and update status to pickup_booked
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

// Find orders that need recovery
async function getStuckOrders() {
  console.log('🔍 Fetching orders stuck in pending/pickup_pending without AWB...\n');
  
  const { data: orders, error } = await supabase
    .from('requests')
    .select('request_id, order_number, status, carrier, type, created_at, awb_number')
    .in('status', ['pending', 'pickup_pending'])
    .is('awb_number', null)
    .order('created_at', { ascending: false })
    .limit(200);
  
  if (error) {
    console.error('❌ Database query failed:', error.message);
    return [];
  }
  
  console.log(`📊 Found ${orders.length} orders that may need recovery\n`);
  return orders;
}

// Check if order exists in Delhivery
async function checkDelhiveryForOrder(requestId, type = 'return') {
  try {
    // For forward shipments (exchanges), use fws- prefix
    const searchRef = type === 'exchange' ? `fws-${requestId}` : requestId;
    
    console.log(`   🔍 Checking Delhivery for: ${searchRef}`);
    
    // Query by reference number
    const trackingData = await delhiveryAPI(`/v1/packages/json/?refnum=${searchRef}`);
    
    if (trackingData && trackingData.packages && trackingData.packages.length > 0) {
      const pkg = trackingData.packages[0];
      const waybill = pkg.waybill_code || pkg.awb;
      const currentStatus = pkg.current_status || 'Unknown';
      
      if (waybill) {
        console.log(`   ✅ Found! AWB: ${waybill}, Status: ${currentStatus}`);
        return {
          found: true,
          waybill,
          delhiveryStatus: currentStatus,
          refnum: pkg.refnum,
          searchedRef: searchRef
        };
      }
    }
    
    console.log(`   ❌ Not found in Delhivery`);
    return { found: false, searchedRef: searchRef };
  } catch (error) {
    console.error(`   ⚠️  Error checking ${requestId}:`, error.message);
    return { found: false, error: error.message };
  }
}

// Update order in database with recovered data
async function updateOrderWithRecoveredData(requestId, waybill, delhiveryStatus) {
  // Map Delhivery status to our internal status
  let newStatus = 'pickup_booked';
  
  const statusUpper = delhiveryStatus.toUpperCase();
  if (statusUpper.includes('PICKED UP') || statusUpper.includes('PICKUP')) {
    newStatus = 'picked_up';
  } else if (statusUpper.includes('IN TRANSIT') || statusUpper.includes('SHIPPED') || 
             statusUpper.includes('OUT FOR DELIVERY') || statusUpper.includes('DISPATCHED')) {
    newStatus = 'in_transit';
  } else if (statusUpper.includes('DELIVERED')) {
    newStatus = 'delivered';
  } else if (statusUpper.includes('SCHEDULED')) {
    newStatus = 'scheduled';
  }
  
  const { data, error } = await supabase
    .from('requests')
    .update({
      awb_number: waybill,
      carrier: 'delhivery',
      status: newStatus,
      updated_at: new Date().toISOString()
    })
    .eq('request_id', requestId);
  
  if (error) {
    console.error(`   ❌ Update failed:`, error.message);
    return false;
  }
  
  console.log(`   ✅ Database updated - Status: ${newStatus}, AWB: ${waybill}`);
  return true;
}

// Main recovery process
async function main() {
  console.log('🚀 Starting recovery of Delhivery orders stuck in pending review...\n');
  console.log('='.repeat(70));
  
  const orders = await getStuckOrders();
  
  if (orders.length === 0) {
    console.log('✅ No orders need recovery. Exiting.');
    return;
  }
  
  let recovered = 0;
  let notFound = 0;
  let errors = 0;
  const results = [];
  
  console.log('\n📋 PROCESSING ORDERS:\n');
  
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    console.log(`\n[${i + 1}/${orders.length}] ${order.request_id}`);
    console.log(`   Type: ${order.type}, Current Status: ${order.status}`);
    
    // Check in Delhivery
    const delhiveryResult = await checkDelhiveryForOrder(order.request_id, order.type);
    
    if (delhiveryResult.found) {
      // Update database with recovered data
      const updated = await updateOrderWithRecoveredData(
        order.request_id,
        delhiveryResult.waybill,
        delhiveryResult.delhiveryStatus
      );
      
      if (updated) {
        recovered++;
        results.push({
          requestId: order.request_id,
          waybill: delhiveryResult.waybill,
          delhiveryStatus: delhiveryResult.delhiveryStatus,
          status: 'recovered'
        });
      } else {
        errors++;
        results.push({
          requestId: order.request_id,
          status: 'update_failed'
        });
      }
    } else {
      notFound++;
      results.push({
        requestId: order.request_id,
        status: 'not_in_delhivery'
      });
    }
    
    // Add delay to avoid rate limiting (500ms between requests)
    if (i < orders.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 RECOVERY SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total orders checked: ${orders.length}`);
  console.log(`✅ Recovered & Updated: ${recovered}`);
  console.log(`❌ Not found in Delhivery: ${notFound}`);
  console.log(`⚠️  Database update errors: ${errors}`);
  console.log('='.repeat(70));
  
  if (recovered > 0) {
    console.log('\n📋 RECOVERED ORDERS:');
    results
      .filter(r => r.status === 'recovered')
      .forEach(r => {
        console.log(`   ${r.requestId} → AWB: ${r.waybill} (Status: ${r.delhiveryStatus})`);
      });
  }
  
  if (notFound > 0) {
    console.log('\n⚠️  ORDERS NOT IN DELHIVERY (need manual review):');
    results
      .filter(r => r.status === 'not_in_delhivery')
      .forEach(r => {
        console.log(`   ${r.requestId}`);
      });
  }
  
  console.log('\n✅ Recovery process complete!');
  console.log('\n💡 Next Steps:');
  console.log('   1. Verify recovered orders in admin dashboard');
  console.log('   2. For orders not found in Delhivery, initiate pickup manually');
  console.log('   3. Monitor tracking updates via background sync\n');
}

// Run the script
main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
