require('dotenv').config();

async function updateAndTestToken() {
    const shop = process.env.SHOPIFY_STORE;
    
    console.log('=== Update Shopify Access Token ===\n');
    console.log(`Shop: ${shop}\n`);
    console.log('Please provide your new Shopify Admin API Access Token');
    console.log('(It starts with "shpat_")\n');
    
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const token = await new Promise((resolve) => {
        rl.question('Paste your new SHOPIFY_ACCESS_TOKEN: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
    
    if (!token || !token.startsWith('shpat_')) {
        console.log('❌ Invalid token format. It should start with "shpat_"');
        return;
    }
    
    console.log('\n🔄 Testing the new token...');
    
    try {
        // Test if token works
        const testResponse = await fetch(`https://${shop}/admin/api/2024-01/price_rules.json`, {
            method: 'GET',
            headers: {
                'X-Shopify-Access-Token': token,
                'Content-Type': 'application/json'
            }
        });
        
        if (testResponse.ok) {
            console.log('✅ Token is valid!\n');
            
            // Test if it has write_price_rules permission
            console.log('🧪 Testing write_price_rules permission...');
            const createResponse = await fetch(`https://${shop}/admin/api/2024-01/price_rules.json`, {
                method: 'POST',
                headers: {
                    'X-Shopify-Access-Token': token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    price_rule: {
                        title: 'TOKEN_TEST_' + Date.now(),
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
            
            const createData = await createResponse.json();
            
            if (createResponse.ok) {
                console.log('✅ SUCCESS! Token has write_price_rules permission!\n');
                console.log(' Update your .env file with:');
                console.log(`SHOPIFY_ACCESS_TOKEN=${token}\n`);
                
                // Cleanup
                await fetch(`https://${shop}/admin/api/2024-01/price_rules/${createData.price_rule.id}.json`, {
                    method: 'DELETE',
                    headers: {
                        'X-Shopify-Access-Token': token
                    }
                });
                console.log('✅ Test data cleaned up');
            } else {
                console.log('⚠️  Token works but missing write_price_rules permission:');
                console.log(JSON.stringify(createData, null, 2));
                console.log('\nYou need to reinstall the app with write_price_rules scope enabled.');
            }
        } else {
            const errorData = await testResponse.json();
            console.log('❌ Token is invalid:');
            console.log(JSON.stringify(errorData, null, 2));
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

updateAndTestToken();
