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
// CUSTOMER INTELLIGENCE (Premium)
// ════════════════════════════════════════════════════════════════

let customerPage = 1;
let selectedCustomers = new Set();
let customerStatsCache = null;
let segmentOptionsCache = [];

// Tier colors & icons
const TIER_CONFIG = {
    platinum: { color: '#6366f1', bg: '#eef2ff', icon: 'fa-gem', label: 'Platinum' },
    gold:     { color: '#d97706', bg: '#fffbeb', icon: 'fa-crown', label: 'Gold' },
    silver:   { color: '#6b7280', bg: '#f3f4f6', icon: 'fa-medal', label: 'Silver' },
    bronze:   { color: '#92400e', bg: '#fef3c7', icon: 'fa-award', label: 'Bronze' }
};

const SEGMENT_COLORS = {
    vip: '#4f46e5', general: '#64748b', repeat: '#06b6d4',
    new_customer: '#10b981', at_risk: '#ef4444', dormant: '#8b5cf6',
    high_value: '#f59e0b', wholesale: '#ec4899'
};

// ── Load Customer Stats ──
async function loadCustomerStats() {
    try {
        const data = await apiCall('customers/stats');
        customerStatsCache = data.stats;
        const s = data.stats;

        document.getElementById('cstat-total').textContent = formatNumber(s.total);
        document.getElementById('cstat-vip').textContent = formatNumber(s.vipCount || 0);
        document.getElementById('cstat-health').textContent = s.avgHealthScore || 0;
        document.getElementById('cstat-atrisk').textContent = formatNumber(s.atRiskCount || 0);

        // Health breakdown bars
        const total = s.total || 1;
        const hb = s.healthBreakdown || {};
        setBarWidth('healthExcellent', hb.excellent, total);
        setBarWidth('healthGood', hb.good, total);
        setBarWidth('healthAverage', hb.average, total);
        setBarWidth('healthPoor', hb.poor, total);

        // Churn breakdown bars
        const cb = s.churnBreakdown || {};
        setBarWidth('churnLow', cb.low, total);
        setBarWidth('churnMedium', cb.medium, total);
        setBarWidth('churnHigh', cb.high, total);
        setBarWidth('churnCritical', cb.critical, total);
    } catch (error) {
        console.error('[Customer Stats] Error:', error.message);
    }
}

function setBarWidth(id, value, total) {
    const el = document.getElementById(id);
    if (el) el.style.width = total > 0 ? Math.round((value / total) * 100) + '%' : '0%';
}

// ── Load Segment Options ──
async function loadSegmentOptions() {
    try {
        const data = await apiCall('customers/segments');
        segmentOptionsCache = data.segments || [];
        const select = document.getElementById('customerSegment');
        const currentVal = select?.value || '';
        select.innerHTML = '<option value="">All Segments</option>';
        segmentOptionsCache.forEach(seg => {
            const opt = document.createElement('option');
            opt.value = seg.name;
            opt.textContent = `${seg.name}${seg.customer_count ? ` (${seg.customer_count})` : ''}`;
            select.appendChild(opt);
        });
        select.value = currentVal;
    } catch (error) {
        // Fallback: use known segment names
        const select = document.getElementById('customerSegment');
        const fallbacks = ['general', 'vip', 'repeat', 'new_customer', 'at_risk', 'dormant', 'high_value'];
        select.innerHTML = '<option value="">All Segments</option>';
        fallbacks.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            select.appendChild(opt);
        });
    }
}

// ── Load Customers ─
async function loadCustomers(page = 1) {
    customerPage = page;
    try {
        const params = new URLSearchParams({ page, limit: 50 });
        const search = document.getElementById('customerSearch')?.value;
        const segment = document.getElementById('customerSegment')?.value;
        const tier = document.getElementById('customerTier')?.value;
        const marketing = document.getElementById('customerMarketing')?.value;
        const sortBy = document.getElementById('customerSortBy')?.value || 'created_at';
        const churnRisk = document.getElementById('customerChurnRisk')?.value;

        if (search) params.append('search', search);
        if (segment) params.append('segment', segment);
        if (tier) params.append('tier', tier);
        if (marketing) params.append('acceptsMarketing', marketing);
        if (churnRisk) params.append('churnRisk', churnRisk);
        params.append('sortBy', sortBy);
        params.append('sortOrder', 'desc');

        const [customerData] = await Promise.all([
            apiCall(`customers?${params}`),
            loadCustomerStats().catch(() => {}),
            loadSegmentOptions().catch(() => {})
        ]);

        const tbody = document.getElementById('customersBody');
        const emptyState = document.getElementById('customersEmpty');

        if (!customerData.data || customerData.data.length === 0) {
            tbody.innerHTML = '';
            emptyState.classList.remove('hidden');
            document.getElementById('customersPagination').innerHTML = '';
            return;
        }

        emptyState.classList.add('hidden');

        const CHURN_CONFIG = {
            low:      { color: '#10b981', bg: '#ecfdf5', icon: 'fa-shield-alt', label: 'Low' },
            medium:   { color: '#f59e0b', bg: '#fffbeb', icon: 'fa-exclamation', label: 'Medium' },
            high:     { color: '#f97316', bg: '#fff7ed', icon: 'fa-exclamation-triangle', label: 'High' },
            critical: { color: '#ef4444', bg: '#fef2f2', icon: 'fa-skull-crossbones', label: 'Critical' }
        };

        tbody.innerHTML = customerData.data.map(c => {
            const initials = getInitials(c.first_name, c.last_name);
            const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email;
            const tierCfg = TIER_CONFIG[(c.lifetime_value_tier || 'bronze').toLowerCase()] || TIER_CONFIG.bronze;
            const segColor = SEGMENT_COLORS[(c.segment || 'general').toLowerCase()] || '#64748b';
            const healthScore = parseInt(c.health_score) || 0;
            const churnCfg = CHURN_CONFIG[(c.churn_risk || 'low').toLowerCase()] || CHURN_CONFIG.low;
            const isSelected = selectedCustomers.has(c.id);

            // Health bar color
            let healthColor = '#ef4444';
            if (healthScore >= 75) healthColor = '#10b981';
            else if (healthScore >= 50) healthColor = '#3b82f6';
            else if (healthScore >= 25) healthColor = '#f59e0b';

            return `
            <tr class="${isSelected ? 'row-selected' : ''}" data-id="${c.id}">
                <td class="col-checkbox"><input type="checkbox" class="customer-cb" ${isSelected ? 'checked' : ''} onchange="toggleCustomerSelect(${c.id}, this)"></td>
                <td>
                    <div class="customer-cell">
                        <div class="avatar" style="background:${tierCfg.bg};color:${tierCfg.color}">${initials}</div>
                        <div class="customer-info">
                            <span class="customer-name">${escapeHtml(fullName)}</span>
                            <span class="customer-id">#${c.shopify_customer_id || c.id}</span>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="contact-cell">
                        <div class="contact-email" title="${escapeHtml(c.email)}">${escapeHtml(c.email)}</div>
                        <div class="contact-phone">${escapeHtml(c.phone || '-')}</div>
                    </div>
                </td>
                <td><strong>${c.total_orders || 0}</strong></td>
                <td><strong>${formatCurrency(c.total_spent)}</strong></td>
                <td>
                    <div class="health-cell">
                        <div class="health-bar-bg"><div class="health-bar-fill" style="width:${healthScore}%;background:${healthColor}"></div></div>
                        <span class="health-score-text" style="color:${healthColor}">${healthScore}</span>
                    </div>
                </td>
                <td><span class="segment-badge" style="background:${segColor}20;color:${segColor}">${escapeHtml(c.segment || 'general')}</span></td>
                <td><span class="tier-badge" style="background:${tierCfg.bg};color:${tierCfg.color}"><i class="fas ${tierCfg.icon}"></i> ${tierCfg.label}</span></td>
                <td><span class="churn-badge" style="background:${churnCfg.bg};color:${churnCfg.color}"><i class="fas ${churnCfg.icon}"></i> ${churnCfg.label}</span></td>
                <td>${c.last_order_date ? timeAgo(c.last_order_date) : '<span class="text-muted">Never</span>'}</td>
                <td>
                    <div class="table-actions">
                        <button class="btn-icon" onclick="viewCustomerDetail(${c.id})" title="View Details"><i class="fas fa-eye"></i></button>
                        <button class="btn-icon" onclick="editCustomerSegment(${c.id}, '${escapeHtml(c.segment || 'general')}', '${escapeHtml(c.lifetime_value_tier || 'bronze')}')" title="Edit"><i class="fas fa-edit"></i></button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        renderPagination('customersPagination', customerData.pagination, 'loadCustomers');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ─ Customer Selection ──
function toggleCustomerSelect(id, cb) {
    if (cb.checked) selectedCustomers.add(id); else selectedCustomers.delete(id);
    updateBulkActionsUI();
    updateRowHighlight(id, cb.checked);
}

function toggleSelectAll(masterCb) {
    const checkboxes = document.querySelectorAll('.customer-cb');
    checkboxes.forEach(cb => {
        const row = cb.closest('tr');
        const id = parseInt(row.dataset.id);
        cb.checked = masterCb.checked;
        if (masterCb.checked) selectedCustomers.add(id); else selectedCustomers.delete(id);
        updateRowHighlight(id, masterCb.checked);
    });
    updateBulkActionsUI();
}

function updateRowHighlight(id, selected) {
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (row) row.classList.toggle('row-selected', selected);
}

function updateBulkActionsUI() {
    const count = selectedCustomers.size;
    document.getElementById('selectedCount').textContent = count;
    const panel = document.getElementById('bulkActionsPanel');
    const btn = document.getElementById('bulkActionsBtn');
    if (count > 0) { panel.classList.remove('hidden'); btn.style.display = 'inline-flex'; }
    else { panel.classList.add('hidden'); btn.style.display = 'none'; }
}

function toggleBulkActions() {
    document.getElementById('bulkActionsPanel').classList.toggle('hidden');
}

function bulkDeselect() {
    selectedCustomers.clear();
    document.querySelectorAll('.customer-cb').forEach(cb => cb.checked = false);
    document.getElementById('selectAllCustomers').checked = false;
    document.querySelectorAll('.row-selected').forEach(r => r.classList.remove('row-selected'));
    updateBulkActionsUI();
}

// ── Bulk Actions ──
async function bulkChangeSegment() {
    if (selectedCustomers.size === 0) return showToast('No customers selected', 'error');
    openModal('Bulk Change Segment', `
        <div class="form-group"><label>Select New Segment</label>
            <select class="form-select" id="bulkSegment">
                <option value="general">General</option><option value="vip">VIP</option>
                <option value="repeat">Repeat</option><option value="new_customer">New Customer</option>
                <option value="at_risk">At Risk</option><option value="dormant">Dormant</option>
                <option value="high_value">High Value</option>
            </select>
        </div>
        <p class="text-muted mb-2">${selectedCustomers.size} customers will be updated</p>
        <button class="btn btn-primary btn-block" onclick="executeBulkSegment()"><i class="fas fa-check"></i> Apply Segment</button>
    `);
}

async function executeBulkSegment() {
    const segment = document.getElementById('bulkSegment').value;
    try {
        showToast(`Updating ${selectedCustomers.size} customers...`, 'info');
        let success = 0;
        for (const id of selectedCustomers) {
            await apiCall(`customers/${id}`, { method: 'PUT', body: { segment } });
            success++;
        }
        showToast(`${success} customers updated to "${segment}"`);
        closeModal();
        bulkDeselect();
        loadCustomers(customerPage);
    } catch (error) { showToast(error.message, 'error'); }
}

async function bulkChangeTier() {
    if (selectedCustomers.size === 0) return showToast('No customers selected', 'error');
    openModal('Bulk Change Tier', `
        <div class="form-group"><label>Select New Tier</label>
            <select class="form-select" id="bulkTier">
                <option value="bronze">Bronze</option><option value="silver">Silver</option>
                <option value="gold">Gold</option><option value="platinum">Platinum</option>
            </select>
        </div>
        <p class="text-muted mb-2">${selectedCustomers.size} customers will be updated</p>
        <button class="btn btn-primary btn-block" onclick="executeBulkTier()"><i class="fas fa-check"></i> Apply Tier</button>
    `);
}

async function executeBulkTier() {
    const tier = document.getElementById('bulkTier').value;
    try {
        showToast(`Updating ${selectedCustomers.size} customers...`, 'info');
        let success = 0;
        for (const id of selectedCustomers) {
            await apiCall(`customers/${id}`, { method: 'PUT', body: { lifetimeValueTier: tier } });
            success++;
        }
        showToast(`${success} customers updated to "${tier}" tier`);
        closeModal();
        bulkDeselect();
        loadCustomers(customerPage);
    } catch (error) { showToast(error.message, 'error'); }
}

async function bulkSendCoupon() {
    if (selectedCustomers.size === 0) return showToast('No customers selected', 'error');
    openModal('Send Coupon to Selected Customers', `
        <div class="form-group"><label>Coupon Code *</label><input type="text" class="form-input" id="bulkCouponCode" placeholder="e.g. VIP20"></div>
        <div class="form-group"><label>Discount Type</label><select class="form-select" id="bulkCouponType"><option value="percentage">Percentage</option><option value="fixed_amount">Fixed Amount</option></select></div>
        <div class="form-group"><label>Discount Value *</label><input type="number" class="form-input" id="bulkCouponValue" step="0.01" placeholder="e.g. 20"></div>
        <p class="text-muted mb-2">Coupon will be sent to ${selectedCustomers.size} customers</p>
        <button class="btn btn-primary btn-block" onclick="executeBulkCoupon()"><i class="fas fa-paper-plane"></i> Create & Send</button>
    `);
}

async function executeBulkCoupon() {
    const code = document.getElementById('bulkCouponCode').value;
    const discountType = document.getElementById('bulkCouponType').value;
    const discountValue = document.getElementById('bulkCouponValue').value;
    if (!code || !discountValue) return showToast('Please fill all fields', 'error');
    try {
        showToast('Creating coupon...', 'info');
        await apiCall('coupons', {
            method: 'POST',
            body: { code, discountType, discountValue, usageLimit: selectedCustomers.size, isActive: true }
        });
        showToast(`Coupon "${code}" created for ${selectedCustomers.size} customers`);
        closeModal();
        bulkDeselect();
    } catch (error) { showToast(error.message, 'error'); }
}

// ── Export Customers ──
async function exportCustomers() {
    try {
        showToast('Preparing export...', 'info');
        const params = new URLSearchParams({ limit: 10000 });
        const search = document.getElementById('customerSearch')?.value;
        const segment = document.getElementById('customerSegment')?.value;
        const tier = document.getElementById('customerTier')?.value;
        if (search) params.append('search', search);
        if (segment) params.append('segment', segment);
        if (tier) params.append('tier', tier);

        const data = await apiCall(`customers?${params}`);
        const customers = data.data || [];

        let csv = 'Name,Email,Phone,Orders,Total Spent,Health Score,Churn Risk,Segment,Tier,Marketing,Last Order\n';
        customers.forEach(c => {
            const avgOrder = c.total_orders > 0 ? (c.total_spent / c.total_orders).toFixed(2) : '0';
            csv += `"${c.first_name || ''} ${c.last_name || ''}","${c.email}","${c.phone || ''}",${c.total_orders || 0},${c.total_spent || 0},${c.health_score || 0},"${c.churn_risk || 'low'}","${c.segment || 'general'}","${c.lifetime_value_tier || 'bronze'}",${c.accepts_marketing ? 'Yes' : 'No'},"${c.last_order_date || ''}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `customers_export_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${customers.length} customers`);
    } catch (error) { showToast(error.message, 'error'); }
}

// ── Customer Detail Modal ──
async function viewCustomerDetail(id) {
    try {
        showToast('Loading customer details...', 'info');
        const data = await apiCall(`customers/${id}`);
        const c = data.customer;
        const orders = data.orders || [];
        const tierCfg = TIER_CONFIG[(c.lifetime_value_tier || 'bronze').toLowerCase()] || TIER_CONFIG.bronze;
        const healthScore = parseInt(c.health_score) || 0;
        const churnRisk = (c.churn_risk || 'low').toLowerCase();

        let healthColor = '#ef4444';
        if (healthScore >= 75) healthColor = '#10b981';
        else if (healthScore >= 50) healthColor = '#3b82f6';
        else if (healthScore >= 25) healthColor = '#f59e0b';

        const CHURN_CFG = {
            low:      { color: '#10b981', bg: '#ecfdf5', icon: 'fa-shield-alt', label: 'Low Risk' },
            medium:   { color: '#f59e0b', bg: '#fffbeb', icon: 'fa-exclamation', label: 'Medium Risk' },
            high:     { color: '#f97316', bg: '#fff7ed', icon: 'fa-exclamation-triangle', label: 'High Risk' },
            critical: { color: '#ef4444', bg: '#fef2f2', icon: 'fa-skull-crossbones', label: 'Critical' }
        };
        const churnCfg = CHURN_CFG[churnRisk] || CHURN_CFG.low;

        let ordersHtml = '';
        if (orders.length > 0) {
            ordersHtml = orders.slice(0, 10).map(o => `
                <div class="order-item">
                    <div class="order-header">
                        <span class="order-name">${escapeHtml(o.order_name || o.shopify_order_id)}</span>
                        <span class="order-status">${statusBadge(o.financial_status)}</span>
                    </div>
                    <div class="order-meta">
                        <span>${formatCurrency(o.total_price)}</span>
                        <span>${formatDate(o.order_created_at)}</span>
                        <span>${Array.isArray(o.line_items) ? o.line_items.length : 0} items</span>
                    </div>
                </div>
            `).join('');
        } else {
            ordersHtml = '<p class="text-muted">No orders found</p>';
        }

        openModal('Customer Profile', `
            <div class="customer-profile">
                <div class="profile-header">
                    <div class="profile-avatar" style="background:${tierCfg.bg};color:${tierCfg.color}">
                        ${getInitials(c.first_name, c.last_name)}
                    </div>
                    <div class="profile-info">
                        <h3>${escapeHtml(c.first_name || '')} ${escapeHtml(c.last_name || '')}</h3>
                        <p class="text-muted">${escapeHtml(c.email)}</p>
                        <div class="profile-badges">
                            <span class="tier-badge" style="background:${tierCfg.bg};color:${tierCfg.color}"><i class="fas ${tierCfg.icon}"></i> ${tierCfg.label}</span>
                            <span class="segment-badge" style="background:${SEGMENT_COLORS[(c.segment||'general').toLowerCase()] || '#64748b'}20;color:${SEGMENT_COLORS[(c.segment||'general').toLowerCase()] || '#64748b'}">${escapeHtml(c.segment || 'general')}</span>
                        </div>
                    </div>
                </div>

                <div class="profile-stats">
                    <div class="profile-stat"><span class="profile-stat-value">${c.total_orders || 0}</span><span class="profile-stat-label">Orders</span></div>
                    <div class="profile-stat"><span class="profile-stat-value">${formatCurrency(c.total_spent)}</span><span class="profile-stat-label">Total Spent</span></div>
                    <div class="profile-stat"><span class="profile-stat-value" style="color:${healthColor}">${healthScore}<small style="font-size:0.6rem;font-weight:400">/100</small></span><span class="profile-stat-label">Health Score</span></div>
                    <div class="profile-stat"><span class="profile-stat-value"><span class="churn-badge" style="background:${churnCfg.bg};color:${churnCfg.color};font-size:0.65rem"><i class="fas ${churnCfg.icon}"></i> ${churnCfg.label}</span></span><span class="profile-stat-label">Churn Risk</span></div>
                </div>

                <div class="profile-details">
                    <div class="detail-row"><span class="detail-label">Customer ID</span><span>#${c.shopify_customer_id || c.id}</span></div>
                    <div class="detail-row"><span class="detail-label">Health Score</span><span style="color:${healthColor};font-weight:700">${healthScore}/100</span></div>
                    <div class="detail-row"><span class="detail-label">Churn Risk</span><span class="churn-badge" style="background:${churnCfg.bg};color:${churnCfg.color}"><i class="fas ${churnCfg.icon}"></i> ${churnCfg.label}</span></div>
                    <div class="detail-row"><span class="detail-label">First Order</span><span>${formatDate(c.first_order_date)}</span></div>
                    <div class="detail-row"><span class="detail-label">Last Order</span><span>${formatDate(c.last_order_date)}</span></div>
                    <div class="detail-row"><span class="detail-label">Phone</span><span>${c.phone || 'N/A'}</span></div>
                    <div class="detail-row"><span class="detail-label">Marketing</span><span>${c.accepts_marketing ? '<span class="marketing-badge subscribed"><i class="fas fa-check-circle"></i> Subscribed</span>' : '<span class="marketing-badge unsubscribed"><i class="fas fa-times-circle"></i> Unsubscribed</span>'}</span></div>
                    <div class="detail-row"><span class="detail-label">Location</span><span>${escapeHtml(c.location || 'N/A')}</span></div>
                    ${c.tags && c.tags.length > 0 ? `<div class="detail-row"><span class="detail-label">Tags</span><span class="tags-list">${c.tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</span></div>` : ''}
                </div>

                <div class="profile-section">
                    <h4><i class="fas fa-shopping-bag"></i> Recent Orders (${orders.length})</h4>
                    <div class="orders-list">${ordersHtml}</div>
                </div>

                <div class="profile-actions">
                    <button class="btn btn-primary" onclick="editCustomerSegment(${c.id}, '${escapeHtml(c.segment || 'general')}', '${escapeHtml(c.lifetime_value_tier || 'bronze')}')"><i class="fas fa-edit"></i> Edit Customer</button>
                </div>
            </div>
        `);
    } catch (error) { showToast(error.message, 'error'); }
}

// ── Edit Customer Segment/Tier ──
function editCustomerSegment(id, currentSegment, currentTier) {
    openModal('Edit Customer', `
        <form onsubmit="updateCustomer(event, ${id})">
            <div class="form-group"><label>Segment</label>
                <select class="form-select" id="editCustSegment">
                    <option value="general" ${currentSegment==='general'?'selected':''}>General</option>
                    <option value="vip" ${currentSegment==='vip'?'selected':''}>VIP</option>
                    <option value="repeat" ${currentSegment==='repeat'?'selected':''}>Repeat</option>
                    <option value="new_customer" ${currentSegment==='new_customer'?'selected':''}>New Customer</option>
                    <option value="at_risk" ${currentSegment==='at_risk'?'selected':''}>At Risk</option>
                    <option value="dormant" ${currentSegment==='dormant'?'selected':''}>Dormant</option>
                    <option value="high_value" ${currentSegment==='high_value'?'selected':''}>High Value</option>
                </select>
            </div>
            <div class="form-group"><label>Lifetime Value Tier</label>
                <select class="form-select" id="editCustTier">
                    <option value="bronze" ${currentTier==='bronze'?'selected':''}>Bronze</option>
                    <option value="silver" ${currentTier==='silver'?'selected':''}>Silver</option>
                    <option value="gold" ${currentTier==='gold'?'selected':''}>Gold</option>
                    <option value="platinum" ${currentTier==='platinum'?'selected':''}>Platinum</option>
                </select>
            </div>
            <button type="submit" class="btn btn-primary btn-block">Save Changes</button>
        </form>
    `);
}

async function updateCustomer(event, id) {
    event.preventDefault();
    try {
        await apiCall(`customers/${id}`, {
            method: 'PUT',
            body: {
                segment: document.getElementById('editCustSegment').value,
                lifetimeValueTier: document.getElementById('editCustTier').value
            }
        });
        closeModal();
        showToast('Customer updated');
        loadCustomers(customerPage);
    } catch (error) { showToast(error.message, 'error'); }
}

// ── Sync Customers ─
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

// ── Smart Recompute Segments ──
async function recomputeSegments() {
    if (!confirm('This will re-analyze ALL customers using RFM scoring. Segments, tiers, health scores and churn risk will be recomputed. Continue?')) return;
    try {
        showToast('Recomputing smart segments...', 'info');
        const data = await apiCall('customers/recompute-segments', { method: 'POST' });
        showToast(data.message || `Recomputed ${data.total} customers`);
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
        const statusFilter = document.getElementById('templateStatus')?.value;
        const showActive = document.getElementById('templateActiveOnly')?.checked;
        
        if (cat) params.append('category', cat);
        if (statusFilter) params.append('status', statusFilter);
        if (showActive !== undefined) params.append('isActive', showActive);
        
        const data = await apiCall(`templates?${params}`);
        
        const tbody = document.getElementById('templatesBody');
        tbody.innerHTML = (data.templates || []).map(t => `
            <tr>
                <td>
                    <div class="template-name-cell">
                        <strong>${escapeHtml(t.name)}</strong>
                        <span class="text-muted" style="font-size: 0.85em">
                            ${escapeHtml(t.body?.substring(0, 60) || '')}...
                        </span>
                    </div>
                </td>
                <td>
                    <span class="badge badge-${t.category}">${escapeHtml(t.category)}</span>
                </td>
                <td>${escapeHtml(t.language || 'en')}</td>
                <td>${statusBadge(t.status)}</td>
                <td>${statusBadge(t.meta_status, 'meta')}</td>
                <td>
                    <div class="usage-stats">
                        <span title="Campaigns"><i class="fas fa-paper-plane"></i> ${t.campaign_usage || 0}</span>
                        <span title="Abandoned Carts"><i class="fas fa-shopping-cart"></i> ${t.cart_usage || 0}</span>
                        <span title="Total Uses"><i class="fas fa-chart-line"></i> ${t.usage_count || 0}</span>
                    </div>
                </td>
                <td>${formatDate(t.created_at)}</td>
                <td>
                    <button class="btn btn-sm" onclick="previewTemplate(${t.id})" title="Preview">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm" onclick="editTemplate(${t.id})" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm" onclick="copyTemplate(${t.id})" title="Copy">
                        <i class="fas fa-copy"></i>
                    </button>
                    ${t.status === 'draft' ? `<button class="btn btn-sm btn-primary" onclick="submitTemplateToMeta(${t.id})" title="Submit to Meta">
                        <i class="fas fa-cloud-upload-alt"></i>
                    </button>` : ''}
                    ${t.status === 'approved' ? `<button class="btn btn-sm btn-success" onclick="linkToAbandonedCart(${t.id})" title="Link to Abandoned Cart">
                        <i class="fas fa-link"></i>
                    </button>` : ''}
                    <button class="btn btn-sm btn-danger" onclick="deleteTemplate(${t.id})" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
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
            <div class="form-group">
                <label>Template Name *</label>
                <input type="text" class="form-input" id="tplName" required 
                       placeholder="e.g., abandoned_cart_reminder_v1">
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>Category *</label>
                    <select class="form-select" id="tplCategory" required>
                        <option value="marketing">Marketing</option>
                        <option value="utility">Utility</option>
                        <option value="authentication">Authentication</option>
                        <option value="service">Service</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Language</label>
                    <input type="text" class="form-input" id="tplLang" value="en" maxlength="5">
                </div>
            </div>
            
            <div class="form-group">
                <label>Header (Optional)</label>
                <input type="text" class="form-input" id="tplHeader" 
                       placeholder="e.g., Don't miss out!">
            </div>
            
            <div class="form-group">
                <label>Message Body *</label>
                <textarea class="form-input" id="tplBody" required rows="6"
                          placeholder="Hi {{1}}, you left {{2}} in your cart worth ₹{{3}}. Complete your order now! {{4}}"></textarea>
                <small class="text-muted">Use {{1}}, {{2}}, {{3}} etc. for dynamic variables</small>
            </div>
            
            <div class="form-group">
                <label>Footer (Optional)</label>
                <input type="text" class="form-input" id="tplFooter" 
                       placeholder="e.g., Reply STOP to unsubscribe">
            </div>
            
            <!-- Smart Variables Section -->
            <div class="card mt-3">
                <div class="card-header">
                    <h4><i class="fas fa-code"></i> Template Variables</h4>
                </div>
                <div class="card-body">
                    <div id="tplVariablesList" class="variables-list">
                        <p class="text-muted">Variables will be auto-detected from message body</p>
                    </div>
                </div>
            </div>
            
            <!-- Live Preview Section -->
            <div class="card mt-3">
                <div class="card-header">
                    <h4><i class="fas fa-mobile-alt"></i> WhatsApp Preview</h4>
                </div>
                <div class="card-body">
                    <div id="tplPreview" class="whatsapp-preview">
                        <div class="preview-bubble">
                            <p id="previewHeader" class="preview-header hidden"></p>
                            <p id="previewBody"></p>
                            <p id="previewFooter" class="preview-footer hidden"></p>
                        </div>
                    </div>
                </div>
            </div>
            
            <button type="submit" class="btn btn-primary btn-block mt-3">
                <i class="fas fa-plus"></i> Create Template
            </button>
        </form>
    `);
    
    // Add auto-detection listeners
    document.getElementById('tplBody')?.addEventListener('input', autoDetectVariables);
    document.getElementById('tplHeader')?.addEventListener('input', updateLivePreview);
    document.getElementById('tplFooter')?.addEventListener('input', updateLivePreview);
}

async function createTemplate(event) {
    event.preventDefault();
    try {
        // Extract variables from body
        const bodyText = document.getElementById('tplBody').value;
        const variables = extractVariablesFromBody(bodyText);
        
        await apiCall('templates', {
            method: 'POST',
            body: {
                name: document.getElementById('tplName').value,
                category: document.getElementById('tplCategory').value,
                language: document.getElementById('tplLang').value,
                header: document.getElementById('tplHeader').value,
                body: bodyText,
                footer: document.getElementById('tplFooter').value,
                variables: variables
            }
        });
        closeModal();
        showToast('Template created');
        loadTemplates();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

/**
 * Sync templates from Meta WhatsApp API
 */
async function syncTemplatesFromMeta() {
    if (!confirm('Sync templates from Meta WhatsApp? This will fetch all templates from Meta and save/update them in the local database.')) {
        return;
    }
    
    try {
        showToast('Syncing templates from Meta...', 'info');
        
        const data = await apiCall('templates/sync-from-meta', {
            method: 'POST'
        });
        
        if (data.success) {
            showToast(`Synced ${data.created + data.updated} templates (${data.created} new, ${data.updated} updated)`, 'success');
            loadTemplates();
        } else {
            showToast(data.error || 'Sync failed', 'error');
        }
    } catch (error) {
        showToast(error.message || 'Failed to sync templates', 'error');
    }
}

async function editTemplate(id) {
    try {
        const data = await apiCall(`templates/${id}`);
        const t = data.template || data;
        openModal('Edit Template', `
            <form onsubmit="updateTemplate(event, ${id})">
                <div class="form-group">
                    <label>Template Name</label>
                    <input type="text" class="form-input" id="editTplName" value="${escapeHtml(t.name)}">
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label>Category</label>
                        <select class="form-select" id="editTplCategory">
                            <option value="marketing" ${t.category==='marketing'?'selected':''}>Marketing</option>
                            <option value="utility" ${t.category==='utility'?'selected':''}>Utility</option>
                            <option value="authentication" ${t.category==='authentication'?'selected':''}>Authentication</option>
                            <option value="service" ${t.category==='service'?'selected':''}>Service</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Language</label>
                        <input type="text" class="form-input" id="editTplLang" value="${escapeHtml(t.language || 'en')}" maxlength="5">
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Header</label>
                    <input type="text" class="form-input" id="editTplHeader" value="${escapeHtml(t.header || '')}">
                </div>
                
                <div class="form-group">
                    <label>Body</label>
                    <textarea class="form-input" id="editTplBody" rows="6">${escapeHtml(t.body)}</textarea>
                    <small class="text-muted">Use {{1}}, {{2}}, {{3}} etc. for dynamic variables</small>
                </div>
                
                <div class="form-group">
                    <label>Footer</label>
                    <input type="text" class="form-input" id="editTplFooter" value="${escapeHtml(t.footer || '')}">
                </div>
                
                <!-- Variables Section -->
                <div class="card mt-3">
                    <div class="card-header">
                        <h4><i class="fas fa-code"></i> Template Variables</h4>
                    </div>
                    <div class="card-body">
                        <div id="editTplVariablesList" class="variables-list">
                            ${(t.variables || []).length > 0 ? renderVariablesList(t.variables) : '<p class="text-muted">No variables defined</p>'}
                        </div>
                    </div>
                </div>
                
                <!-- Live Preview -->
                <div class="card mt-3">
                    <div class="card-header">
                        <h4><i class="fas fa-mobile-alt"></i> WhatsApp Preview</h4>
                    </div>
                    <div class="card-body">
                        <div class="whatsapp-preview">
                            <div class="preview-bubble">
                                ${t.header ? `<p class="preview-header"><strong>${escapeHtml(t.header)}</strong></p>` : ''}
                                <p class="preview-body">${escapeHtml(previewTemplateBody(t.body, t.variables || []))}</p>
                                ${t.footer ? `<p class="preview-footer text-muted">${escapeHtml(t.footer)}</p>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
                
                <button type="submit" class="btn btn-primary btn-block mt-3">Update Template</button>
            </form>
        `);
        
        // Add listeners for edit modal
        document.getElementById('editTplBody')?.addEventListener('input', () => autoDetectVariables('editTplBody', 'editTplVariablesList'));
        document.getElementById('editTplHeader')?.addEventListener('input', () => updateLivePreview('editTplHeader', 'editTplBody', 'editTplFooter'));
        document.getElementById('editTplFooter')?.addEventListener('input', () => updateLivePreview('editTplHeader', 'editTplBody', 'editTplFooter'));
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function updateTemplate(event, id) {
    event.preventDefault();
    try {
        const bodyText = document.getElementById('editTplBody').value;
        const variables = extractVariablesFromBody(bodyText);
        
        await apiCall(`templates/${id}`, {
            method: 'PUT',
            body: {
                name: document.getElementById('editTplName').value,
                category: document.getElementById('editTplCategory').value,
                language: document.getElementById('editTplLang')?.value || 'en',
                header: document.getElementById('editTplHeader').value,
                body: bodyText,
                footer: document.getElementById('editTplFooter').value,
                variables: variables
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
// TEMPLATE HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Extract variables from template body text
 * Looks for patterns like {{1}}, {{2}}, etc.
 */
function extractVariablesFromBody(bodyText) {
    const variableRegex = /\{\{(\d+)\}\}/g;
    const variables = [];
    let match;
    
    while ((match = variableRegex.exec(bodyText)) !== null) {
        const varNum = match[1];
        if (!variables.find(v => v.name === varNum)) {
            variables.push({
                name: varNum,
                type: 'text',
                example: getVariableExample(varNum)
            });
        }
    }
    
    return variables;
}

/**
 * Get example value for a variable based on common patterns
 */
function getVariableExample(varNum) {
    const examples = {
        '1': 'John',
        '2': '3 items',
        '3': '₹1,499',
        '4': 'https://offcomfrt.com/checkout',
        '5': '24 hours',
        '6': '10%'
    };
    return examples[varNum] || `Sample ${varNum}`;
}

/**
 * Auto-detect variables and update the variables list UI
 */
function autoDetectVariables(bodyId = 'tplBody', containerId = 'tplVariablesList') {
    const bodyText = document.getElementById(bodyId)?.value || '';
    const variables = extractVariablesFromBody(bodyText);
    const container = document.getElementById(containerId);
    
    if (container) {
        container.innerHTML = variables.length > 0 
            ? renderVariablesList(variables)
            : '<p class="text-muted">Variables will be auto-detected from message body</p>';
    }
    
    // Update live preview
    updateLivePreview();
}

/**
 * Render variables list as editable items
 */
function renderVariablesList(variables) {
    return variables.map(v => `
        <div class="variable-item">
            <code>{{${v.name}}}</code>
            <input type="text" class="form-input" placeholder="Type" value="${escapeHtml(v.type || 'text')}" 
                   onchange="updateVariableType('${v.name}', this.value)">
            <input type="text" class="form-input" placeholder="Example value" value="${escapeHtml(v.example || '')}" 
                   onchange="updateVariableExample('${v.name}', this.value)">
            <span class="text-muted" style="font-size: 0.85em">Variable ${v.name}</span>
        </div>
    `).join('');
}

/**
 * Update live WhatsApp preview
 */
function updateLivePreview(headerId = 'tplHeader', bodyId = 'tplBody', footerId = 'tplFooter') {
    const header = document.getElementById(headerId)?.value || '';
    const body = document.getElementById(bodyId)?.value || '';
    const footer = document.getElementById(footerId)?.value || '';
    
    const previewHeader = document.getElementById('previewHeader');
    const previewBody = document.getElementById('previewBody');
    const previewFooter = document.getElementById('previewFooter');
    
    if (previewHeader) {
        if (header) {
            previewHeader.textContent = header;
            previewHeader.classList.remove('hidden');
        } else {
            previewHeader.classList.add('hidden');
        }
    }
    
    if (previewBody) {
        // Replace variables with example values
        const variables = extractVariablesFromBody(body);
        let previewText = body;
        variables.forEach(v => {
            const regex = new RegExp(`\\{\\{${v.name}\\}\\}`, 'g');
            previewText = previewText.replace(regex, `[${v.example || v.name}]`);
        });
        previewBody.textContent = previewText;
    }
    
    if (previewFooter) {
        if (footer) {
            previewFooter.textContent = footer;
            previewFooter.classList.remove('hidden');
        } else {
            previewFooter.classList.add('hidden');
        }
    }
}

/**
 * Preview template body with sample values
 */
function previewTemplateBody(body, variables) {
    if (!body) return '';
    let preview = body;
    variables.forEach(v => {
        const regex = new RegExp(`\\{\\{${v.name}\\}\\}`, 'g');
        preview = preview.replace(regex, v.example || `[${v.name}]`);
    });
    return preview;
}

/**
 * Copy template - creates a duplicate with "_copy" suffix
 */
async function copyTemplate(id) {
    try {
        const data = await apiCall(`templates/${id}`);
        const t = data.template || data;
        
        await apiCall('templates', {
            method: 'POST',
            body: {
                name: `${t.name}_copy`,
                category: t.category,
                language: t.language,
                header: t.header,
                body: t.body,
                footer: t.footer,
                variables: t.variables,
                status: 'draft'
            }
        });
        
        showToast('Template copied');
        loadTemplates();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

/**
 * Preview template in a modal
 */
async function previewTemplate(id) {
    try {
        const data = await apiCall(`templates/${id}`);
        const t = data.template || data;
        
        // Parse variables and generate sample preview
        const variables = t.variables || [];
        let previewBody = t.body || '';
        variables.forEach(v => {
            const regex = new RegExp(`\\{\\{${v.name}\\}\\}`, 'g');
            previewBody = previewBody.replace(regex, v.example || `[${v.name}]`);
        });
        
        openModal(`Template Preview: ${t.name}`, `
            <div class="template-preview-container">
                <div class="template-info-row">
                    <span><strong>Category:</strong> ${escapeHtml(t.category)}</span>
                    <span><strong>Language:</strong> ${escapeHtml(t.language || 'en')}</span>
                    <span><strong>Status:</strong> ${statusBadge(t.status)}</span>
                    <span><strong>Meta Status:</strong> ${statusBadge(t.meta_status, 'meta')}</span>
                </div>
                
                <div class="whatsapp-preview mt-3">
                    <div class="preview-bubble">
                        ${t.header ? `<p class="preview-header"><strong>${escapeHtml(t.header)}</strong></p>` : ''}
                        <p class="preview-body">${escapeHtml(previewBody)}</p>
                        ${t.footer ? `<p class="preview-footer text-muted">${escapeHtml(t.footer)}</p>` : ''}
                    </div>
                </div>
                
                <div class="template-variables-section mt-3">
                    <h5>Variables</h5>
                    <table class="data-table">
                        <thead>
                            <tr><th>Variable</th><th>Type</th><th>Example</th></tr>
                        </thead>
                        <tbody>
                            ${(t.variables || []).map(v => `
                                <tr>
                                    <td><code>{{${v.name}}}</code></td>
                                    <td>${escapeHtml(v.type || 'text')}</td>
                                    <td>${escapeHtml(v.example || '-')}</td>
                                </tr>
                            `).join('') || '<tr><td colspan="3" class="text-muted">No variables defined</td></tr>'}
                        </tbody>
                    </table>
                </div>
                
                <div class="template-usage-section mt-3">
                    <h5>Usage Statistics</h5>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <span class="stat-value">${t.usage_count || 0}</span>
                            <span class="stat-label">Total Uses</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-value">${t.campaign_usage || 0}</span>
                            <span class="stat-label">Campaigns</span>
                        </div>
                        <div class="stat-card">
                            <span class="stat-value">${t.cart_usage || 0}</span>
                            <span class="stat-label">Abandoned Carts</span>
                        </div>
                    </div>
                </div>
            </div>
        `);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

/**
 * Link template to abandoned cart recovery
 */
async function linkToAbandonedCart(templateId) {
    try {
        const data = await apiCall(`templates/${templateId}`);
        const t = data.template || data;
        
        if (t.status !== 'approved') {
            showToast('Template must be Meta-approved before linking to abandoned carts', 'error');
            return;
        }
        
        openModal(`Link Template to Abandoned Cart Recovery`, `
            <form onsubmit="saveAbandonedCartTemplateLink(event, ${templateId})">
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i>
                    Link this template to automated abandoned cart recovery messages.
                </div>
                
                <div class="form-group">
                    <label>Reminder Type</label>
                    <select class="form-select" id="linkReminderType" required>
                        <option value="first">First Reminder (1 hour after abandonment)</option>
                        <option value="second">Second Reminder (24 hours after)</option>
                        <option value="final">Final Reminder (72 hours after)</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Delay (hours)</label>
                    <input type="number" class="form-input" id="linkDelayHours" value="1" min="1" max="168">
                </div>
                
                <div class="form-group">
                    <label>Auto-Apply Coupon?</label>
                    <select class="form-select" id="linkAutoCoupon">
                        <option value="false">No coupon</option>
                        <option value="true">Auto-generate 10% discount coupon</option>
                    </select>
                </div>
                
                <div class="card mt-3">
                    <div class="card-header">
                        <h5>Template Preview with Sample Data</h5>
                    </div>
                    <div class="card-body">
                        <div class="whatsapp-preview">
                            <div class="preview-bubble">
                                ${t.header ? `<p class="preview-header"><strong>${escapeHtml(t.header)}</strong></p>` : ''}
                                <p class="preview-body">${escapeHtml(t.body
                                    .replace(/\{\{1\}\}/g, 'John')
                                    .replace(/\{\{2\}\}/g, '3 items')
                                    .replace(/\{\{3\}\}/g, '₹1,499')
                                    .replace(/\{\{4\}\}/g, 'https://offcomfrt.com/checkout')
                                )}</p>
                                ${t.footer ? `<p class="preview-footer text-muted">${escapeHtml(t.footer)}</p>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
                
                <button type="submit" class="btn btn-primary btn-block mt-3">
                    <i class="fas fa-link"></i> Link Template
                </button>
            </form>
        `);
    } catch (error) {
        showToast(error.message, 'error');
    }
}

/**
 * Save abandoned cart template link
 */
async function saveAbandonedCartTemplateLink(event, templateId) {
    event.preventDefault();
    try {
        const reminderType = document.getElementById('linkReminderType').value;
        const delayHours = parseInt(document.getElementById('linkDelayHours').value);
        const autoCoupon = document.getElementById('linkAutoCoupon').value === 'true';
        
        // Update marketing_settings with the template link
        await apiCall('settings', {
            method: 'PUT',
            body: {
                key: `abandoned_cart_${reminderType}_template_id`,
                value: templateId.toString()
            }
        });
        
        await apiCall('settings', {
            method: 'PUT',
            body: {
                key: `abandoned_cart_${reminderType}_delay_hours`,
                value: delayHours.toString()
            }
        });
        
        if (autoCoupon) {
            await apiCall('settings', {
                method: 'PUT',
                body: {
                    key: `abandoned_cart_${reminderType}_auto_coupon`,
                    value: 'true'
                }
            });
        }
        
        closeModal();
        showToast(`${reminderType.charAt(0).toUpperCase() + reminderType.slice(1)} reminder linked to template`);
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
