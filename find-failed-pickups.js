require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Diagnostic script to find requests that show pickup_pending/scheduled 
 * but may not have actual carrier bookings due to server crash
 */
async function findFailedPickups() {
  console.log('=== Failed Pickup Diagnostic Tool ===\n');
  console.log('Checking for requests that may have failed carrier bookings...\n');

  // Get all pickup_pending and scheduled requests
  const { data: failedRequests, error } = await supabase
    .from('requests')
    .select('*')
    .or('status.eq.pickup_pending,status.eq.scheduled')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching requests:', error);
    return;
  }

  console.log(`Found ${failedRequests.length} requests with pickup_pending/scheduled status\n`);

  // Categorize requests
  const categories = {
    noCarrier: [],
    noAwb: [],
    noShipmentId: [],
    delhivery: [],
    shiprocket: []
  };

  failedRequests.forEach(req => {
    if (!req.carrier) {
      categories.noCarrier.push(req);
    } else if (req.carrier === 'delhivery') {
      categories.delhivery.push(req);
    } else if (req.carrier === 'shiprocket') {
      categories.shiprocket.push(req);
    }
    
    if (!req.carrierAwb && !req.awbNumber) {
      categories.noAwb.push(req);
    }
    if (!req.carrierShipmentId && !req.shipmentId) {
      categories.noShipmentId.push(req);
    }
  });

  // Display summary
  console.log('=== Summary ===');
  console.log(`Total requests: ${failedRequests.length}`);
  console.log(`- Delhivery: ${categories.delhivery.length}`);
  console.log(`- Shiprocket: ${categories.shiprocket.length}`);
  console.log(`- No carrier specified: ${categories.noCarrier.length}`);
  console.log(`- Missing AWB: ${categories.noAwb.length}`);
  console.log(`- Missing Shipment ID: ${categories.noShipmentId.length}\n`);

  // Show problematic requests (missing carrier info)
  if (categories.noCarrier.length > 0 || categories.noAwb.length > 0) {
    console.log('=== Requests Missing Critical Data ===\n');
    
    const problematic = [...new Set([...categories.noCarrier, ...categories.noAwb])];
    problematic.forEach(req => {
      console.log(`Request ID: ${req.request_id}`);
      console.log(`  Order: ${req.orderNumber}`);
      console.log(`  Status: ${req.status}`);
      console.log(`  Carrier: ${req.carrier || 'NOT SET'}`);
      console.log(`  AWB: ${req.carrierAwb || req.awbNumber || 'NOT SET'}`);
      console.log(`  Shipment ID: ${req.carrierShipmentId || req.shipmentId || 'NOT SET'}`);
      console.log(`  Created: ${req.created_at}`);
      console.log('');
    });
  }

  // Show Delhivery requests for verification
  if (categories.delhivery.length > 0) {
    console.log('=== Delhivery Requests (need API verification) ===\n');
    console.log('These requests have Delhivery as carrier. To verify them:');
    console.log('1. Check if AWB exists in Delhivery dashboard');
    console.log('2. Or use Delhivery tracking API to verify each AWB\n');
    
    categories.delhivery.forEach((req, index) => {
      console.log(`${index + 1}. ${req.request_id} | Order: ${req.orderNumber} | AWB: ${req.carrierAwb || req.awbNumber || 'N/A'} | Created: ${req.created_at}`);
    });
    
    console.log('\n=== Next Steps ===');
    console.log('1. Manually verify these AWBs in Delhivery dashboard');
    console.log('2. Run recover-failed-pickups.js with the list of failed request IDs');
    console.log('3. Or use the "Reset to Pending" button in admin dashboard for individual requests\n');
  }

  // Export failed request IDs for recovery script
  const allFailedIds = [
    ...categories.noCarrier.map(r => r.request_id),
    ...categories.noAwb.map(r => r.request_id)
  ];

  if (allFailedIds.length > 0) {
    console.log('=== Failed Request IDs (for recovery) ===');
    console.log(JSON.stringify(allFailedIds, null, 2));
    console.log('\nCopy these IDs and use them in recover-failed-pickups.js\n');
  }

  console.log('=== Diagnostic Complete ===');
}

findFailedPickups().catch(console.error);
