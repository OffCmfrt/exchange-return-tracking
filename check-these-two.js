require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSpecificRequests() {
  const requestIds = ['REQ-98306', 'REQ-68038'];

  console.log('=== Checking Specific Requests ===\n');

  for (const requestId of requestIds) {
    console.log(`\nChecking ${requestId}...`);
    
    const { data: request, error } = await supabase
      .from('requests')
      .select('*')
      .eq('request_id', requestId)
      .single();

    if (error || !request) {
      console.error(`Error fetching ${requestId}:`, error?.message || 'Not found');
      continue;
    }

    console.log(`  Status: ${request.status}`);
    console.log(`  Carrier: ${request.carrier}`);
    console.log(`  Carrier AWB: ${request.carrier_awb}`);
    console.log(`  Carrier Shipment ID: ${request.carrier_shipment_id}`);
    console.log(`  AWB Number: ${request.awb_number}`);
    console.log(`  Shipment ID: ${request.shipment_id}`);
    console.log(`  Admin Notes: ${request.admin_notes?.slice(-200) || 'none'}`);

    // If it has a Delhivery AWB, verify it
    if (request.carrier === 'delhivery' && request.carrier_awb) {
      console.log(`\n  Verifying AWB ${request.carrier_awb} with Delhivery...`);
      
      try {
        const response = await axios.get(
          `https://track.delhivery.com/api/packets/${request.carrier_awb}`,
          {
            headers: {
              'Content-Type': 'application/json',
              'apikey': process.env.DELHIVERY_API_KEY
            }
          }
        );

        if (response.data && response.data.Shipments && response.data.Shipments.length > 0) {
          const shipment = response.data.Shipments[0];
          console.log(`  ✅ AWB exists in Delhivery!`);
          console.log(`  Delhivery Status: ${shipment.Status}`);
          console.log(`  Order: ${shipment.Order}`);
        } else {
          console.log(`  ❌ AWB NOT FOUND in Delhivery!`);
          console.log(`  This booking failed and needs to be reset.`);
        }
      } catch (err) {
        console.log(`  ⚠️  Error checking Delhivery: ${err.message}`);
      }
    }
    
    console.log('');
  }
}

checkSpecificRequests();
