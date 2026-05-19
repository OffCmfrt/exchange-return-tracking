/**
 * Fix Delhivery Pickup Location in Database
 * Update to use "Offcomfrt Warehouse" which is the registered Delhivery location
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixDelhiveryPickupLocation() {
    console.log('🔧 Fixing Delhivery Pickup Location in Database...\n');

    try {
        // Check current warehouse_location setting
        console.log('📋 Checking current warehouse_location setting...');
        const { data: currentData, error: fetchError } = await supabase
            .from('store_settings')
            .select('*')
            .eq('key', 'warehouse_location')
            .single();

        if (fetchError) {
            console.error('❌ Error fetching current setting:', fetchError.message);
            return;
        }

        if (!currentData) {
            console.error('❌ No warehouse_location setting found');
            return;
        }

        console.log('✅ Current warehouse_location:');
        console.log(JSON.stringify(currentData.value, null, 2));
        console.log('');

        const oldValue = currentData.value.pickup_location;
        console.log(`Current pickup_location: "${oldValue}"`);

        // Update to "Offcomfrt Warehouse" for Delhivery
        const updatedValue = {
            ...currentData.value,
            pickup_location: 'Offcomfrt Warehouse'
        };

        console.log(`\n📝 Updating pickup_location to: "Offcomfrt Warehouse"`);

        const { data: updatedData, error: updateError } = await supabase
            .from('store_settings')
            .update({ value: updatedValue })
            .eq('key', 'warehouse_location')
            .select()
            .single();

        if (updateError) {
            console.error('❌ Error updating setting:', updateError.message);
            return;
        }

        console.log('\n✅ Successfully updated Delhivery pickup location!');
        console.log('\n📋 Updated warehouse location:');
        console.log(JSON.stringify(updatedData.value, null, 2));
        console.log('\n💡 Delhivery will now use "Offcomfrt Warehouse" as the pickup location');
        console.log('   This matches your registered Delhivery warehouse.\n');

        // Also set the delhivery_pickup_location setting explicitly
        console.log('\n📝 Setting explicit delhivery_pickup_location setting...');
        
        const { data: delhiverySetting, error: delhiveryFetchError } = await supabase
            .from('store_settings')
            .select('*')
            .eq('key', 'delhivery_pickup_location')
            .single();

        if (delhiveryFetchError && delhiveryFetchError.code !== 'PGRST116') {
            console.error('❌ Error fetching delhivery_pickup_location:', delhiveryFetchError.message);
        }

        if (delhiverySetting) {
            // Update existing
            const { error: updateError2 } = await supabase
                .from('store_settings')
                .update({ value: 'Offcomfrt Warehouse' })
                .eq('key', 'delhivery_pickup_location');

            if (updateError2) {
                console.error('❌ Error updating delhivery_pickup_location:', updateError2.message);
            } else {
                console.log('✅ Updated delhivery_pickup_location to: "Offcomfrt Warehouse"');
            }
        } else {
            // Insert new
            const { error: insertError } = await supabase
                .from('store_settings')
                .insert({ 
                    key: 'delhivery_pickup_location', 
                    value: 'Offcomfrt Warehouse' 
                });

            if (insertError) {
                console.error('❌ Error inserting delhivery_pickup_location:', insertError.message);
            } else {
                console.log('✅ Created delhivery_pickup_location: "Offcomfrt Warehouse"');
            }
        }

        console.log('\n✨ Done! Both settings are now configured correctly.');
        console.log('   Restart your server and test Delhivery forward order creation.\n');

    } catch (error) {
        console.error('\n❌ Failed to update:', error.message);
        console.error(error.stack);
    }
}

fixDelhiveryPickupLocation();
