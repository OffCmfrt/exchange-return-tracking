/**
 * Revert Delhivery Pickup Location to "Offcomfrt Warehouse"
 * This is the registered location that works with Delhivery API
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function revertPickupLocation() {
    console.log('🔧 Reverting Delhivery Pickup Location to "Offcomfrt Warehouse"...\n');

    try {
        // Update warehouse_location setting
        console.log('📋 Updating warehouse_location setting...');
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
        console.log(`   pickup_location: "${currentData.value.pickup_location}"`);

        // Revert to "Offcomfrt Warehouse"
        const updatedValue = {
            ...currentData.value,
            pickup_location: 'Offcomfrt Warehouse'
        };

        console.log(`\n📝 Reverting pickup_location to: "Offcomfrt Warehouse"`);

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

        console.log('\n✅ Successfully reverted warehouse_location!');
        console.log(`   New pickup_location: "${updatedData.value.pickup_location}"`);

        // Also update the delhivery_pickup_location setting
        console.log('\n📝 Updating delhivery_pickup_location setting...');
        
        const { data: delhiverySetting, error: delhiveryFetchError } = await supabase
            .from('store_settings')
            .select('*')
            .eq('key', 'delhivery_pickup_location')
            .single();

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

        console.log('\n✨ Done! Pickup location reverted to "Offcomfrt Warehouse"');
        console.log('   This is the registered location in Delhivery that works.');
        console.log('   Restart your server and test Delhivery forward order creation.\n');

    } catch (error) {
        console.error('\n❌ Failed to update:', error.message);
        console.error(error.stack);
    }
}

revertPickupLocation();
