require('dotenv').config();

async function getNewAccessToken() {
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    const shop = process.env.SHOPIFY_STORE;
    
    console.log('=== Shopify Access Token Generator ===\n');
    console.log(`Shop: ${shop}`);
    console.log(`Client ID: ${clientId}`);
    console.log(`Client Secret: ${clientSecret.substring(0, 20)}...\n`);
    
    try {
        // Step 1: Get authorization URL
        const scopes = [
            'read_orders',
            'write_orders',
            'read_products',
            'read_customers',
            'read_price_rules',
            'write_price_rules'
        ].join(',');
        
        const redirectUri = process.env.SHOPIFY_REDIRECT_URI || 'http://localhost:3000/auth/callback';
        const state = Math.random().toString(36).substring(2, 15);
        
        const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
        
        console.log('📋 STEP 1: Authorize the app');
        console.log('Copy and paste this URL in your browser:');
        console.log('\n' + authUrl + '\n');
        
        console.log('📋 STEP 2: After authorization, Shopify will redirect you');
        console.log('The redirect URL will contain a "code" parameter');
        console.log('Example: http://localhost:3000/auth/callback?code=abc123&shop=j0yyii-uf.myshopify.com\n');
        
        // Ask for the authorization code
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const code = await new Promise((resolve) => {
            rl.question('Paste the "code" parameter from the redirect URL: ', (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        });
        
        if (!code) {
            console.log('❌ No code provided. Exiting.');
            return;
        }
        
        // Step 3: Exchange code for access token
        console.log('\n🔄 Exchanging authorization code for access token...');
        
        const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
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
        
        const tokenData = await tokenResponse.json();
        
        if (tokenResponse.ok && tokenData.access_token) {
            console.log('\n✅ SUCCESS! New Access Token Generated:\n');
            console.log(tokenData.access_token);
            console.log('\n' + '='.repeat(60));
            console.log('\n📝 Update your .env file with:');
            console.log(`SHOPIFY_ACCESS_TOKEN=${tokenData.access_token}\n`);
            
            // Test the token
            console.log('🧪 Testing the new token...');
            const testResponse = await fetch(`https://${shop}/admin/api/2024-01/price_rules.json`, {
                method: 'GET',
                headers: {
                    'X-Shopify-Access-Token': tokenData.access_token,
                    'Content-Type': 'application/json'
                }
            });
            
            if (testResponse.ok) {
                console.log('✅ Token works! write_price_rules scope is active.\n');
                console.log('You can now create discount codes automatically!');
            } else {
                const errorData = await testResponse.json();
                console.log('⚠️  Token test result:', JSON.stringify(errorData, null, 2));
            }
        } else {
            console.log('\n❌ Failed to get access token:');
            console.log(JSON.stringify(tokenData, null, 2));
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
    }
}

getNewAccessToken();
