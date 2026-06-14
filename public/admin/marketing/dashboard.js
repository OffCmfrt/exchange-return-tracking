/**
 * Marketing Dashboard - Main Application Logic
 * Handles all section loading, CRUD operations, and modals
 */

// ── Dashboard Init ─
async function initDashboard() {
    // Chart functions are no-ops if Chart.js CDN was blocked
    if (typeof initRevenueChart === 'function') initRevenueChart('revenueChart');
    if (typeof initCampaignChart === 'function') initCampaignChart('campaignChart');
    if (typeof initSegmentChart === 'function') initSegmentChart('segmentChart');
    if (typeof initRecoveryChart === 'function') initRecoveryChart('recoveryChart');
    loadOverview();
}

// ── Overview ──
async function loadOverview() {
    try {
        const data = await apiCall('analytics/overview');
        const o = data.overview;
        
        document.getElementById('stat-totalCustomers').textContent = formatNumber(o.customers?.total);
        document.getElementById('stat-campaignsSent').textContent = formatNumber(o.revenue?.campaignsSent);
        document.getElementById('stat-activeCoupons').textContent = formatNumber(o.coupons?.totalActive);
        document.getElementById('stat-abandonedCarts').textContent = formatNumber(o.abandonedCarts?.total);
        
        if (o.dailyTrend?.length > 0) {
            updateRevenueChart('revenueChart', o.dailyTrend);
            updateCampaignChart('campaignChart', o.dailyTrend);
        }
        if (o.customers?.segments) {
            updateSegmentChart('segmentChart', o.customers.segments);
        }
        if (o.abandonedCarts) {
            updateRecoveryChart('recoveryChart', o.abandonedCarts);
        }
        
        document.getElementById('lastSyncTime').textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    } catch (error) {
        console.error('[Overview] Error:', error.message);
    }
}

// ════════════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════════════

let customerPage = 1;

async function loadCustomers(page = 1) {
    customerPage = page;
    try {
        const params = new URLSearchParams({ page });
        const search = document.getElementById('customerSearch')?.value;
        const segment = document.getElementById('customerSegment')?.value;
        const tier = document.getElementById('customerTier')?.value;
        if (search) params.append('search', search);
        if (segment) params.append('segment', segment);
        if (tier) params.append('tier', tier);
        
        const data = await apiCall(`customers?${params}`);
        
        const tbody = document.getElementById('customersBody');
        tbody.innerHTML = data.data.map(c => `
            <tr>
                <td>${escapeHtml(c.first_name || '')} ${escapeHtml(c.last_name || '')}</td>
                <td>${escapeHtml(c.email)}</td>
                <td>${escapeHtml(c.phone || '-')}</td>
                <td>${c.total_orders || 0}</td>
                <td>${formatCurrency(c.total_spent)}</td>
                <td>${statusBadge(c.segment)}</td>
                <td>${statusBadge(c.lifetime_value_tier)}</td>
                <td>${formatDate(c.last_order_date)}</td>
            </tr>
        `).join('');
        
        renderPagination('customersPagination', data.pagination, 'loadCustomers');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function syncCustomers(forceFull = false) {
    try {
        const mode = forceFull ? 'full' : 'incremental';
        showToast(`Syncing customers from Shopify (${mode} mode)...`, 'info');
        const data = await apiCall('customers/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ forceFull })
        });
        const skipped = data.totalSkipped > 0 ? `, ${data.totalSkipped} skipped (no email)` : '';
        const recovered = data.phonesRecovered > 0 ? `, ${data.phonesRecovered} phones recovered from address` : '';
        showToast(`Synced ${data.totalSynced || 0} customers (${data.mode || mode})${skipped}${recovered}`);
        loadCustomers();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ════════════════════════════════════════════════════════════════

let campaignPage = 1;

async function loadCampaigns(page = 1) {
    campaignPage = page;
    try {
        const params = new URLSearchParams({ page });
        const status = document.getElementById('campaignStatus')?.value;
        if (status) params.append('status', status);
        
        const data = await apiCall(`campaigns?${params}`);
        
        const tbody = document.getElementById('campaignsBody');
        tbody.innerHTML = data.data.map(c => `
            <tr>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td>${escapeHtml(c.type)}</td>
                <td>${statusBadge(c.status)}</td>
                <td>${formatNumber(c.recipient_count)}</td>
                <td>${c.template_id || '-'}</td>
                <td>${c.scheduled_at ? formatDateTime(c.scheduled_at) : '-'}</td>
                <td>${formatDate(c.created_at)}</td>
                <td>
                    ${c.status === 'draft' ? `<button class="btn btn-sm btn-primary" onclick="launchCampaign(${c.id})">Launch</button>` : ''}
                    ${c.status === 'sending' ? `<button class="btn btn-sm btn-warning" onclick="pauseCampaign(${c.id})">Pause</button>` : ''}
                    ${['draft','scheduled'].includes(c.status) ? `<button class="btn btn-sm btn-danger" onclick="cancelCampaign(${c.id})">Cancel</button>` : ''}
                </td>
            </tr>
        `).join('');
        
        renderPagination('campaignsPagination', data.pagination, 'loadCampaigns');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function showCreateCampaignModal() {
    openModal('Create Campaign', `
        <form onsubmit="createCampaign(event)">
            <div class="form-group"><label>Name *</label><input type="text" class="form-input" id="campName" required></div>
            <div class="form-group"><label>Description</label><textarea class="form-input" id="campDesc"></textarea></div>
            <div class="form-group"><label>Type</label><select class="form-select" id="campType"><option value="bulk">Bulk</option><option value="segment">Segment</option><option value="scheduled">Scheduled</option></select></div>
            <div class="form-group"><label>Template ID</label><input type="number" class="form-input" id="campTemplate" placeholder="Optional"></div>
            <div class="form-group"><label>Scheduled At</label><input type="datetime-local" class="form-input" id="campSchedule"></div>
            <div class="form-group"><label>Segment Filter (JSON)</label><textarea class="form-input" id="campSegment" placeholder='{"segment": "VIP"}'></textarea></div>
            <button type="submit" class="btn btn-primary btn-block">Create Campaign</button>
        </form>
    `);
}

async function createCampaign(event) {
    event.preventDefault();
    try {
        let segmentFilter = {};
        const segText = document.getElementById('campSegment').value;
        if (segText) { try { segmentFilter = JSON.parse(segText); } catch(e) { showToast('Invalid segment JSON', 'error'); return; } }
        
        await apiCall('campaigns', {
            method: 'POST',
            body: {
                name: document.getElementById('campName').value,
                description: document.getElementById('campDesc').value,
                type: document.getElementById('campType').value,
                templateId: document.getElementById('campTemplate').value || null,
                scheduledAt: document.getElementById('campSchedule').value || null,
                segmentFilter
            }
        });
        closeModal();
        showToast('Campaign created');
        loadCampaigns();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function launchCampaign(id) {
    if (!confirm('Launch this campaign? Messages will be sent to all recipients.')) return;
    try {
        await apiCall(`campaigns/${id}/launch`, { method: 'POST' });
        showToast('Campaign launched');
        loadCampaigns();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function pauseCampaign(id) {
    try {
        await apiCall(`campaigns/${id}/pause`, { method: 'POST' });
        showToast('Campaign paused');
        loadCampaigns();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function cancelCampaign(id) {
    if (!confirm('Cancel this campaign?')) return;
    try {
        await apiCall(`campaigns/${id}/cancel`, { method: 'POST' });
        showToast('Campaign cancelled');
        loadCampaigns();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════════
// TEMPLATES
// ════════════════════════════════════════════════════════════════

async function loadTemplates() {
    try {
        const params = new URLSearchParams();
        const cat = document.getElementById('templateCategory')?.value;
        if (cat) params.append('category', cat);
        
        const data = await apiCall(`templates?${params}`);
        
        const tbody = document.getElementById('templatesBody');
        tbody.innerHTML = (data.templates || data.data || []).map(t => `
            <tr>
                <td><strong>${escapeHtml(t.name)}</strong></td>
                <td>${escapeHtml(t.category)}</td>
                <td>${escapeHtml(t.language || 'en')}</td>
                <td>${statusBadge(t.status)}</td>
                <td>${statusBadge(t.meta_status)}</td>
                <td>${formatDate(t.created_at)}</td>
                <td>
                    <button class="btn btn-sm" onclick="editTemplate(${t.id})">Edit</button>
                    ${t.status === 'draft' ? `<button class="btn btn-sm btn-primary" onclick="submitTemplateToMeta(${t.id})">Submit to Meta</button>` : ''}
                    <button class="btn btn-sm btn-danger" onclick="deleteTemplate(${t.id})">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function showCreateTemplateModal() {
    openModal('Create Template', `
        <form onsubmit="createTemplate(event)">
            <div class="form-group"><label>Name *</label><input type="text" class="form-input" id="tplName" required></div>
            <div class="form-group"><label>Category</label><select class="form-select" id="tplCategory"><option value="marketing">Marketing</option><option value="utility">Utility</option><option value="authentication">Authentication</option><option value="service">Service</option></select></div>
            <div class="form-group"><label>Language</label><input type="text" class="form-input" id="tplLang" value="en"></div>
            <div class="form-group"><label>Header</label><input type="text" class="form-input" id="tplHeader"></div>
            <div class="form-group"><label>Body *</label><textarea class="form-input" id="tplBody" required placeholder="Use {{1}}, {{2}} for variables"></textarea></div>
            <div class="form-group"><label>Footer</label><input type="text" class="form-input" id="tplFooter"></div>
            <button type="submit" class="btn btn-primary btn-block">Create Template</button>
        </form>
    `);
}

async function createTemplate(event) {
    event.preventDefault();
    try {
        await apiCall('templates', {
            method: 'POST',
            body: {
                name: document.getElementById('tplName').value,
                category: document.getElementById('tplCategory').value,
                language: document.getElementById('tplLang').value,
                header: document.getElementById('tplHeader').value,
                body: document.getElementById('tplBody').value,
                footer: document.getElementById('tplFooter').value
            }
        });
        closeModal();
        showToast('Template created');
        loadTemplates();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function editTemplate(id) {
    try {
        const data = await apiCall(`templates/${id}`);
        const t = data.template || data;
        openModal('Edit Template', `
            <form onsubmit="updateTemplate(event, ${id})">
                <div class="form-group"><label>Name</label><input type="text" class="form-input" id="editTplName" value="${escapeHtml(t.name)}"></div>
                <div class="form-group"><label>Category</label><select class="form-select" id="editTplCategory"><option value="marketing" ${t.category==='marketing'?'selected':''}>Marketing</option><option value="utility" ${t.category==='utility'?'selected':''}>Utility</option><option value="authentication" ${t.category==='authentication'?'selected':''}>Authentication</option><option value="service" ${t.category==='service'?'selected':''}>Service</option></select></div>
                <div class="form-group"><label>Header</label><input type="text" class="form-input" id="editTplHeader" value="${escapeHtml(t.header || '')}"></div>
                <div class="form-group"><label>Body</label><textarea class="form-input" id="editTplBody">${escapeHtml(t.body)}</textarea></div>
                <div class="form-group"><label>Footer</label><input type="text" class="form-input" id="editTplFooter" value="${escapeHtml(t.footer || '')}"></div>
                <button type="submit" class="btn btn-primary btn-block">Update Template</button>
            </form>
        `);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function updateTemplate(event, id) {
    event.preventDefault();
    try {
        await apiCall(`templates/${id}`, {
            method: 'PUT',
            body: {
                name: document.getElementById('editTplName').value,
                category: document.getElementById('editTplCategory').value,
                header: document.getElementById('editTplHeader').value,
                body: document.getElementById('editTplBody').value,
                footer: document.getElementById('editTplFooter').value
            }
        });
        closeModal();
        showToast('Template updated');
        loadTemplates();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function submitTemplateToMeta(id) {
    try {
        showToast('Submitting to Meta...', 'info');
        await apiCall(`templates/${id}/submit-meta`, { method: 'POST' });
        showToast('Template submitted to Meta');
        loadTemplates();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    try {
        await apiCall(`templates/${id}`, { method: 'DELETE' });
        showToast('Template deleted');
        loadTemplates();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════════
// COUPONS
// ════════════════════════════════════════════════════════════════

let couponPage = 1;

async function loadCoupons(page = 1) {
    couponPage = page;
    try {
        const params = new URLSearchParams({ page });
        const search = document.getElementById('couponSearch')?.value;
        if (search) params.append('search', search);
        
        const [couponData, statsData] = await Promise.all([
            apiCall(`coupons?${params}`),
            apiCall('coupons/stats').catch(() => ({ stats: {} }))
        ]);
        
        // Stats
        const s = statsData.stats;
        document.getElementById('couponStats').innerHTML = `
            <div class="stat-card"><div class="stat-icon green"><i class="fas fa-check"></i></div><div class="stat-info"><span class="stat-value">${s.totalActive || 0}</span><span class="stat-label">Active</span></div></div>
            <div class="stat-card"><div class="stat-icon orange"><i class="fas fa-clock"></i></div><div class="stat-info"><span class="stat-value">${s.totalExpired || 0}</span><span class="stat-label">Expired</span></div></div>
            <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-receipt"></i></div><div class="stat-info"><span class="stat-value">${s.totalUses || 0}</span><span class="stat-label">Total Uses</span></div></div>
            <div class="stat-card"><div class="stat-icon purple"><i class="fas fa-rupee-sign"></i></div><div class="stat-info"><span class="stat-value">${formatCurrency(s.totalDiscountGiven)}</span><span class="stat-label">Discount Given</span></div></div>
        `;
        
        const tbody = document.getElementById('couponsBody');
        tbody.innerHTML = couponData.data.map(c => {
            const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
            return `
            <tr>
                <td><strong>${escapeHtml(c.code)}</strong>${c.name ? `<br><small class="text-muted">${escapeHtml(c.name)}</small>` : ''}</td>
                <td>${c.discount_type === 'percentage' ? c.discount_value + '%' : formatCurrency(c.discount_value)}</td>
                <td>${escapeHtml(c.discount_type)}</td>
                <td>${c.used_count || 0}${c.usage_limit ? '/' + c.usage_limit : ''}</td>
                <td>${isExpired ? statusBadge('expired') : (c.is_active ? statusBadge('active') : statusBadge('draft'))}</td>
                <td>${c.expires_at ? formatDate(c.expires_at) : 'No expiry'}</td>
                <td>${c.shopify_sync_status ? statusBadge(c.shopify_sync_status) : '<span class="badge badge-not-synced">Not synced</span>'}</td>
                <td>
                    <button class="btn btn-sm" onclick="editCoupon(${c.id})">Edit</button>
                    ${!c.shopify_price_rule_id ? `<button class="btn btn-sm btn-primary" onclick="syncCouponToShopify(${c.id})">Sync</button>` : ''}
                    <button class="btn btn-sm btn-danger" onclick="deleteCoupon(${c.id})">Delete</button>
                </td>
            </tr>`;
        }).join('');
        
        renderPagination('couponsPagination', couponData.pagination, 'loadCoupons');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function showCreateCouponModal() {
    openModal('Create Coupon', `
        <form onsubmit="createCoupon(event)">
            <div class="form-group"><label>Code *</label><input type="text" class="form-input" id="cpnCode" required placeholder="e.g. SAVE20"></div>
            <div class="form-group"><label>Name</label><input type="text" class="form-input" id="cpnName"></div>
            <div class="form-group"><label>Discount Type</label><select class="form-select" id="cpnType"><option value="percentage">Percentage</option><option value="fixed_amount">Fixed Amount</option><option value="free_shipping">Free Shipping</option></select></div>
            <div class="form-group"><label>Discount Value *</label><input type="number" class="form-input" id="cpnValue" required step="0.01"></div>
            <div class="form-group"><label>Min Purchase Amount</label><input type="number" class="form-input" id="cpnMinPurchase" value="0" step="0.01"></div>
            <div class="form-group"><label>Max Discount Amount</label><input type="number" class="form-input" id="cpnMaxDiscount" step="0.01"></div>
            <div class="form-group"><label>Usage Limit</label><input type="number" class="form-input" id="cpnUsageLimit"></div>
            <div class="form-group"><label>Expires At</label><input type="datetime-local" class="form-input" id="cpnExpires"></div>
            <button type="submit" class="btn btn-primary btn-block">Create Coupon</button>
        </form>
    `);
}

async function createCoupon(event) {
    event.preventDefault();
    try {
        await apiCall('coupons', {
            method: 'POST',
            body: {
                code: document.getElementById('cpnCode').value,
                name: document.getElementById('cpnName').value,
                discountType: document.getElementById('cpnType').value,
                discountValue: document.getElementById('cpnValue').value,
                minPurchaseAmount: document.getElementById('cpnMinPurchase').value,
                maxDiscountAmount: document.getElementById('cpnMaxDiscount').value,
                usageLimit: document.getElementById('cpnUsageLimit').value || null,
                expiresAt: document.getElementById('cpnExpires').value || null
            }
        });
        closeModal();
        showToast('Coupon created');
        loadCoupons();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function editCoupon(id) {
    try {
        const data = await apiCall(`coupons/${id}`);
        const c = data.coupon || data;
        openModal('Edit Coupon', `
            <form onsubmit="updateCoupon(event, ${id})">
                <div class="form-group"><label>Code</label><input type="text" class="form-input" value="${escapeHtml(c.code)}" disabled></div>
                <div class="form-group"><label>Name</label><input type="text" class="form-input" id="editCpnName" value="${escapeHtml(c.name || '')}"></div>
                <div class="form-group"><label>Discount Value</label><input type="number" class="form-input" id="editCpnValue" value="${c.discount_value}" step="0.01"></div>
                <div class="form-group"><label>Usage Limit</label><input type="number" class="form-input" id="editCpnUsageLimit" value="${c.usage_limit || ''}"></div>
                <div class="form-group"><label>Active</label><select class="form-select" id="editCpnActive"><option value="true" ${c.is_active?'selected':''}>Yes</option><option value="false" ${!c.is_active?'selected':''}>No</option></select></div>
                <button type="submit" class="btn btn-primary btn-block">Update Coupon</button>
            </form>
        `);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function updateCoupon(event, id) {
    event.preventDefault();
    try {
        await apiCall(`coupons/${id}`, {
            method: 'PUT',
            body: {
                name: document.getElementById('editCpnName').value,
                discountValue: document.getElementById('editCpnValue').value,
                usageLimit: document.getElementById('editCpnUsageLimit').value || null,
                isActive: document.getElementById('editCpnActive').value === 'true'
            }
        });
        closeModal();
        showToast('Coupon updated');
        loadCoupons();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function syncCouponToShopify(id) {
    try {
        showToast('Syncing to Shopify...', 'info');
        await apiCall(`coupons/${id}/sync-shopify`, { method: 'POST' });
        showToast('Coupon synced to Shopify');
        loadCoupons();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteCoupon(id) {
    if (!confirm('Delete this coupon?')) return;
    try {
        await apiCall(`coupons/${id}`, { method: 'DELETE' });
        showToast('Coupon deleted');
        loadCoupons();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════════
// ABANDONED CARTS
// ════════════════════════════════════════════════════════════════

let cartPage = 1;

async function loadAbandonedCarts(page = 1) {
    cartPage = page;
    try {
        const params = new URLSearchParams({ page });
        const status = document.getElementById('cartStatus')?.value;
        if (status) params.append('status', status);
        
        const [cartData, statsData] = await Promise.all([
            apiCall(`abandoned-carts?${params}`),
            apiCall('abandoned-carts/stats').catch(() => ({ stats: {} }))
        ]);
        
        const s = statsData.stats;
        document.getElementById('cartStats').innerHTML = `
            <div class="stat-card"><div class="stat-icon orange"><i class="fas fa-shopping-cart"></i></div><div class="stat-info"><span class="stat-value">${formatNumber(s.total)}</span><span class="stat-label">Total Carts</span></div></div>
            <div class="stat-card"><div class="stat-icon green"><i class="fas fa-check-circle"></i></div><div class="stat-info"><span class="stat-value">${formatNumber(s.recoveredCount)}</span><span class="stat-label">Recovered</span></div></div>
            <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-rupee-sign"></i></div><div class="stat-info"><span class="stat-value">${formatCurrency(s.recoveredRevenue)}</span><span class="stat-label">Revenue Recovered</span></div></div>
            <div class="stat-card"><div class="stat-icon purple"><i class="fas fa-percentage"></i></div><div class="stat-info"><span class="stat-value">${s.recoveryRate || 0}%</span><span class="stat-label">Recovery Rate</span></div></div>
        `;
        
        const tbody = document.getElementById('cartsBody');
        tbody.innerHTML = cartData.data.map(c => `
            <tr>
                <td>${escapeHtml(c.customer_name || c.customer_email || 'Anonymous')}</td>
                <td>${escapeHtml(c.customer_phone || '-')}</td>
                <td>${formatCurrency(c.cart_value)}</td>
                <td>${Array.isArray(c.items) ? c.items.length : 0} items</td>
                <td>${statusBadge(c.recovery_status)}</td>
                <td>${c.reminder_count || 0}</td>
                <td>${timeAgo(c.created_at)}</td>
                <td>
                    ${c.customer_phone && !['recovered','expired'].includes(c.recovery_status) ? `<button class="btn btn-sm btn-primary" onclick="sendCartReminder(${c.id})">Send Reminder</button>` : ''}
                    ${c.recovery_status !== 'recovered' ? `<button class="btn btn-sm btn-success" onclick="markCartRecovered(${c.id})">Mark Recovered</button>` : ''}
                </td>
            </tr>
        `).join('');
        
        renderPagination('cartsPagination', cartData.pagination, 'loadAbandonedCarts');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function sendCartReminder(id) {
    try {
        await apiCall(`abandoned-carts/${id}/send-reminder`, { method: 'POST', body: { reminderType: 'first' } });
        showToast('Reminder sent');
        loadAbandonedCarts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function markCartRecovered(id) {
    try {
        await apiCall(`abandoned-carts/${id}/mark-recovered`, { method: 'POST', body: {} });
        showToast('Cart marked as recovered');
        loadAbandonedCarts();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════════
// ANALYTICS
// ════════════════════════════════════════════════════════════════

async function loadAnalytics() {
    try {
        initDailyRevenueChart('dailyRevenueChart');
        initAnalyticsCampaignChart('analyticsCampaignChart');
        
        const params = new URLSearchParams();
        const start = document.getElementById('analyticsStart')?.value;
        const end = document.getElementById('analyticsEnd')?.value;
        if (start) params.append('start', start);
        if (end) params.append('end', end);
        
        const data = await apiCall(`analytics/overview?${params}`);
        const o = data.overview;
        
        document.getElementById('analyticsStats').innerHTML = `
            <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-rupee-sign"></i></div><div class="stat-info"><span class="stat-value">${formatCurrency(o.revenue?.totalRevenue)}</span><span class="stat-label">Total Revenue</span></div></div>
            <div class="stat-card"><div class="stat-icon green"><i class="fas fa-chart-line"></i></div><div class="stat-info"><span class="stat-value">${formatCurrency(o.revenue?.marketingRevenue)}</span><span class="stat-label">Marketing Revenue</span></div></div>
            <div class="stat-card"><div class="stat-icon purple"><i class="fas fa-paper-plane"></i></div><div class="stat-info"><span class="stat-value">${formatNumber(o.revenue?.campaignsSent)}</span><span class="stat-label">Messages Sent</span></div></div>
            <div class="stat-card"><div class="stat-icon orange"><i class="fas fa-recycle"></i></div><div class="stat-info"><span class="stat-value">${formatNumber(o.revenue?.cartsRecovered)}</span><span class="stat-label">Carts Recovered</span></div></div>
        `;
        
        if (o.dailyTrend?.length > 0) {
            updateDailyRevenueChart('dailyRevenueChart', o.dailyTrend);
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════

async function loadSettings() {
    try {
        const data = await apiCall('settings');
        const settings = data.settings || [];
        
        // Group by category
        const grouped = {};
        settings.forEach(s => {
            const cat = s.category || 'general';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(s);
        });
        
        let html = '';
        for (const [category, items] of Object.entries(grouped)) {
            html += `<div class="setting-category">${category.replace(/_/g, ' ').toUpperCase()}</div>`;
            items.forEach(s => {
                const val = typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value ?? '');
                html += `
                    <div class="setting-item">
                        <div class="setting-info">
                            <h4>${escapeHtml(s.key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))}</h4>
                            <p>${escapeHtml(s.description || '')}</p>
                        </div>
                        <div style="display:flex;gap:0.5rem;align-items:center;">
                            <input type="text" class="form-input" style="width:200px;" value="${escapeHtml(val)}" id="setting-${s.key}" ${s.is_secret ? 'placeholder=••••••••' : ''}>
                            <button class="btn btn-sm btn-primary" onclick="updateSetting('${s.key}')">Save</button>
                        </div>
                    </div>`;
            });
        }
        
        document.getElementById('settingsBody').innerHTML = html || '<p class="text-muted">No settings found.</p>';
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function updateSetting(key) {
    try {
        const input = document.getElementById(`setting-${key}`);
        let value = input.value;
        // Try to parse as JSON
        try { value = JSON.parse(value); } catch(e) { /* keep as string */ }
        
        await apiCall(`settings/${key}`, { method: 'PUT', body: { value } });
        showToast(`Setting "${key}" updated`);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════════
// AUDIT LOG
// ════════════════════════════════════════════════════════════════

let auditPage = 1;

async function loadAuditLogs(page = 1) {
    auditPage = page;
    try {
        const params = new URLSearchParams({ page });
        const entityType = document.getElementById('auditEntityType')?.value;
        const action = document.getElementById('auditAction')?.value;
        if (entityType) params.append('entityType', entityType);
        if (action) params.append('action', action);
        
        const data = await apiCall(`audit-logs?${params}`);
        
        const tbody = document.getElementById('auditBody');
        tbody.innerHTML = data.data.map(log => `
            <tr>
                <td>${formatDateTime(log.created_at)}</td>
                <td>${statusBadge(log.action)}</td>
                <td>${escapeHtml(log.entity_type)}${log.entity_name ? `: ${escapeHtml(log.entity_name)}` : ''}</td>
                <td><span class="badge badge-${log.actor_type === 'system' ? 'scheduled' : 'draft'}">${escapeHtml(log.actor)}</span></td>
                <td><small>${escapeHtml(JSON.stringify(log.details || {}).substring(0, 100))}</small></td>
            </tr>
        `).join('');
        
        renderPagination('auditPagination', data.pagination, 'loadAuditLogs');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ── Init on load ──
window.addEventListener('DOMContentLoaded', () => {
    // Set default analytics dates
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const startEl = document.getElementById('analyticsStart');
    const endEl = document.getElementById('analyticsEnd');
    if (startEl) startEl.value = start;
    if (endEl) endEl.value = end;
});
