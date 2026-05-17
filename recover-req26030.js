/**
 * Recover REQ-26030 - Successfully created in Delhivery but DB update failed
 * Delhivery response: AWB 54716210000781, Order: fws-REQ-26030
 * Failed due to missing pickup_booked status in DB constraint
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const requestId = 'REQ-26030';
  
  console.log(`\n🔧 Recovering ${requestId}...\n`);
  console.log('   This is a FORWARD DISPATCH (exchange):');
  console.log('   - Delhivery order: fws-REQ-26030');
  console.log('   - AWB: 54716210000781');
  console.log('   - Delhivery status: Success');
  console.log('   - DB update failed: missing pickup_booked constraint\n');
  
  // Check current status
  const { data: currentData, error: fetchError } = await supabase
    .from('requests')
    .select('*')
    .eq('request_id', requestId)
    .single();
  
  if (fetchError) {
    console.error('❌ Error fetching request:', fetchError.message);
    process.exit(1);
  }
  
  console.log('📋 Current Status:');
  console.log(`   Type: ${currentData.type}`);
  console.log(`   Status: ${currentData.status}`);
  console.log(`   Carrier: ${currentData.carrier || 'Not set'}`);
  console.log(`   AWB: ${currentData.awb_number || 'Not set'}`);
  console.log(`   Shipment ID: ${currentData.shipment_id || 'Not set'}\n`);
  
  // Try to update with pickup_booked status
  const { data, error } = await supabase
    .from('requests')
    .update({
      carrier: 'delhivery',
      awb_number: '54716210000781',
      status: 'pickup_booked',
      updated_at: new Date().toISOString()
    })
    .eq('request_id', requestId)
    .select();
  
  if (error) {
    console.error('❌ Update failed:', error.message);
    
    if (error.code === '23514' && error.message.includes('pickup_booked')) {
      console.log('\n⚠️  Database constraint does not allow "pickup_booked" status yet!');
      console.log('\n📋 To fix this, run the SQL migration:');
      console.log('   1. Go to Supabase Dashboard → SQL Editor');
      console.log('   2. Copy content from: supabase_migration_add_pickup_booked_status.sql');
      console.log('   3. Run the migration');
      console.log('   4. Then run this script again\n');
    }
    
    process.exit(1);
  }
  
  if (data && data.length > 0) {
    console.log('✅ SUCCESS! Request updated.\n');
    console.log('📋 Updated Record:');
    console.log(`   Request ID: ${data[0].request_id}`);
    console.log(`   Order Number: ${data[0].order_number}`);
    console.log(`   Type: ${data[0].type}`);
    console.log(`   Carrier: ${data[0].carrier}`);
    console.log(`   AWB: ${data[0].awb_number}`);
    console.log(`   Status: ${data[0].status}`);
    console.log(`   Updated At: ${data[0].updated_at}`);
    
    console.log('\n💡 Next Steps:');
    console.log('   1. Customer can track using AWB: 54716210000781');
    console.log('   2. Check Delhivery dashboard for tracking updates');
    console.log('   3. Background sync will update status automatically');
  } else {
    console.log('⚠️  No records updated. Request ID might not exist.');
  }
  
  console.log('\n✅ Recovery complete!');
}

main().catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
});
