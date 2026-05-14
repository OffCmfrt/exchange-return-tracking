/**
 * Check REQ-67796 details to confirm if it's a forward dispatch (exchange)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const requestId = 'REQ-67796';
  
  console.log(`\n🔍 Checking ${requestId} details...\n`);
  
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .eq('request_id', requestId)
    .single();
  
  if (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
  
  console.log('📋 Request Details:');
  console.log(`   Request ID: ${data.request_id}`);
  console.log(`   Order Number: ${data.order_number}`);
  console.log(`   Type: ${data.type || 'NOT SET'}`);
  console.log(`   Status: ${data.status}`);
  console.log(`   Carrier: ${data.carrier || 'Not set'}`);
  console.log(`   AWB: ${data.awb_number || 'Not set'}`);
  console.log(`   Shipment ID: ${data.shipment_id || 'Not set'}`);
  console.log(`   Customer: ${data.customer_name}`);
  console.log(`   Email: ${data.customer_email}`);
  
  console.log('\n💡 Analysis:');
  if (data.type === 'exchange') {
    console.log('   ✅ This is an EXCHANGE (forward dispatch)');
    console.log('   ✅ Should use "fws-" prefix for Delhivery');
  } else if (data.type === 'return') {
    console.log('   ℹ️  This is a RETURN (reverse pickup)');
    console.log('   ℹ️  Should NOT use "fws-" prefix');
  } else {
    console.log('   ⚠️  Type is not set or unknown');
  }
  
  console.log('\n✅ Check complete!');
}

main().catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
});
