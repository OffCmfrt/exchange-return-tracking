/**
 * Batch recover all orders that already exist in Delhivery
 * Queries pending orders and checks if they have existing waybills in Delhivery
 * Updates their status to 'pickup_pending' if found
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

async function getOrdersNeedingRecovery() {
  console.log('🔍 Fetching orders that need recovery...\n');
  
  // Get orders that are approved but don't have AWB numbers
  const { data: orders, error } = await supabase
    .from('requests')
    .select('request_id, order_number, status, carrier, created_at')
    .in('status', ['approved', 'pickup_pending'])
    .is('awb_number', null)
    .order('created_at', { ascending: false })
    .limit(500);
  
  if (error) {
    console.error('❌ Database query failed:', error.message);
    return [];
  }
  
  console.log(`📊 Found ${orders.length} orders without AWB numbers\n`);
  return orders;
}

async function checkDelhiveryForOrder(requestId) {
  try {
    // Query Delhivery using the order reference number
    const trackingData = await delhiveryAPI(`/v1/packages/json/?refnum=${requestId}`);
    
    if (trackingData && trackingData.packages && trackingData.packages.length > 0) {
      const pkg = trackingData.packages[0];
      const waybill = pkg.waybill_code || pkg.awb;
      
      if (waybill) {
        return {
          found: true,
          waybill,
          status: pkg.current_status || 'Unknown',
          refnum: pkg.refnum
        };
      }
    }
    
    return { found: false };
  } catch (error) {
    console.error(`   ⚠️  Error checking ${requestId}:`, error.message);
    return { found: false, error: error.message };
  }
}

async function updateOrderStatus(requestId, waybill, carrierUsed = 'delhivery') {
  const { data, error } = await supabase
    .from('requests')
    .update({
      awb_number: waybill,
      carrier: carrierUsed,
      status: 'pickup_booked',
      updated_at: new Date().toISOString()
    })
    .eq('request_id', requestId);
  
  if (error) {
    console.error(`   ❌ Update failed:`, error.message);
    return false;
  }
  
  return true;
}

async function main() {
  console.log('🚀 Starting batch recovery of Delhivery orders...\n');
  
  const orders = await getOrdersNeedingRecovery();
  
  if (orders.length === 0) {
    console.log('✅ No orders need recovery. Exiting.');
    return;
  }
  
  let recovered = 0;
  let notFound = 0;
  let errors = 0;
  const results = [];
  
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    console.log(`[${i + 1}/${orders.length}] Checking ${order.request_id} (Status: ${order.status})...`);
    
    const delhiveryResult = await checkDelhiveryForOrder(order.request_id);
    
    if (delhiveryResult.found) {
      console.log(`   ✅ Found in Delhivery - AWB: ${delhiveryResult.waybill}, Status: ${delhiveryResult.status}`);
      
      const updated = await updateOrderStatus(
        order.request_id,
        delhiveryResult.waybill,
        'delhivery'
      );
      
      if (updated) {
        console.log(`   ✅ Database updated - Status set to pickup_pending`);
        recovered++;
        results.push({
          requestId: order.request_id,
          waybill: delhiveryResult.waybill,
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
      console.log(`   ❌ Not found in Delhivery`);
      notFound++;
      results.push({
        requestId: order.request_id,
        status: 'not_in_delhivery'
      });
    }
    
    // Add small delay to avoid rate limiting
    if (i < orders.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 RECOVERY SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total orders checked: ${orders.length}`);
  console.log(`✅ Recovered: ${recovered}`);
  console.log(`❌ Not in Delhivery: ${notFound}`);
  console.log(`⚠️  Update errors: ${errors}`);
  console.log('='.repeat(60));
  
  if (recovered > 0) {
    console.log('\n📋 RECOVERED ORDERS:');
    results
      .filter(r => r.status === 'recovered')
      .forEach(r => {
        console.log(`   ${r.requestId} → AWB: ${r.waybill}`);
      });
  }
  
  console.log('\n✅ Batch recovery complete!');
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
