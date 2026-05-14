/**
 * Recover REQ-67796 - Forward dispatch order approved by admin
 * Successfully created in Shiprocket (shipment_id: 1340042737)
 * Currently stuck in pickup_pending, needs status update
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const requestId = 'REQ-67796';
  
  console.log(`\n🔧 Recovering ${requestId}...\n`);
  console.log('   This is a FORWARD DISPATCH order:');
  console.log('   - Admin approved the dispatch');
  console.log('   - Delhivery initially failed (duplicate order error)');
  console.log('   - Successfully created in Shiprocket');
  console.log('   - Shiprocket shipment_id: 1340042737');
  console.log('   - Currently stuck in: pickup_pending');
  console.log('   - Needs status update to: scheduled or pickup_booked\n');
  
  // First, check current status
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
  console.log(`   Status: ${currentData.status}`);
  console.log(`   Carrier: ${currentData.carrier || 'Not set'}`);
  console.log(`   AWB: ${currentData.awb_number || 'Not set'}`);
  console.log(`   Shipment ID: ${currentData.shipment_id || 'Not set'}\n`);
  
  // Use 'scheduled' status (works without migration)
  const newStatus = 'scheduled';
  
  const { data, error } = await supabase
    .from('requests')
    .update({
      carrier: 'shiprocket',
      shipment_id: '1340042737',
      status: newStatus,
      updated_at: new Date().toISOString()
    })
    .eq('request_id', requestId)
    .select();
  
  if (error) {
    console.error('❌ Update failed:', error.message);
    console.log('\n⚠️  If you see a constraint error, run the database migration first:');
    console.log('   File: supabase_migration_add_pickup_booked_status.sql');
    process.exit(1);
  }
  
  if (data && data.length > 0) {
    console.log('✅ SUCCESS! Request updated.\n');
    console.log('📋 Updated Record:');
    console.log(`   Request ID: ${data[0].request_id}`);
    console.log(`   Order Number: ${data[0].order_number}`);
    console.log(`   Carrier: ${data[0].carrier}`);
    console.log(`   Shipment ID: ${data[0].shipment_id}`);
    console.log(`   Status: ${data[0].status}`);
    console.log(`   Updated At: ${data[0].updated_at}`);
    
    console.log('\n💡 Next Steps:');
    console.log('   1. Check Shiprocket dashboard for AWB assignment');
    console.log('   2. AWB will be synced automatically when available');
    console.log('   3. Customer can track once AWB is assigned');
  } else {
    console.log('⚠️  No records updated. Request ID might not exist.');
  }
  
  console.log('\n✅ Recovery complete!');
}

main().catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
});
