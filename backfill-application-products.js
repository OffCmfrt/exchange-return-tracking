/**
 * Backfill Product Requests for Existing Influencers
 * 
 * This script creates product request records in the `influencer_product_requests` table
 * for influencers who selected products during their application but don't have
 * corresponding product request records.
 * 
 * Run: node backfill-application-products.js
 */

require('dotenv').config();
const { getInfluencerById, getAllInfluencers, createProductRequest } = require('./config/db-helpers');

async function backfillProductRequests() {
    console.log('🔍 Starting backfill of product requests from application data...\n');

    try {
        // Get all influencers
        const { influencers } = await getAllInfluencers({ limit: 10000 });
        
        if (!influencers || influencers.length === 0) {
            console.log('❌ No influencers found');
            return;
        }

        console.log(`📊 Found ${influencers.length} total influencers\n`);

        let processed = 0;
        let created = 0;
        let skipped = 0;
        let errors = 0;

        for (const influencer of influencers) {
            processed++;

            // Check if influencer has selected products
            if (!influencer.selected_products) {
                skipped++;
                continue;
            }

            let selectedProducts;
            try {
                selectedProducts = typeof influencer.selected_products === 'string' 
                    ? JSON.parse(influencer.selected_products) 
                    : influencer.selected_products;
            } catch (parseError) {
                console.log(`⚠️  Influencer ${influencer.id} (${influencer.name}): Failed to parse selected_products`);
                skipped++;
                continue;
            }

            if (!Array.isArray(selectedProducts) || selectedProducts.length === 0) {
                skipped++;
                continue;
            }

            console.log(`\n[${processed}/${influencers.length}] Processing ${influencer.name} (${influencer.id})`);
            console.log(`   Selected products: ${selectedProducts.length}`);

            // Check if product requests already exist for this influencer
            const { requests: existingRequests } = await require('./config/db-helpers').getProductRequests({
                influencerId: influencer.id
            });

            const existingCount = existingRequests ? existingRequests.length : 0;
            
            if (existingCount >= selectedProducts.length) {
                console.log(`   ✓ Already has ${existingCount} product request(s) - skipping`);
                skipped++;
                continue;
            }

            console.log(`   Has ${existingCount} existing request(s), creating ${selectedProducts.length - existingCount} new one(s)...`);

            // Create product requests for missing products
            for (let i = existingCount; i < selectedProducts.length; i++) {
                const product = selectedProducts[i];
                
                try {
                    await createProductRequest({
                        influencerId: influencer.id,
                        productTitle: product.title || product.productTitle || 'Unknown Product',
                        productImageUrl: product.image || product.imageUrl || product.productImageUrl || null,
                        shopifyProductId: product.id || product.shopifyProductId || null,
                        shopifyVariantId: product.variantId || product.shopifyVariantId || null,
                        reason: `Backfilled from application - Tier: ${influencer.follower_tier || 'Unknown'}`,
                        shippingFullName: influencer.name,
                        shippingAddressLine1: influencer.shipping_address || '',
                        shippingAddressLine2: influencer.shipping_landmark || null,
                        shippingCity: influencer.shipping_city || '',
                        shippingState: influencer.shipping_state || '',
                        shippingPincode: influencer.shipping_pin || '',
                        shippingPhone: influencer.phone || ''
                    });

                    created++;
                    console.log(`   ✓ Created request for: ${product.title || product.productTitle || 'Unknown'}`);
                } catch (error) {
                    errors++;
                    console.error(`   ✗ Failed to create request for product ${i + 1}:`, error.message);
                }
            }
        }

        console.log('\n\n📋 Backfill Summary:');
        console.log('━'.repeat(50));
        console.log(`Total influencers processed: ${processed}`);
        console.log(`Product requests created: ${created}`);
        console.log(`Skipped (no products/already exists): ${skipped}`);
        console.log(`Errors: ${errors}`);
        console.log('━'.repeat(50));

        if (created > 0) {
            console.log('\n✅ Backfill completed successfully!');
            console.log('   New product requests are now visible in the admin "Product Requests" tab.');
        } else {
            console.log('\nℹ️  No new product requests needed to be created.');
        }

    } catch (error) {
        console.error('\n❌ Backfill failed:', error);
        process.exit(1);
    }
}

// Run the backfill
backfillProductRequests();
