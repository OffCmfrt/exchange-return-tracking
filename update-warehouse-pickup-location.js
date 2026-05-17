/**
 * Update warehouse location pickup_location field to match Delhivery
 * This changes the Shiprocket location's pickup_location from "warehouse" to "Offcomfrt Warehouse"
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials in .env file');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function updateWarehousePickupLocation() {
    try {
        console.log(' Fetching current warehouse location setting...\n');

        // Get current warehouse_location setting
        const { data: currentSetting, error: fetchError } = await supabase
            .from('store_settings')
            .select('*')
            .eq('key', 'warehouse_location')
            .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
            console.error(' Error fetching setting:', fetchError);
            process.exit(1);
        }

        if (!currentSetting) {
            console.log('⚠️  No warehouse_location setting found in database');
            console.log('   You need to configure a warehouse location in admin settings first.');
            process.exit(0);
        }

        console.log('📋 Current warehouse location:');
        console.log(JSON.stringify(currentSetting.value, null, 2));
        console.log('');

        // Check if it has pickup_location field
        if (!currentSetting.value || !currentSetting.value.pickup_location) {
            console.log('⚠️  No pickup_location field found in warehouse setting');
            process.exit(0);
        }

        const oldPickupLocation = currentSetting.value.pickup_location;
        console.log(`Current pickup_location: "${oldPickupLocation}"`);

        // Update the pickup_location to match Shiprocket's valid locations
        // Shiprocket has: "Home" and "warehouse" (case-sensitive)
        const updatedValue = {
            ...currentSetting.value,
            pickup_location: 'warehouse'  // Changed from 'Offcomfrt Warehouse' to 'warehouse'
        };

        console.log(`\n📝 Updating pickup_location to: "warehouse"`);

        const { error: updateError } = await supabase
            .from('store_settings')
            .update({ value: updatedValue })
            .eq('key', 'warehouse_location');

        if (updateError) {
            console.error('❌ Error updating setting:', updateError);
            process.exit(1);
        }

        console.log('\n✅ Successfully updated warehouse location!');
        console.log('\n📋 Updated warehouse location:');
        console.log(JSON.stringify(updatedValue, null, 2));
        console.log('\n💡 Shiprocket will now use "warehouse" as the pickup location');
        console.log('   This matches one of your valid Shiprocket pickup locations.');
        console.log('   Delhivery will continue to use its own pickup location setting.\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

updateWarehousePickupLocation();
