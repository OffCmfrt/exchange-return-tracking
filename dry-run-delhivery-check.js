/**
 * Dry-run version: Check which orders exist in Delhivery without updating
 * Use this first to see what will be recovered before running the actual batch recovery
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

async function main() {
  console.log('🔍 DRY RUN - Checking orders in Delhivery (no updates will be made)\n');
  
  // Get orders without AWB numbers
  const { data: orders, error } = await supabase
    .from('requests')
    .select('request_id, order_number, status, carrier, created_at')
    .in('status', ['approved', 'pickup_pending'])
    .is('awb_number', null)
    .order('created_at', { ascending: false })
    .limit(500);
  
  if (error) {
    console.error('❌ Database query failed:', error.message);
    process.exit(1);
  }
  
  console.log(`📊 Found ${orders.length} orders to check\n`);
  console.log('='.repeat(80));
  
  let foundInDelhivery = 0;
  let notFound = 0;
  const foundOrders = [];
  
  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    process.stdout.write(`[${i + 1}/${orders.length}] Checking ${order.request_id}... `);
    
    try {
      const trackingData = await delhiveryAPI(`/v1/packages/json/?refnum=${order.request_id}`);
      
      if (trackingData && trackingData.packages && trackingData.packages.length > 0) {
        const pkg = trackingData.packages[0];
        const waybill = pkg.waybill_code || pkg.awb;
        
        if (waybill) {
          console.log(`✅ AWB: ${waybill}, Status: ${pkg.current_status || 'Unknown'}`);
          foundInDelhivery++;
          foundOrders.push({
            requestId: order.request_id,
            orderNumber: order.order_number,
            waybill,
            delhiveryStatus: pkg.current_status || 'Unknown',
            currentStatus: order.status
          });
        } else {
          console.log('❌ No waybill');
          notFound++;
        }
      } else {
        console.log('❌ Not found');
        notFound++;
      }
    } catch (error) {
      console.log(`⚠️  Error: ${error.message}`);
    }
    
    // Rate limit delay
    if (i < orders.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 DRY RUN SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total orders checked: ${orders.length}`);
  console.log(`✅ Found in Delhivery: ${foundInDelhivery}`);
  console.log(`❌ Not found: ${notFound}`);
  console.log('='.repeat(80));
  
  if (foundOrders.length > 0) {
    console.log('\n📋 ORDERS THAT WOULD BE RECOVERED:');
    console.log('='.repeat(80));
    console.log('Request ID'.padEnd(20) + 'Order Number'.padEnd(20) + 'AWB'.padEnd(20) + 'Status');
    console.log('-'.repeat(80));
    
    foundOrders.forEach(order => {
      console.log(
        order.requestId.padEnd(20) +
        order.orderNumber.padEnd(20) +
        order.waybill.padEnd(20) +
        order.delhiveryStatus
      );
    });
    
    console.log('\n💡 To recover these orders, run:');
    console.log('   node batch-recover-delhivery-orders.js');
  } else {
    console.log('\n✅ No orders found in Delhivery that need recovery.');
  }
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
