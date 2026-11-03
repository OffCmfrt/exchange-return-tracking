// ============================================================================
// Website Support & Tickets System — Catalog Configuration
// Static configuration, reason taxonomy, and stage eligibility matrix.
// ============================================================================

const REASONS = [
  {
    code: 'order',
    label: 'Order confirmation & changes',
    subs: [
      { code: 'cancel_order', label: 'Cancel order' },
      { code: 'edit_order', label: 'Edit items in order' },
      { code: 'change_address', label: 'Change delivery address' },
      { code: 'cod_to_prepaid', label: 'Convert COD to prepaid' }
    ]
  },
  {
    code: 'delivery',
    label: 'Delivery & address',
    subs: [
      { code: 'not_delivered', label: 'Marked delivered but not received' },
      { code: 'delayed', label: 'Shipment is delayed' },
      { code: 'wrong_address', label: 'Delivered to wrong address' },
      { code: 'address_change', label: 'Update address after dispatch' }
    ]
  },
  {
    code: 'product',
    label: 'Problem with the product',
    subs: [
      { code: 'damaged', label: 'Arrived damaged' },
      { code: 'missing_item', label: 'Item missing from package' },
      { code: 'wrong_product', label: 'Received wrong product' },
      { code: 'tampered', label: 'Package was opened / tampered' },
      { code: 'not_as_described', label: 'Product not as described' }
    ]
  },
  {
    code: 'fit',
    label: 'Size & fit',
    subs: [
      { code: 'too_small', label: 'Too small / tight' },
      { code: 'too_large', label: 'Too large / loose' },
      { code: 'not_as_expected', label: 'Fit / style not as expected' }
    ]
  },
  {
    code: 'return',
    label: 'Return or exchange',
    subs: [
      { code: 'return_request', label: 'Return for store credit' },
      { code: 'exchange_request', label: 'Exchange for different size / item' },
      { code: 'pickup_issue', label: 'Pickup issue / delay' }
    ]
  },
  {
    code: 'credit',
    label: 'Store credit & payments',
    subs: [
      { code: 'code_not_working', label: 'Store credit code not working' },
      { code: 'refund_status', label: 'Refund / credit status' },
      { code: 'payment_failed', label: 'Payment failed / deducted twice' }
    ]
  },
  {
    code: 'other',
    label: 'Something else',
    subs: [
      { code: 'general_query', label: 'General question' },
      { code: 'feedback', label: 'Feedback or suggestion' }
    ]
  }
];

const PREFERENCES = [
  { value: 'exchange', label: 'Exchange for another size/item' },
  { value: 'replacement', label: 'Replacement of same item' },
  { value: 'credit', label: 'Store credit' }
];

const CONTACT_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'call', label: 'Phone Call' }
];

const RESOLUTION_TYPES = [
  { code: 'information_shared', label: 'Information shared' },
  { code: 'order_updated', label: 'Order updated' },
  { code: 'address_updated', label: 'Delivery address updated' },
  { code: 'order_cancelled', label: 'Order cancelled' },
  { code: 'converted_prepaid', label: 'Converted to prepaid' },
  { code: 'new_order', label: 'New order created' },
  { code: 'pickup_scheduled', label: 'Reverse pickup scheduled' },
  { code: 'exchange_dispatched', label: 'Exchange dispatched' },
  { code: 'reshipped', label: 'Order reshipped' },
  { code: 'store_credit_issued', label: 'Store credit issued' },
  { code: 'courier_escalated', label: 'Courier escalated' },
  { code: 'request_declined', label: 'Request declined' },
  { code: 'claim_not_verified', label: 'Claim not verified' },
  { code: 'no_response', label: 'No response from customer' }
];

/**
 * Check eligibility of a reason/sub-issue against an order stage.
 * @param {string} reason
 * @param {string} sub
 * @param {string|null} stage ('unshipped', 'shipped', 'delivered', 'cancelled', 'rto', 'return', 'exchange')
 * @param {object} [options]
 * @param {Date|string} [options.deliveredAt]
 * @param {number} [options.returnWindowDays=7]
 * @param {number} [options.dnrReportDays=3]
 * @returns {{ eligible: boolean, locked_reason: string|null }}
 */
function checkEligibility(reason, sub, stage, options = {}) {
  if (!stage) {
    return { eligible: true, locked_reason: null };
  }

  const normalizedStage = String(stage).toLowerCase().trim();
  const returnWindowDays = Number(options.returnWindowDays) || 7;
  const dnrReportDays = Number(options.dnrReportDays) || 3;

  // Global stages: cancelled
  if (normalizedStage === 'cancelled') {
    if (['credit', 'other'].includes(reason)) {
      return { eligible: true, locked_reason: null };
    }
    return { eligible: false, locked_reason: 'This order has already been cancelled.' };
  }

  // Helper: check elapsed days since delivery
  function daysSinceDelivery() {
    if (!options.deliveredAt) return 0;
    const diffMs = Date.now() - new Date(options.deliveredAt).getTime();
    return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  }

  // 1. Stage: unshipped
  if (normalizedStage === 'unshipped') {
    if (reason === 'order') {
      return { eligible: true, locked_reason: null };
    }
    if (reason === 'delivery') {
      if (['delayed', 'address_change'].includes(sub)) {
        return { eligible: true, locked_reason: null };
      }
      return { eligible: false, locked_reason: 'Order has not shipped yet.' };
    }
    if (['product', 'fit', 'return'].includes(reason)) {
      return { eligible: false, locked_reason: 'Order has not been delivered yet.' };
    }
    return { eligible: true, locked_reason: null };
  }

  // 2. Stage: shipped
  if (normalizedStage === 'shipped') {
    if (reason === 'order') {
      return { eligible: false, locked_reason: 'Order has already shipped and cannot be modified or cancelled directly.' };
    }
    if (reason === 'delivery') {
      if (sub === 'not_delivered') {
        return { eligible: false, locked_reason: 'Order is still in transit.' };
      }
      if (sub === 'wrong_address') {
        return { eligible: false, locked_reason: 'Order has not been delivered yet.' };
      }
      return { eligible: true, locked_reason: null };
    }
    if (['product', 'fit', 'return'].includes(reason)) {
      return { eligible: false, locked_reason: 'Order has not been delivered yet.' };
    }
    return { eligible: true, locked_reason: null };
  }

  // 3. Stage: delivered
  if (normalizedStage === 'delivered') {
    if (reason === 'order') {
      return { eligible: false, locked_reason: 'Order has already been delivered.' };
    }
    if (reason === 'delivery') {
      if (sub === 'not_delivered') {
        if (daysSinceDelivery() > dnrReportDays) {
          return {
            eligible: false,
            locked_reason: `Delivery dispute must be reported within ${dnrReportDays} days of delivery.`
          };
        }
        return { eligible: true, locked_reason: null };
      }
      if (sub === 'wrong_address') {
        return { eligible: true, locked_reason: null };
      }
      return { eligible: false, locked_reason: 'Order has already been delivered.' };
    }
    if (reason === 'product') {
      return { eligible: true, locked_reason: null };
    }
    if (['fit', 'return'].includes(reason)) {
      if (daysSinceDelivery() > returnWindowDays) {
        return {
          eligible: false,
          locked_reason: `The ${returnWindowDays}-day return & exchange window has expired for this order.`
        };
      }
      return { eligible: true, locked_reason: null };
    }
    return { eligible: true, locked_reason: null };
  }

  // 4. Stage: rto
  if (normalizedStage === 'rto') {
    if (reason === 'delivery' && ['delayed', 'address_change'].includes(sub)) {
      return { eligible: true, locked_reason: null };
    }
    if (['credit', 'other'].includes(reason)) {
      return { eligible: true, locked_reason: null };
    }
    return { eligible: false, locked_reason: 'Package has been returned to origin.' };
  }

  // 5. Stage: return / exchange
  if (['return', 'exchange'].includes(normalizedStage)) {
    if (reason === 'return' && sub === 'pickup_issue') {
      return { eligible: true, locked_reason: null };
    }
    if (['credit', 'other'].includes(reason)) {
      return { eligible: true, locked_reason: null };
    }
    return { eligible: false, locked_reason: 'A return or exchange request is already active for this order.' };
  }

  // Default fallback
  return { eligible: true, locked_reason: null };
}

/**
 * Build the full catalog with eligibility flags for a given order stage.
 * @param {object} [params]
 * @param {string|null} [params.stage]
 * @param {object} [params.settings]
 * @param {Date|string} [params.deliveredAt]
 * @returns {object} C2 payload
 */
function buildCatalog({ stage = null, settings = {}, deliveredAt = null } = {}) {
  const costConfig = settings.cost_config || {};
  const returnWindowDays = costConfig.return_window_days || 7;
  const dnrReportDays = costConfig.dnr_report_days || 3;

  const reasons = REASONS.map(r => {
    const subs = (r.subs || []).map(s => {
      const eligibility = checkEligibility(r.code, s.code, stage, {
        deliveredAt,
        returnWindowDays,
        dnrReportDays
      });
      return {
        code: s.code,
        label: s.label,
        eligible: eligibility.eligible,
        locked_reason: eligibility.locked_reason
      };
    });

    const isAnySubEligible = subs.some(s => s.eligible);
    const reasonEligibility = stage
      ? isAnySubEligible
      : true;

    return {
      code: r.code,
      label: r.label,
      eligible: reasonEligibility,
      locked_reason: reasonEligibility ? null : 'Not eligible for current order stage',
      subs
    };
  });

  return {
    reasons,
    preferences: PREFERENCES,
    contact_options: CONTACT_OPTIONS,
    limits: {
      max_images: 3
    }
  };
}

module.exports = {
  REASONS,
  PREFERENCES,
  CONTACT_OPTIONS,
  RESOLUTION_TYPES,
  checkEligibility,
  buildCatalog
};
