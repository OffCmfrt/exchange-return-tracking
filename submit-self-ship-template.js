/**
 * One-time script: Submit the "self_ship_required" UTILITY template to Meta
 * for review/approval.
 *
 * Usage:
 *   node submit-self-ship-template.js
 *
 * Requires META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_WABA_ID in .env
 */

require('dotenv').config();
const metaWhatsApp = require('./config/meta-whatsapp');

const TEMPLATE = {
    name: 'self_ship_required',
    category: 'UTILITY',
    language: 'en',
    header: null,
    body: `📦 *SELF-SHIP REQUIRED – RETURN/EXCHANGE REQUEST*

Hi! Unfortunately, we're *unable to arrange a pickup* for your {{1}} request because your location is currently *unserviceable by both of our pickup partners.*

💰 *The ₹150 pickup fee (if paid) will be automatically refunded within 24 hours.*

Please *self-ship* the product to the following address:

📍 *Shipping Address:*
{{2}}

📞 *Mobile:* {{3}}

📝 *Please place a note inside the package with the following details:*
• Order Number: {{4}}
• Return/Exchange Request ID: {{5}}
• Registered Name
• Registered Mobile Number
• Return or Exchange Request

🚚 Once you've shipped the package, please *share the courier receipt and AWB/Tracking Number* with us so we can track your shipment.

📦 Once your return reaches our warehouse and successfully passes the *Quality Check (QC)*, we'll process the next step of your request *(Replacement, Store Credit, or Refund, as applicable).*

Thank you for your cooperation, and we sincerely apologize for the inconvenience. 💙`,
    footer: null,
    buttons: null,
    variables: [
        { name: 'request_type',      example: 'Return/Exchange' },
        { name: 'warehouse_address', example: '1590, HUDA Sector 1, Narnaul, Haryana – 123001' },
        { name: 'warehouse_phone',   example: '9138514222' },
        { name: 'order_number',      example: '#12345' },
        { name: 'request_id',        example: 'REQ-67796' }
    ]
};

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Submit Self-Ship Required Template to Meta');
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
