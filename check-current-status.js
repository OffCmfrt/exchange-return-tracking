require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRequestStatus() {
  console.log('=== Checking Request Status Distribution ===\n');

  // Get all requests by status
  const { data: allRequests, error } = await supabase
    .from('requests')
    .select('status, carrier, carrier_awb, carrier_shipment_id, awb_number, shipment_id, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching requests:', error);
    return;
  }

  console.log(`Total requests: ${allRequests.length}\n`);

  // Count by status
  const statusCount = {};
  allRequests.forEach(req => {
    statusCount[req.status] = (statusCount[req.status] || 0) + 1;
  });

  console.log('Status Distribution:');
  Object.entries(statusCount).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });

  console.log('\n=== Pending Requests with Carrier Info (PROBLEM!) ===\n');
  
  // Find pending requests that HAVE carrier info (these shouldn't be pending)
  const pendingWithCarrier = allRequests.filter(req => 
    req.status === 'pending' && 
    (req.carrier_awb || req.carrier_shipment_id || req.awb_number || req.shipment_id)
  );

  console.log(`Found ${pendingWithCarrier.length} pending requests WITH carrier info:\n`);

  pendingWithCarrier.slice(0, 20).forEach(req => {
    console.log(`Request ID: ${req.request_id}`);
    console.log(`  Status: ${req.status}`);
    console.log(`  Carrier: ${req.carrier || 'none'}`);
    console.log(`  Carrier AWB: ${req.carrier_awb || 'none'}`);
    console.log(`  Carrier Shipment ID: ${req.carrier_shipment_id || 'none'}`);
    console.log(`  AWB Number: ${req.awb_number || 'none'}`);
    console.log(`  Shipment ID: ${req.shipment_id || 'none'}`);
    console.log(`  Created: ${req.created_at}`);
    console.log('');
  });

  if (pendingWithCarrier.length > 20) {
    console.log(`... and ${pendingWithCarrier.length - 20} more`);
  }

  console.log('\n=== Pickup Pending/Scheduled Requests ===\n');
  
  const pickupRequests = allRequests.filter(req => 
    req.status === 'pickup_pending' || req.status === 'scheduled'
  );

  console.log(`Found ${pickupRequests.length} requests in pickup_pending/scheduled:\n`);

  pickupRequests.forEach(req => {
    console.log(`Request ID: ${req.request_id}`);
    console.log(`  Status: ${req.status}`);
    console.log(`  Carrier: ${req.carrier || 'none'}`);
    console.log(`  Carrier AWB: ${req.carrier_awb || 'none'}`);
    console.log(`  Carrier Shipment ID: ${req.carrier_shipment_id || 'none'}`);
    console.log(`  Created: ${req.created_at}`);
    console.log('');
  });

  console.log('\n=== Summary ===');
  console.log(`Pending requests with carrier info (needs investigation): ${pendingWithCarrier.length}`);
  console.log(`Requests still in pickup_pending/scheduled: ${pickupRequests.length}`);
}

checkRequestStatus();
