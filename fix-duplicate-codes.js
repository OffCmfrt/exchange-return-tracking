require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixDuplicateCodes() {
    console.log('=== Fixing Duplicate Discount Codes ===\n');
    
    const duplicates = [
        { name: 'AJEET', code: 'AJEET10' },
        { name: 'SHOAIB MALIK', code: 'SM30' },
        { name: 'MUDIT', code: 'MUDIT1' }
    ];
    
    for (const item of duplicates) {
        console.log(`\nProcessing: ${item.name} (${item.code})`);
        
        try {
            // Step 1: Find the influencer in Supabase
            const { data: influencers, error: fetchError } = await supabase
                .from('influencers')
                .select('*')
                .eq('referral_code', item.code)
                .single();
            
            if (fetchError) {
                console.error(`   ❌ Error fetching influencer: ${fetchError.message}`);
                continue;
            }
            
            const influencer = influencers;
            console.log(`   ✅ Found influencer: ${influencer.name}`);
            console.log(`   📊 Discount value: ${influencer.discount_value || influencer.commission_rate}%`);
            
            // Step 2: Search for existing discount code in Shopify
            const searchResponse = await fetch(
                `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/price_rules.json?since_id=0`,
                {
                    method: 'GET',
                    headers: {
                        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            const searchData = await searchResponse.json();
            
            if (!searchData.price_rules) {
                console.error('   ❌ Could not fetch price rules');
                continue;
            }
            
            // Find the price rule that has this discount code
            let foundPriceRuleId = null;
            let foundDiscountCodeId = null;
            
            for (const rule of searchData.price_rules) {
                const codesResponse = await fetch(
                    `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/price_rules/${rule.id}/discount_codes.json`,
                    {
                        method: 'GET',
                        headers: {
                            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                
                const codesData = await codesResponse.json();
                
                if (codesData.discount_codes) {
                    const matchingCode = codesData.discount_codes.find(
                        dc => dc.code.toUpperCase() === item.code.toUpperCase()
                    );
                    
                    if (matchingCode) {
                        foundPriceRuleId = rule.id;
                        foundDiscountCodeId = matchingCode.id;
                        break;
                    }
                }
            }
            
            if (!foundPriceRuleId) {
                console.error(`   ❌ Could not find existing discount code in Shopify`);
                continue;
            }
            
            console.log(`   ✅ Found existing Shopify Price Rule: ${foundPriceRuleId}`);
            console.log(`   ✅ Found existing Discount Code ID: ${foundDiscountCodeId}`);
            
            // Step 3: Update the influencer record with the existing IDs
            const { error: updateError } = await supabase
                .from('influencers')
                .update({
                    shopify_price_rule_id: String(foundPriceRuleId),
                    shopify_discount_code_id: String(foundDiscountCodeId)
                })
                .eq('id', influencer.id);
            
            if (updateError) {
                console.error(`   ❌ Error updating Supabase: ${updateError.message}`);
            } else {
                console.log(`   ✅ Supabase record updated successfully!`);
            }
            
        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
        }
    }
    
    console.log('\n\n=== Fix Summary ===');
    console.log('All duplicate codes should now be linked to their influencers!');
}

fixDuplicateCodes().catch(console.error);
