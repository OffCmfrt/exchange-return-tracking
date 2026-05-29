/**
 * Update database with the 8 forward shipments that were just created
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const forwardShipments = [
  { requestId: 'REQ-13161', awb: '54716210002984', shipmentId: 'fws-REQ-13161' },
  { requestId: 'REQ-22347', awb: '54716210002995', shipmentId: 'fws-REQ-22347' },
  { requestId: 'REQ-35188', awb: '54716210003001', shipmentId: 'fws-REQ-35188' },
  { requestId: 'REQ-51923', awb: '54716210003010', shipmentId: 'fws-REQ-51923' },
  { requestId: 'REQ-57939', awb: '54716210003021', shipmentId: 'fws-REQ-57939' },
  { requestId: 'REQ-60414', awb: '54716210003032', shipmentId: 'fws-REQ-60414' },
  { requestId: 'REQ-66532', awb: '54716210003043', shipmentId: 'fws-REQ-66532' },
  { requestId: 'REQ-94765', awb: '54716210003054', shipmentId: 'fws-REQ-94765' }
];

async function updateDatabase() {
  console.log('\n=== UPDATING DATABASE WITH FORWARD SHIPMENTS ===\n');

  let successCount = 0;

  for (const fwd of forwardShipments) {
    console.log(`📦 Updating ${fwd.requestId}...`);
    
    const { error } = await supabase
      .from('requests')
      .update({
        forward_shipment_id: fwd.shipmentId,
        forward_awb_number: fwd.awb,
        forward_status: 'scheduled',
        admin_notes: `${new Date().toISOString()} - Forward created with CORRECT replacement products via recovery script. AWB: ${fwd.awb}`
      })
      .eq('request_id', fwd.requestId);

    if (error) {
      console.error(`   ❌ Failed: ${error.message}`);
    } else {
      console.log(`   ✅ Updated - AWB: ${fwd.awb}`);
      successCount++;
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Successfully updated ${successCount}/${forwardShipments.length} orders`);
  console.log(`${'='.repeat(80)}\n`);
}

updateDatabase().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
