require('dotenv').config();

/**
 * Script to fetch registered pickup locations from Delhivery
 * This helps identify the correct pickup_location nickname to use
 */

async function getDelhiveryToken() {
    // Delhivery uses API key directly, not token-based auth
    return process.env.DELHIVERY_API_KEY;
}

async function fetchPickupLocations() {
    if (!process.env.DELHIVERY_API_KEY) {
        console.error('❌ DELHIVERY_API_KEY not found in .env file');
        process.exit(1);
    }

    console.log('🔍 Fetching pickup locations from Delhivery...\n');

    try {
        // Delhivery doesn't have a direct "list pickup locations" API endpoint
        // But we can check the city serviceability or use the pickup creation endpoint
        // The most reliable way is to check your Delhivery dashboard
        
        console.log('📋 Delhivery API Information:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`API Key: ${process.env.DELHIVERY_API_KEY.substring(0, 10)}...`);
        console.log('');
        console.log('⚠️  Important: Delhivery does NOT provide a public API to list pickup locations.');
        console.log('');
        console.log('📝 To find your registered pickup location nickname:');
        console.log('   1. Log into your Delhivery dashboard: https://delhivery.com');
        console.log('   2. Go to Settings → Pickup Locations / Warehouses');
        console.log('   3. Find your registered warehouse/pickup location');
        console.log('   4. Copy the EXACT "Nickname" or "Name" field');
        console.log('');
        console.log('💡 Common issues:');
        console.log('   • The nickname must match EXACTLY (case-sensitive)');
        console.log('   • "Primary" is just a default - your actual nickname may be different');
        console.log('   • Check for spaces, special characters, or different capitalization');
        console.log('');
        console.log('🔧 Once you have the correct nickname:');
        console.log('   1. Update your .env file: DELHIVERY_PICKUP_LOCATION=YourExactNickname');
        console.log('   2. OR update the warehouse location in your admin settings');
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Test the current configuration
        console.log('🧪 Testing current configuration...');
        console.log(`Current DELHIVERY_PICKUP_LOCATION: "${process.env.DELHIVERY_PICKUP_LOCATION || 'Primary (default)'}"\n`);

        // Try to create a test pickup location check
        const testPayload = {
            pickup_location: {
                name: process.env.DELHIVERY_PICKUP_LOCATION || 'Primary',
                add: 'Test Address',
                pin: '110001',
                city: 'Delhi',
                state: 'Delhi',
                country: 'India',
                phone: '9999999999'
            },
            shipments: []
        };

        const response = await fetch('https://track.delhivery.com/api/cmu/create.json', {
            method: 'POST',
            headers: {
                'Authorization': `Token ${process.env.DELHIVERY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: `format=json&data=${JSON.stringify(testPayload)}`
        });

        const data = await response.json();
        
        if (data.rmk && data.rmk.includes('ClientWarehouse matching query does not exist')) {
            console.log('❌ CONFIRMED: The pickup location nickname is NOT registered in Delhivery');
            console.log(`   Error: ${data.rmk}`);
            console.log('');
            console.log('✅ Next Steps:');
            console.log('   1. Follow the instructions above to find your correct nickname');
            console.log('   2. Update .env file with: DELHIVERY_PICKUP_LOCATION=CorrectNickname');
            console.log('   3. Restart your server');
        } else if (data.success || data.status === 'success') {
            console.log('✅ Current configuration appears to be working!');
        } else {
            console.log('⚠️  Response from Delhivery:', JSON.stringify(data, null, 2));
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

fetchPickupLocations();
