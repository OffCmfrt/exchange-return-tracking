/**
 * Manually update REQ-76588 with the known waybill from Delhivery logs
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const requestId = 'REQ-76588';
  const waybill = '54716210000711';
  
  console.log(`\n🔧 Manually updating ${requestId}...\n`);
  console.log(`   Waybill: ${waybill}`);
  console.log(`   Status: pickup_booked`);
  console.log(`   Carrier: delhivery\n`);
  
  const { data, error } = await supabase
    .from('requests')
    .update({
      awb_number: waybill,
      carrier: 'delhivery',
      status: 'pickup_booked',
      updated_at: new Date().toISOString()
    })
    .eq('request_id', requestId)
    .select();
  
  if (error) {
    console.error('❌ Update failed:', error.message);
    process.exit(1);
  }
  
  if (data && data.length > 0) {
    console.log('✅ SUCCESS! Database updated.');
    console.log(`\n📋 Updated Record:`);
    console.log(`   Request ID: ${data[0].request_id}`);
    console.log(`   Order Number: ${data[0].order_number}`);
    console.log(`   AWB Number: ${data[0].awb_number}`);
    console.log(`   Carrier: ${data[0].carrier}`);
    console.log(`   Status: ${data[0].status}`);
    console.log(`   Updated At: ${data[0].updated_at}`);
  } else {
    console.log('⚠️  No records updated. Request ID might not exist.');
  }
  
  console.log('\n✅ Manual recovery complete!');
}

main().catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
});
