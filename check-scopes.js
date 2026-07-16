require('dotenv').config();

async function checkShopifyScopes() {
    const token = process.env.SHOPIFY_ACCESS_TOKEN;
    const shop = process.env.SHOPIFY_STORE;
    
    console.log('Checking Shopify API token scopes...');
    console.log(`Shop: ${shop}`);
    console.log(`Token: ${token ? token.substring(0, 20) + '...' : 'Missing'}`);
    
    try {
        // Make a simple API call to check what scopes are available
        const response = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
            method: 'GET',
            headers: {
                'X-Shopify-Access-Token': token,
                'Content-Type': 'application/json'
            }
        });

        // Check the response headers for X-Shopify-Access-Token-Scopes
        const scopes = response.headers.get('X-Shopify-Access-Token-Scopes');
        
        console.log('\n✅ Token is valid!');
        console.log('\n📋 Available Scopes:');
        console.log(scopes || 'No scopes header found');
        
        // Check if required scopes are present
        if (scopes) {
            const scopeList = scopes.split(',').map(s => s.trim());
            console.log('\n🔍 Checking required scopes:');
            console.log(`  read_orders: ${scopeList.includes('read_orders') ? '✅' : '❌'}`);
            console.log(`  write_orders: ${scopeList.includes('write_orders') ? '✅' : '❌'}`);
            console.log(`  read_price_rules: ${scopeList.includes('read_price_rules') ? '✅' : '❌'}`);
            console.log(`  write_price_rules: ${scopeList.includes('write_price_rules') ? '✅' : '❌'}`);
            
            if (!scopeList.includes('write_price_rules')) {
                console.log('\n⚠️  MISSING: write_price_rules scope');
                console.log('You need to add this scope to your app and REINSTALL it.');
            } else {
                console.log('\n✅ All required scopes are present!');
            }
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkShopifyScopes();
