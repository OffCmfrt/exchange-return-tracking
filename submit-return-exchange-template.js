/**
 * One-time script: Submit the "return_exchange_approved" UTILITY template to Meta
 * for review/approval.
 *
 * Usage:
 *   node submit-return-exchange-template.js
 *
 * Requires META_ACCESS_TOKEN, META_WABA_ID in .env
 */

require('dotenv').config();
const metaWhatsApp = require('./config/meta-whatsapp');

const TEMPLATE = {
    name: 'return_exchange_approved',
    category: 'UTILITY',
    language: 'en',
    header: null,
    body: `📦 *RETURN / EXCHANGE APPROVED – MANDATORY STEPS*

Hi! Your *Return/Exchange Request* has been approved and is ready for pickup.

🆔 *Request ID:* {{1}}
📦 *Order Number:* {{2}}
🔄 *Request Type:* {{3}}

*Before handing over the package to the pickup executive, please record a continuous handover video showing:*

• The product(s) being packed.
• The package being sealed properly.
• The pickup executive receiving the package.
• The AWB/shipping label clearly visible (if applicable).

⚠️ *Important:* This handover video is *mandatory* and will be required in case of any future disputes, such as:
• Wrong product received at our warehouse
• Missing item(s)
• Empty package claims
• Transit-related issues

*Without a valid handover video, we may be unable to process such claims.*

Thank you for your cooperation! 💙`,
    footer: null,
    buttons: null,
    variables: [
        { name: 'request_id',   example: 'REQ-67796' },
        { name: 'order_number', example: '#12345' },
        { name: 'request_type', example: 'Return' }
    ]
};

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Submit Return/Exchange Approval Template to Meta');
    console.log('═══════════════════════════════════════════════════\n');

    if (!metaWhatsApp.isMetaConfigured()) {
        console.error('❌ Meta Cloud API not configured.');
        console.error('   Set META_ACCESS_TOKEN and META_PHONE_NUMBER_ID in .env');
        process.exit(1);
    }

    if (!process.env.META_WABA_ID) {
        console.error('❌ META_WABA_ID not set in .env');
        process.exit(1);
    }

    // 1. Check if template already exists
    console.log('🔍 Checking if template already exists on Meta…');
    const existing = await metaWhatsApp.getTemplateStatusFromMeta(TEMPLATE.name);

    if (existing.success && existing.templateId) {
        console.log(`⚠️  Template "${TEMPLATE.name}" already exists on Meta.`);
        console.log(`   Status: ${existing.status}`);
        console.log(`   ID:     ${existing.templateId}`);
        if (existing.status === 'APPROVED') {
            console.log('\n✅ Template is already approved — no action needed.');
        } else if (existing.status === 'REJECTED') {
            console.log(`\n⚠️  Template was REJECTED: ${existing.rejectionReason || 'Unknown reason'}`);
            console.log('   You may need to edit and re-submit manually via Meta Business Manager.');
        } else {
            console.log(`\n⏳ Template is ${existing.status} — waiting for Meta review.`);
        }
        return;
    }

    // 2. Submit template
    console.log('\n📤 Submitting template to Meta for review…\n');
    console.log('Template name :', TEMPLATE.name);
    console.log('Category      :', TEMPLATE.category);
    console.log('Language      :', TEMPLATE.language);
    console.log('Variables     :', TEMPLATE.variables.map(v => `{{${TEMPLATE.variables.indexOf(v) + 1}}} = ${v.name} (e.g. "${v.example}")`).join('\n                 '));
    console.log('\n───────────────────────────────────────────────────');
    console.log(TEMPLATE.body);
    console.log('───────────────────────────────────────────────────\n');

    const result = await metaWhatsApp.submitTemplateToMeta(TEMPLATE);

    if (result.success) {
        console.log('✅ Template submitted successfully!');
        console.log(`   Template ID: ${result.templateId}`);
        console.log('\n⏳ Meta will review the template (usually takes a few minutes to a few hours).');
        console.log('   You can check status anytime by running:');
        console.log(`   node -e "require('dotenv').config(); const m = require('./config/meta-whatsapp'); m.getTemplateStatusFromMeta('${TEMPLATE.name}').then(r => console.log(r))"`);
    } else {
        console.error('❌ Template submission failed!');
        console.error(`   Error: ${result.error}`);
        if (result.errorCode) console.error(`   Code:  ${result.errorCode}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
