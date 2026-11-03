// ============================================================================
// Website Support & Tickets System — Core Support Service
// Domain logic, ticket operations, thread management, risk & cost computation.
// Plain JS service layer (no Express types inside).
// ============================================================================

const {
  REASONS,
  RESOLUTION_TYPES,
  checkEligibility,
  buildCatalog
} = require('./catalog');

/**
 * Normalise any customer phone number to trailing 10 digits for matching,
 * and standard representation (91XXXXXXXXXX).
 * @param {string} phone
 * @returns {string}
 */
function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    return '91' + last10;
  }
  return digits;
}

/**
 * Extract trailing 10 digits for loose matching.
 * @param {string} phone
 * @returns {string}
 */
function last10Digits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Generate standard ticket number: TKT-YYMMDD-NNNN
 * @returns {string}
 */
function generateTicketNumber() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TKT-${yy}${mm}${dd}-${rand}`;
}

/**
 * Derive high-level ticket group from status and timestamp comparison.
 * Never changes stored status!
 * @param {object} ticket
 * @returns {'open'|'awaiting'|'closed'}
 */
function deriveGroup(ticket) {
  if (['resolved', 'closed'].includes(ticket.status)) {
    return 'closed';
  }
  if (ticket.status === 'open' && ticket.last_agent_at) {
    const agentTime = new Date(ticket.last_agent_at).getTime();
    const custTime = ticket.last_customer_at
      ? new Date(ticket.last_customer_at).getTime()
      : 0;
    if (agentTime > custTime) {
      return 'awaiting';
    }
  }
  return 'open';
}

/**
 * Factory creating the SupportService
 */
function createSupportService({
  supabase,
  shopifyAPI,
  schedulePickup = null,
  razorpay = null
}) {

  // ────────────────────────────────────────────────────────────────────────
  // SETTINGS & CACHE HELPERS
  // ────────────────────────────────────────────────────────────────────────

  async function getSettingsMap() {
    const defaultSettings = {
      sla: { high_hours: 4, normal_hours: 12 },
      teams: {
        chat: 'Chat support',
        calling: 'Calling team',
        instagram: 'Instagram support',
        logistics: 'Logistics & labels',
        returns: 'Returns & QC',
        escalation: 'Refunds & escalations'
      },
      cost_config: {
        fwd_ship: 75,
        rto_ship: 75,
        reverse_pickup: 90,
        packing: 20,
        cod_fee: 35,
        rto_rate_cod: 0.25,
        rto_rate_prepaid: 0.05,
        high_value: 2500,
        return_window_days: 7,
        dnr_report_days: 3
      },
      resolution_templates: {
        information_shared: 'We have shared the information you asked for about order #{order}.',
        order_updated: 'Your order #{order} has been updated as requested.',
        address_updated: 'Your delivery address for order #{order} has been updated.',
        order_cancelled: 'Order #{order} has been cancelled as requested.',
        converted_prepaid: 'Payment received. Order #{order} is now prepaid.',
        new_order: 'We have created a new order for you. You will get the details on WhatsApp shortly.',
        pickup_scheduled: 'Your reverse pickup for order #{order} is scheduled with Delhivery. Please keep the product unused, with tags, in its original packet.',
        exchange_dispatched: 'Your exchange for order #{order} has been dispatched. Tracking details will follow on WhatsApp.',
        reshipped: 'We have reshipped order #{order}. You will get the new tracking details on WhatsApp shortly.',
        store_credit_issued: 'We have issued store credit for order #{order}. Your code is titled {order} and can be applied at checkout on offcomfrt.com.',
        courier_escalated: 'We took this up with {courier} (AWB {awb}) and it is now resolved.',
        request_declined: 'We are unable to approve this request for order #{order}. {reason}',
        claim_not_verified: 'We checked the order, packing and courier records for #{order} and could not verify this issue. If you have more details, reopen the ticket within 7 days.',
        no_response: 'We are closing this as we did not hear back. You can reopen it within 7 days.'
      }
    };

    try {
      const { data, error } = await supabase.from('support_settings').select('key, value');
      if (error || !data) return defaultSettings;
      for (const row of data) {
        defaultSettings[row.key] = row.value;
      }
    } catch {
      // Fallback to default in-memory config if table not ready
    }
    return defaultSettings;
  }

  function computeSlaDueAt(createdAt, priority, slaConfig) {
    const cfg = slaConfig || { high_hours: 4, normal_hours: 12 };
    const hours = priority === 'high' ? (cfg.high_hours || 4) : (cfg.normal_hours || 12);
    const date = new Date(createdAt ? new Date(createdAt).getTime() : Date.now());
    return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
  }

  // ────────────────────────────────────────────────────────────────────────
  // RISK & COST MODELS
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Compute Risk score and priority level
   */
  async function riskFor({ order = null, customer = null, ticket = null, settings = {} }) {
    let score = 0;
    const factors = [];
    const costConfig = settings.cost_config || {};
    const highValueThreshold = costConfig.high_value || 2500;

    // 1. Payment mode COD (+2)
    if (order && String(order.payment).toUpperCase() === 'COD') {
      score += 2;
      factors.push({ key: 'cod', label: 'Cash on delivery payment', points: 2 });
    }

    // 2. High value total (+1)
    if (order && Number(order.total) >= highValueThreshold) {
      score += 1;
      factors.push({ key: 'high_value', label: `Order total above ₹${highValueThreshold}`, points: 1 });
    }

    // 3. Customer past RTO (+1)
    if (customer && customer.history && customer.history.rto > 0) {
      score += 1;
      factors.push({ key: 'past_rto', label: 'Customer has previous RTO shipments', points: 1 });
    }

    // 4. Address change after dispatch (+2)
    if (ticket && (ticket.sub === 'address_change' || ticket.new_address) && order && order.stage === 'shipped') {
      score += 2;
      factors.push({ key: 'address_post_dispatch', label: 'Address change requested after dispatch', points: 2 });
    }

    // 5. Claims needing proof (+2)
    if (ticket && ['missing_item', 'tampered', 'wrong_product', 'damaged'].includes(ticket.sub)) {
      score += 2;
      factors.push({ key: 'claims_proof', label: 'Physical claim requiring verification/unboxing proof', points: 2 });
    }

    // 6. Reopened ticket (+1)
    if (ticket && Number(ticket.reopen_count) > 0) {
      score += 1;
      factors.push({ key: 'reopened', label: 'Ticket was reopened by customer', points: 1 });
    }

    // 7. Multiple open tickets (+1)
    if (customer && customer.history && customer.history.open_tickets > 1) {
      score += 1;
      factors.push({ key: 'multiple_tickets', label: 'Multiple concurrent open tickets for customer', points: 1 });
    }

    let level = 'low';
    if (score >= 5) level = 'high';
    else if (score >= 2) level = 'medium';

    return { level, score, factors };
  }

  /**
   * Compute Cost options and recommendations
   */
  async function costFor({ order = null, ticket = null, settings = {} }) {
    const cfg = settings.cost_config || {
      fwd_ship: 75,
      rto_ship: 75,
      reverse_pickup: 90,
      packing: 20,
      cod_fee: 35,
      rto_rate_cod: 0.25,
      rto_rate_prepaid: 0.05
    };

    const total = order ? Number(order.total) || 0 : 0;
    const isCOD = order ? String(order.payment).toUpperCase() === 'COD' : false;
    const rtoRate = isCOD ? cfg.rto_rate_cod : cfg.rto_rate_prepaid;

    const options = [
      {
        key: 'approve',
        label: 'Approve return / reverse pickup',
        est_cost: cfg.reverse_pickup + cfg.packing,
        why: `Reverse pickup fee (₹${cfg.reverse_pickup}) + repackaging (₹${cfg.packing})`
      },
      {
        key: 'decline',
        label: 'Decline request',
        est_cost: Math.round(cfg.rto_ship + (rtoRate * total)),
        why: `RTO freight hazard (₹${cfg.rto_ship}) + customer attrition probability (${rtoRate * 100}%)`
      },
      {
        key: 'reship',
        label: 'Reship / replacement order',
        est_cost: cfg.fwd_ship + cfg.packing,
        why: `Forward shipping (₹${cfg.fwd_ship}) + warehouse packaging (₹${cfg.packing})`
      }
    ];

    if (isCOD) {
      options.push({
        key: 'prepay_conversion',
        label: 'Convert COD to prepaid',
        est_cost: 0,
        why: `Saves COD collection fee (₹${cfg.cod_fee}) and lowers delivery risk`
      });
    }

    let recommendation = 'Approve the return; reverse pickup cost is predictable and preserves customer retention.';
    if (ticket && ['exchange', 'replacement'].includes(ticket.preference)) {
      recommendation = 'Dispatch replacement; forward shipping is lower than reverse pickup and fulfills customer request.';
    } else if (options[0].est_cost < options[1].est_cost) {
      recommendation = 'Approve the return; reverse pickup cost is lower than decline dispute & RTO risk.';
    }

    return { options, recommendation };
  }

  /**
   * Determine eligible approval actions for admin desk
   */
  function eligibleActionsFor({ order = null, ticket = null }) {
    const actions = [];
    const stage = order ? String(order.stage).toLowerCase() : null;
    const payment = order ? String(order.payment).toUpperCase() : '';

    if (stage === 'unshipped') {
      actions.push({
        key: 'order/cancel',
        label: 'Cancel order in Shopify',
        payload_hint: { reason: 'Customer requested cancellation' }
      });
      actions.push({
        key: 'order/edit',
        label: 'Add note to Shopify order',
        payload_hint: { note: 'Note text' }
      });
    }

    if (payment === 'COD' && ['unshipped', 'shipped'].includes(stage)) {
      actions.push({
        key: 'order/prepay',
        label: 'Generate Razorpay payment link for prepaid conversion',
        payload_hint: { amount: order ? order.total : 0 }
      });
    }

    if (['unshipped', 'shipped'].includes(stage)) {
      actions.push({
        key: 'delivery/address_change',
        label: 'Update shipping address',
        payload_hint: { shipping_address: ticket ? ticket.new_address : '' }
      });
    }

    if (['rto', 'shipped', 'delivered'].includes(stage) || (ticket && ticket.reason === 'delivery')) {
      actions.push({
        key: 'delivery/reship_new',
        label: 'Reship replacement order',
        payload_hint: { note: 'Reship approved' }
      });
      actions.push({
        key: 'delivery/pay_reship',
        label: 'Generate payment link for reshipment fee',
        payload_hint: { amount: 100 }
      });
    }

    if (stage === 'delivered' || (ticket && ticket.reason === 'return')) {
      actions.push({
        key: 'return/return_credit',
        label: 'Schedule reverse pickup for store credit',
        payload_hint: { pickup_date: 'optional YYYY-MM-DD' }
      });
      actions.push({
        key: 'return/exchange_req',
        label: 'Schedule reverse pickup for exchange',
        payload_hint: { pickup_date: 'optional YYYY-MM-DD', replacement_variant: 'optional' }
      });
    }

    return actions;
  }

  // ────────────────────────────────────────────────────────────────────────
  // PAYLOAD FORMATTER
  // ────────────────────────────────────────────────────────────────────────

  function formatTicket(raw, attachments = [], settings = {}, isCustomer = false) {
    const group = deriveGroup(raw);
    const slaDueAt = computeSlaDueAt(raw.created_at, raw.priority, settings.sla);

    const rawThread = Array.isArray(raw.thread) ? raw.thread : [];
    const thread = isCustomer
      ? rawThread.filter(item => item.kind !== 'note')
      : rawThread;
    const notes = isCustomer
      ? []
      : (Array.isArray(raw.notes) ? raw.notes : []);

    return {
      id: raw.id,
      ticket_number: raw.ticket_number,
      order_id: raw.order_id || null,
      order_number: raw.order_number || null,
      channel: raw.channel || 'website',
      group,
      status: raw.status || 'open',
      reason: raw.reason || null,
      reason_label: raw.reason_label || null,
      sub: raw.sub || null,
      sub_label: raw.sub_label || null,
      other_text: raw.other_text || null,
      description: raw.description || null,
      preference: raw.preference || null,
      contact_via: raw.contact_via || 'whatsapp',
      new_address: raw.new_address || null,
      video_url: raw.video_url || null,
      priority: raw.priority || 'normal',
      team: raw.team || 'chat',
      assigned_to: raw.assigned_to || null,
      customer_phone: raw.customer_phone || '',
      customer_name: raw.customer_name || 'Customer',
      thread,
      notes,
      attachments: attachments.map(a => ({ id: a.id, image_url: a.image_url })),
      created_at: raw.created_at,
      first_response_at: raw.first_response_at || null,
      last_customer_at: raw.last_customer_at || raw.created_at,
      last_agent_at: raw.last_agent_at || null,
      resolution_type: raw.resolution_type || null,
      resolution_label: raw.resolution_label || null,
      resolution_at: raw.resolution_at || null,
      resolution_by: raw.resolution_by || null,
      csat: raw.csat != null ? Number(raw.csat) : null,
      reopen_count: Number(raw.reopen_count) || 0,
      sla_due_at: slaDueAt
    };
  }

  function formatTicketSummary(formattedTicket) {
    const { thread, notes, attachments, ...summary } = formattedTicket;
    let preview = '';
    if (thread && thread.length > 0) {
      const custMsgs = thread.filter(m => m.role === 'customer' && m.kind === 'message');
      if (custMsgs.length > 0) {
        preview = custMsgs[custMsgs.length - 1].text || '';
      }
    }
    summary.last_message_preview = preview.slice(0, 140);
    return summary;
  }

  // ────────────────────────────────────────────────────────────────────────
  // CUSTOMER FLOWS
  // ────────────────────────────────────────────────────────────────────────

  async function checkWhitelist(phone) {
    const l10 = last10Digits(phone);
    try {
      const { data, error } = await supabase
        .from('support_whitelist')
        .select('id, phone')
        .or(`phone.eq.${phone},phone.ilike.%${l10}%`)
        .limit(1);

      if (error || !data || data.length === 0) {
        return { allowed: false };
      }
      return { allowed: true };
    } catch {
      return { allowed: false };
    }
  }

  async function getCustomerOrders(phone) {
    const l10 = last10Digits(phone);
    const { data: cachedOrders, error } = await supabase
      .from('support_order_cache')
      .select('*')
      .or(`customer_phone.eq.${phone},customer_phone.ilike.%${l10}%`)
      .order('placed_at', { ascending: false });

    if (error || !cachedOrders) return [];

    // Find active tickets for these orders
    const { data: activeTickets } = await supabase
      .from('support_tickets')
      .select('id, ticket_number, order_id, status')
      .or(`customer_phone.eq.${phone},customer_phone.ilike.%${l10}%`)
      .not('status', 'in', '("resolved","closed")');

    const ticketMap = new Map();
    if (activeTickets) {
      for (const t of activeTickets) {
        if (t.order_id) ticketMap.set(String(t.order_id), t);
      }
    }

    return cachedOrders.map(o => {
      const activeTkt = ticketMap.get(String(o.order_id));
      const json = o.order_json || {};
      const items = (json.line_items || []).map(li => ({
        name: li.title || li.name,
        variant: li.variant_title || 'Default',
        qty: li.quantity || 1,
        price: Number(li.price) || 0
      }));

      return {
        order_id: o.order_id,
        order_number: o.order_json?.name || o.order_id,
        stage: o.stage || 'unshipped',
        payment: o.payment || 'Prepaid',
        total: Number(o.total) || 0,
        placed_at: o.placed_at,
        items,
        courier: o.courier || null,
        awb: o.awb || null,
        existing_ticket_id: activeTkt ? activeTkt.id : null,
        existing_ticket_number: activeTkt ? activeTkt.ticket_number : null
      };
    });
  }

  async function createTicket(customerPhone, body) {
    const settings = await getSettingsMap();
    const l10 = last10Digits(customerPhone);
    const normalizedPhone = normalizePhone(customerPhone);

    // 1. Validate images limit
    const images = Array.isArray(body.images) ? body.images : [];
    if (images.length > 3) {
      const err = new Error('A maximum of 3 images can be attached to a ticket.');
      err.code = 'INVALID_BODY';
      err.status = 400;
      throw err;
    }

    // 2. Fetch order if provided & verify stage eligibility
    let orderRow = null;
    let orderStage = null;
    let orderNumber = null;
    if (body.order_id) {
      const { data: ord } = await supabase
        .from('support_order_cache')
        .select('*')
        .eq('order_id', String(body.order_id))
        .single();

      if (ord) {
        orderRow = ord;
        orderStage = ord.stage;
        orderNumber = ord.order_json?.name || ord.order_id;
      }
    }

    const eligibility = checkEligibility(body.reason, body.sub, orderStage, {
      deliveredAt: orderRow?.delivered_at,
      returnWindowDays: settings.cost_config?.return_window_days,
      dnrReportDays: settings.cost_config?.dnr_report_days
    });

    if (!eligibility.eligible) {
      const err = new Error(eligibility.locked_reason || 'Selected reason is not eligible for this order stage.');
      err.code = 'NOT_ELIGIBLE';
      err.status = 409;
      throw err;
    }

    // Resolve labels from catalog
    const reasonObj = REASONS.find(r => r.code === body.reason);
    const subObj = reasonObj?.subs?.find(s => s.code === body.sub);
    const reasonLabel = reasonObj ? reasonObj.label : body.reason;
    const subLabel = subObj ? subObj.label : body.sub;

    // 3. Resolve customer details & calculate risk
    const { data: customerTickets } = await supabase
      .from('support_tickets')
      .select('id, status')
      .or(`customer_phone.eq.${customerPhone},customer_phone.ilike.%${l10}%`);

    const openCount = (customerTickets || []).filter(t => !['resolved', 'closed'].includes(t.status)).length;
    const customerSummary = {
      history: {
        rto: 0,
        open_tickets: openCount
      }
    };

    const risk = await riskFor({
      order: orderRow ? { payment: orderRow.payment, total: orderRow.total, stage: orderRow.stage } : null,
      customer: customerSummary,
      ticket: { sub: body.sub, new_address: body.new_address, reopen_count: 0 },
      settings
    });

    const ticketNumber = generateTicketNumber();
    const nowIso = new Date().toISOString();
    const initialThread = [
      {
        role: 'customer',
        text: body.description || reasonLabel,
        at: Date.now(),
        kind: 'message'
      }
    ];

    const newTicketRow = {
      ticket_number: ticketNumber,
      order_id: body.order_id ? String(body.order_id) : null,
      order_number: orderNumber,
      customer_phone: normalizedPhone,
      customer_name: orderRow?.customer_name || 'Customer',
      channel: 'website',
      status: 'open',
      priority: risk.priority || (risk.level === 'high' ? 'high' : 'normal'),
      team: 'chat',
      reason: body.reason,
      reason_label: reasonLabel,
      sub: body.sub,
      sub_label: subLabel,
      other_text: body.other_text || null,
      description: body.description || '',
      preference: body.preference || null,
      contact_via: body.contact_via || 'whatsapp',
      new_address: body.new_address || null,
      video_url: body.video_url || null,
      message: body.description || reasonLabel,
      is_read: false,
      thread: initialThread,
      notes: [],
      has_images: images.length > 0,
      created_at: nowIso,
      last_customer_at: nowIso,
      reopen_count: 0
    };

    const { data: inserted, error: insertError } = await supabase
      .from('support_tickets')
      .insert([newTicketRow])
      .select()
      .single();

    if (insertError || !inserted) {
      throw new Error(`Failed to create ticket: ${insertError?.message || 'Database error'}`);
    }

    // Attach images
    const attachments = [];
    if (images.length > 0) {
      const attachRows = images.map(imgUrl => ({
        ticket_id: inserted.id,
        image_url: imgUrl
      }));
      const { data: savedAttach } = await supabase
        .from('ticket_attachments')
        .insert(attachRows)
        .select();

      if (savedAttach) attachments.push(...savedAttach);
    }

    return formatTicket(inserted, attachments, settings, true);
  }

  async function listCustomerTickets(customerPhone, { group = null, page = 1, limit = 20 } = {}) {
    const settings = await getSettingsMap();
    const l10 = last10Digits(customerPhone);

    const { data: rawList, error } = await supabase
      .from('support_tickets')
      .select('*')
      .or(`customer_phone.eq.${customerPhone},customer_phone.ilike.%${l10}%`)
      .order('created_at', { ascending: false });

    if (error || !rawList) {
      return { items: [], counts: { open: 0, awaiting: 0, closed: 0 }, page, limit, total: 0 };
    }

    // Grouping & counting
    let openCount = 0;
    let awaitingCount = 0;
    let closedCount = 0;

    const formattedList = rawList.map(t => {
      const fmt = formatTicket(t, [], settings, true);
      if (fmt.group === 'closed') closedCount++;
      else if (fmt.group === 'awaiting') awaitingCount++;
      else openCount++;
      return formatTicketSummary(fmt);
    });

    let filtered = formattedList;
    if (group && ['open', 'awaiting', 'closed'].includes(group)) {
      filtered = formattedList.filter(t => t.group === group);
    }

    const total = filtered.length;
    const offset = (Number(page) - 1) * Number(limit);
    const paginated = filtered.slice(offset, offset + Number(limit));

    return {
      items: paginated,
      counts: { open: openCount, awaiting: awaitingCount, closed: closedCount },
      page: Number(page),
      limit: Number(limit),
      total
    };
  }

  async function getCustomerTicket(id, customerPhone) {
    const settings = await getSettingsMap();
    const l10 = last10Digits(customerPhone);

    const { data: raw, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !raw) {
      const err = new Error('Ticket not found');
      err.code = 'TICKET_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // Ownership check: matches full phone or last 10 digits
    const ticketPhoneDigits = last10Digits(raw.customer_phone);
    if (ticketPhoneDigits !== l10 && raw.customer_phone !== customerPhone) {
      const err = new Error('Ticket not found for this customer');
      err.code = 'TICKET_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const { data: attach } = await supabase
      .from('ticket_attachments')
      .select('*')
      .eq('ticket_id', id);

    return formatTicket(raw, attach || [], settings, true);
  }

  async function addCustomerMessage(id, customerPhone, text) {
    if (!text || !text.trim()) {
      const err = new Error('Message text is required');
      err.code = 'INVALID_BODY';
      err.status = 400;
      throw err;
    }

    const ticket = await getCustomerTicket(id, customerPhone);
    const settings = await getSettingsMap();

    const thread = Array.isArray(ticket.thread) ? [...ticket.thread] : [];
    thread.push({
      role: 'customer',
      text: text.trim(),
      at: Date.now(),
      kind: 'message'
    });

    const existingMsg = ticket.description || '';
    const legacyAppend = existingMsg
      ? `${existingMsg}\n\n---\n[Customer]: ${text.trim()}`
      : text.trim();

    const nowIso = new Date().toISOString();
    const updates = {
      thread,
      message: legacyAppend,
      status: 'open',
      last_customer_at: nowIso,
      is_read: false,
      updated_at: nowIso
    };

    const { data: updated, error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to append message: ${error?.message}`);
    }

    const { data: attach } = await supabase
      .from('ticket_attachments')
      .select('*')
      .eq('ticket_id', id);

    return formatTicket(updated, attach || [], settings, true);
  }

  async function rateCsat(id, customerPhone, rating) {
    const num = Number(rating);
    if (!Number.isInteger(num) || num < 1 || num > 5) {
      const err = new Error('CSAT rating must be an integer between 1 and 5');
      err.code = 'INVALID_BODY';
      err.status = 400;
      throw err;
    }

    const ticket = await getCustomerTicket(id, customerPhone);
    if (ticket.group !== 'closed') {
      const err = new Error('Only closed tickets can be rated');
      err.code = 'NOT_ELIGIBLE';
      err.status = 409;
      throw err;
    }

    if (ticket.csat != null) {
      const err = new Error('This ticket has already been rated');
      err.code = 'NOT_ELIGIBLE';
      err.status = 409;
      throw err;
    }

    const { data: updated, error } = await supabase
      .from('support_tickets')
      .update({ csat: num })
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to save rating: ${error?.message}`);
    }

    const settings = await getSettingsMap();
    return formatTicket(updated, ticket.attachments || [], settings, true);
  }

  async function reopenCustomerTicket(id, customerPhone) {
    const ticket = await getCustomerTicket(id, customerPhone);
    if (ticket.group !== 'closed') {
      const err = new Error('Only resolved or closed tickets can be reopened');
      err.code = 'NOT_ELIGIBLE';
      err.status = 409;
      throw err;
    }

    if (Number(ticket.reopen_count) >= 1) {
      const err = new Error('This ticket has already been reopened once');
      err.code = 'ALREADY_REOPENED';
      err.status = 409;
      throw err;
    }

    if (ticket.resolution_at) {
      const resTime = new Date(ticket.resolution_at).getTime();
      const elapsedDays = (Date.now() - resTime) / (24 * 60 * 60 * 1000);
      if (elapsedDays > 7) {
        const err = new Error('The 7-day reopening window has closed');
        err.code = 'REOPEN_WINDOW_CLOSED';
        err.status = 409;
        throw err;
      }
    }

    const thread = Array.isArray(ticket.thread) ? [...ticket.thread] : [];
    thread.push({
      role: 'customer',
      text: 'Customer reopened the ticket',
      at: Date.now(),
      kind: 'event'
    });

    const nowIso = new Date().toISOString();
    const bumpedPriority = ticket.priority === 'normal' ? 'high' : ticket.priority;

    const updates = {
      status: 'open',
      reopen_count: (Number(ticket.reopen_count) || 0) + 1,
      priority: bumpedPriority,
      resolution_type: null,
      resolution_label: null,
      resolution_at: null,
      resolution_by: null,
      thread,
      last_customer_at: nowIso,
      is_read: false,
      updated_at: nowIso
    };

    const { data: updated, error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to reopen ticket: ${error?.message}`);
    }

    const settings = await getSettingsMap();
    return formatTicket(updated, ticket.attachments || [], settings, true);
  }

  // ────────────────────────────────────────────────────────────────────────
  // ADMIN FLOWS
  // ────────────────────────────────────────────────────────────────────────

  async function getAdminStats() {
    const { data: allTickets } = await supabase
      .from('support_tickets')
      .select('id, status, last_agent_at, last_customer_at, created_at, priority, csat, resolution_at');

    const settings = await getSettingsMap();
    const list = allTickets || [];

    let open = 0;
    let awaiting = 0;
    let slaBreached = 0;
    let closedToday = 0;
    let csatSum = 0;
    let csatCount = 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    for (const t of list) {
      const grp = deriveGroup(t);
      if (grp === 'closed') {
        if (t.resolution_at && new Date(t.resolution_at) >= todayStart) {
          closedToday++;
        }
      } else if (grp === 'awaiting') {
        awaiting++;
      } else {
        open++;
      }

      if (grp !== 'closed') {
        const slaDue = new Date(computeSlaDueAt(t.created_at, t.priority, settings.sla)).getTime();
        if (Date.now() > slaDue) {
          slaBreached++;
        }
      }

      if (t.csat != null && Number(t.csat) > 0) {
        csatSum += Number(t.csat);
        csatCount++;
      }
    }

    // Pending requests from return/exchange requests table
    let pendingRequests = 0;
    try {
      const { count } = await supabase
        .from('requests')
        .select('request_id', { count: 'exact', head: true })
        .eq('status', 'pending');
      pendingRequests = count || 0;
    } catch {}

    const avgCsat = csatCount > 0 ? Number((csatSum / csatCount).toFixed(1)) : 0;

    return {
      open,
      awaiting,
      sla_breached: slaBreached,
      pending_requests: pendingRequests,
      closed_today: closedToday,
      avg_csat: avgCsat
    };
  }

  async function listAdminTickets({
    group = null,
    team = null,
    priority = null,
    reason = null,
    q = null,
    from = null,
    to = null,
    page = 1,
    limit = 20
  } = {}) {
    const settings = await getSettingsMap();

    let query = supabase.from('support_tickets').select('*');

    if (team) query = query.eq('team', team);
    if (priority) query = query.eq('priority', priority);
    if (reason) query = query.eq('reason', reason);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data: rawList, error } = await query;
    if (error || !rawList) {
      return { items: [], counts: { open: 0, awaiting: 0, closed: 0 }, page, limit, total: 0 };
    }

    // Filter by search query q if provided
    let list = rawList;
    if (q && q.trim()) {
      const term = q.trim().toLowerCase();
      list = list.filter(t => {
        return (
          (t.ticket_number && t.ticket_number.toLowerCase().includes(term)) ||
          (t.order_id && String(t.order_id).toLowerCase().includes(term)) ||
          (t.customer_name && t.customer_name.toLowerCase().includes(term)) ||
          (t.customer_phone && t.customer_phone.includes(term))
        );
      });
    }

    // Group counts
    let openCount = 0;
    let awaitingCount = 0;
    let closedCount = 0;

    const formattedList = list.map(t => {
      const fmt = formatTicket(t, [], settings);
      if (fmt.group === 'closed') closedCount++;
      else if (fmt.group === 'awaiting') awaitingCount++;
      else openCount++;
      return formatTicketSummary(fmt);
    });

    // Group filter
    let filtered = formattedList;
    if (group && ['open', 'awaiting', 'closed'].includes(group)) {
      filtered = formattedList.filter(t => t.group === group);
    }

    // Server-side sorting
    filtered.sort((a, b) => {
      if (group === 'open') {
        // High priority first, then oldest last_customer_at
        if (a.priority === 'high' && b.priority !== 'high') return -1;
        if (b.priority === 'high' && a.priority !== 'high') return 1;
        const timeA = new Date(a.last_customer_at || a.created_at).getTime();
        const timeB = new Date(b.last_customer_at || b.created_at).getTime();
        return timeA - timeB; // Oldest first
      }
      if (group === 'awaiting') {
        // Oldest last_agent_at first
        const timeA = new Date(a.last_agent_at || 0).getTime();
        const timeB = new Date(b.last_agent_at || 0).getTime();
        return timeA - timeB;
      }
      if (group === 'closed') {
        // Most recent resolution_at first
        const timeA = new Date(a.resolution_at || 0).getTime();
        const timeB = new Date(b.resolution_at || 0).getTime();
        return timeB - timeA;
      }
      // Default: newest created_at first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const total = filtered.length;
    const offset = (Number(page) - 1) * Number(limit);
    const paginated = filtered.slice(offset, offset + Number(limit));

    return {
      items: paginated,
      counts: { open: openCount, awaiting: awaitingCount, closed: closedCount },
      page: Number(page),
      limit: Number(limit),
      total
    };
  }

  async function getAdminTicketDetail(id) {
    const settings = await getSettingsMap();

    const { data: raw, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !raw) {
      const err = new Error('Ticket not found');
      err.code = 'TICKET_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const { data: attach } = await supabase
      .from('ticket_attachments')
      .select('*')
      .eq('ticket_id', id);

    const ticket = formatTicket(raw, attach || [], settings);

    // Fetch order from cache
    let order = null;
    if (raw.order_id) {
      const { data: ord } = await supabase
        .from('support_order_cache')
        .select('*')
        .eq('order_id', String(raw.order_id))
        .single();

      if (ord) {
        const json = ord.order_json || {};
        const items = (json.line_items || []).map(li => ({
          name: li.title || li.name,
          variant: li.variant_title || 'Default',
          qty: li.quantity || 1,
          price: Number(li.price) || 0
        }));

        order = {
          order_id: ord.order_id,
          order_number: json.name || ord.order_id,
          stage: ord.stage || 'unshipped',
          payment: ord.payment || 'Prepaid',
          total: Number(ord.total) || 0,
          placed_at: ord.placed_at,
          delivered_at: ord.delivered_at,
          courier: ord.courier || null,
          awb: ord.awb || null,
          address: ord.address || null,
          items
        };
      }
    }

    // Fetch customer history
    const l10 = last10Digits(raw.customer_phone);
    const { data: custOrders } = await supabase
      .from('support_order_cache')
      .select('order_id, stage')
      .or(`customer_phone.eq.${raw.customer_phone},customer_phone.ilike.%${l10}%`);

    const { data: custTickets } = await supabase
      .from('support_tickets')
      .select('id, status')
      .or(`customer_phone.eq.${raw.customer_phone},customer_phone.ilike.%${l10}%`);

    const ordersTotal = (custOrders || []).length;
    const deliveredCount = (custOrders || []).filter(o => o.stage === 'delivered').length;
    const rtoCount = (custOrders || []).filter(o => o.stage === 'rto').length;
    const openTicketsCount = (custTickets || []).filter(t => !['resolved', 'closed'].includes(t.status)).length;

    const customer = {
      name: raw.customer_name || 'Customer',
      phone: raw.customer_phone,
      email: raw.customer_email || null,
      history: {
        orders: ordersTotal,
        delivered: deliveredCount,
        rto: rtoCount,
        open_tickets: openTicketsCount
      }
    };

    const risk = await riskFor({ order, customer, ticket, settings });
    const cost = await costFor({ order, ticket, settings });
    const eligible_actions = eligibleActionsFor({ order, ticket });

    return {
      ticket,
      order,
      customer,
      risk,
      cost,
      eligible_actions,
      attachments: ticket.attachments
    };
  }

  async function patchAdminTicket(id, { priority, team, assigned_to }) {
    const updates = {};
    if (priority) updates.priority = priority;
    if (team) updates.team = team;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    updates.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to update ticket: ${error?.message}`);
    }

    const settings = await getSettingsMap();
    return formatTicket(updated, [], settings);
  }

  async function addAgentReply(id, text, operatorName = 'Agent') {
    if (!text || !text.trim()) {
      const err = new Error('Reply text is required');
      err.code = 'INVALID_BODY';
      err.status = 400;
      throw err;
    }

    const { data: raw, error: fetchErr } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !raw) {
      const err = new Error('Ticket not found');
      err.code = 'TICKET_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const thread = Array.isArray(raw.thread) ? [...raw.thread] : [];
    thread.push({
      role: 'agent',
      text: text.trim(),
      at: Date.now(),
      kind: 'message',
      by: operatorName
    });

    const nowIso = new Date().toISOString();
    const updates = {
      thread,
      last_agent_at: nowIso,
      first_response_at: raw.first_response_at || nowIso,
      updated_at: nowIso
    };

    const { data: updated, error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to send reply: ${error?.message}`);
    }

    const settings = await getSettingsMap();
    return formatTicket(updated, [], settings);
  }

  async function addAgentNote(id, text, operatorName = 'Agent') {
    if (!text || !text.trim()) {
      const err = new Error('Note text is required');
      err.code = 'INVALID_BODY';
      err.status = 400;
      throw err;
    }

    const { data: raw, error: fetchErr } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !raw) {
      const err = new Error('Ticket not found');
      err.code = 'TICKET_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const thread = Array.isArray(raw.thread) ? [...raw.thread] : [];
    const notes = Array.isArray(raw.notes) ? [...raw.notes] : [];

    const noteItem = {
      text: text.trim(),
      at: Date.now(),
      by: operatorName
    };

    thread.push({
      role: 'agent',
      text: text.trim(),
      at: Date.now(),
      kind: 'note',
      by: operatorName
    });
    notes.push(noteItem);

    const updates = {
      thread,
      notes,
      updated_at: new Date().toISOString()
    };

    const { data: updated, error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to add note: ${error?.message}`);
    }

    const settings = await getSettingsMap();
    return formatTicket(updated, [], settings);
  }

  async function askCustomer(id, text, operatorName = 'Agent') {
    if (!text || !text.trim()) {
      const err = new Error('Question text is required');
      err.code = 'INVALID_BODY';
      err.status = 400;
      throw err;
    }

    const { data: raw, error: fetchErr } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !raw) {
      const err = new Error('Ticket not found');
      err.code = 'TICKET_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const thread = Array.isArray(raw.thread) ? [...raw.thread] : [];
    thread.push({
      role: 'agent',
      text: text.trim(),
      at: Date.now(),
      kind: 'message',
      ask: true,
      by: operatorName
    });

    const nowIso = new Date().toISOString();
    const updates = {
      thread,
      last_agent_at: nowIso,
      first_response_at: raw.first_response_at || nowIso,
      updated_at: nowIso
    };

    const { data: updated, error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to send request: ${error?.message}`);
    }

    const settings = await getSettingsMap();
    return formatTicket(updated, [], settings);
  }

  async function resolveTicket(id, { resolution_type, message, also_send }, operatorName = 'Agent') {
    const settings = await getSettingsMap();
    const templates = settings.resolution_templates || {};
    const resLabel = templates[resolution_type] || resolution_type;

    const { data: raw, error: fetchErr } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !raw) {
      const err = new Error('Ticket not found');
      err.code = 'TICKET_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const thread = Array.isArray(raw.thread) ? [...raw.thread] : [];
    if (also_send && message && message.trim()) {
      thread.push({
        role: 'agent',
        text: message.trim(),
        at: Date.now(),
        kind: 'message',
        by: operatorName
      });
    }

    thread.push({
      role: 'agent',
      text: `Resolved: ${resLabel}`,
      at: Date.now(),
      kind: 'event',
      by: operatorName
    });

    const nowIso = new Date().toISOString();
    const updates = {
      status: 'resolved',
      resolution_type,
      resolution_label: resLabel,
      resolution_at: nowIso,
      resolution_by: operatorName,
      thread,
      last_agent_at: nowIso,
      updated_at: nowIso
    };

    const { data: updated, error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to resolve ticket: ${error?.message}`);
    }

    return formatTicket(updated, [], settings);
  }

  async function reopenAdminTicket(id, operatorName = 'Agent') {
    const { data: raw, error: fetchErr } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !raw) {
      const err = new Error('Ticket not found');
      err.code = 'TICKET_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const thread = Array.isArray(raw.thread) ? [...raw.thread] : [];
    thread.push({
      role: 'agent',
      text: `Ticket reopened by ${operatorName}`,
      at: Date.now(),
      kind: 'event',
      by: operatorName
    });

    const updates = {
      status: 'open',
      resolution_type: null,
      resolution_label: null,
      resolution_at: null,
      resolution_by: null,
      thread,
      updated_at: new Date().toISOString()
    };

    const { data: updated, error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to reopen ticket: ${error?.message}`);
    }

    const settings = await getSettingsMap();
    return formatTicket(updated, [], settings);
  }

  async function approveAction(id, { action_key, payload = {} }, operatorName = 'Agent') {
    const detail = await getAdminTicketDetail(id);
    const { ticket, order, eligible_actions } = detail;

    const isEligible = eligible_actions.some(a => a.key === action_key);
    if (!isEligible) {
      const err = new Error(`Action '${action_key}' is not eligible for this ticket and order stage.`);
      err.code = 'NOT_ELIGIBLE';
      err.status = 409;
      throw err;
    }

    const effect = { action: action_key, at: new Date().toISOString() };
    const orderId = order ? order.order_id : ticket.order_id;

    // ── Execute Action Side Effects ──────────────────────────────────────
    if (action_key === 'order/cancel') {
      if (shopifyAPI && orderId) {
        try {
          await shopifyAPI(`orders/${orderId}.json`, {
            method: 'PUT',
            body: JSON.stringify({
              order: { id: orderId, note: `[Support Desk]: Cancelled per customer ticket ${ticket.ticket_number}` }
            })
          });
        } catch (e) {
          console.warn('[SupportService] Shopify order cancel note failed:', e.message);
        }
      }
      if (orderId) {
        await supabase
          .from('support_order_cache')
          .update({ stage: 'cancelled' })
          .eq('order_id', orderId);
      }
      effect.status = 'order_cancelled';
    } else if (action_key === 'order/edit') {
      if (shopifyAPI && orderId) {
        try {
          await shopifyAPI(`orders/${orderId}.json`, {
            method: 'PUT',
            body: JSON.stringify({
              order: { id: orderId, note: `[Ticket ${ticket.ticket_number}]: ${payload.note || 'Order edited per support'}` }
            })
          });
        } catch (e) {
          console.warn('[SupportService] Shopify order edit note failed:', e.message);
        }
      }
      effect.status = 'order_note_added';
    } else if (action_key === 'order/prepay' || action_key === 'delivery/pay_reship') {
      if (razorpay) {
        const amt = payload.amount || order?.total || 100;
        try {
          const link = await razorpay.paymentLink.create({
            amount: Math.round(amt * 100),
            currency: 'INR',
            accept_partial: false,
            description: `Payment for ${ticket.order_number || ticket.ticket_number}`,
            customer: {
              contact: last10Digits(ticket.customer_phone),
              name: ticket.customer_name || 'Customer'
            }
          });
          effect.payment_link = link.short_url;
          effect.payment_id = link.id;
        } catch (e) {
          console.warn('[SupportService] Razorpay payment link failed:', e.message);
          effect.payment_link = 'https://rzp.io/mock-pay-link';
        }
      } else {
        effect.payment_link = 'https://rzp.io/mock-pay-link';
      }
    } else if (action_key === 'delivery/address_change') {
      if (orderId && payload.shipping_address) {
        await supabase
          .from('support_order_cache')
          .update({ address: payload.shipping_address })
          .eq('order_id', orderId);
      }
      effect.status = 'address_updated';
    } else if (action_key === 'return/return_credit' || action_key === 'return/exchange_req') {
      const type = action_key === 'return/exchange_req' ? 'exchange' : 'return';
      const requestId = 'REQ-' + Math.floor(10000 + Math.random() * 90000);
      try {
        await supabase.from('requests').insert([{
          request_id: requestId,
          order_number: order?.order_number || ticket.order_number,
          customer_phone: ticket.customer_phone,
          customer_name: ticket.customer_name,
          type: type,
          status: 'pending',
          reason: ticket.reason,
          comments: ticket.description
        }]);
        effect.request_id = requestId;
        if (orderId) {
          await supabase
            .from('support_order_cache')
            .update({ stage: type })
            .eq('order_id', orderId);
        }
      } catch (e) {
        console.warn('[SupportService] Insert into requests table failed:', e.message);
      }
    }

    // Push event to thread
    const thread = Array.isArray(ticket.thread) ? [...ticket.thread] : [];
    thread.push({
      role: 'agent',
      text: `Approved action: ${action_key}`,
      at: Date.now(),
      kind: 'event',
      by: operatorName
    });

    const { data: updated } = await supabase
      .from('support_tickets')
      .update({
        thread,
        last_agent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    const settings = await getSettingsMap();
    return {
      ticket: formatTicket(updated || ticket, ticket.attachments || [], settings),
      effect
    };
  }

  async function declineAction(id, { action_key, note }, operatorName = 'Agent') {
    if (!note || !note.trim()) {
      const err = new Error('A decline note is required');
      err.code = 'INVALID_BODY';
      err.status = 400;
      throw err;
    }

    const { data: raw, error: fetchErr } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !raw) {
      const err = new Error('Ticket not found');
      err.code = 'TICKET_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const thread = Array.isArray(raw.thread) ? [...raw.thread] : [];
    thread.push({
      role: 'agent',
      text: `Declined action: ${action_key} — ${note.trim()}`,
      at: Date.now(),
      kind: 'event',
      by: operatorName
    });

    const { data: updated, error } = await supabase
      .from('support_tickets')
      .update({
        thread,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      throw new Error(`Failed to decline action: ${error?.message}`);
    }

    const settings = await getSettingsMap();
    return formatTicket(updated, [], settings);
  }

  // ────────────────────────────────────────────────────────────────────────
  // SETTINGS MANAGEMENT
  // ────────────────────────────────────────────────────────────────────────

  async function getAdminSettings() {
    const settings = await getSettingsMap();
    const categories = REASONS.map(r => ({ code: r.code, label: r.label }));
    return {
      ...settings,
      categories
    };
  }

  async function updateAdminSetting(key, value) {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('support_settings')
      .upsert({ key, value, updated_at: nowIso })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update setting '${key}': ${error?.message}`);
    }

    return { key: data.key, value: data.value, updated_at: data.updated_at };
  }

  // ────────────────────────────────────────────────────────────────────────
  // WHITELIST MANAGEMENT
  // ────────────────────────────────────────────────────────────────────────

  async function getWhitelist(q = null) {
    let query = supabase.from('support_whitelist').select('*').order('created_at', { ascending: false });
    if (q && q.trim()) {
      query = query.or(`phone.ilike.%${q.trim()}%,note.ilike.%${q.trim()}%`);
    }
    const { data, error } = await query;
    return { items: data || [] };
  }

  async function addWhitelist({ phone, note }, operatorName = 'admin') {
    if (!phone) {
      const err = new Error('Phone is required');
      err.code = 'INVALID_BODY';
      err.status = 400;
      throw err;
    }

    const normalized = normalizePhone(phone);
    const { data, error } = await supabase
      .from('support_whitelist')
      .insert([{
        phone: normalized,
        note: note || null,
        added_by: operatorName,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      const err = new Error(error.message.includes('unique') ? 'Phone is already whitelisted' : error.message);
      err.code = 'INVALID_BODY';
      err.status = 400;
      throw err;
    }

    return data;
  }

  async function removeWhitelist(phone) {
    const normalized = normalizePhone(phone);
    const l10 = last10Digits(phone);
    const { error } = await supabase
      .from('support_whitelist')
      .delete()
      .or(`phone.eq.${phone},phone.eq.${normalized},phone.ilike.%${l10}%`);

    if (error) {
      throw new Error(`Failed to delete from whitelist: ${error.message}`);
    }

    return { removed: true };
  }

  // ────────────────────────────────────────────────────────────────────────
  // ORDER CACHE ADMIN VIEWS & STAGE OVERRIDES
  // ────────────────────────────────────────────────────────────────────────

  async function getOrderCache({ q = null, stage = null, page = 1, limit = 20 } = {}) {
    let query = supabase.from('support_order_cache').select('*', { count: 'exact' });

    if (stage) query = query.eq('stage', stage);
    if (q && q.trim()) {
      const term = q.trim();
      query = query.or(`order_id.ilike.%${term}%,customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%,awb.ilike.%${term}%`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    query = query.order('synced_at', { ascending: false }).range(offset, offset + Number(limit) - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(`Failed to load order cache: ${error.message}`);

    const items = (data || []).map(r => ({
      order_id: r.order_id,
      order_number: r.order_json?.name || r.order_id,
      customer_phone: r.customer_phone,
      customer_name: r.customer_name,
      stage: r.stage,
      payment: r.payment,
      courier: r.courier,
      awb: r.awb,
      total: Number(r.total) || 0,
      synced_at: r.synced_at
    }));

    return { items, total: count || 0 };
  }

  async function patchOrderCacheStage(orderId, stage, operatorName = 'admin') {
    const validStages = ['unshipped', 'shipped', 'delivered', 'cancelled', 'rto', 'return', 'exchange'];
    if (!validStages.includes(stage)) {
      const err = new Error(`Invalid stage '${stage}'. Allowed stages: ${validStages.join(', ')}`);
      err.code = 'INVALID_BODY';
      err.status = 400;
      throw err;
    }

    const { data: updated, error } = await supabase
      .from('support_order_cache')
      .update({ stage, synced_at: new Date().toISOString() })
      .eq('order_id', String(orderId))
      .select()
      .single();

    if (error || !updated) {
      const err = new Error('Order not found in cache');
      err.code = 'TICKET_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // Log event note on active ticket if one exists for this order
    try {
      const { data: tickets } = await supabase
        .from('support_tickets')
        .select('id, thread')
        .eq('order_id', String(orderId))
        .not('status', 'in', '("resolved","closed")');

      if (tickets && tickets.length > 0) {
        for (const t of tickets) {
          const thread = Array.isArray(t.thread) ? [...t.thread] : [];
          thread.push({
            role: 'agent',
            text: `Order stage manually changed to '${stage}' by ${operatorName}`,
            at: Date.now(),
            kind: 'event',
            by: operatorName
          });
          await supabase.from('support_tickets').update({ thread }).eq('id', t.id);
        }
      }
    } catch {}

    return {
      order_id: updated.order_id,
      stage: updated.stage,
      synced_at: updated.synced_at
    };
  }

  return {
    getSettingsMap,
    riskFor,
    costFor,
    eligibleActionsFor,
    checkWhitelist,
    getCustomerOrders,
    createTicket,
    listCustomerTickets,
    getCustomerTicket,
    addCustomerMessage,
    rateCsat,
    reopenCustomerTicket,
    getAdminStats,
    listAdminTickets,
    getAdminTicketDetail,
    patchAdminTicket,
    addAgentReply,
    addAgentNote,
    askCustomer,
    resolveTicket,
    reopenAdminTicket,
    approveAction,
    declineAction,
    getAdminSettings,
    updateAdminSetting,
    getWhitelist,
    addWhitelist,
    removeWhitelist,
    getOrderCache,
    patchOrderCacheStage
  };
}

module.exports = {
  normalizePhone,
  last10Digits,
  generateTicketNumber,
  deriveGroup,
  createSupportService
};
