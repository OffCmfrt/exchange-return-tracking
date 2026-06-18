/**
 * Create 3 Abandoned Cart WhatsApp Templates with "Buy It" Button
 * and submit them to Meta for approval.
 * 
 * Templates:
 *   1. abandoned_cart_first  – Gentle nudge (1hr after abandonment)
 *   2. abandoned_cart_second – Urgency reminder (24hr after 1st)
 *   3. abandoned_cart_final  – Last chance (72hr after 2nd)
 * 
 * Usage:  node create-abandoned-cart-templates.js
 */

require('dotenv').config();
const metaWhatsApp = require('./config/meta-whatsapp');
const supabase = require('./config/supabase');

// ── Template Definitions ─────────────────────────────────────────────

const TEMPLATES = [
    {
        name: 'abandoned_cart_first',
        category: 'MARKETING',
        language: 'en',
        header: 'Forgot Something?',
        body: 'Hi {{1}}, you left {{2}} in your cart worth {{3}}. Don\'t miss out — complete your order before it sells out!',
        footer: 'OFFCOMFRT — Comfort You Deserve',
        buttons: [
            {
                type: 'URL',
                text: 'Buy It Now',
                url: 'https://offcomfrt.com/checkout'
            }
        ],
        variables: [
            { name: '1', type: 'text', example: 'John' },
            { name: '2', type: 'text', example: '2 items' },
            { name: '3', type: 'text', example: 'Rs.1499' }
        ]
    },
    {
        name: 'abandoned_cart_second',
        category: 'MARKETING',
        language: 'en',
        header: 'Your Cart Is Waiting',
        body: 'Hey {{1}}, your {{2}} worth {{3}} are still in your cart. Stocks are running low — grab them before they\'re gone!',
        footer: 'OFFCOMFRT — Don\'t Miss Out',
        buttons: [
            {
                type: 'URL',
                text: 'Complete Your Order',
                url: 'https://offcomfrt.com/checkout'
            }
        ],
        variables: [
            { name: '1', type: 'text', example: 'John' },
            { name: '2', type: 'text', example: '2 items' },
            { name: '3', type: 'text', example: 'Rs.1499' }
        ]
    },
    {
        name: 'abandoned_cart_final',
        category: 'MARKETING',
        language: 'en',
        header: 'Final Reminder',
        body: 'Hi {{1}}, you have {{2}} worth {{3}} waiting in your cart. Complete your order today!',
        footer: 'OFFCOMFRT',
        buttons: [
            {
                type: 'URL',
                text: 'Shop Now',
                url: 'https://offcomfrt.com/checkout'
            }
        ],
        variables: [
            { name: '1', type: 'text', example: 'John' },
            { name: '2', type: 'text', example: '2 items' },
            { name: '3', type: 'text', example: 'Rs.1499' }
        ]
    }
];

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Creating 3 Abandoned Cart Templates on Meta');
    console.log('═══════════════════════════════════════════════════════\n');

    if (!metaWhatsApp.isMetaConfigured()) {
        console.error('❌ Meta Cloud API not configured. Check META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_WABA_ID in .env');
        process.exit(1);
    }

    const results = [];

    for (const tpl of TEMPLATES) {
        console.log(`\n── Submitting: ${tpl.name} ──`);
        console.log(`   Category: ${tpl.category}`);
        console.log(`   Header:   ${tpl.header}`);
        console.log(`   Body:     ${tpl.body}`);
        console.log(`   Footer:   ${tpl.footer}`);
        console.log(`   Button:   [${tpl.buttons[0].type}] ${tpl.buttons[0].text} → ${tpl.buttons[0].url}`);

        // Submit to Meta
        const metaResult = await metaWhatsApp.submitTemplateToMeta(tpl);

        if (metaResult.success) {
            console.log(`   ✅ Submitted to Meta! Template ID: ${metaResult.templateId}`);
        } else {
            console.error(`   ❌ Failed: ${metaResult.error}`);
            if (metaResult.errorCode) console.error(`      Error Code: ${metaResult.errorCode}`);
        }

        // Save to local database
        let localId = null;
        try {
            // Check if template already exists locally
            const { data: existing } = await supabase
                .from('marketing_templates')
                .select('id')
                .eq('name', tpl.name)
                .maybeSingle();

            const templateData = {
                name: tpl.name,
                category: tpl.category.toLowerCase(),
                language: tpl.language,
                header: tpl.header,
                header_type: 'text',
                body: tpl.body,
                footer: tpl.footer,
                buttons: JSON.stringify(tpl.buttons),
                variables: JSON.stringify(tpl.variables),
                status: 'pending_approval',
                meta_template_id: metaResult.success ? String(metaResult.templateId) : null,
                meta_status: metaResult.success ? 'PENDING' : 'FAILED',
                meta_rejection_reason: metaResult.success ? null : metaResult.error,
                meta_last_synced_at: new Date().toISOString()
            };

            if (existing) {
                const { data: updated } = await supabase
                    .from('marketing_templates')
                    .update(templateData)
                    .eq('id', existing.id)
                    .select()
                    .single();
                localId = updated?.id;
                console.log(`   💾 Updated local DB (ID: ${localId})`);
            } else {
                const { data: created } = await supabase
                    .from('marketing_templates')
                    .insert(templateData)
                    .select()
                    .single();
                localId = created?.id;
                console.log(`   💾 Saved to local DB (ID: ${localId})`);
            }
        } catch (dbErr) {
            console.error(`   ⚠️  DB error: ${dbErr.message}`);
        }

        results.push({
            name: tpl.name,
            metaSuccess: metaResult.success,
            metaTemplateId: metaResult.templateId || null,
            metaError: metaResult.error || null,
            localId
        });
    }

    // ── Summary ──────────────────────────────────────────────────────
    console.log('\n\n═══════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════');
    for (const r of results) {
        const icon = r.metaSuccess ? '✅' : '❌';
        console.log(`  ${icon} ${r.name}  |  Meta ID: ${r.metaTemplateId || 'N/A'}  |  Local ID: ${r.localId || 'N/A'}`);
        if (r.metaError) console.log(`      Error: ${r.metaError}`);
    }
    console.log('\n⏳ Templates typically take 5-30 minutes for Meta review.');
    console.log('   Use "Sync from Meta" in the dashboard to check approval status.\n');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
