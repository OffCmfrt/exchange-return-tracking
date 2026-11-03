// ============================================================================
// Website Support & Tickets System — API Routes Mounting
// Implements Frozen Contract (Sections 4.1 - 4.4)
// ============================================================================

const {
  createSupportService,
  createSupportSync,
  buildCatalog,
  last10Digits,
  normalizePhone
} = require('./index');

module.exports = function mountSupportRoutes(app, deps) {
  const {
    supabase,
    shopifyAPI,
    upload,
    authenticateAdmin,
    schedulePickup,
    razorpay,
    writeLimiter
  } = deps;

  const supportService = createSupportService({
    supabase,
    shopifyAPI,
    schedulePickup,
    razorpay
  });

  const supportSync = createSupportSync({
    supabase,
    shopifyAPI
  });

  // Standard response error handler
  function sendError(res, err, defaultStatus = 500, defaultCode = 'INTERNAL_ERROR') {
    const status = err.status || defaultStatus;
    const code = err.code || defaultCode;
    return res.status(status).json({
      success: false,
      error: err.message || 'An error occurred',
      code
    });
  }

  // ── Customer Phone Authentication Middleware ──────────────────────────────
  async function verifyCustomerPhone(req, res, next) {
    const rawPhone = req.headers['x-customer-phone'];
    if (!rawPhone || !String(rawPhone).trim()) {
      return res.status(401).json({
        success: false,
        error: 'X-Customer-Phone header is required',
        code: 'NO_PHONE'
      });
    }

    const cleaned = String(rawPhone).trim();
    const l10 = last10Digits(cleaned);
    const normalized = normalizePhone(cleaned);

    try {
      // 1. Whitelist verification
      const whitelistCheck = await supportService.checkWhitelist(cleaned);
      if (!whitelistCheck.allowed) {
        return res.status(403).json({
          success: false,
          error: 'Phone number is not authorized for support',
          code: 'NOT_WHITELISTED'
        });
      }

      req.customerPhone = normalized;
      req.customerPhoneL10 = l10;
      next();
    } catch (err) {
      return sendError(res, err);
    }
  }

  // Helper to extract operator/admin username for auditing
  function getOperatorName(req) {
    if (req.operator && req.operator.username) return req.operator.username;
    if (req.user && req.user.username) return req.user.username;
    return 'admin';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUSTOMER ROUTES (Behind verifyCustomerPhone)
  // ══════════════════════════════════════════════════════════════════════════

  // C1: Whitelist Check
  app.get('/api/support/whitelist-check', verifyCustomerPhone, async (req, res) => {
    res.json({
      success: true,
      data: { allowed: true }
    });
  });

  // C2: Reason/Issue Catalog & Stage Eligibility
  app.get('/api/support/catalog', verifyCustomerPhone, async (req, res) => {
    try {
      const orderId = req.query.order_id ? String(req.query.order_id) : null;
      let stage = null;
      let deliveredAt = null;

      if (orderId) {
        const { data: ord } = await supabase
          .from('support_order_cache')
          .select('stage, delivered_at')
          .eq('order_id', orderId)
          .single();

        if (ord) {
          stage = ord.stage;
          deliveredAt = ord.delivered_at;
        }
      }

      const settings = await supportService.getSettingsMap();
      const catalog = buildCatalog({ stage, settings, deliveredAt });

      res.json({
        success: true,
        data: catalog
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // C3: Customer Orders List (From Cache)
  app.get('/api/support/orders', verifyCustomerPhone, async (req, res) => {
    try {
      const orders = await supportService.getCustomerOrders(req.customerPhone);
      res.json({
        success: true,
        data: { orders }
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // C4: List Customer Tickets (With Grouping & Pagination)
  app.get('/api/support/tickets', verifyCustomerPhone, async (req, res) => {
    try {
      const { group, page, limit } = req.query;
      const result = await supportService.listCustomerTickets(req.customerPhone, {
        group,
        page: page || 1,
        limit: limit || 20
      });
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // C5: Get Specific Ticket Details
  app.get('/api/support/tickets/:id', verifyCustomerPhone, async (req, res) => {
    try {
      const ticket = await supportService.getCustomerTicket(req.params.id, req.customerPhone);
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // C6: Create Ticket
  const writeLimit = writeLimiter || ((req, res, next) => next());

  app.post('/api/support/tickets', verifyCustomerPhone, writeLimit, async (req, res) => {
    try {
      const ticket = await supportService.createTicket(req.customerPhone, req.body);
      res.status(201).json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // C7: Customer Appends Message to Thread
  app.post('/api/support/tickets/:id/messages', verifyCustomerPhone, writeLimit, async (req, res) => {
    try {
      const ticket = await supportService.addCustomerMessage(
        req.params.id,
        req.customerPhone,
        req.body?.text
      );
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // C8: Submit CSAT Rating (Closed Tickets Only)
  app.patch('/api/support/tickets/:id/csat', verifyCustomerPhone, writeLimit, async (req, res) => {
    try {
      const ticket = await supportService.rateCsat(
        req.params.id,
        req.customerPhone,
        req.body?.rating
      );
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // C9: Reopen Ticket (Within 7 Days of Resolution)
  app.post('/api/support/tickets/:id/reopen', verifyCustomerPhone, writeLimit, async (req, res) => {
    try {
      const ticket = await supportService.reopenCustomerTicket(
        req.params.id,
        req.customerPhone
      );
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 409, 'NOT_ELIGIBLE');
    }
  });

  // C10: Image Upload (Cloudinary)
  const singleUpload = upload ? upload.single('file') : (req, res, next) => next();

  app.post('/api/support/upload', verifyCustomerPhone, writeLimit, singleUpload, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded',
          code: 'INVALID_BODY'
        });
      }

      // If CloudinaryStorage already saved it, path has URL
      if (req.file.path) {
        return res.json({
          success: true,
          data: {
            url: req.file.path,
            public_id: req.file.filename || req.file.public_id || 'support-img'
          }
        });
      }

      // If MemoryStorage, upload buffer to Cloudinary
      if (req.file.buffer) {
        const cloudinary = require('cloudinary');
        if (process.env.CLOUDINARY_CLOUD_NAME) {
          const b64 = Buffer.from(req.file.buffer).toString('base64');
          const dataURI = `data:${req.file.mimetype};base64,${b64}`;
          const result = await cloudinary.v2.uploader.upload(dataURI, { folder: 'support' });
          return res.json({
            success: true,
            data: {
              url: result.secure_url,
              public_id: result.public_id
            }
          });
        }
      }

      // Dev mock fallback if Cloudinary credentials not configured locally
      return res.json({
        success: true,
        data: {
          url: `https://placeholder.invalid/uploads/${encodeURIComponent(req.file.originalname || 'support-file')}`,
          public_id: 'mock-public-id'
        }
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN ROUTES (Behind authenticateAdmin)
  // ══════════════════════════════════════════════════════════════════════════

  // A1: Dashboard Key Stats
  app.get('/api/support/admin/stats', authenticateAdmin, async (req, res) => {
    try {
      const stats = await supportService.getAdminStats();
      res.json({
        success: true,
        data: stats
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // A2: Ticket Inbox / Listing with Server-Side Sorting & Filters
  app.get('/api/support/admin/tickets', authenticateAdmin, async (req, res) => {
    try {
      const result = await supportService.listAdminTickets(req.query);
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // A3: Full Ticket Detail Panel (Composed with Order, Risk, Cost, Actions)
  app.get('/api/support/admin/tickets/:id', authenticateAdmin, async (req, res) => {
    try {
      const detail = await supportService.getAdminTicketDetail(req.params.id);
      res.json({
        success: true,
        data: detail
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // A4: Update Ticket Metadata (Priority, Team, Assigned To)
  app.patch('/api/support/admin/tickets/:id', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const ticket = await supportService.patchAdminTicket(req.params.id, req.body);
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A5: Send Agent Public Reply
  app.post('/api/support/admin/tickets/:id/reply', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const operator = getOperatorName(req);
      const ticket = await supportService.addAgentReply(req.params.id, req.body?.text, operator);
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A6: Add Internal Private Note (Never Visible to Customer)
  app.post('/api/support/admin/tickets/:id/note', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const operator = getOperatorName(req);
      const ticket = await supportService.addAgentNote(req.params.id, req.body?.text, operator);
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A7: Ask Customer (Sends Message & Automatically Moves to Awaiting Group)
  app.post('/api/support/admin/tickets/:id/ask', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const operator = getOperatorName(req);
      const ticket = await supportService.askCustomer(req.params.id, req.body?.text, operator);
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A8: Resolve Ticket with Template & Optional Message
  app.post('/api/support/admin/tickets/:id/resolve', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const operator = getOperatorName(req);
      const { resolution_type, message, also_send } = req.body;
      if (!resolution_type) {
        return res.status(400).json({
          success: false,
          error: 'resolution_type is required',
          code: 'INVALID_BODY'
        });
      }

      const ticket = await supportService.resolveTicket(
        req.params.id,
        { resolution_type, message, also_send },
        operator
      );
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A9: Reopen Ticket (Admin)
  app.post('/api/support/admin/tickets/:id/reopen', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const operator = getOperatorName(req);
      const ticket = await supportService.reopenAdminTicket(req.params.id, operator);
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A10: Approve Action with Automated Side Effects
  app.post('/api/support/admin/tickets/:id/approve', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const operator = getOperatorName(req);
      const { action_key, payload } = req.body;
      if (!action_key) {
        return res.status(400).json({
          success: false,
          error: 'action_key is required',
          code: 'INVALID_BODY'
        });
      }

      const result = await supportService.approveAction(
        req.params.id,
        { action_key, payload },
        operator
      );
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A11: Decline Action with Required Note
  app.post('/api/support/admin/tickets/:id/decline', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const operator = getOperatorName(req);
      const { action_key, note } = req.body;
      if (!action_key || !note) {
        return res.status(400).json({
          success: false,
          error: 'Both action_key and note are required',
          code: 'INVALID_BODY'
        });
      }

      const ticket = await supportService.declineAction(
        req.params.id,
        { action_key, note },
        operator
      );
      res.json({
        success: true,
        data: { ticket }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A12: Get Admin Settings & Categories
  app.get('/api/support/admin/settings', authenticateAdmin, async (req, res) => {
    try {
      const settings = await supportService.getAdminSettings();
      res.json({
        success: true,
        data: settings
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // A13: Update Specific Settings Document
  app.put('/api/support/admin/settings/:key', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;
      if (value === undefined) {
        return res.status(400).json({
          success: false,
          error: 'value payload is required',
          code: 'INVALID_BODY'
        });
      }

      const result = await supportService.updateAdminSetting(key, value);
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A14: List Whitelisted Phone Numbers
  app.get('/api/support/admin/whitelist', authenticateAdmin, async (req, res) => {
    try {
      const result = await supportService.getWhitelist(req.query.q);
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // A15: Add Phone to Whitelist
  app.post('/api/support/admin/whitelist', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const operator = getOperatorName(req);
      const { phone, note } = req.body;
      const item = await supportService.addWhitelist({ phone, note }, operator);
      res.status(201).json({
        success: true,
        data: { item }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A16: Remove Phone from Whitelist
  app.delete('/api/support/admin/whitelist/:phone', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const result = await supportService.removeWhitelist(req.params.phone);
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  // A17: View Cached Orders
  app.get('/api/support/admin/order-cache', authenticateAdmin, async (req, res) => {
    try {
      const result = await supportService.getOrderCache(req.query);
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // A18: Trigger Order Cache Synchronization
  app.post('/api/support/admin/order-cache/sync', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const phones = Array.isArray(req.body?.phones) ? req.body.phones : null;
      const result = await supportSync.syncOrdersToCache({ phones });
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // A19: Manual Stage Override (Dev / Desk Stage Control)
  app.patch('/api/support/admin/order-cache/:order_id', authenticateAdmin, writeLimit, async (req, res) => {
    try {
      const operator = getOperatorName(req);
      const { stage } = req.body;
      if (!stage) {
        return res.status(400).json({
          success: false,
          error: 'stage is required',
          code: 'INVALID_BODY'
        });
      }

      const item = await supportService.patchOrderCacheStage(
        req.params.order_id,
        stage,
        operator
      );
      res.json({
        success: true,
        data: { item }
      });
    } catch (err) {
      sendError(res, err, 400, 'INVALID_BODY');
    }
  });

  console.log('🎧 Customer Support & Tickets routes mounted');
};
