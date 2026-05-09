require('dotenv').config();

async function getAccessToken() {
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const shop = process.env.SHOPIFY_STORE;
    const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
    
    console.log('=== Shopify OAuth Token Generator ===\n');
    console.log(`Shop: ${shop}`);
    console.log(`Client ID: ${clientId}`);
    console.log(`Redirect URI: ${redirectUri}\n`);
    
    // Step 1: Generate authorization URL
    const scopes = [
        'read_orders',
        'write_orders', 
        'read_products',
        'read_customers',
        'read_price_rules',
        'write_price_rules'
    ].join(',');
    
    const state = 'oauth_state_' + Date.now();
    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    
    console.log('📋 STEP 1: Authorize the App');
    console.log('Copy this URL and open it in your browser:\n');
    console.log(authUrl);
    console.log('\n');
    
    console.log('📋 STEP 2: Get the Authorization Code');
    console.log('After authorizing, Shopify will redirect to:');
    console.log(`${redirectUri}?code=XXXXX&shop=${shop}&hmac=XXXXX&timestamp=XXXXX\n`);
    console.log('Copy the value of the "code" parameter from the URL\n');
    
    // Get the code from user
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const code = await new Promise((resolve) => {
        rl.question('Paste the "code" parameter here: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
    
    if (!code) {
        console.log('❌ No code provided');
        return;
    }
    
    console.log('\n🔄 Exchanging code for access token...\n');
    
    try {
        // Exchange code for access token
        const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                code: code
            })
        });
        
        const data = await response.json();
        
        if (response.ok && data.access_token) {
            console.log('✅ SUCCESS!\n');
            console.log('Your new Admin API Access Token:\n');
            console.log(data.access_token);
            console.log('\n' + '='.repeat(60));
            console.log('\n Update your .env file:\n');
            console.log(`SHOPIFY_ACCESS_TOKEN=${data.access_token}`);
            console.log('\n' + '='.repeat(60));
            
            // Test the token
            console.log('\n🧪 Testing the new token...\n');
            const testResponse = await fetch(`https://${shop}/admin/api/2024-01/price_rules.json`, {
                method: 'GET',
                headers: {
                    'X-Shopify-Access-Token': data.access_token,
                    'Content-Type': 'application/json'
                }
            });
            
            if (testResponse.ok) {
                console.log('✅ Token works! Testing write_price_rules scope...\n');
                
                // Test creating a discount
                const createResponse = await fetch(`https://${shop}/admin/api/2024-01/price_rules.json`, {
                    method: 'POST',
                    headers: {
                        'X-Shopify-Access-Token': data.access_token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        price_rule: {
                            title: 'TEST_' + Date.now(),
                            target_type: 'line_item',
                            target_selection: 'all',
                            allocation_method: 'across',
                            value_type: 'percentage',
                            value: '-10',
                            customer_selection: 'all',
                            starts_at: new Date().toISOString()
                        }
                    })
                });
                
                if (createResponse.ok) {
                    const createData = await createResponse.json();
                    console.log('✅ SUCCESS! write_price_rules scope is active!\n');
                    console.log('Your app can now create discount codes automatically.\n');
                    
                    // Cleanup
                    await fetch(`https://${shop}/admin/api/2024-01/price_rules/${createData.price_rule.id}.json`, {
                        method: 'DELETE',
                        headers: {
                            'X-Shopify-Access-Token': data.access_token
                        }
                    });
                    console.log('✅ Test data cleaned up');
                } else {
                    const errorData = await createResponse.json();
                    console.log('⚠️  Token works but write_price_rules scope missing:');
                    console.log(JSON.stringify(errorData, null, 2));
                }
            } else {
                const errorData = await testResponse.json();
                console.log('❌ Token test failed:', JSON.stringify(errorData, null, 2));
            }
        } else {
            console.log('❌ Failed to get access token:');
            console.log(JSON.stringify(data, null, 2));
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

getAccessToken();
