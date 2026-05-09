require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function syncShopifyUsageData() {
    console.log('=== Syncing Shopify Discount Code Usage Data ===\n');
    
    // Step 1: Fetch all influencers
    console.log('1. Fetching all influencers from Supabase...');
    const { data: influencers, error } = await supabase
        .from('influencers')
        .select('*')
        .eq('is_active', true);
    
    if (error) {
        console.error('❌ Error fetching influencers:', error);
        return;
    }
    
    console.log(`✅ Found ${influencers.length} active influencers\n`);
    
    let syncedCount = 0;
    let failedCount = 0;
    let newlyLinkedCount = 0;
    
    for (const influencer of influencers) {
        console.log(`\nProcessing: ${influencer.name} (${influencer.referral_code})`);
        
        try {
            let priceRuleId = influencer.shopify_price_rule_id;
            let discountCodeId = influencer.shopify_discount_code_id;
            
            // If no Shopify IDs, try to find the discount code in Shopify
            if (!priceRuleId || !discountCodeId) {
                console.log(`   🔍 Searching for discount code in Shopify...`);
                
                const found = await findDiscountCodeInShopify(influencer.referral_code);
                
                if (found) {
                    priceRuleId = found.priceRuleId;
                    discountCodeId = found.discountCodeId;
                    
                    // Update Supabase with the found IDs
                    const { error: updateError } = await supabase
                        .from('influencers')
                        .update({
                            shopify_price_rule_id: String(priceRuleId),
                            shopify_discount_code_id: String(discountCodeId)
                        })
                        .eq('id', influencer.id);
                    
                    if (updateError) {
                        console.error(`   ⚠️  Error updating IDs: ${updateError.message}`);
                    } else {
                        console.log(`   ✅ Linked to Shopify Price Rule: ${priceRuleId}`);
                        console.log(`   ✅ Linked to Shopify Discount Code: ${discountCodeId}`);
                        newlyLinkedCount++;
                    }
                } else {
                    console.log(`   ⚠️  Discount code not found in Shopify`);
                    continue;
                }
            }
            
            // Now fetch usage data from Shopify
            console.log(`   📊 Fetching usage data from Shopify...`);
            
            const usageData = await getDiscountCodeUsage(priceRuleId, discountCodeId);
            
            if (usageData !== null) {
                console.log(`   ✅ Usage count from Shopify: ${usageData}`);
                
                // Update usage_count in Supabase
                const { error: usageError } = await supabase
                    .from('influencers')
                    .update({
                        usage_count: usageData,
                        last_synced_at: new Date().toISOString()
                    })
                    .eq('id', influencer.id);
                
                if (usageError) {
                    console.error(`   ⚠️  Error updating usage count: ${usageError.message}`);
                    failedCount++;
                } else {
                    console.log(`   ✅ Usage count updated in database`);
                    syncedCount++;
                }
            } else {
                console.log(`   ⚠️  Could not fetch usage data`);
                failedCount++;
            }
            
        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            failedCount++;
        }
    }
    
    // Summary
    console.log('\n\n=== Sync Summary ===');
    console.log(`Total processed: ${influencers.length}`);
    console.log(`✅ Usage synced: ${syncedCount}`);
    console.log(`🔗 Newly linked: ${newlyLinkedCount}`);
    console.log(`❌ Failed: ${failedCount}`);
    console.log(`\n✨ All influencers now have accurate usage data from Shopify!`);
}

async function findDiscountCodeInShopify(code) {
    try {
        // Fetch all price rules
        const priceRulesResponse = await fetch(
            `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/price_rules.json`,
            {
                method: 'GET',
                headers: {
                    'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        const priceRulesData = await priceRulesResponse.json();
        
        if (!priceRulesData.price_rules) {
            return null;
        }
        
        // Search through each price rule for the discount code
        for (const rule of priceRulesData.price_rules) {
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
                    dc => dc.code.toUpperCase() === code.toUpperCase()
                );
                
                if (matchingCode) {
                    return {
                        priceRuleId: rule.id,
                        discountCodeId: matchingCode.id
                    };
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error(`   Error searching Shopify: ${error.message}`);
        return null;
    }
}

async function getDiscountCodeUsage(priceRuleId, discountCodeId) {
    try {
        // Get the specific discount code details
        const response = await fetch(
            `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/price_rules/${priceRuleId}/discount_codes/${discountCodeId}.json`,
            {
                method: 'GET',
                headers: {
                    'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        const data = await response.json();
        
        if (data.discount_code) {
            // usage_count is the field that tracks how many times the code was used
            return data.discount_code.usage_count || 0;
        }
        
        return null;
    } catch (error) {
        console.error(`   Error fetching usage: ${error.message}`);
        return null;
    }
}

syncShopifyUsageData().catch(console.error);
