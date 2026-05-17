/**
 * Recover duplicate Delhivery orders by querying existing waybills
 * Usage: node recover-duplicate-delhivery.js [REQUEST_ID]
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
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

async function recoverDuplicateOrder(requestId) {
  console.log(`\n🔍 Attempting to recover waybill for ${requestId}...\n`);
  
  try {
    // Query Delhivery using the order reference number
    const trackingData = await delhiveryAPI(`/v1/packages/json/?refnum=${requestId}`);
    
    console.log('📦 Delhivery Response:');
    console.log(JSON.stringify(trackingData, null, 2));
    
    if (trackingData && trackingData.packages && trackingData.packages.length > 0) {
      const pkg = trackingData.packages[0];
      const waybill = pkg.waybill_code || pkg.awb;
      
      if (waybill) {
        console.log(`\n✅ Found existing waybill: ${waybill}`);
        console.log(`   Package Status: ${pkg.current_status || 'Unknown'}`);
        console.log(`   Reference: ${pkg.refnum}`);
        
        // Update the database with the recovered waybill
        const { data, error } = await supabase
          .from('return_requests')
          .update({
            awb_number: waybill,
            carrier_used: 'delhivery',
            status: 'pickup_pending',
            updated_at: new Date().toISOString()
          })
          .eq('request_id', requestId);
        
        if (error) {
          console.error(`\n❌ Database update failed:`, error.message);
        } else {
          console.log(`\n✅ Database updated successfully!`);
          console.log(`   ${requestId} now has AWB: ${waybill}`);
        }
        
        return waybill;
      } else {
        console.log(`\n❌ No waybill found in Delhivery response`);
      }
    } else {
      console.log(`\n❌ No packages found for ${requestId} in Delhivery`);
    }
  } catch (error) {
    console.error(`\n❌ Recovery failed:`, error.message);
  }
  
  return null;
}

async function main() {
  const requestId = process.argv[2];
  
  if (!requestId) {
    console.log('Usage: node recover-duplicate-delhivery.js <REQUEST_ID>');
    console.log('\nExample: node recover-duplicate-delhivery.js REQ-76588');
    process.exit(1);
  }
  
  await recoverDuplicateOrder(requestId);
}

main().catch(console.error);
