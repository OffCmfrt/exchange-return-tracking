/**
 * Meta WhatsApp Cloud API Configuration
 * 
 * Provides integration with Meta's WhatsApp Business Cloud API for marketing messages.
 * Reuses existing WhatsApp infrastructure (WHATSAPP_BOT_URL, WHATSAPP_INTERNAL_TOKEN).
 * 
 * Graceful degradation: If Meta credentials are not configured, all functions
 * log warnings and return null/empty results without crashing the server.
 */

const META_API_VERSION = 'v18.0';
const META_GRAPH_API_BASE = 'https://graph.facebook.com';

// ── Configuration Getters ──

function getMetaAccessToken() {
    return process.env.META_ACCESS_TOKEN || null;
}

function getPhoneNumberId() {
    return process.env.META_PHONE_NUMBER_ID || null;
}

function getWabaId() {
    return process.env.META_WABA_ID || null;
}

function getAppSecret() {
    return process.env.META_APP_SECRET || null;
}

function getVerifyToken() {
    return process.env.META_VERIFY_TOKEN || null;
}

function getWhatsappBotUrl() {
    return process.env.WHATSAPP_BOT_URL || 'http://localhost:3000';
}

function getWhatsappInternalToken() {
    return process.env.WHATSAPP_INTERNAL_TOKEN || '';
}

/**
 * Check if Meta Cloud API is properly configured
 */
function isMetaConfigured() {
    return !!(getMetaAccessToken() && getPhoneNumberId());
}

/**
 * Check if the legacy WhatsApp bot is configured (fallback)
 */
function isBotConfigured() {
    return !!(getWhatsappBotUrl());
}

// ── Meta Cloud API: Send Template Message ──

/**
 * Build properly structured components array from Meta template metadata and a variable pool.
 * Handles HEADER, BODY, and BUTTON components — each gets its own parameters.
 *
 * @param {Object} metaTemplate - Full template object from getMetaTemplateByName()
 * @param {Array<string>} varPool - Ordered pool of variable values [name, itemCount, value, url, phone, email]
 * @returns {Array} components array ready for the Meta Cloud API
 */
function buildTemplateComponents(metaTemplate, varPool) {
    const components = metaTemplate.components || [];
    let varIndex = 0;
    const result = [];

    for (const comp of components) {
        if (comp.type === 'HEADER' && comp.format === 'TEXT' && comp.text) {
            const matches = comp.text.match(/\{\{\d+\}\}/g) || [];
            if (matches.length > 0) {
                const params = [];
                for (let i = 0; i < matches.length; i++) {
                    params.push({ type: 'text', text: String(varPool[varIndex++] || '') });
                }
                result.push({ type: 'header', parameters: params });
            }
        } else if (comp.type === 'BODY') {
            const matches = (comp.text || '').match(/\{\{\d+\}\}/g) || [];
            if (matches.length > 0) {
                const params = [];
                for (let i = 0; i < matches.length; i++) {
                    params.push({ type: 'text', text: String(varPool[varIndex++] || '') });
                }
                result.push({ type: 'body', parameters: params });
            }
        } else if (comp.type === 'BUTTONS') {
            // Handle URL buttons with payload parameters
            for (let btnIdx = 0; btnIdx < (comp.buttons || []).length; btnIdx++) {
                const btn = comp.buttons[btnIdx];
                if (btn.type === 'URL' && btn.url) {
                    const matches = btn.url.match(/\{\{\d+\}\}/g) || [];
                    if (matches.length > 0) {
                        const params = [];
                        for (let i = 0; i < matches.length; i++) {
                            params.push({ type: 'text', text: String(varPool[varIndex++] || '') });
                        }
                        result.push({
                            type: 'button',
                            sub_type: 'url',
                            index: String(btnIdx),
                            parameters: params
                        });
                    }
                }
            }
        }
    }

    return result;
}

/**
 * Send a WhatsApp template message via Meta Cloud API
 * Falls back to existing WhatsApp bot if Meta is not configured
 * 
 * @param {string} phone - Recipient phone number with country code (e.g., '919876543210')
 * @param {string} templateName - Meta-approved template name
 * @param {Array} parameters - Array of parameter values OR pre-built components array
 * @param {string} language - Template language code (default: 'en')
 * @param {Array} [prebuiltComponents] - Optional pre-built components from buildTemplateComponents()
 * @returns {Object} { success, messageId, fallback, error }
 */
async function sendTemplateMessage(phone, templateName, parameters = [], language = 'en', prebuiltComponents = null) {
    if (!phone) {
        return { success: false, error: 'Phone number is required' };
    }

    // Try Meta Cloud API first
    if (isMetaConfigured()) {
        return await _sendViaMetaCloudAPI(phone, templateName, parameters, language, prebuiltComponents);
    }

    // Fallback to existing WhatsApp bot
    if (isBotConfigured()) {
        return await _sendViaWhatsappBot(phone, templateName, parameters);
    }

    console.warn('[Meta WhatsApp] No messaging channel configured. Set META_ACCESS_TOKEN + META_PHONE_NUMBER_ID or WHATSAPP_BOT_URL.');
    return { success: false, error: 'No messaging channel configured' };
}

/**
 * Send via Meta Cloud API directly
 */
async function _sendViaMetaCloudAPI(phone, templateName, parameters, language, prebuiltComponents = null) {
    const accessToken = getMetaAccessToken();
    const phoneNumberId = getPhoneNumberId();

    try {
        const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${phoneNumberId}/messages`;

        // Build template component
        const templatePayload = {
            name: templateName,
            language: { code: language }
        };

        // Use pre-built components if provided (handles header + body + button)
        if (prebuiltComponents && prebuiltComponents.length > 0) {
            templatePayload.components = prebuiltComponents;
        } else if (parameters && parameters.length > 0) {
            // Legacy fallback: all params go into body only
            templatePayload.components = [
                {
                    type: 'body',
                    parameters: parameters.map(param => {
                        if (typeof param === 'object' && param.type) {
                            return param; // Already formatted parameter object
                        }
                        return { type: 'text', text: String(param) };
                    })
                }
            ];
        }

        const body = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phone,
            type: 'template',
            template: templatePayload
        };

        console.log(`[Meta WhatsApp] Sending template "${templateName}" to ${phone}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (data.messages && data.messages.length > 0) {
            console.log(`[Meta WhatsApp] Message sent: ${data.messages[0].id}`);
            return {
                success: true,
                messageId: data.messages[0].id,
                conversationId: data.messages[0].conversation?.id || null,
                pricingCategory: data.messages[0].pricing?.category || null,
                fallback: false
            };
        }

        if (data.error) {
            console.error(`[Meta WhatsApp] API error: ${data.error.message}`);
            return {
                success: false,
                error: data.error.message,
                errorCode: data.error.code,
                fallback: false
            };
        }

        return { success: false, error: 'Unknown Meta API response', data, fallback: false };

    } catch (error) {
        console.error(`[Meta WhatsApp] Send failed:`, error.message);

        // Try fallback to bot
        if (isBotConfigured()) {
            console.log(`[Meta WhatsApp] Falling back to WhatsApp bot...`);
            return await _sendViaWhatsappBot(phone, templateName, parameters);
        }

        return { success: false, error: error.message, fallback: false };
    }
}

/**
 * Send via existing WhatsApp bot server (fallback)
 */
async function _sendViaWhatsappBot(phone, templateName, parameters) {
    const botUrl = getWhatsappBotUrl();
    const internalToken = getWhatsappInternalToken();

    try {
        // Build message text from template (simple substitution)
        let message = templateName; // Use template name as fallback message
        if (parameters && parameters.length > 0) {
            parameters.forEach((param, idx) => {
                const value = typeof param === 'object' ? (param.text || JSON.stringify(param)) : String(param);
                message = message.replace(`{{${idx + 1}}}`, value);
            });
        }

        const response = await fetch(`${botUrl}/api/internal/send-notification`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-token': internalToken
            },
            body: JSON.stringify({
                phone,
                message,
                type: 'marketing',
                templateData: { templateName, parameters }
            })
        });

        const data = await response.json();

        if (data.success) {
            return { success: true, messageId: data.messageId, fallback: true };
        }

        return { success: false, error: data.error || 'Bot send failed', fallback: true };

    } catch (error) {
        console.error(`[Meta WhatsApp] Bot fallback failed:`, error.message);
        return { success: false, error: error.message, fallback: true };
    }
}

// ── Meta Cloud API: Template Management ──

/**
 * Submit a template to Meta for approval
 */
async function submitTemplateToMeta(templateData) {
    if (!isMetaConfigured()) {
        return { success: false, error: 'Meta Cloud API not configured' };
    }

    const accessToken = getMetaAccessToken();
    const wabaId = getWabaId();

    if (!wabaId) {
        return { success: false, error: 'META_WABA_ID not configured' };
    }

    try {
        const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${wabaId}/message_templates`;

        // Build Meta API template payload
        const components = [];

        // Header component
        if (templateData.header) {
            if (templateData.headerType === 'image' || templateData.headerType === 'video' || templateData.headerType === 'document') {
                components.push({
                    type: 'HEADER',
                    format: templateData.headerType.toUpperCase()
                });
            } else {
                components.push({
                    type: 'HEADER',
                    format: 'TEXT',
                    text: templateData.header
                });
            }
        }

        // Body component (required)
        const bodyComponent = {
            type: 'BODY',
            text: templateData.body
        };
        if (templateData.variables && templateData.variables.length > 0) {
            bodyComponent.example = {
                body_text: [templateData.variables.map(v => v.example || 'example')]
            };
        }
        components.push(bodyComponent);

        // Footer component
        if (templateData.footer) {
            components.push({
                type: 'FOOTER',
                text: templateData.footer
            });
        }

        // Buttons component
        if (templateData.buttons && templateData.buttons.length > 0) {
            const buttons = templateData.buttons.map(btn => {
                const button = { type: btn.type || 'QUICK_REPLY', text: btn.text };
                if (btn.type === 'URL' && btn.url) button.url = btn.url;
                if (btn.type === 'PHONE_NUMBER' && btn.phoneNumber) button.phone_number = btn.phoneNumber;
                return button;
            });
            components.push({ type: 'BUTTONS', buttons });
        }

        const body = {
            name: templateData.name,
            language: templateData.language || 'en',
            category: templateData.category?.toUpperCase() || 'MARKETING',
            components
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (data.id) {
            return { success: true, templateId: data.id };
        }

        if (data.error) {
            return { success: false, error: data.error.message, errorCode: data.error.code };
        }

        return { success: false, error: 'Unknown response from Meta', data };

    } catch (error) {
        console.error('[Meta WhatsApp] Template submission failed:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Get template status from Meta
 */
async function getTemplateStatusFromMeta(templateName) {
    if (!isMetaConfigured()) {
        return { success: false, error: 'Meta Cloud API not configured' };
    }

    const accessToken = getMetaAccessToken();
    const wabaId = getWabaId();

    if (!wabaId) {
        return { success: false, error: 'META_WABA_ID not configured' };
    }

    try {
        const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${wabaId}/message_templates?name=${encodeURIComponent(templateName)}`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const data = await response.json();

        if (data.data && data.data.length > 0) {
            const template = data.data[0];
            return {
                success: true,
                templateId: template.id,
                status: template.status,
                rejectionReason: template.rejection_reason || null,
                category: template.category
            };
        }

        return { success: false, error: 'Template not found on Meta' };

    } catch (error) {
        console.error('[Meta WhatsApp] Template status check failed:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Get full template details from Meta (including components/parameters)
 */
async function getMetaTemplateByName(templateName) {
    if (!isMetaConfigured()) {
        return { success: false, error: 'Meta Cloud API not configured' };
    }

    const accessToken = getMetaAccessToken();
    const wabaId = getWabaId();

    if (!wabaId) {
        return { success: false, error: 'META_WABA_ID not configured' };
    }

    try {
        const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${wabaId}/message_templates?name=${encodeURIComponent(templateName)}`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const data = await response.json();

        if (data.data && data.data.length > 0) {
            return { success: true, template: data.data[0] };
        }

        return { success: false, error: 'Template not found on Meta' };

    } catch (error) {
        console.error('[Meta WhatsApp] Get template failed:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * List all templates from Meta
 */
async function listMetaTemplates(limit = 50) {
    if (!isMetaConfigured()) {
        return { success: false, error: 'Meta Cloud API not configured' };
    }

    const accessToken = getMetaAccessToken();
    const wabaId = getWabaId();

    if (!wabaId) {
        return { success: false, error: 'META_WABA_ID not configured' };
    }

    try {
        const url = `${META_GRAPH_API_BASE}/${META_API_VERSION}/${wabaId}/message_templates?limit=${limit}`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const data = await response.json();

        if (data.data) {
            return { success: true, templates: data.data };
        }

        return { success: false, error: 'Failed to list templates', data };

    } catch (error) {
        console.error('[Meta WhatsApp] List templates failed:', error.message);
        return { success: false, error: error.message };
    }
}

// ── Meta Webhook Verification ──

/**
 * Verify Meta webhook token
 */
function verifyWebhookToken(req) {
    const verifyToken = getVerifyToken();
    if (!verifyToken) return false;
    return req.query['hub.verify_token'] === verifyToken;
}

/**
 * Verify webhook signature (using app secret)
 */
function verifyWebhookSignature(payload, signature, appSecret) {
    const crypto = require('crypto');
    const secret = appSecret || getAppSecret();
    if (!secret || !signature) return false;

    const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
    );
}

// ── Exports ──

module.exports = {
    // Configuration
    getMetaAccessToken,
    getPhoneNumberId,
    getWabaId,
    getAppSecret,
    getVerifyToken,
    isMetaConfigured,
    isBotConfigured,

    // Messaging
    sendTemplateMessage,
    buildTemplateComponents,

    // Template Management
    submitTemplateToMeta,
    getTemplateStatusFromMeta,
    getMetaTemplateByName,
    listMetaTemplates,

    // Webhook
    verifyWebhookToken,
    verifyWebhookSignature
};
