require('dotenv').config();

async function cleanupAndRetry() {
    console.log('=== Cleanup and Retry for Duplicates ===\n');
    
    const duplicates = [
        { name: 'AJEET', code: 'AJEET10', priceRuleId: '1756337832180' },
        { name: 'SHOAIB MALIK', code: 'SM30', priceRuleId: '1756337930484' },
        { name: 'MUDIT', code: 'MUDIT1', priceRuleId: '1756337963252' }
    ];
    
    for (const item of duplicates) {
        console.log(`\nProcessing: ${item.name} (${item.code})`);
        
        try {
            // Delete the failed price rule
            console.log(`   Deleting empty price rule ${item.priceRuleId}...`);
            const deleteResponse = await fetch(
                `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/price_rules/${item.priceRuleId}.json`,
                {
                    method: 'DELETE',
                    headers: {
                        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            if (deleteResponse.ok || deleteResponse.status === 200) {
                console.log(`   ✅ Deleted empty price rule`);
            } else {
                console.log(`   ⚠️  Could not delete (may not exist): ${deleteResponse.status}`);
            }
            
            // Now try to find if the code exists in Shopify discounts
            console.log(`   Searching for existing discount code: ${item.code}`);
            const searchResponse = await fetch(
                `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/discounts.json`,
                {
                    method: 'GET',
                    headers: {
                        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            const searchData = await searchResponse.json();
            console.log(`   Search response:`, searchData);
            
        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
        }
    }
}

cleanupAndRetry().catch(console.error);
