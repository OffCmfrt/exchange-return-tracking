require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function syncExistingInfluencers() {
    console.log('=== Syncing Existing Influencers to Shopify ===\n');
    
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
    
    // Step 2: Identify influencers without Shopify discount codes
    const needsSync = influencers.filter(inf => 
        !inf.shopify_price_rule_id || inf.shopify_price_rule_id === null
    );
    
    console.log(`📋 Influencers needing sync: ${needsSync.length}\n`);
    
    if (needsSync.length === 0) {
        console.log('✅ All influencers already have Shopify discount codes!');
        return;
    }
    
    // Step 3: Create discount codes for each
    let successCount = 0;
    let failCount = 0;
    
    for (const influencer of needsSync) {
        console.log(`\nProcessing: ${influencer.name} (${influencer.referral_code})`);
        
        try {
            // Create Price Rule in Shopify
            const priceRulePayload = {
                price_rule: {
                    title: `Influencer: ${influencer.name}`,
                    target_type: 'line_item',
                    target_selection: 'all',
                    allocation_method: 'across',
                    value_type: 'percentage',
                    value: `-${influencer.discount_value || influencer.commission_rate || 10}`,
                    customer_selection: 'all',
                    starts_at: new Date().toISOString()
                }
            };
            
            const priceRuleResponse = await fetch(
                `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/price_rules.json`,
                {
                    method: 'POST',
                    headers: {
                        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(priceRulePayload)
                }
            );
            
            const priceRuleData = await priceRuleResponse.json();
            
            if (!priceRuleResponse.ok || !priceRuleData.price_rule) {
                throw new Error(
                    `Failed to create price rule: ${JSON.stringify(priceRuleData)}`
                );
            }
            
            const priceRuleId = priceRuleData.price_rule.id;
            console.log(`   ✅ Price Rule created: ${priceRuleId}`);
            
            // Create Discount Code under the Price Rule
            const discountCodePayload = {
                discount_code: {
                    code: influencer.referral_code
                }
            };
            
            const discountCodeResponse = await fetch(
                `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/price_rules/${priceRuleId}/discount_codes.json`,
                {
                    method: 'POST',
                    headers: {
                        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(discountCodePayload)
                }
            );
            
            const discountCodeData = await discountCodeResponse.json();
            
            if (!discountCodeResponse.ok || !discountCodeData.discount_code) {
                throw new Error(
                    `Failed to create discount code: ${JSON.stringify(discountCodeData)}`
                );
            }
            
            const discountCodeId = discountCodeData.discount_code.id;
            console.log(`   ✅ Discount Code created: ${discountCodeId}`);
            
            // Update the influencer record in Supabase
            const { error: updateError } = await supabase
                .from('influencers')
                .update({
                    shopify_price_rule_id: String(priceRuleId),
                    shopify_discount_code_id: String(discountCodeId)
                })
                .eq('id', influencer.id);
            
            if (updateError) {
                console.error(`   ⚠️  Error updating Supabase: ${updateError.message}`);
                failCount++;
            } else {
                console.log(`   ✅ Supabase record updated`);
                successCount++;
            }
            
        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            failCount++;
        }
    }
    
    // Summary
    console.log('\n\n=== Sync Summary ===');
    console.log(`Total processed: ${needsSync.length}`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`\nRemaining to sync: ${needsSync.length - successCount}`);
}

syncExistingInfluencers().catch(console.error);
