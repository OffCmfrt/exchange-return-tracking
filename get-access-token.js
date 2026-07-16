require('dotenv').config();

async function getAccessToken() {
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const refreshToken = '01d88b9eaae7e6289e2291de81734d05-1778278485';
    const shop = process.env.SHOPIFY_STORE;
    
    console.log('Exchanging refresh token for access token...');
    console.log(`Shop: ${shop}`);
    console.log(`Client ID: ${clientId}`);
    
    try {
        const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken
            })
        });

        const data = await response.json();
        
        if (response.ok && data.access_token) {
            console.log('\n✅ SUCCESS!');
            console.log('\n Your new Admin API Access Token:');
            console.log(data.access_token);
            console.log('\n Copy this token and update your .env file:');
            console.log(`SHOPIFY_ACCESS_TOKEN=${data.access_token}`);
            
            // Test the token immediately
            console.log('\n🧪 Testing the new token...');
            const testResponse = await fetch(`https://${shop}/admin/api/2024-01/price_rules.json`, {
                method: 'GET',
                headers: {
                    'X-Shopify-Access-Token': data.access_token,
                    'Content-Type': 'application/json'
                }
            });
            
            if (testResponse.ok) {
                console.log('✅ Token works! You can now create discount codes.');
            } else {
                const errorData = await testResponse.json();
                console.log('⚠️  Token test failed:', errorData);
            }
        } else {
            console.error('\n❌ Failed to get access token:');
            console.error(JSON.stringify(data, null, 2));
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
    }
}

getAccessToken();
