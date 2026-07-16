/**
 * Check Delhivery Pickup Locations
 * This will list all available pickup locations in Delhivery
 */

const dotenv = require('dotenv');
dotenv.config();

async function checkDelhiveryLocations() {
    if (!process.env.DELHIVERY_API_KEY) {
        console.error('❌ DELHIVERY_API_KEY not set');
        return;
    }

    console.log('🔍 Fetching Delhivery pickup locations...\n');

    try {
        // Delhivery API to get pickup locations
        const response = await fetch('https://track.delhivery.com/api/pickup/locations/', {
            method: 'GET',
            headers: {
                'Authorization': `Token ${process.env.DELHIVERY_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        console.log('📦 Delhivery Pickup Locations Response:');
        console.log(JSON.stringify(data, null, 2));

        if (data && data.data && data.data.length > 0) {
            console.log('\n✅ Available Pickup Locations:');
            data.data.forEach((loc, idx) => {
                console.log(`\n${idx + 1}. ${loc.name}`);
                console.log(`   ID: ${loc.id}`);
                console.log(`   Address: ${loc.address}`);
                console.log(`   City: ${loc.city}, ${loc.state} ${loc.pin}`);
                console.log(`   Phone: ${loc.phone}`);
                console.log(`   Email: ${loc.email}`);
            });
        } else if (data && data.rmk) {
            console.log('\n❌ Error:', data.rmk);
        } else {
            console.log('\n⚠️  No locations found or unexpected response format');
        }

    } catch (error) {
        console.error('\n❌ Failed to fetch locations:', error.message);
    }
}

checkDelhiveryLocations();
