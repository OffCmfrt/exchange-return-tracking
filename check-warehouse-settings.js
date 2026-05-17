require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkWarehouseSettings() {
  console.log('\n📦 Checking Warehouse Location Settings...\n');

  // Get warehouse location from settings
  const { data: warehouseData, error: warehouseError } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', ['warehouse_location', 'delhivery_pickup_location'])
    .order('key');

  if (warehouseError) {
    console.error('❌ Error fetching settings:', warehouseError.message);
    return;
  }

  console.log('📋 Settings from database:\n');
  warehouseData.forEach(setting => {
    console.log(`Key: ${setting.key}`);
    console.log(`Value:`, JSON.stringify(setting.value, null, 2));
    console.log('');
  });

  console.log('\n🔧 Environment variables:');
  console.log(`DELHIVERY_PICKUP_LOCATION: ${process.env.DELHIVERY_PICKUP_LOCATION || 'Not set'}`);
  
  console.log('\n✅ Default warehouse that should be used:');
  const defaultWarehouse = {
    name: 'BURB MANUFACTURES PVT LTD',
    address: 'VILLAGE - BAIRAWAS, NEAR GOVT. SCHOOL',
    city: 'MAHENDERGARH',
    state: 'Haryana',
    pincode: '123028',
    phone: '9138514222'
  };
  console.log(defaultWarehouse);
  console.log('');
}

checkWarehouseSettings();
