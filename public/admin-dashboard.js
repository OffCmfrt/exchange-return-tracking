// Admin Dashboard Functions
// Extracted from page.influencer-admin.liquid to stay under Shopify's 256KB asset limit
const API = 'https://exchange-return-tracking.onrender.com/api/influencer-admin';
let authToken = null; // JWT stored in memory only (not localStorage)
let influencersData = [];
let selectedInfluencers = new Set();
let searchFilters = {
 name: '',
 code: '',
 phone: '',
 email: '',
 minOrders: null,
 maxOrders: null,
 dateFrom: null,
 dateTo: null
};
// ─── BOOT ───────────────────────────────────────────────────────────────────
// Note: With JWT, we don't persist tokens in localStorage for security
// User must login again after page refresh (token expires in 24h anyway)
window.addEventListener('DOMContentLoaded', () => {
 // Token is stored in memory only (authToken variable)
 if (authToken) {
 loadDashboard();
 } else {
 hide('iaLoading');
 show('iaAuth');
 }
 // Press Enter to login
 document.getElementById('iaPassword').addEventListener('keydown', e => {
 if (e.key === 'Enter') handleLogin();
 });
});
// ─── AUTH ────────────────────────────────────────────────────────────────────
async function handleLogin() {
 const btn = document.getElementById('iaLoginBtn');
 const errEl = document.getElementById('iaLoginErr');
 const password = document.getElementById('iaPassword').value.trim();
 if (!password) return;
 btn.disabled = true;
 btn.textContent = 'Verifying…';
 errEl.classList.remove('show');
 try {
 const res = await fetch('https://exchange-return-tracking.onrender.com/api/admin/login', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ password })
 });
 const data = await res.json();
 if (data.success) {
 authToken = data.token;
 // JWT token stored in memory only (not localStorage) for security
 // Token expires in 24 hours as configured on the server
 hide('iaAuth');
 show('iaLoading');
 await loadDashboard();
 // Initialize sidebar after dashboard loads
 initSidebar();
 } else {
 errEl.classList.add('show');
 }
 } catch (err) {
 errEl.textContent = 'Connection error. Try again.';
 errEl.classList.add('show');
 }
 btn.disabled = false;
 btn.textContent = 'Authenticate';
}
function handleLogout() {
 authToken = null;
 // Clear sensitive data from memory
 influencersData = [];
 location.reload();
}
// ─── SIDEBAR TOGGLE ─────────────────────────────────────────────────────────
function toggleSidebar() {
 const sidebar = document.getElementById('iaSidebar');
 const overlay = document.getElementById('iaOverlay');
 
 if (!sidebar || !overlay) return;
 
 const isOpen = sidebar.classList.contains('open');
 
 if (isOpen) {
 sidebar.classList.remove('open');
 sidebar.classList.add('collapsed');
 overlay.classList.remove('active');
 } else {
 sidebar.classList.remove('collapsed');
 sidebar.classList.add('open');
 overlay.classList.add('active');
 }
}
// Desktop sidebar collapse/expand
function toggleSidebarDesktop() {
 const sidebar = document.getElementById('iaSidebar');
 const main = document.querySelector('.ia-main');
 const toggle = document.getElementById('iaSidebarToggle');
 
 if (!sidebar || !main || !toggle) return;
 
 const isCollapsed = sidebar.classList.contains('collapsed');
 
 if (isCollapsed) {
 sidebar.classList.remove('collapsed');
 main.classList.remove('expanded');
 toggle.classList.remove('shifted');
 } else {
 sidebar.classList.add('collapsed');
 main.classList.add('expanded');
 toggle.classList.add('shifted');
 }
}
// Close sidebar when clicking outside on desktop
function initSidebar() {
 const sidebar = document.getElementById('iaSidebar');
 if (!sidebar) return;
 
 // On desktop, sidebar is always visible initially
 if (window.innerWidth > 900) {
 sidebar.classList.remove('collapsed', 'open');
 document.querySelector('.ia-main')?.classList.remove('expanded');
 document.getElementById('iaSidebarToggle')?.classList.remove('shifted');
 } else {
 // On mobile, start collapsed
 sidebar.classList.add('collapsed');
 sidebar.classList.remove('open');
 }
}
// Listen for window resize
window.addEventListener('resize', () => {
 const sidebar = document.getElementById('iaSidebar');
 const overlay = document.getElementById('iaOverlay');
 const main = document.querySelector('.ia-main');
 const toggle = document.getElementById('iaSidebarToggle');
 
 if (window.innerWidth > 900) {
 sidebar?.classList.remove('open');
 overlay?.classList.remove('active');
 // Restore desktop state - if it was collapsed, keep it collapsed
 if (!sidebar?.classList.contains('collapsed')) {
 main?.classList.remove('expanded');
 toggle?.classList.remove('shifted');
 }
 } else {
 // On mobile, collapse and reset desktop state
 if (!sidebar?.classList.contains('open')) {
 sidebar?.classList.add('collapsed');
 }
 main?.classList.remove('expanded');
 toggle?.classList.remove('shifted');
 }
});
// ─── DATA ────────────────────────────────────────────────────────────────────
async function loadDashboard() {
 try {
 const res = await fetch(`${API}/list`, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 if (res.status === 401) { handleLogout(); return; }
 const data = await res.json();
 if (data.success) {
 influencersData = data.influencers || [];
 // DEBUG: Log first influencer to check if shipping fields are present
 if (influencersData.length > 0) {
   const sample = influencersData[0];
   console.log('═══ loadDashboard: First influencer keys ═══', Object.keys(sample));
   console.log('═══ loadDashboard: First influencer shipping fields ═══', {
     shipping_address: sample.shipping_address,
     shipping_city: sample.shipping_city,
     shipping_state: sample.shipping_state,
     shipping_pin: sample.shipping_pin,
     shipping_landmark: sample.shipping_landmark
   });
 }
 renderStats(influencersData);
 renderTable(filteredInfluencers());
 updateTimestamp();
 hide('iaLoading');
 show('iaDashboard');
 }
 } catch (err) {
 showToast('Failed to load data', true);
 hide('iaLoading');
 show('iaAuth');
 }
}
function renderStats(list) {
 const active = list.filter(i => (i.status === 'active') || (i.status === undefined && i.is_active)).length;
 const pending = list.filter(i => i.status === 'pending').length;
 const suspended = list.filter(i => i.status === 'suspended').length;
 const rejected = list.filter(i => i.status === 'rejected').length;
 const avgComm = list.length > 0
 ? (list.reduce((s, i) => s + parseFloat(i.commission_rate || 7), 0) / list.length).toFixed(1)
 : 0;
 setText('statTotal', list.length);
 setText('statActive', active);
 setText('statAvgCommission', avgComm + '%');
 // Filter counts
 setText('fcAll', list.length);
 setText('fcPending', pending);
 setText('fcActive', active);
 setText('fcSuspended', suspended);
 setText('fcRejected', rejected);
 // Sidebar pending badge
 const badge = document.getElementById('iaNavPendingBadge');
 if (badge) {
 if (pending > 0) {
 badge.textContent = pending;
 badge.classList.remove('hidden');
 } else {
 badge.classList.add('hidden');
 }
 }
}
// ─── STATUS FILTER ───────────────────────────────────────────────────────────
let iaStatusFilter = 'all';
let iaSortMode = 'orders-desc';
function setSort(mode, btn) {
 iaSortMode = mode;
 document.querySelectorAll('.ia-sort-btn').forEach(b => b.classList.remove('active'));
 if (btn) btn.classList.add('active');
 renderTable(filteredInfluencers());
}
function applySorting(list) {
 const sorted = [...list];
 const [field, dir] = iaSortMode.split('-');
 const asc = dir === 'asc' ? 1 : -1;
 switch (field) {
   case 'orders':
     sorted.sort((a, b) => asc * ((a.usage_count || 0) - (b.usage_count || 0)));
     break;
   case 'name':
     sorted.sort((a, b) => asc * (a.name || '').localeCompare(b.name || ''));
     break;
   case 'date':
     sorted.sort((a, b) => asc * (new Date(a.created_at) - new Date(b.created_at)));
     break;
   case 'commission':
     sorted.sort((a, b) => asc * ((a.commission_rate || a.discount_value || 0) - (b.commission_rate || b.discount_value || 0)));
     break;
   case 'followers':
     sorted.sort((a, b) => asc * ((Number(a.follower_count) || 0) - (Number(b.follower_count) || 0)));
     break;
   case 'status':
     const order = { active: 0, pending: 1, suspended: 2, rejected: 3 };
     sorted.sort((a, b) => {
       const sa = a.status || (a.is_active ? 'active' : 'suspended');
       const sb = b.status || (b.is_active ? 'active' : 'suspended');
       return (order[sa] ?? 9) - (order[sb] ?? 9);
     });
     break;
 }
 return sorted;
}
function setStatusFilter(filter) {
 iaStatusFilter = filter;
 document.querySelectorAll('.ia-filter-btn').forEach(btn => {
 btn.classList.toggle('active', btn.dataset.filter === filter);
 });
 renderTable(filteredInfluencers());
}
function filteredInfluencers() {
 let list = influencersData || [];
 
 // Apply status filter
 if (iaStatusFilter !== 'all') {
 list = list.filter(i => {
 const s = i.status || (i.is_active ? 'active' : 'suspended');
 return s === iaStatusFilter;
 });
 }
 
 // Apply search filters
 if (searchFilters.name) {
 list = list.filter(i => 
 (i.name || '').toLowerCase().includes(searchFilters.name.toLowerCase())
 );
 }
 if (searchFilters.code) {
 list = list.filter(i => 
 (i.referral_code || '').toLowerCase().includes(searchFilters.code.toLowerCase())
 );
 }
 if (searchFilters.phone) {
 list = list.filter(i => 
 (i.phone || '').includes(searchFilters.phone)
 );
 }
 if (searchFilters.email) {
 list = list.filter(i => 
 (i.email || '').toLowerCase().includes(searchFilters.email.toLowerCase())
 );
 }
 if (searchFilters.minOrders !== null) {
 list = list.filter(i => 
 (i.usage_count || 0) >= searchFilters.minOrders
 );
 }
 if (searchFilters.maxOrders !== null) {
 list = list.filter(i => 
 (i.usage_count || 0) <= searchFilters.maxOrders
 );
 }
 if (searchFilters.dateFrom) {
 list = list.filter(i => 
 new Date(i.created_at) >= new Date(searchFilters.dateFrom)
 );
 }
 if (searchFilters.dateTo) {
 list = list.filter(i => 
 new Date(i.created_at) <= new Date(searchFilters.dateTo + 'T23:59:59')
 );
 }
 
 return applySorting(list);
}
function statusPill(inf) {
 const s = inf.status || (inf.is_active ? 'active' : 'suspended');
 const label = s.charAt(0).toUpperCase() + s.slice(1);
 return `<span class="ia-pill ${s}">${label}</span>`;
}
function renderTable(list) {
 const tbody = document.getElementById('iaTableBody');
 if (list.length === 0) {
 tbody.innerHTML = `<tr><td colspan="13"><div class="ia-empty"><h3>No Ambassadors${iaStatusFilter !== 'all' ? ' in this view' : ' Yet'}</h3><p>${iaStatusFilter !== 'all' ? 'Try a different filter.' : 'Click "Add Ambassador" or share the apply link to get started.'}</p></div></td></tr>`;
 return;
 }
 tbody.innerHTML = list.map(inf => {
 const portalUrl = `${window.location.origin}/pages/influencer-portal?token=${inf.link_token}`;
 const created = new Date(inf.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
 const discountVal = inf.discount_value !== undefined && inf.discount_value !== null ? inf.discount_value : (inf.commission_rate || 7);
 const usageLimit = inf.usage_limit !== null && inf.usage_limit !== undefined ? inf.usage_limit : 'Unlimited';
 const status = inf.status || (inf.is_active ? 'active' : 'suspended');
 const isSelected = selectedInfluencers.has(inf.id);
 const tierColors = { 'Rising Star': '#3b82f6', 'Growing Creator': '#22c55e', 'Established Influencer': '#a855f7', 'Top Tier Creator': '#f59e0b' };
 const tierColor = tierColors[inf.follower_tier] || '#6366f1';
 const tierBadge = inf.follower_tier ? `<span class="ia-dt-badge" style="background:${tierColor}20;color:${tierColor};padding:.15rem .4rem;font-size:.6rem;">${inf.follower_tier}</span>` : '-';
 const followerCount = inf.follower_count ? Number(inf.follower_count).toLocaleString() : '-';
 const contentWeekly = inf.content_weekly_count || '-';
 const selectedProds = inf.selected_products ? (typeof inf.selected_products === 'string' ? JSON.parse(inf.selected_products) : inf.selected_products) : [];
 const productsCount = selectedProds.length || '-';
 let actions;
 actions = `<button class="ia-action-btn view" onclick="viewInfluencerDetails('${inf.id}')">View</button>`;
 if (status === 'pending') {
 actions += `<button class="ia-action-btn approve" onclick="approveInfluencer(${inf.id})">Approve</button><button class="ia-action-btn reject" onclick="rejectInfluencer(${inf.id})">Reject</button>`;
 } else if (status === 'rejected') {
 actions += `<button class="ia-action-btn approve" onclick="approveInfluencer(${inf.id})">Reactivate</button><button class="ia-action-btn remove" onclick="removeInfluencer(${inf.id})">Delete</button>`;
 } else {
 actions += `<button class="ia-action-btn payouts" onclick="openPayoutsDrawer(${inf.id})">Payouts</button><button class="ia-action-btn edit" onclick="openEditModal('${inf.id}')">Edit</button><button class="ia-action-btn remove" onclick="removeInfluencer(${inf.id})">Remove</button>`;
 }
 return `
 <tr class="ia-row-enter" id="row-${inf.id}">
 <td data-label="Select">
 <div class="ia-checkbox-wrap">
 <input type="checkbox" class="ia-checkbox" ${isSelected ? 'checked' : ''} onchange="toggleSelect(${inf.id})">
 </div>
 </td>
 <td class="td-name" data-label="Name">${esc(inf.name)}</td>
 <td data-label="Status">${statusPill(inf)}</td>
 <td data-label="Tier">${tierBadge}</td>
 <td data-label="Followers" style="font-size:0.8rem;">${followerCount}</td>
 <td class="td-phone" style="font-size:0.75rem;color:var(--muted);" data-label="Phone">${esc(inf.phone || '—')}</td>
 <td data-label="Code"><span class="td-code" style="${!inf.shopify_price_rule_id ? 'border-color:var(--danger);color:var(--danger);' : ''}">${esc(inf.referral_code)}${!inf.shopify_price_rule_id ? ' <span title="Shopify discount code not synced">⚠️</span>' : ''}</span></td>
 <td data-label="Content/Wk" style="font-size:0.8rem;">${contentWeekly}</td>
 <td data-label="Products" style="font-size:0.8rem;">${productsCount}</td>
 <td class="td-orders" style="font-weight: 600; color: ${inf.usage_count > 0 ? 'var(--success)' : 'var(--muted)'};" data-label="Orders">${inf.usage_count !== undefined && inf.usage_count !== null ? inf.usage_count : '—'}</td>
 <td class="td-date" data-label="Created">${created}</td>
 <td data-label="Portal">
 <button class="ia-copy-btn" id="copyBtn-${inf.id}" onclick="copyLink('${portalUrl}', ${inf.id})">
 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
 Copy Link
 </button>
 </td>
 <td data-label="Actions">
 <div class="ia-row-actions">${actions}</div>
 </td>
 </tr>
 `;
 }).join('');
 
 // Update select all checkbox state
 updateSelectAllCheckbox();
}
// ─── ADD ─────────────────────────────────────────────────────────────────────
function openAddModal() {
 document.getElementById('addName').value = '';
 document.getElementById('addPhone').value = '';
 document.getElementById('addCode').value = '';
 document.getElementById('addCommission').value = '7';
 document.getElementById('addDiscountValue').value = '7';
 document.getElementById('addUsageLimit').value = '';
 document.getElementById('addError').classList.remove('show');
 openModal('iaAddModal');
}
async function submitAdd() {
 const btn = document.getElementById('addSubmitBtn');
 const errEl = document.getElementById('addError');
 const name = document.getElementById('addName').value.trim();
 const phone = document.getElementById('addPhone').value.trim();
 const referralCode = document.getElementById('addCode').value.trim().toUpperCase();
 const commissionRate = parseFloat(document.getElementById('addCommission').value) || 7;
 const displayedCommissionRate = parseFloat(document.getElementById('addDisplayedCommission').value) || commissionRate;
 const discountValue = document.getElementById('addDiscountValue').value ? parseFloat(document.getElementById('addDiscountValue').value) : commissionRate;
 const usageLimit = document.getElementById('addUsageLimit').value.trim();
 if (!name || !referralCode || !phone) { errEl.textContent = 'Name, Code, and Phone are required.'; errEl.classList.add('show'); return; }
 btn.disabled = true; btn.textContent = 'Creating…';
 errEl.classList.remove('show');
 try {
 const res = await fetch(`${API}/add`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ name, referralCode, commissionRate, displayedCommissionRate, discountValue, usageLimit, phone })
 });
 if (res.ok) {
 const d = await res.json();
 closeModal('iaAddModal');
 if (d.warning) {
 showToast('Ambassador created ⚠️ Shopify code not synced');
 // Show warning in a more visible way
 setTimeout(() => alert(d.warning), 300);
 } else {
 showToast('Ambassador created ✓');
 }
 await loadDashboard();
 } else {
 const d = await res.json();
 errEl.textContent = d.error || 'Failed to add. Code might already exist.';
 errEl.classList.add('show');
 }
 } catch (err) {
 errEl.textContent = 'Connection error.';
 errEl.classList.add('show');
 }
 btn.disabled = false; btn.textContent = 'Create Link';
}
// ─── EDIT ─────────────────────────────────────────────────────────────────────
function openEditModal(id) {
 console.log('═══ openEditModal ═══', id);
 const inf = influencersData.find(i => String(i.id) === String(id));
 if (!inf) { alert('Could not find ambassador: ' + id); return; }
 // DEBUG: Log ALL keys and shipping-related values to diagnose address loading
 console.log('═══ INFLUENCER DATA KEYS ═══', Object.keys(inf));
 console.log('═══ SHIPPING FIELDS ═══', {
   shipping_address: inf.shipping_address,
   shipping_city: inf.shipping_city,
   shipping_state: inf.shipping_state,
   shipping_pin: inf.shipping_pin,
   shipping_landmark: inf.shipping_landmark,
   address_type: inf.address_type
 });
 console.log('═══ FULL INFLUENCER OBJECT ═══', JSON.stringify(inf, null, 2));
 // Remove any existing edit modal
 const old = document.getElementById('iaEditModal');
 if (old) old.remove();
 // Build modal HTML dynamically
 const overlay = document.createElement('div');
 overlay.id = 'iaEditModal';
 overlay.style.cssText = 'position:fixed!important;inset:0!important;z-index:999999!important;background:rgba(0,0,0,0.85)!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:1rem!important;';
 overlay.onclick = function(e) { if (e.target === overlay) closeEditModal(); };
 const dc = inf.displayed_commission_rate != null ? inf.displayed_commission_rate : (inf.commission_rate || 7);
 const dv = inf.discount_value != null ? inf.discount_value : (inf.commission_rate || 7);
 const ul = inf.usage_limit != null ? inf.usage_limit : '';
 overlay.innerHTML = `
 <div style="background:#0a0a0a;border:1px solid #1f1f1f;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;padding:2rem;color:#fff;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid #1f1f1f;">
   <span style="font-size:0.8rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;">Edit Ambassador</span>
   <button onclick="closeEditModal()" style="background:none;border:none;color:#606060;cursor:pointer;font-size:1.2rem;line-height:1;padding:0.25rem;">&times;</button>
  </div>
  <input type="hidden" id="editId" value="${id}">
  <div style="margin-bottom:1rem;"><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">Full Name</label><input type="text" id="editName" value="${(inf.name||'').replace(/"/g,'&quot;')}" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"></div>
  <div style="margin-bottom:1rem;"><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">Phone Number</label><input type="text" id="editPhone" value="${(inf.phone||'').replace(/"/g,'&quot;')}" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
   <div><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">Referral Code</label><input type="text" id="editCode" value="${(inf.referral_code||'').replace(/"/g,'&quot;')}" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;text-transform:uppercase;"></div>
   <div><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">Commission (%)</label><input type="number" id="editCommission" value="${parseFloat(inf.commission_rate||7).toFixed(1)}" step="0.5" min="0" max="100" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"><p style="font-size:0.6rem;color:#606060;margin-top:0.3rem;">Admin only</p></div>
   <div><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">Displayed Commission (%)</label><input type="number" id="editDisplayedCommission" value="${parseFloat(dc).toFixed(1)}" step="0.5" min="0" max="100" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"><p style="font-size:0.6rem;color:#606060;margin-top:0.3rem;">What influencers see</p></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
   <div><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">Discount (%)</label><input type="number" id="editDiscountValue" value="${parseFloat(dv).toFixed(1)}" step="0.5" min="0" max="100" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"></div>
   <div><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">Usage Limit</label><input type="number" id="editUsageLimit" value="${ul}" min="1" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"><p style="font-size:0.6rem;color:#606060;margin-top:0.3rem;">Blank = unlimited</p></div>
  </div>
  <div style="border-top:1px solid #1f1f1f;padding-top:1rem;margin-top:0.5rem;">
   <p style="font-size:0.6rem;letter-spacing:0.2em;text-transform:uppercase;color:#606060;margin-bottom:0.75rem;font-weight:700;">Shipping Address</p>
   <div style="margin-bottom:0.75rem;"><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">Address Line 1</label><input type="text" id="editShippingAddress" value="${(inf.shipping_address||'').replace(/"/g,'&quot;')}" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"></div>
   <div style="margin-bottom:0.75rem;"><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">Landmark</label><input type="text" id="editShippingLandmark" value="${(inf.shipping_landmark||'').replace(/"/g,'&quot;')}" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"></div>
   <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;">
    <div><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">City</label><input type="text" id="editShippingCity" value="${(inf.shipping_city||'').replace(/"/g,'&quot;')}" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"></div>
    <div><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">State</label><input type="text" id="editShippingState" value="${(inf.shipping_state||'').replace(/"/g,'&quot;')}" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"></div>
    <div><label style="display:block;font-size:0.6rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:#606060;margin-bottom:0.5rem;">Pincode</label><input type="text" id="editShippingPin" value="${(inf.shipping_pin||'').replace(/"/g,'&quot;')}" maxlength="6" style="width:100%;padding:0.65rem 0.85rem;background:#111;border:1px solid #1f1f1f;color:#fff;font-size:0.8rem;outline:none;"></div>
   </div>
  </div>
  <p id="editError" style="display:none;color:#ff4444;font-size:0.75rem;margin-top:1rem;"></p>
  <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.5rem;">
   <button onclick="closeEditModal()" style="padding:0.6rem 1.2rem;background:transparent;border:1px solid #1f1f1f;color:#fff;font-size:0.7rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">Cancel</button>
   <button onclick="submitEdit()" id="editSubmitBtn" style="padding:0.6rem 1.2rem;background:#fff;border:1px solid #fff;color:#000;font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;">Save Changes</button>
  </div>
 </div>`;
 document.body.appendChild(overlay);
 console.log('═══ DYNAMIC EDIT MODAL CREATED & APPENDED ═══');
 // If all shipping fields are empty, fetch fresh data from dedicated detail endpoint
 const hasAnyAddress = inf.shipping_address || inf.shipping_city || inf.shipping_state || inf.shipping_pin || inf.shipping_landmark;
 // ALWAYS fetch fresh data from server to ensure we have latest address
 console.log(hasAnyAddress ? '🔄 Fetching fresh data to ensure latest address...' : '⚠️ No shipping address in cached data. Fetching fresh from detail endpoint...');
 fetch(`${API}/detail/${id}`, { headers: { 'Authorization': `Bearer ${authToken}` } })
   .then(r => r.json())
   .then(data => {
     if (data.success && data.influencer) {
       const fresh = data.influencer;
       console.log('═══ FRESH DETAIL SHIPPING FIELDS ═══', {
         shipping_address: fresh.shipping_address,
         shipping_city: fresh.shipping_city,
         shipping_state: fresh.shipping_state,
         shipping_pin: fresh.shipping_pin,
         shipping_landmark: fresh.shipping_landmark
       });
       const freshHasAddress = fresh.shipping_address || fresh.shipping_city || fresh.shipping_state || fresh.shipping_pin;
       if (freshHasAddress) {
         console.log('✅ Fresh detail data HAS address! Updating modal fields...');
         const addrEl = document.getElementById('editShippingAddress');
         const cityEl = document.getElementById('editShippingCity');
         const stateEl = document.getElementById('editShippingState');
         const pinEl = document.getElementById('editShippingPin');
         const landmarkEl = document.getElementById('editShippingLandmark');
         if (addrEl) addrEl.value = fresh.shipping_address || '';
         if (cityEl) cityEl.value = fresh.shipping_city || '';
         if (stateEl) stateEl.value = fresh.shipping_state || '';
         if (pinEl) pinEl.value = fresh.shipping_pin || '';
         if (landmarkEl) landmarkEl.value = fresh.shipping_landmark || '';
         // Also update the cached data for next time
         Object.assign(inf, fresh);
       } else {
         console.log('❌ Fresh detail data also has NO address. Address not saved in DB yet.');
       }
     }
   })
   .catch(err => console.error('Failed to fetch detail:', err));
}
function closeEditModal() {
 const el = document.getElementById('iaEditModal');
 if (el) el.remove();
}
async function submitEdit() {
 const btn = document.getElementById('editSubmitBtn');
 const errEl = document.getElementById('editError');
 const id = document.getElementById('editId').value;
 const name = document.getElementById('editName').value.trim();
 const phone = document.getElementById('editPhone').value.trim();
 const referralCode = document.getElementById('editCode').value.trim().toUpperCase();
 const commissionRate = parseFloat(document.getElementById('editCommission').value);
 const displayedCommissionRate = parseFloat(document.getElementById('editDisplayedCommission').value) || commissionRate;
 const discountValue = document.getElementById('editDiscountValue').value ? parseFloat(document.getElementById('editDiscountValue').value) : commissionRate;
 const usageLimit = document.getElementById('editUsageLimit').value.trim();
 const shippingAddress = document.getElementById('editShippingAddress').value.trim();
 const shippingLandmark = document.getElementById('editShippingLandmark').value.trim();
 const shippingCity = document.getElementById('editShippingCity').value.trim();
 const shippingState = document.getElementById('editShippingState').value.trim();
 const shippingPin = document.getElementById('editShippingPin').value.trim();
 if (!name || !referralCode || !phone) { errEl.textContent = 'All fields are required.'; errEl.style.display = 'block'; return; }
 btn.disabled = true; btn.textContent = 'Saving…';
 errEl.style.display = 'none';
 try {
 const res = await fetch(`${API}/update/${id}`, {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ name, referralCode, commissionRate, displayedCommissionRate, discountValue, usageLimit, phone, shippingAddress, shippingLandmark, shippingCity, shippingState, shippingPin })
 });
 if (res.ok) {
 closeEditModal();
 showToast('Changes saved ✓');
 await loadDashboard();
 } else {
 const d = await res.json();
 errEl.textContent = d.error || 'Failed to update.';
 errEl.style.display = 'block';
 }
 } catch (err) {
 errEl.textContent = 'Connection error.';
 errEl.style.display = 'block';
 }
 btn.disabled = false; btn.textContent = 'Save Changes';
}
// ─── REMOVE ──────────────────────────────────────────────────────────────────
async function removeInfluencer(id) {
 const inf = influencersData.find(i => String(i.id) === String(id));
 if (!confirm(`Remove "${inf?.name || 'this ambassador'}"? Their tracking link will be deactivated.`)) return;
 try {
 const res = await fetch(`${API}/remove/${id}`, {
 method: 'DELETE',
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 if (res.ok) {
 showToast('Ambassador removed');
 await loadDashboard();
 } else {
 showToast('Failed to remove', true);
 }
 } catch (err) {
 showToast('Connection error', true);
 }
}
// ─── COPY LINK ────────────────────────────────────────────────────────────────
async function copyLink(url, id) {
 try {
 await navigator.clipboard.writeText(url);
 const btn = document.getElementById(`copyBtn-${id}`);
 btn.classList.add('copied');
 btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
 setTimeout(() => {
 btn.classList.remove('copied');
 btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Link';
 }, 2000);
 } catch (err) {
 showToast('Could not copy to clipboard', true);
 }
}
// ─── MODAL UTILS ─────────────────────────────────────────────────────────────
function openModal(id) {
 const el = document.getElementById(id);
 if (!el) { console.error('openModal: element', id, 'not found'); return; }
 el.classList.add('open');
 el.style.display = 'flex';
 el.style.position = 'fixed';
 el.style.inset = '0';
 el.style.zIndex = '99999';
 el.style.alignItems = 'center';
 el.style.justifyContent = 'center';
 console.log('openModal:', id, '→', el.style.display, el.className);
}
function closeModal(id) {
 const el = document.getElementById(id);
 if (!el) return;
 el.classList.remove('open');
 el.style.display = 'none';
}
function handleOverlayClick(e, id) { if (e.target === e.currentTarget) closeModal(id); }
// ─── TOAST ───────────────────────────────────────────────────────────────────
// ─── TOAST ───────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, isError = false) {
 const t = document.getElementById('iaToast');
 clearTimeout(toastTimer);
 t.textContent = msg;
 t.className = 'ia-toast' + (isError ? ' error' : '');
 requestAnimationFrame(() => t.classList.add('show'));
 toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}
// ─── APPLY LINK SHARING ────────────────────────────────────────────────────────────
async function copyApplyLink() {
 const url = `${window.location.origin}/pages/influencer-apply`;
 const btn = document.getElementById('iaCopyApplyBtn');
 try {
 await navigator.clipboard.writeText(url);
 if (btn) {
 const original = btn.innerHTML;
 btn.classList.add('copied');
 btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Copied';
 setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = original; }, 2000);
 }
 showToast('Apply link copied ✓');
 } catch (e) {
 showToast('Could not copy. Link: ' + url, true);
 }
}
// ─── APPROVE / REJECT ──────────────────────────────────────────────────────────────
async function approveInfluencer(id) {
 if (!confirm('Approve this ambassador? This will activate their Shopify discount code at checkout.')) return;
 try {
 const res = await fetch(`${API}/approve/${id}`, {
 method: 'POST',
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 if (res.status === 401) { handleLogout(); return; }
 const data = await res.json();
 if (res.ok && data.success) {
 showToast(data.warning ? 'Approved ⚠️ ' + data.warning : 'Ambassador approved ✓');
 await loadDashboard();
 } else {
 showToast(data.error || 'Failed to approve', true);
 }
 } catch (err) { showToast('Connection error', true);
 }
}
async function rejectInfluencer(id) {
 if (!confirm('Reject this application? Their Shopify price rule will be disabled.')) return;
 try {
 const res = await fetch(`${API}/reject/${id}`, {
 method: 'POST',
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 if (res.status === 401) { handleLogout(); return; }
 const data = await res.json();
 if (res.ok && data.success) {
 showToast('Application rejected');
 await loadDashboard();
 } else {
 showToast(data.error || 'Failed to reject', true);
 }
 } catch (err) { showToast('Connection error', true);
 }
}
// ─── PAYOUTS DRAWER ──────────────────────────────────────────────────────────────
let currentDrawerInfluencer = null;
function openPayoutsDrawer(id) {
 const inf = (influencersData || []).find(i => String(i.id) === String(id));
 if (!inf) return;
 currentDrawerInfluencer = inf;
 setText('iaPayoutDrawerName', inf.name);
 setText('iaPayoutDrawerCode', inf.referral_code || '—');
 clearPayoutForm();
 document.getElementById('iaPayoutsDrawer').classList.add('show');
 document.body.style.overflow = 'hidden';
 loadDrawerPayouts(id);
}
function closePayoutsDrawer() {
 document.getElementById('iaPayoutsDrawer').classList.remove('show');
 document.body.style.overflow = '';
 currentDrawerInfluencer = null;
}
function handleDrawerOverlay(e) {
 if (e.target.id === 'iaPayoutsDrawer') closePayoutsDrawer();
}
function clearPayoutForm() {
 ['poStart', 'poEnd', 'poAmount', 'poRef', 'poNotes'].forEach(id => {
 const el = document.getElementById(id);
 if (el) el.value = '';
 });
}
async function loadDrawerPayouts(id) {
 const list = document.getElementById('iaPayoutList');
 list.innerHTML = '<div class="ia-payout-empty">Loading…</div>';
 try {
 const res = await fetch(`${API}/payouts/${id}`, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 if (res.status === 401) { handleLogout(); return; }
 const data = await res.json();
 if (data.success) {
 const payouts = data.payouts || [];
 let totalPaid = 0, pending = 0;
 payouts.forEach(p => {
 const amt = parseFloat(p.amount || 0);
 if (p.status === 'paid') totalPaid += amt;
 if (p.status === 'pending') pending += amt;
 });
 setText('iaDrawerTotalPaid', '₹' + totalPaid.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
 setText('iaDrawerPending', '₹' + pending.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
 renderPayoutsList(payouts);
 } else {
 list.innerHTML = '<div class="ia-payout-empty">Failed to load.</div>';
 }
 } catch (err) { list.innerHTML = '<div class="ia-payout-empty">Connection error.</div>';
 }
}
function renderPayoutsList(payouts) {
 const list = document.getElementById('iaPayoutList');
 if (!payouts.length) {
 list.innerHTML = '<div class="ia-payout-empty">No payouts recorded yet. Use the form above to add one.</div>';
 return;
 }
 list.innerHTML = payouts.map(p => {
 const start = new Date(p.period_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
 const end = new Date(p.period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
 const paidAt = p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
 const amount = parseFloat(p.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
 const actions = p.status === 'pending'
 ? `<button class="pay" onclick="updatePayoutStatusAdmin(${p.id}, 'paid')">Mark Paid</button>
 <button class="cancel" onclick="updatePayoutStatusAdmin(${p.id}, 'cancelled')">Cancel</button>`
 : p.status === 'paid'
 ? `<button onclick="updatePayoutStatusAdmin(${p.id}, 'pending')">Revert to Pending</button>`
 : `<button onclick="updatePayoutStatusAdmin(${p.id}, 'pending')">Restore</button>`;
 return `
 <div class="ia-payout-item">
 <div class="ia-payout-item-top">
 <div class="ia-payout-item-amt">₹${amount}</div>
 <span class="ia-pill ${p.status === 'paid' ? 'active' : p.status === 'pending' ? 'pending' : 'rejected'}">${p.status.toUpperCase()}</span>
 </div>
 <div class="ia-payout-item-meta">${start} → ${end}${paidAt ? ' · Paid ' + paidAt : ''}${p.reference ? ' · Ref: ' + esc(p.reference) : ''}</div>
 ${p.notes ? `<div class="ia-payout-item-meta" style="margin-top:0.3rem;">${esc(p.notes)}</div>` : ''}
 <div class="ia-payout-actions">${actions}</div>
 </div>
 `;
 }).join('');
}
async function submitNewPayout() {
 if (!currentDrawerInfluencer) return;
 const periodStart = document.getElementById('poStart').value;
 const periodEnd = document.getElementById('poEnd').value;
 const amount = document.getElementById('poAmount').value;
 const reference = document.getElementById('poRef').value.trim();
 const notes = document.getElementById('poNotes').value.trim();
 if (!periodStart || !periodEnd || !amount) {
 showToast('Period start, end, and amount are required', true);
 return;
 }
 if (new Date(periodStart) > new Date(periodEnd)) {
 showToast('Start cannot be after end', true);
 return;
 }
 const btn = document.getElementById('iaAddPayoutBtn');
 btn.disabled = true; btn.textContent = 'Saving…';
 try {
 const res = await fetch(`${API}/payouts/${currentDrawerInfluencer.id}`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ periodStart, periodEnd, amount, reference: reference || null, notes: notes || null })
 });
 if (res.status === 401) { handleLogout(); return; }
 const data = await res.json();
 if (res.ok && data.success) {
 showToast('Payout recorded ✓');
 clearPayoutForm();
 await loadDrawerPayouts(currentDrawerInfluencer.id);
 } else {
 showToast(data.error || 'Failed to save', true);
 }
 } catch (err) { showToast('Connection error', true);
 } finally {
 btn.disabled = false;
 btn.textContent = 'Record Payout';
 }
}
async function updatePayoutStatusAdmin(payoutId, status) {
 if (status === 'cancelled' && !confirm('Cancel this payout? Amount will be removed from pending total.')) return;
 try {
 const res = await fetch(`${API}/payouts/item/${payoutId}`, {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ status })
 });
 if (res.status === 401) { handleLogout(); return; }
 const data = await res.json();
 if (res.ok && data.success) {
 showToast('Payout updated ✓');
 if (currentDrawerInfluencer) await loadDrawerPayouts(currentDrawerInfluencer.id);
 } else {
 showToast(data.error || 'Failed to update', true);
 }
 } catch (err) { showToast('Connection error', true);
 }
}
// ─── VIEW STATS ──────────────────────────────────────────────────────────────
let currentStatsId = null;
let currentStatsRange = 'all';
function viewInfluencerStats(id) {
 const inf = influencersData.find(i => String(i.id) === String(id));
 if (!inf) return;
 
 currentStatsId = id;
 currentStatsRange = 'all';
 
 // Reset UI
 document.getElementById('statsModalTitle').textContent = `${esc(inf.name)} - Performance`;
 document.getElementById('customDateRow').style.display = 'none';
 document.getElementById('statsStartDate').value = '';
 document.getElementById('statsEndDate').value = '';
 
 // Reset range buttons
 document.querySelectorAll('.ia-range-btn').forEach(btn => {
 btn.classList.toggle('active', btn.dataset.range === 'all');
 });
 
 // Show loading state
 document.getElementById('statTotalRevenue').textContent = '—';
 document.getElementById('statTotalOrders').textContent = '—';
 document.getElementById('statAov').textContent = '—';
 document.getElementById('statEarnings').textContent = '—';
 document.getElementById('statCommissionRate').textContent = '—';
 document.getElementById('statsConversionsList').innerHTML = '<div class="ia-conversion-loading"></div>';
 
 openModal('iaStatsModal');
 fetchInfluencerStats(id, 'all');
}
function setStatsRange(range) {
 if (range === currentStatsRange && range !== 'custom') return;
 currentStatsRange = range;
 
 // Update active button
 document.querySelectorAll('#iaStatsModal .ia-range-btn').forEach(btn => {
 btn.classList.toggle('active', btn.dataset.range === range);
 });
 
 if (range === 'custom') {
 document.getElementById('customDateRow').style.display = 'flex';
 return; // Don't fetch yet, wait for custom date apply
 } else {
 document.getElementById('customDateRow').style.display = 'none';
 }
 
 // Show loading
 document.getElementById('statsConversionsList').innerHTML = '<div class="ia-conversion-loading"></div>';
 fetchInfluencerStats(currentStatsId, range);
}
function toggleCustomDate() {
 const row = document.getElementById('customDateRow');
 const isVisible = row.style.display === 'flex';
 row.style.display = isVisible ? 'none' : 'flex';
 
 if (!isVisible) {
 document.querySelectorAll('#iaStatsModal .ia-range-btn').forEach(btn => {
 btn.classList.toggle('active', btn.dataset.range === 'custom');
 });
 currentStatsRange = 'custom';
 }
}
function applyCustomDate() {
 const startDate = document.getElementById('statsStartDate').value;
 const endDate = document.getElementById('statsEndDate').value;
 
 if (!startDate || !endDate) {
 showToast('Please select both start and end dates', true);
 return;
 }
 
 if (new Date(startDate) > new Date(endDate)) {
 showToast('Start date cannot be after end date', true);
 return;
 }
 
 document.getElementById('statsConversionsList').innerHTML = '<div class="ia-conversion-loading"></div>';
 fetchInfluencerStats(currentStatsId, 'custom', startDate, endDate);
}
async function fetchInfluencerStats(id, range, startDate = null, endDate = null) {
 try {
 // Fetch stats (from cache - fast)
 let statsUrl = `${API}/stats/${id}?range=${range}`;
 if (range === 'custom' && startDate && endDate) {
 statsUrl += `&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
 }
 
 const statsRes = await fetch(statsUrl, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 
 if (statsRes.status === 401) { handleLogout(); return; }
 
 const statsData = await statsRes.json();
 
 if (!statsData.success) {
 showToast('Failed to load stats', true);
 return;
 }
 
 // Fetch conversions separately (from Shopify - may take a moment)
 let conversionsUrl = `${API}/conversions/${id}?range=${range}`;
 if (range === 'custom' && startDate && endDate) {
 conversionsUrl += `&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
 }
 
 let conversions = [];
 try {
 const conversionsRes = await fetch(conversionsUrl, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 
 if (conversionsRes.ok) {
 const conversionsData = await conversionsRes.json();
 conversions = conversionsData.conversions || [];
 }
 } catch (err) { // Don't fail the whole request if conversions fail
 }
 
 // Merge and render
 statsData.recentConversions = conversions;
 renderInfluencerStats(statsData);
 
 } catch (err) { showToast('Connection error', true);
 }
}
function renderInfluencerStats(data) {
 const stats = data.stats;
 const influencer = data.influencer;
 const conversions = data.recentConversions || [];
 const currency = stats.currency || 'INR';
 const sym = currency === 'INR' ? '₹' : currency;
 
 // Render stats
 document.getElementById('statTotalRevenue').textContent = `${sym}${fmt(stats.totalRevenue)}`;
 document.getElementById('statTotalOrders').textContent = stats.orderCount;
 document.getElementById('statAov').textContent = `${sym}${fmt(stats.aov)}`;
 document.getElementById('statEarnings').textContent = `${sym}${fmt(stats.estimatedEarnings)}`;
 document.getElementById('statCommissionRate').textContent = `${stats.commissionRate}% commission`;
 
 // Render conversions count
 document.getElementById('statsConversionsCount').textContent = 
 conversions.length > 0 ? `${conversions.length} orders` : '';
 
 // Render conversions list
 const listEl = document.getElementById('statsConversionsList');
 
 if (conversions.length === 0) {
 listEl.innerHTML = '<div class="ia-conversion-empty">No conversions found for this date range</div>';
 return;
 }
 
 listEl.innerHTML = conversions.map((order, i) => `
 <div class="ia-conversion-item" style="animation: fadeUp 0.3s ease ${i * 0.05}s both;">
 <div>
 <div class="ia-conversion-order">Order ${esc(order.orderName || order.name)}</div>
 <div class="ia-conversion-date">${fmtDate(order.date)} • ${esc(order.customerName || 'Guest')}</div>
 </div>
 <div style="text-align: right;">
 <div class="ia-conversion-total">${sym}${fmt(order.total)}</div>
 <div style="font-size: 0.75rem; color: var(--muted); margin-top: 2px;">${esc(order.discountCode || '')}</div>
 </div>
 </div>
 `).join('');
}
function fmt(num) {
 return parseFloat(num).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtDate(d) {
 return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
// ─── ADVANCED SEARCH ─────────────────────────────────────────────────────────
function toggleSearchPanel() {
 const panel = document.getElementById('iaSearchPanel');
 panel.classList.toggle('open');
}
function applySearch() {
 searchFilters.name = document.getElementById('searchName').value.trim();
 searchFilters.code = document.getElementById('searchCode').value.trim();
 searchFilters.phone = document.getElementById('searchPhone').value.trim();
 searchFilters.email = document.getElementById('searchEmail').value.trim();
 
 const minOrders = document.getElementById('searchMinOrders').value;
 searchFilters.minOrders = minOrders ? parseInt(minOrders) : null;
 
 const maxOrders = document.getElementById('searchMaxOrders').value;
 searchFilters.maxOrders = maxOrders ? parseInt(maxOrders) : null;
 
 searchFilters.dateFrom = document.getElementById('searchDateFrom').value || null;
 searchFilters.dateTo = document.getElementById('searchDateTo').value || null;
 
 renderTable(filteredInfluencers());
 renderActiveFilters();
 showToast('Search applied ✓');
}
function resetSearch() {
 searchFilters = {
 name: '',
 code: '',
 phone: '',
 email: '',
 minOrders: null,
 maxOrders: null,
 dateFrom: null,
 dateTo: null
 };
 
 document.getElementById('searchName').value = '';
 document.getElementById('searchCode').value = '';
 document.getElementById('searchPhone').value = '';
 document.getElementById('searchEmail').value = '';
 document.getElementById('searchMinOrders').value = '';
 document.getElementById('searchMaxOrders').value = '';
 document.getElementById('searchDateFrom').value = '';
 document.getElementById('searchDateTo').value = '';
 
 renderTable(filteredInfluencers());
 renderActiveFilters();
 showToast('Search reset');
}
function renderActiveFilters() {
 const container = document.getElementById('iaActiveFilters');
 const filters = [];
 
 if (searchFilters.name) filters.push({ label: `Name: ${searchFilters.name}`, key: 'name' });
 if (searchFilters.code) filters.push({ label: `Code: ${searchFilters.code}`, key: 'code' });
 if (searchFilters.phone) filters.push({ label: `Phone: ${searchFilters.phone}`, key: 'phone' });
 if (searchFilters.email) filters.push({ label: `Email: ${searchFilters.email}`, key: 'email' });
 if (searchFilters.minOrders !== null) filters.push({ label: `Min Orders: ${searchFilters.minOrders}`, key: 'minOrders' });
 if (searchFilters.maxOrders !== null) filters.push({ label: `Max Orders: ${searchFilters.maxOrders}`, key: 'maxOrders' });
 if (searchFilters.dateFrom) filters.push({ label: `From: ${searchFilters.dateFrom}`, key: 'dateFrom' });
 if (searchFilters.dateTo) filters.push({ label: `To: ${searchFilters.dateTo}`, key: 'dateTo' });
 
 if (filters.length === 0) {
 container.style.display = 'none';
 return;
 }
 
 container.style.display = 'flex';
 container.innerHTML = filters.map(f => `
 <div class="ia-filter-tag">
 ${f.label}
 <span class="ia-filter-tag-remove" onclick="removeFilter('${f.key}')">&times;</span>
 </div>
 `).join('');
}
function removeFilter(key) {
 searchFilters[key] = key.includes('Orders') ? null : '';
 
 if (key === 'name') document.getElementById('searchName').value = '';
 if (key === 'code') document.getElementById('searchCode').value = '';
 if (key === 'phone') document.getElementById('searchPhone').value = '';
 if (key === 'email') document.getElementById('searchEmail').value = '';
 if (key === 'minOrders') document.getElementById('searchMinOrders').value = '';
 if (key === 'maxOrders') document.getElementById('searchMaxOrders').value = '';
 if (key === 'dateFrom') document.getElementById('searchDateFrom').value = '';
 if (key === 'dateTo') document.getElementById('searchDateTo').value = '';
 
 renderTable(filteredInfluencers());
 renderActiveFilters();
}
// ─── BULK SELECTION ──────────────────────────────────────────────────────────
function toggleSelect(id) {
 if (selectedInfluencers.has(id)) {
 selectedInfluencers.delete(id);
 } else {
 selectedInfluencers.add(id);
 }
 updateBulkBar();
 updateSelectAllCheckbox();
}
function toggleSelectAll() {
 const selectAllCheckbox = document.getElementById('selectAllCheckbox');
 const currentList = filteredInfluencers();
 
 if (selectAllCheckbox.checked) {
 currentList.forEach(inf => selectedInfluencers.add(inf.id));
 } else {
 selectedInfluencers.clear();
 }
 
 renderTable(currentList);
 updateBulkBar();
}
function updateSelectAllCheckbox() {
 const selectAllCheckbox = document.getElementById('selectAllCheckbox');
 const currentList = filteredInfluencers();
 
 if (currentList.length === 0) {
 selectAllCheckbox.checked = false;
 selectAllCheckbox.indeterminate = false;
 return;
 }
 
 const selectedCount = currentList.filter(inf => selectedInfluencers.has(inf.id)).length;
 
 if (selectedCount === 0) {
 selectAllCheckbox.checked = false;
 selectAllCheckbox.indeterminate = false;
 } else if (selectedCount === currentList.length) {
 selectAllCheckbox.checked = true;
 selectAllCheckbox.indeterminate = false;
 } else {
 selectAllCheckbox.checked = false;
 selectAllCheckbox.indeterminate = true;
 }
}
function updateBulkBar() {
 const bulkBar = document.getElementById('iaBulkBar');
 const selectedCount = selectedInfluencers.size;
 
 document.getElementById('iaSelectedCount').textContent = selectedCount;
 
 if (selectedCount > 0) {
 bulkBar.classList.add('show');
 } else {
 bulkBar.classList.remove('show');
 }
}
function clearSelection() {
 selectedInfluencers.clear();
 renderTable(filteredInfluencers());
 updateBulkBar();
 showToast('Selection cleared');
}
// ─── BULK ACTIONS ────────────────────────────────────────────────────────────
async function bulkApprove() {
 const selectedIds = Array.from(selectedInfluencers);
 
 if (selectedIds.length === 0) {
 showToast('No influencers selected', true);
 return;
 }
 
 const pendingIds = selectedIds.filter(id => {
 const inf = influencersData.find(i => String(i.id) === String(id));
 return inf && (inf.status === 'pending' || inf.status === 'rejected');
 });
 
 if (pendingIds.length === 0) {
 showToast('No pending applications in selection', true);
 return;
 }
 
 if (!confirm(`Approve ${pendingIds.length} ambassador(s)? This will activate their Shopify discount codes.`)) return;
 
 try {
 const res = await fetch(`${API}/bulk-approve`, {
 method: 'POST',
 headers: { 
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${authToken}` 
 },
 body: JSON.stringify({ ids: pendingIds })
 });
 
 if (res.status === 401) { handleLogout(); return; }
 
 const data = await res.json();
 
 if (data.success) {
 const { summary } = data;
 clearSelection();
 await loadDashboard();
 
 if (summary.failed === 0) {
 showToast(`${summary.succeeded} ambassador(s) approved ✓`);
 } else {
 showToast(`${summary.succeeded} approved, ${summary.failed} failed`, true);
 }
 } else {
 showToast(data.error || 'Bulk approval failed', true);
 }
 } catch (err) { showToast('Connection error', true);
 }
}
async function bulkReject() {
 const selectedIds = Array.from(selectedInfluencers);
 
 if (selectedIds.length === 0) {
 showToast('No influencers selected', true);
 return;
 }
 
 const pendingIds = selectedIds.filter(id => {
 const inf = influencersData.find(i => String(i.id) === String(id));
 return inf && inf.status === 'pending';
 });
 
 if (pendingIds.length === 0) {
 showToast('No pending applications in selection', true);
 return;
 }
 
 if (!confirm(`Reject ${pendingIds.length} application(s)? Their Shopify price rules will be disabled.`)) return;
 
 try {
 const res = await fetch(`${API}/bulk-reject`, {
 method: 'POST',
 headers: { 
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${authToken}` 
 },
 body: JSON.stringify({ ids: pendingIds })
 });
 
 if (res.status === 401) { handleLogout(); return; }
 
 const data = await res.json();
 
 if (data.success) {
 const { summary } = data;
 clearSelection();
 await loadDashboard();
 
 if (summary.failed === 0) {
 showToast(`${summary.succeeded} application(s) rejected`);
 } else {
 showToast(`${summary.succeeded} rejected, ${summary.failed} failed`, true);
 }
 } else {
 showToast(data.error || 'Bulk rejection failed', true);
 }
 } catch (err) { showToast('Connection error', true);
 }
}
// ─── HELPERS ─────────────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function esc(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function updateTimestamp() {
 const el = document.getElementById('iaLastUpdated');
 if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
// ─── SHOPIFY USAGE SYNC ─────────────────────────────────────────────────────
async function syncShopifyUsage() {
 const btn = document.getElementById('syncShopifyBtn');
 if (!btn || !authToken) return;
 
 const originalHTML = btn.innerHTML;
 btn.disabled = true;
 btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ia-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Syncing...';
 
 try {
 const response = await fetch('https://exchange-return-tracking.onrender.com/api/admin/trigger-shopify-sync', {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${authToken}`
 }
 });
 
 const data = await response.json();
 
 if (data.success) {
 btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Syncing Started!';
 
 // Reload influencer data after 3 seconds to show updated usage
 setTimeout(() => {
 loadInfluencers();
 updateTimestamp();
 }, 3000);
 
 setTimeout(() => {
 btn.innerHTML = originalHTML;
 btn.disabled = false;
 }, 2000);
 } else {
 btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ' + (data.message || 'Sync Failed');
 setTimeout(() => {
 btn.innerHTML = originalHTML;
 btn.disabled = false;
 }, 3000);
 }
 } catch (error) { btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Error';
 setTimeout(() => {
 btn.innerHTML = originalHTML;
 btn.disabled = false;
 }, 3000);
 }
}
// ─── PAGE NAVIGATION ─────────────────────────────────────────────────────────
function showPage(pageName, navItem) {
 // Update nav active state
 document.querySelectorAll('.ia-nav-item').forEach(item => item.classList.remove('active'));
 navItem.classList.add('active');
 
 // Hide all pages
 document.getElementById('page-ambassadors').style.display = 'none';
 document.getElementById('page-shipments-reels').style.display = 'none';
 document.getElementById('page-leaderboard').style.display = 'none';
 document.getElementById('page-messages').classList.add('hidden');
 
 // Show selected page
 if (pageName === 'messages') {
   document.getElementById('page-messages').classList.remove('hidden');
 } else {
   document.getElementById(`page-${pageName}`).style.display = 'block';
 }
 
 // Stop polling when leaving messages page
 if (pageName !== 'messages') {
   stopMessagePolling();
 }
 
 // Load page-specific data
 if (pageName === 'shipments-reels') {
 // Set default month/year to current
 const now = new Date();
 document.getElementById('srTargetMonth').value = now.getMonth() + 1;
 document.getElementById('srTargetYear').value = now.getFullYear();
 loadMonthlyTargets();
 loadProductRequests();
 } else if (pageName === 'leaderboard') {
 loadFullLeaderboard('30d');
 } else if (pageName === 'messages') {
 showMessagesPage();
 }
}
// ─── SHIPMENTS & REELS TAB SWITCHING ─────────────────────────────────────────
function switchSRTab(tabName, btnEl) {
 // Update button active state
 document.querySelectorAll('[data-srtab]').forEach(b => b.classList.remove('active'));
 btnEl.classList.add('active');
 
 // Hide all tabs
 document.querySelectorAll('.sr-tab-content').forEach(tab => tab.style.display = 'none');
 
 // Show selected tab
 document.getElementById(`sr-tab-${tabName}`).style.display = 'block';
 
 // Load tab data
 if (tabName === 'monthly-targets') {
 loadMonthlyTargets();
 } else if (tabName === 'inventory') {
 searchShopifyProducts();
 } else if (tabName === 'product-requests') {
 loadProductRequests();
 } else if (tabName === 'all-shipments') {
 loadAllShipments();
 }
}
// ── FULL LEADERBOARD ────────────────────────────────────────────────────────
let currentLeaderboardData = [];
let currentLeaderboardRange = '30d';
async function loadFullLeaderboard(range = '30d', btnEl) {
 if (btnEl) {
 document.querySelectorAll('.ia-lb-range-btn').forEach(b => b.classList.remove('active'));
 btnEl.classList.add('active');
 }
 
 currentLeaderboardRange = range;
 
 try {
 const res = await fetch(`${API}/leaderboard?range=${range}&limit=100`, { 
 headers: { 'Authorization': `Bearer ${authToken}` } 
 });
 const data = await res.json();
 
 if (!data.success || !data.leaderboard || data.leaderboard.length === 0) {
 document.getElementById('lbPodium').innerHTML = '<div class="ia-lb-podium-loading">No data available</div>';
 document.getElementById('lbFullTableBody').innerHTML = '<tr><td colspan="8" class="ia-lb-table-loading">No rankings available</td></tr>';
 return;
 }
 
 currentLeaderboardData = data.leaderboard;
 
 // Calculate stats
 const totalRevenue = data.leaderboard.reduce((sum, item) => sum + item.revenue, 0);
 const totalOrders = data.leaderboard.reduce((sum, item) => sum + item.orders, 0);
 const activeInfluencers = data.leaderboard.length;
 const avgRevenue = totalRevenue / activeInfluencers;
 
 // Update stat cards
 document.getElementById('lbTotalRevenue').textContent = `₹${fmt(totalRevenue)}`;
 document.getElementById('lbTotalOrders').textContent = fmt(totalOrders);
 document.getElementById('lbActiveInfluencers').textContent = activeInfluencers;
 document.getElementById('lbAvgRevenue').textContent = `₹${fmt(avgRevenue)}`;
 
 // Render podium (top 3)
 renderPodium(data.leaderboard.slice(0, 3));
 
 // Render full table
 renderFullTable(data.leaderboard);
 
 } catch (e) { document.getElementById('lbPodium').innerHTML = '<div class="ia-lb-podium-loading">Failed to load</div>';
 document.getElementById('lbFullTableBody').innerHTML = '<tr><td colspan="8" class="ia-lb-table-loading">Failed to load rankings</td></tr>';
 }
}
function renderPodium(top3) {
 const podium = document.getElementById('lbPodium');
 
 if (top3.length === 0) {
 podium.innerHTML = '<div class="ia-lb-podium-loading">No data</div>';
 return;
 }
 
 // Reorder for display: 2nd, 1st, 3rd
 const displayOrder = [top3[1], top3[0], top3[2]].filter(Boolean);
 
 podium.innerHTML = `
 <div class="ia-lb-podium">
 ${displayOrder.map((item, idx) => {
 const rank = idx === 0 ? 2 : (idx === 1 ? 1 : 3);
 if (!item) return '';
 const initials = item.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
 return `
 <div class="ia-lb-podium-item rank-${rank}">
 <div class="ia-lb-podium-avatar">
 ${initials}
 <div class="ia-lb-podium-badge">#${rank}</div>
 </div>
 <div class="ia-lb-podium-name">${esc(item.name)}</div>
 <div class="ia-lb-podium-code">${esc(item.referral_code)}</div>
 <div class="ia-lb-podium-revenue">₹${fmt(item.revenue)}</div>
 <div class="ia-lb-podium-orders">${item.orders} orders</div>
 <div class="ia-lb-podium-bar"></div>
 </div>
 `;
 }).join('')}
 </div>
 `;
}
function renderFullTable(data) {
 const tbody = document.getElementById('lbFullTableBody');
 
 if (data.length === 0) {
 tbody.innerHTML = '<tr><td colspan="8" class="ia-lb-no-results">No influencers found</td></tr>';
 return;
 }
 
 tbody.innerHTML = data.map(item => {
 const initials = item.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
 const avgOrderValue = item.orders > 0 ? item.revenue / item.orders : 0;
 const commission = item.revenue * 0.07; // 7% commission
 const rankClass = item.rank <= 3 ? `rank-${item.rank}` : '';
 
 return `
 <tr>
 <td>
 <span class="ia-lb-rank-badge ${rankClass}">${item.rank}</span>
 </td>
 <td>
 <div class="ia-lb-influencer-cell">
 <div class="ia-lb-influencer-avatar">${initials}</div>
 <div class="ia-lb-influencer-name">${esc(item.name)}</div>
 </div>
 </td>
 <td><span class="ia-lb-code">${esc(item.referral_code)}</span></td>
 <td class="ia-lb-revenue-cell">₹${fmt(item.revenue)}</td>
 <td>${item.orders}</td>
 <td>₹${fmt(avgOrderValue)}</td>
 <td>₹${fmt(commission)}</td>
 <td><span class="ia-lb-status-badge active">Active</span></td>
 </tr>
 `;
 }).join('');
}
function filterLeaderboard() {
 const searchTerm = document.getElementById('lbSearchInput').value.toLowerCase();
 
 if (!searchTerm) {
 renderFullTable(currentLeaderboardData);
 return;
 }
 
 const filtered = currentLeaderboardData.filter(item => 
 item.name.toLowerCase().includes(searchTerm) ||
 item.referral_code.toLowerCase().includes(searchTerm)
 );
 
 renderFullTable(filtered);
}
// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
async function loadLeaderboard(range = '30d', btnEl) {
 if (btnEl) {
 document.querySelectorAll('.ia-lb-range-btn').forEach(b => b.classList.remove('active'));
 btnEl.classList.add('active');
 }
 const body = document.getElementById('leaderboardBody');
 body.innerHTML = '<div class="ia-lb-empty">Loading...</div>';
 try {
 const res = await fetch(`${API}/leaderboard?range=${range}&limit=10`, { headers: { 'Authorization': `Bearer ${authToken}` }});
 const data = await res.json();
 if (!data.success || !data.leaderboard || data.leaderboard.length === 0) {
 body.innerHTML = '<div class="ia-lb-empty">No data available</div>';
 return;
 }
 const maxRevenue = Math.max(...data.leaderboard.map(r => r.revenue), 1);
 body.innerHTML = `
 <table class="ia-lb-table">
 <thead><tr><th>Rank</th><th>Name</th><th>Code</th><th>Revenue</th><th>Orders</th></tr></thead>
 <tbody>${data.leaderboard.map(r => `
 <tr>
 <td><span class="ia-lb-rank ${r.rank === 1 ? 'top1' : ''}">${r.rank}</span></td>
 <td class="ia-lb-name">${esc(r.name)}</td>
 <td style="color: var(--muted); font-size: 0.75rem;">${esc(r.referral_code)}</td>
 <td class="ia-lb-revenue">₹${fmt(r.revenue)}</td>
 <td>${r.orders}</td>
 </tr>
 `).join('')}</tbody>
 </table>
 `;
 } catch (e) { body.innerHTML = '<div class="ia-lb-empty">Failed to load</div>';
 }
}
// ─── TABS ────────────────────────────────────────────────────────────────────
function switchTab(tabName, btnEl) {
 document.querySelectorAll('.ia-tab-btn').forEach(b => b.classList.remove('active'));
 document.querySelectorAll('.ia-tab-content').forEach(c => c.classList.remove('active'));
 btnEl.classList.add('active');
 document.getElementById(`tab-${tabName}`).classList.add('active');
}
// ─── ANALYTICS LOADER ────────────────────────────────────────────────────────
let currentAnalyticsInfluencerId = null;
async function loadAnalytics(id) {
 currentAnalyticsInfluencerId = id;
 try {
 const res = await fetch(`${API}/analytics/${id}?range=all`, { headers: { 'Authorization': `Bearer ${authToken}` }});
 const data = await res.json();
 if (!data.success) return;
 // Update overview stats
 document.getElementById('statTotalRevenue').textContent = `₹${fmt(data.summary.totalRevenue)}`;
 document.getElementById('statTotalOrders').textContent = data.summary.totalOrders;
 document.getElementById('statAov').textContent = `₹${fmt(data.summary.aov)}`;
 document.getElementById('statEarnings').textContent = `₹${fmt(data.summary.estimatedEarnings)}`;
 document.getElementById('statCommissionRate').textContent = `${data.summary.commissionRate}% commission`;
 // Monthly bars
 renderMonthlyBars(data.monthly);
 // Shipments
 renderShipmentsTable(data.shipments.items);
 // Payouts
 renderPayoutsTable(data.payouts.items);
 } catch (e) { }
}
function renderMonthlyBars(monthly) {
 const container = document.getElementById('monthlyBars');
 if (!monthly || monthly.length === 0) {
 container.innerHTML = '<div style="text-align:center; padding: 1rem; color: var(--muted); font-size: 0.75rem;">No monthly data</div>';
 return;
 }
 const maxRev = Math.max(...monthly.map(m => m.revenue), 1);
 const top6 = monthly.slice(0, 6).reverse();
 container.innerHTML = top6.map(m => `
 <div class="ia-monthly-bar-row">
 <div class="ia-monthly-bar-label">${m.month}</div>
 <div class="ia-monthly-bar-track">
 <div class="ia-monthly-bar-fill" style="width: ${(m.revenue / maxRev * 100).toFixed(1)}%;"></div>
 <div class="ia-monthly-bar-value">₹${fmt(m.revenue)}</div>
 </div>
 </div>
 `).join('');
}
// ─── SHIPMENTS ───────────────────────────────────────────────────────────────
function openAddShipmentForm() { document.getElementById('addShipmentForm').style.display = 'block'; }
function closeAddShipmentForm() { document.getElementById('addShipmentForm').style.display = 'none'; }
async function submitShipment() {
 const productTitle = document.getElementById('shipProductTitle').value.trim();
 const sentAt = document.getElementById('shipSentAt').value;
 const reelDueDate = document.getElementById('shipDueDate').value;
 const productImageUrl = document.getElementById('shipImage').value.trim();
 if (!productTitle || !sentAt || !reelDueDate) { showToast('Fill all required fields', true); return; }
 try {
 const res = await fetch(`${API}/shipments/${currentAnalyticsInfluencerId}`, {
 method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ productTitle, sentAt, reelDueDate, productImageUrl })
 });
 const data = await res.json();
 if (data.success) {
 showToast('Shipment added');
 closeAddShipmentForm();
 loadAnalytics(currentAnalyticsInfluencerId);
 } else { showToast(data.error || 'Failed', true); }
 } catch (e) { showToast('Network error', true); }
}
async function markShipmentReceived(shipmentId) {
 const reelUrl = prompt('Enter Reel URL:');
 if (!reelUrl) return;
 try {
 const res = await fetch(`${API}/shipments/${shipmentId}`, {
 method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ reelUrl, reelStatus: 'received' })
 });
 const data = await res.json();
 if (data.success) { showToast('Marked as received'); loadAnalytics(currentAnalyticsInfluencerId); }
 else showToast(data.error || 'Failed', true);
 } catch (e) { showToast('Network error', true); }
}
async function deleteShipmentItem(shipmentId) {
 if (!confirm('Delete this shipment?')) return;
 try {
 const res = await fetch(`${API}/shipments/${shipmentId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` }});
 const data = await res.json();
 if (data.success) { showToast('Deleted'); loadAnalytics(currentAnalyticsInfluencerId); }
 else showToast(data.error || 'Failed', true);
 } catch (e) { showToast('Network error', true); }
}
function renderShipmentsTable(items) {
 const tbody = document.getElementById('shipmentsTableBody');
 if (!items || items.length === 0) {
 tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--muted);">No shipments</td></tr>';
 return;
 }
 tbody.innerHTML = items.map(s => `
 <tr>
 <td>${esc(s.product_title)}</td>
 <td>${new Date(s.sent_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
 <td>${new Date(s.reel_due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
 <td><span class="ia-badge ${s.reel_status}">${s.reel_status}</span></td>
 <td>${s.reel_url ? `<a href="${esc(s.reel_url)}" target="_blank" style="color: var(--text); font-size: 0.7rem;">View</a>` : '—'}</td>
 <td class="ia-ship-actions">
 ${s.reel_status !== 'received' ? `<button class="ia-ship-btn-sm" onclick="markShipmentReceived(${s.id})">Mark Received</button>` : ''}
 <button class="ia-ship-btn-sm" onclick="deleteShipmentItem(${s.id})">Delete</button>
 </td>
 </tr>
 `).join('');
}
// ─── PAYOUTS ─────────────────────────────────────────────────────────────────
async function generatePayouts() {
 const month = prompt('Enter month (YYYY-MM):', new Date().toISOString().substring(0, 7));
 if (!month || !/^\d{4}-\d{2}$/.test(month)) { showToast('Invalid format', true); return; }
 try {
 const res = await fetch(`${API.replace('/influencer-admin', '/influencer-admin')}/payouts/generate`, {
 method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ month })
 });
 const data = await res.json();
 if (data.success) { showToast(`Generated ${data.generated} payouts`); loadAnalytics(currentAnalyticsInfluencerId); }
 else showToast(data.error || 'Failed', true);
 } catch (e) { showToast('Network error', true); }
}
async function togglePayoutStatus(payoutId, currentStatus) {
 const newStatus = currentStatus === 'paid' ? 'pending' : 'paid';
 try {
 const res = await fetch(`${API}/payouts/item/${payoutId}`, {
 method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ status: newStatus })
 });
 const data = await res.json();
 if (data.success) { showToast(`Marked as ${newStatus}`); loadAnalytics(currentAnalyticsInfluencerId); }
 else showToast(data.error || 'Failed', true);
 } catch (e) { showToast('Network error', true); }
}
function renderPayoutsTable(items) {
 const tbody = document.getElementById('payoutsTableBody');
 if (!items || items.length === 0) {
 tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--muted);">No payouts generated</td></tr>';
 return;
 }
 tbody.innerHTML = items.map(p => `
 <tr>
 <td>${p.month}</td>
 <td>${p.orders_count || 0}</td>
 <td>₹${fmt(parseFloat(p.revenue_amount || 0))}</td>
 <td>${p.commission_rate}%</td>
 <td style="font-weight: 700;">₹${fmt(parseFloat(p.amount_due || 0))}</td>
 <td><span class="ia-badge ${p.status === 'paid' ? 'paid' : 'unpaid'}">${p.status}</span></td>
 <td><button class="ia-payout-toggle ${p.status === 'paid' ? 'paid' : ''}" onclick="togglePayoutStatus(${p.id}, '${p.status}')">${p.status === 'paid' ? 'Paid ✓' : 'Mark Paid'}</button></td>
 </tr>
 `).join('');
}
// Hook viewInfluencerStats to also load analytics
const origViewInfluencerStats = viewInfluencerStats;
viewInfluencerStats = function(id) {
 origViewInfluencerStats(id);
 loadAnalytics(id);
 loadLeaderboard('30d');
};
// ==================== SHIPMENTS & REELS FUNCTIONS ====================
// Load monthly targets
async function loadMonthlyTargets() {
 const month = document.getElementById('srTargetMonth').value;
 const year = document.getElementById('srTargetYear').value;
 
 try {
 const res = await fetch(`${API}/reel-targets?month=${month}&year=${year}`, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 const data = await res.json();
 
 if (data.success) {
 // Show summary
 document.getElementById('srTargetSummary').style.display = 'grid';
 document.getElementById('srTotalInfluencers').textContent = data.summary.totalInfluencers;
 document.getElementById('srOnTrack').textContent = data.summary.onTrack;
 document.getElementById('srBehind').textContent = data.summary.behind;
 document.getElementById('srCompleted').textContent = data.summary.completed;
 
 // Render targets grid
 const grid = document.getElementById('srTargetsGrid');
 if (data.targets.length === 0) {
 grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--muted);"><p>No targets set for this month</p></div>';
 return;
 }
 
 grid.innerHTML = data.targets.map(t => {
 const statusColor = t.completionPercentage >= 100 ? 'var(--success)' : t.completionPercentage >= 50 ? 'var(--warning)' : 'var(--danger)';
 return `
 <div style="border: 1px solid var(--border); background: var(--surface); padding: 1.25rem;">
 <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
 <div>
 <div style="font-weight: 600; font-size: 0.95rem;">${t.influencerName}</div>
 <div style="font-size: 0.7rem; color: var(--muted);">${t.referralCode}</div>
 </div>
 <button class="ia-btn ia-btn-ghost" onclick="editReelTarget('${t.influencerId}', ${t.targetCount})" style="padding: 0.3rem 0.6rem; font-size: 0.65rem;">Edit</button>
 </div>
 <div style="margin-bottom: 0.75rem;">
 <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 0.4rem;">
 <span style="color: var(--muted);">Progress</span>
 <span style="font-weight: 600; color: ${statusColor};">${t.submittedCount}/${t.targetCount} (${t.completionPercentage}%)</span>
 </div>
 <div style="height: 6px; background: var(--subtle); position: relative; overflow: hidden;">
 <div style="height: 100%; width: ${Math.min(t.completionPercentage, 100)}%; background: ${statusColor}; transition: width 0.5s ease;"></div>
 </div>
 </div>
 <div style="font-size: 0.7rem; color: var(--muted); display: flex; justify-content: space-between;">
 <span>Pending: ${t.pendingCount}</span>
 <span>Overdue: ${t.overdueCount}</span>
 </div>
 </div>
 `;
 }).join('');
 }
 } catch (e) { }
}
// Open reel target modal
// Open Set Monthly Target Modal
function openReelTargetModal() {
 const month = document.getElementById('srTargetMonth').value;
 const year = document.getElementById('srTargetYear').value;
 
 // Create modal
 const modal = document.createElement('div');
 modal.id = 'srTargetModal';
 modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 2rem;';
 
 modal.innerHTML = `
 <div style="background: var(--surface); border: 1px solid var(--border); width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; padding: 2rem;">
 <h3 style="font-size: 0.8rem; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 1.5rem;">Set Monthly Reel Target</h3>
 
 <div style="padding: 1rem; background: var(--subtle); margin-bottom: 1.5rem; border-left: 3px solid var(--text);">
 <p style="font-size: 0.85rem; font-weight: 600; margin: 0;">Period: ${getMonthName(month)} ${year}</p>
 </div>
 
 <div class="ia-form-group">
 <label for="rtInfluencer">Select Influencer *</label>
 <select id="rtInfluencer" class="ia-input" required>
 <option value="">Choose influencer...</option>
 </select>
 </div>
 
 <div class="ia-form-group">
 <label for="rtTargetCount">Monthly Reel Target *</label>
 <input type="number" id="rtTargetCount" class="ia-input" min="1" max="30" value="3" required>
 <p style="font-size: 0.7rem; color: var(--muted); margin-top: 0.3rem;">Recommended: 3-5 reels per month</p>
 </div>
 
 <div class="ia-form-group">
 <label for="rtNotes">Notes (Optional)</label>
 <textarea id="rtNotes" class="ia-input" rows="3" placeholder="Any specific instructions or campaign details..." style="resize: vertical;"></textarea>
 </div>
 
 <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
 <button onclick="closeReelTargetModal()" style="flex: 1; padding: 0.8rem; background: transparent; border: 1px solid var(--border); color: var(--text); cursor: pointer; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600;">Cancel</button>
 <button onclick="saveReelTarget(${month}, ${year})" style="flex: 1; padding: 0.8rem; background: var(--text); border: 1px solid var(--text); color: var(--bg); cursor: pointer; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600;">Save Target</button>
 </div>
 </div>
 `;
 
 document.body.appendChild(modal);
 
 // Load influencers into select
 loadInfluencersForTarget();
}
function closeReelTargetModal() {
 const modal = document.getElementById('srTargetModal');
 if (modal) modal.remove();
}
async function loadInfluencersForTarget() {
 try {
 const res = await fetch(`${API}/list`, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 const data = await res.json();
 
 if (data.success || Array.isArray(data)) {
 const influencers = Array.isArray(data) ? data : (data.influencers || []);
 const select = document.getElementById('rtInfluencer');
 select.innerHTML = '<option value="">Choose influencer...</option>' + 
 influencers.map(i => `<option value="${i.id}">${i.name || i.handle || 'Influencer'}</option>`).join('');
 }
 } catch (e) { }
}
async function saveReelTarget(month, year) {
 const influencerId = document.getElementById('rtInfluencer').value;
 const targetCount = parseInt(document.getElementById('rtTargetCount').value);
 const notes = document.getElementById('rtNotes').value.trim();
 
 if (!influencerId) {
 alert('Please select an influencer');
 return;
 }
 if (!targetCount || targetCount < 1) {
 alert('Target must be at least 1');
 return;
 }
 
 try {
 const res = await fetch(`${API}/reel-targets`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${authToken}`
 },
 body: JSON.stringify({
 influencerId,
 month,
 year,
 targetCount,
 notes: notes || null
 })
 });
 
 const data = await res.json();
 
 if (data.success) {
 showToast('Monthly target set successfully!');
 closeReelTargetModal();
 loadMonthlyTargets();
 } else {
 alert(data.error || 'Failed to set target');
 }
 } catch (e) {
 alert('Network error. Please try again.');
 }
}
// Edit existing reel target
function editReelTarget(influencerId, currentTarget) {
 const month = document.getElementById('srTargetMonth').value;
 const year = document.getElementById('srTargetYear').value;
 
 const modal = document.createElement('div');
 modal.id = 'srEditTargetModal';
 modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 2rem;';
 
 modal.innerHTML = `
 <div style="background: var(--surface); border: 1px solid var(--border); width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; padding: 2rem;">
 <h3 style="font-size: 0.8rem; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 1.5rem;">Edit Monthly Target</h3>
 
 <div style="padding: 1rem; background: var(--subtle); margin-bottom: 1.5rem; border-left: 3px solid var(--text);">
 <p style="font-size: 0.85rem; font-weight: 600; margin: 0;">Period: ${getMonthName(month)} ${year}</p>
 <p style="font-size: 0.75rem; color: var(--muted); margin: 0.3rem 0 0 0;">Current Target: ${currentTarget} reels</p>
 </div>
 
 <div class="ia-form-group">
 <label for="etTargetCount">New Monthly Target *</label>
 <input type="number" id="etTargetCount" class="ia-input" min="1" max="30" value="${currentTarget}" required>
 <p style="font-size: 0.7rem; color: var(--muted); margin-top: 0.3rem;">Recommended: 3-5 reels per month</p>
 </div>
 
 <div class="ia-form-group">
 <label for="etNotes">Update Notes (Optional)</label>
 <textarea id="etNotes" class="ia-input" rows="3" placeholder="Reason for changing target..." style="resize: vertical;"></textarea>
 </div>
 
 <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
 <button onclick="closeEditTargetModal()" style="flex: 1; padding: 0.8rem; background: transparent; border: 1px solid var(--border); color: var(--text); cursor: pointer; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600;">Cancel</button>
 <button onclick="updateReelTarget('${influencerId}', ${month}, ${year})" style="flex: 1; padding: 0.8rem; background: var(--text); border: 1px solid var(--text); color: var(--bg); cursor: pointer; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600;">Update Target</button>
 </div>
 </div>
 `;
 
 document.body.appendChild(modal);
}
function closeEditTargetModal() {
 const modal = document.getElementById('srEditTargetModal');
 if (modal) modal.remove();
}
async function updateReelTarget(influencerId, month, year) {
 const targetCount = parseInt(document.getElementById('etTargetCount').value);
 const notes = document.getElementById('etNotes').value.trim();
 
 if (!targetCount || targetCount < 1) {
 alert('Target must be at least 1');
 return;
 }
 
 try {
 const res = await fetch(`${API}/reel-targets`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${authToken}`
 },
 body: JSON.stringify({
 influencerId,
 month,
 year,
 targetCount,
 notes: notes || null
 })
 });
 
 const data = await res.json();
 
 if (data.success) {
 showToast('Target updated successfully!');
 closeEditTargetModal();
 loadMonthlyTargets();
 } else {
 alert(data.error || 'Failed to update target');
 }
 } catch (e) {
 alert('Network error. Please try again.');
 }
}
function getMonthName(monthNum) {
 const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
 return months[parseInt(monthNum) - 1];
}
// Search Shopify products with "Show More" infinite loading
let srCurrentPage = 1;
const SR_PRODUCTS_PER_PAGE = 20;
let srAllLoadedProducts = []; // Accumulates all loaded products
let srHasMoreProducts = false;
let srTotalProductCount = 0;

async function searchShopifyProducts(page = 1, append = false) {
 const search = document.getElementById('srProductSearch').value;
 const grid = document.getElementById('srProductGrid');
 const showMoreWrap = document.getElementById('srShowMoreWrap');
 const toolbarEl = document.getElementById('srBulkToolbar');

 if (!append) {
   // Fresh search — reset everything
   srCurrentPage = 1;
   srAllLoadedProducts = [];
   window.srSelectedProducts = new Set();
   grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--muted);"><div class="ia-spinner" style="margin: 0 auto 1rem;"></div><p class="form-input-sm">Loading available inventory...</p></div>';
   if (showMoreWrap) showMoreWrap.style.display = 'none';
   if (toolbarEl) toolbarEl.style.display = 'none';
 } else {
   srCurrentPage = page;
 }

 try {
 const res = await fetch(`${API}/shopify-products?search=${encodeURIComponent(search)}&limit=${SR_PRODUCTS_PER_PAGE}&page=${page}`, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 const data = await res.json();

 if (data.success && data.products && data.products.length > 0) {
   // Accumulate products
   if (append) {
     srAllLoadedProducts = srAllLoadedProducts.concat(data.products);
   } else {
     srAllLoadedProducts = data.products.slice();
   }
   window.srCurrentProducts = srAllLoadedProducts;
   srTotalProductCount = data.pagination ? data.pagination.totalProducts : srAllLoadedProducts.length;
   srHasMoreProducts = data.pagination ? data.pagination.hasNextPage : false;

   if (append) {
     // Append only the new products to the grid
     const newProducts = data.products;
     const fragment = document.createElement('div');
     fragment.innerHTML = newProducts.map(p => buildProductCardHtml(p)).join('');
     while (fragment.firstElementChild) {
       grid.appendChild(fragment.firstElementChild);
     }
   } else {
     // Full render
     grid.innerHTML = srAllLoadedProducts.map(p => buildProductCardHtml(p)).join('');
   }

   // Restore checkbox state for previously selected products
   window.srSelectedProducts.forEach(pid => {
     const cb = document.getElementById(`select-product-${pid}`);
     const card = document.getElementById(`product-card-${pid}`);
     if (cb) cb.checked = true;
     if (card) { card.style.borderColor = 'var(--text, #000)'; card.style.boxShadow = '0 0 0 2px var(--text, #000)'; }
   });

   // Show bulk toolbar
   if (toolbarEl) toolbarEl.style.display = 'flex';

   // Update show more button
   const showMoreWrapEl = document.getElementById('srShowMoreWrap');
   const showMoreBtnEl = document.getElementById('srShowMoreBtn');
   const loadedCountEl = document.getElementById('srLoadedCount');
   console.log('[Shopify Products] showMoreWrap:', !!showMoreWrapEl, 'hasMore:', srHasMoreProducts, 'loaded:', srAllLoadedProducts.length, 'total:', srTotalProductCount);
   if (showMoreWrapEl) {
     if (srHasMoreProducts) {
       const loaded = srAllLoadedProducts.length;
       const remaining = srTotalProductCount - loaded;
       showMoreWrapEl.setAttribute('style', 'display:flex!important;flex-direction:column;align-items:center;gap:0.5rem;margin-top:1.5rem;padding:1rem;');
       if (showMoreBtnEl) {
         showMoreBtnEl.style.display = '';
         showMoreBtnEl.textContent = `Show More Products (${remaining} remaining)`;
       }
       if (loadedCountEl) loadedCountEl.textContent = `Showing ${loaded} of ${srTotalProductCount} products`;
     } else {
       if (srAllLoadedProducts.length > SR_PRODUCTS_PER_PAGE) {
         showMoreWrapEl.setAttribute('style', 'display:flex!important;flex-direction:column;align-items:center;gap:0.5rem;margin-top:1.5rem;padding:1rem;');
         if (loadedCountEl) loadedCountEl.textContent = `All ${srTotalProductCount} products loaded`;
         if (showMoreBtnEl) showMoreBtnEl.style.display = 'none';
       } else {
         showMoreWrapEl.style.display = 'none';
       }
     }
   }

   updateSelectionUI();
 } else if (!append) {
 grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--muted);"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="margin-bottom: 1rem; opacity: 0.3;"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg><p class="form-input-sm">No available products found</p><p style="font-size: 0.7rem; margin-top: 0.5rem; color: var(--muted);">All products are currently out of stock or no matches for your search</p></div>';
 }
 } catch (e) {
   if (!append) {
     grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--danger, #ef4444);"><p class="form-input-sm">Failed to load products</p><p style="font-size: 0.7rem; margin-top: 0.5rem; color: var(--muted);">Please check your connection and try again</p><button onclick="searchShopifyProducts()" class="ia-btn" style="margin-top: 1rem; padding: 0.5rem 1.5rem; font-size: 0.7rem;">Retry</button></div>';
   }
 }
}

// Build a single product card HTML (shared by initial load and append)
function buildProductCardHtml(p) {
 const imageUrl = p.images[0]?.src || '';
 const totalStock = p.totalStock || 0;
 const variantCount = p.variants.length;
 const sizesHtml = p.variants.map(v =>
   `<span style="display: inline-block; padding: 0.2rem 0.5rem; font-size: 0.65rem; border: 1px solid var(--border); margin: 0.15rem; background: var(--bg); font-weight: 500;" title="Stock: ${v.inventoryQuantity}">${v.title} <span style="color: var(--success, #22c55e); font-size: 0.6rem;">(${v.inventoryQuantity})</span></span>`
 ).join('');
 const isSelected = window.srSelectedProducts.has(p.id);

 return `
 <div style="border: 1px solid ${isSelected ? 'var(--text, #000)' : 'var(--border)'}; background: var(--surface); overflow: hidden; display: flex; flex-direction: column; transition: border-color 0.2s; position: relative; ${isSelected ? 'box-shadow: 0 0 0 2px var(--text, #000);' : ''}" onmouseenter="this.style.borderColor='var(--text)'" onmouseleave="this.style.borderColor=window.srSelectedProducts.has(${p.id})?'var(--text, #000)':'var(--border)'" id="product-card-${p.id}">
 <div style="position: absolute; top: 0.5rem; left: 0.5rem; z-index: 10;">
 <input type="checkbox" id="select-product-${p.id}" value="${p.id}" onchange="toggleProductSelection(${p.id})" style="width: 20px; height: 20px; cursor: pointer; accent-color: var(--text, #000);" ${isSelected ? 'checked' : ''}>
 </div>
 <div style="position: relative;">
 ${imageUrl ? `<img src="${imageUrl}" style="width: 100%; height: 220px; object-fit: contain; background: var(--subtle);">` : '<div style="width: 100%; height: 220px; background: var(--subtle); display: flex; align-items: center; justify-content: center; color: var(--muted);"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>'}
 <div style="position: absolute; top: 0.5rem; right: 0.5rem; background: ${totalStock > 10 ? 'var(--success, #22c55e)' : totalStock > 3 ? '#f59e0b' : '#ef4444'}; color: white; padding: 0.2rem 0.5rem; font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">${totalStock} in stock</div>
 </div>
 <div style="padding: 1rem; flex: 1; display: flex; flex-direction: column;">
 <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.4rem; line-height: 1.3;">${p.title}</div>
 <div style="font-size: 0.75rem; color: var(--muted); margin-bottom: 0.5rem;">${p.productType || 'Apparel'} ${p.vendor ? '&middot; ' + p.vendor : ''}</div>
 <div style="font-size: 0.9rem; font-weight: 700; margin-bottom: 0.75rem;">&#8377;${p.variants[0]?.price || '0'}</div>
 <div style="margin-bottom: 0.75rem;">
 <div style="font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 0.4rem; font-weight: 600;">Available Sizes (${variantCount})</div>
 <div style="display: flex; flex-wrap: wrap; gap: 0;">${sizesHtml}</div>
 </div>
 <div style="display: flex; gap: 0.5rem; margin-top: auto;">
 <button class="ia-btn" onclick='assignProductToInfluencer(${JSON.stringify(p).replace(/'/g, "&apos;")})' style="flex: 1; padding: 0.6rem; font-size: 0.7rem; letter-spacing: 0.1em;">
 Assign Single
 </button>
 </div>
 </div>
 </div>
 `;
}
// Global variable to store current product being assigned
let currentAssignProduct = null;
// Assign product to influencer with complete modal
function assignProductToInfluencer(product) {
 // Store product globally for access in save function
 currentAssignProduct = product;
 
 const productId = product.id;
 const productTitle = product.title;
 const imageUrl = product.images[0]?.src || '';
 const variants = product.variants || [];
 
 const modal = document.createElement('div');
 modal.id = 'srAssignModal';
 modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 2rem; backdrop-filter: blur(4px);';
 
 const sizeOptionsHtml = variants.length > 1 
 ? variants.map((v, i) => `<option value="${v.id}" ${i === 0 ? 'selected' : ''}>${v.title} - Stock: ${v.inventoryQuantity}</option>`).join('')
 : `<option value="${variants[0]?.id}" selected>${variants[0]?.title || 'Default'} - Stock: ${variants[0]?.inventoryQuantity || 0}</option>`;
 
 modal.innerHTML = `
 <div style="background: var(--surface); border: 1px solid var(--border); width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; padding: 2rem;">
 <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
 <h3 style="font-size: 0.8rem; letter-spacing: 0.2em; text-transform: uppercase; margin: 0;">Assign Product & Create Shipment</h3>
 <button onclick="closeAssignProductModal()" style="background: transparent; border: none; color: var(--text); cursor: pointer; font-size: 1.5rem; line-height: 1;">&times;</button>
 </div>
 
 ${imageUrl ? `<img src="${imageUrl}" style="width: 100%; height: 200px; object-fit: contain; background: var(--subtle); margin-bottom: 1rem; border: 1px solid var(--border);">` : ''}
 
 <div style="padding: 1rem; background: var(--subtle); margin-bottom: 1.5rem; border-left: 3px solid var(--text);">
 <p style="font-size: 0.85rem; font-weight: 600; margin: 0;">Product: ${productTitle}</p>
 <p style="font-size: 0.7rem; color: var(--muted); margin: 0.3rem 0 0;">${product.productType || ''} ${product.vendor ? '&middot; ' + product.vendor : ''}</p>
 </div>
 
 <div class="ia-form-group">
 <label for="apSize" class="form-label">Select Size/Variant *</label>
 <select id="apSize" class="ia-input" required class="form-input">
 ${sizeOptionsHtml}
 </select>
 <span style="font-size: 0.65rem; color: var(--success, #22c55e); margin-top: 0.3rem; display: block;">Only showing variants with available stock</span>
 </div>
 
 <div class="ia-form-group">
 <label for="apInfluencer" class="form-label">Select Influencer *</label>
 <select id="apInfluencer" class="ia-input" required class="form-input">
 <option value="">Choose influencer...</option>
 </select>
 </div>
 
 <div class="ia-form-group">
 <label for="apReelDueDate" class="form-label">Reel Due Date (Optional)</label>
 <input type="date" id="apReelDueDate" class="ia-input" min="${new Date().toISOString().split('T')[0]}" class="form-input">
 <span style="font-size: 0.65rem; color: var(--muted); margin-top: 0.3rem; display: block;">Leave blank for inventory-based shipments without reel requirement</span>
 </div>
 
 <div style="padding: 1rem; background: #4facfe10; border-left: 3px solid #4facfe; margin: 1rem 0;">
 <p style="font-size: 0.7rem; color: #4facfe; margin: 0; font-weight: 600;">Shipping Address</p>
 <p style="font-size: 0.65rem; color: var(--muted); margin: 0.3rem 0 0;">Will be auto-filled from influencer profile. Edit if needed.</p>
 </div>
 
 <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
 <div class="ia-form-group">
 <label for="apShipName" class="form-label">Full Name *</label>
 <input type="text" id="apShipName" class="ia-input" required class="form-input">
 </div>
 <div class="ia-form-group">
 <label for="apShipPhone" class="form-label">Phone *</label>
 <input type="text" id="apShipPhone" class="ia-input" required maxlength="10" pattern="[0-9]{10}" class="form-input">
 </div>
 </div>
 
 <div class="ia-form-group">
 <label for="apShipAddress1" class="form-label">Address Line 1 *</label>
 <input type="text" id="apShipAddress1" class="ia-input" required class="form-input">
 </div>
 
 <div class="ia-form-group">
 <label for="apShipAddress2" class="form-label">Address Line 2 (Optional)</label>
 <input type="text" id="apShipAddress2" class="ia-input" class="form-input">
 </div>
 
 <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
 <div class="ia-form-group">
 <label for="apShipCity" class="form-label">City *</label>
 <input type="text" id="apShipCity" class="ia-input" required class="form-input">
 </div>
 <div class="ia-form-group">
 <label for="apShipState" class="form-label">State *</label>
 <input type="text" id="apShipState" class="ia-input" required class="form-input">
 </div>
 <div class="ia-form-group">
 <label for="apShipPincode" class="form-label">Pincode *</label>
 <input type="text" id="apShipPincode" class="ia-input" required maxlength="6" pattern="[0-9]{6}" class="form-input">
 </div>
 </div>
 
 <div class="ia-form-group">
 <label for="apIsMonthlyTarget" class="form-label">Mark as Monthly Target? *</label>
 <select id="apIsMonthlyTarget" class="ia-input" class="form-input">
 <option value="true">Yes - Counts towards monthly reel quota</option>
 <option value="false">No - One-time shipment</option>
 </select>
 </div>
 
 <div class="ia-form-group">
 <label for="apNotes" class="form-label">Admin Notes (Optional)</label>
 <textarea id="apNotes" class="ia-input" rows="3" placeholder="Campaign details, special instructions..." style="resize: vertical; font-size: 0.85rem;"></textarea>
 </div>
 
 <div style="padding: 1rem; background: #4facfe10; border-left: 3px solid #4facfe; margin-top: 1rem;">
 <p style="font-size: 0.7rem; color: #4facfe; margin: 0; font-weight: 600;">This will:</p>
 <ul style="font-size: 0.65rem; color: var(--muted); margin: 0.5rem 0 0 1rem; line-height: 1.8;">
 <li>Create a shipment record with selected size</li>
 <li>Mark as "pending" status</li>
 <li>Notify influencer in their portal</li>
 <li>Track reel submission deadline</li>
 </ul>
 </div>
 
 <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
 <button onclick="closeAssignProductModal()" style="flex: 1; padding: 0.8rem; background: transparent; border: 1px solid var(--border); color: var(--text); cursor: pointer; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600; transition: all 0.2s;" onmouseenter="this.style.background='var(--subtle)'" onmouseleave="this.style.background='transparent'">Cancel</button>
 <button onclick="saveProductShipment('${productTitle.replace(/'/g, "\\'")}', '${imageUrl}')" style="flex: 1; padding: 0.8rem; background: var(--text); border: 1px solid var(--text); color: var(--bg); cursor: pointer; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600; transition: opacity 0.2s;" onmouseenter="this.style.opacity='0.85'" onmouseleave="this.style.opacity='1'">Create Shipment</button>
 </div>
 </div>
 `;
 
 document.body.appendChild(modal);
 
 // Load influencers
 loadInfluencersForShipment();
}
function closeAssignProductModal() {
 const modal = document.getElementById('srAssignModal');
 if (modal) modal.remove();
}
async function loadInfluencersForShipment() {
 try {
 const res = await fetch(`${API}/list`, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 const data = await res.json();
 
 if (data.success || Array.isArray(data)) {
 const influencers = Array.isArray(data) ? data : (data.influencers || []);
 const select = document.getElementById('apInfluencer');
 select.innerHTML = '<option value="">Choose influencer...</option>' + 
 influencers.map(i => `<option value="${i.id}">${i.name || i.handle || 'Influencer'}</option>`).join('');
 
 // Add event listener to auto-fill address when influencer is selected
 select.addEventListener('change', function() {
 const selectedInfluencer = influencers.find(i => i.id == this.value);
 if (selectedInfluencer) {
 // Auto-fill shipping address from influencer profile
 document.getElementById('apShipName').value = selectedInfluencer.name || '';
 document.getElementById('apShipPhone').value = selectedInfluencer.phone || '';
 document.getElementById('apShipAddress1').value = selectedInfluencer.shipping_address || '';
 document.getElementById('apShipAddress2').value = '';
 document.getElementById('apShipCity').value = selectedInfluencer.city || '';
 document.getElementById('apShipState').value = selectedInfluencer.shipping_state || '';
 document.getElementById('apShipPincode').value = selectedInfluencer.shipping_pin || '';
 } else {
 // Clear fields if no influencer selected
 document.getElementById('apShipName').value = '';
 document.getElementById('apShipPhone').value = '';
 document.getElementById('apShipAddress1').value = '';
 document.getElementById('apShipAddress2').value = '';
 document.getElementById('apShipCity').value = '';
 document.getElementById('apShipState').value = '';
 document.getElementById('apShipPincode').value = '';
 }
 });
 }
 } catch (e) { }
}
async function saveProductShipment(productTitle, imageUrl) {
 const influencerId = document.getElementById('apInfluencer').value;
 const reelDueDate = document.getElementById('apReelDueDate').value; // Now optional
 const isMonthlyTarget = document.getElementById('apIsMonthlyTarget').value === 'true';
 const notes = document.getElementById('apNotes').value.trim();
 const sizeSelect = document.getElementById('apSize');
 const selectedSize = sizeSelect ? sizeSelect.options[sizeSelect.selectedIndex]?.text.split(' - ')[0] : '';
 const selectedVariantId = sizeSelect ? sizeSelect.value : '';
 
 // Shipping address fields
 const shippingFullName = document.getElementById('apShipName').value.trim();
 const shippingPhone = document.getElementById('apShipPhone').value.trim();
 const shippingAddressLine1 = document.getElementById('apShipAddress1').value.trim();
 const shippingAddressLine2 = document.getElementById('apShipAddress2').value.trim();
 const shippingCity = document.getElementById('apShipCity').value.trim();
 const shippingState = document.getElementById('apShipState').value.trim();
 const shippingPincode = document.getElementById('apShipPincode').value.trim();
 
 if (!influencerId) {
 alert('Please select an influencer');
 return;
 }
 
 // Validate shipping address
 if (!shippingFullName || !shippingPhone || !shippingAddressLine1 || !shippingCity || !shippingState || !shippingPincode) {
 alert('Please fill in all required shipping address fields');
 return;
 }
 
 // Validate phone format
 if (!/^[0-9]{10}$/.test(shippingPhone)) {
 alert('Please enter a valid 10-digit phone number');
 return;
 }
 
 // Validate pincode format
 if (!/^[0-9]{6}$/.test(shippingPincode)) {
 alert('Please enter a valid 6-digit pincode');
 return;
 }
 
 try {
 const res = await fetch(`${API}/shipments`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${authToken}`
 },
 body: JSON.stringify({
 influencerId,
 products: [{
 productTitle: productTitle,
 productImageUrl: imageUrl || null,
 shopifyProductId: currentAssignProduct?.id || null,
 variantId: selectedVariantId || null,
 size: selectedSize || null
 }],
 sentAt: new Date().toISOString(),
 reelDueDate: reelDueDate || null, // Optional
 isMonthlyTarget,
 shippingFullName,
 shippingAddressLine1,
 shippingAddressLine2: shippingAddressLine2 || null,
 shippingCity,
 shippingState,
 shippingPincode,
 shippingPhone,
 notes: notes || null
 })
 });
 
 const data = await res.json();
 
 if (data.success) {
 showToast(data.message || 'Shipment created successfully!');
 closeAssignProductModal();
 // Refresh product grid to update stock counts
 searchShopifyProducts();
 } else {
 alert(data.error || 'Failed to create shipment');
 }
 } catch (e) {
 alert('Network error. Please try again.');
 }
}
// Load product requests
async function loadProductRequests() {
 const status = document.getElementById('srRequestFilter').value;
 
 try {
 let url = `${API}/product-requests`;
 if (status) url += `?status=${status}`;
 
 const res = await fetch(url, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 const data = await res.json();
 
 if (data.success) {
 const tbody = document.getElementById('srRequestsTableBody');
 if (data.requests.length === 0) {
 tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--muted);">No requests found</td></tr>';
 return;
 }
 
 tbody.innerHTML = data.requests.map(r => {
 const statusBadge = getStatusBadge(r.status);
 const actions = r.status === 'pending' ? `
 <button class="ia-btn ia-btn-primary" onclick="approveProductRequest('${r.id}')" style="padding: 0.3rem 0.6rem; font-size: 0.65rem; margin-right: 0.3rem;">Approve</button>
 <button class="ia-btn" onclick="rejectProductRequest('${r.id}')" style="padding: 0.3rem 0.6rem; font-size: 0.65rem; color: var(--danger); border-color: var(--danger);">Reject</button>
 ` : '<span style="font-size: 0.7rem; color: var(--muted);">—</span>';
 
 return `
 <tr>
 <td>
 <div style="font-weight: 600;">${r.influencers?.name || 'Unknown'}</div>
 <div style="font-size: 0.7rem; color: var(--muted);">${r.influencers?.referral_code || ''}</div>
 </td>
 <td>${r.product_title}</td>
 <td style="max-width: 280px; word-wrap: break-word; white-space: normal; line-height: 1.4; font-size: 0.75rem;">${r.reason}</td>
 <td style="font-size: 0.75rem;">${r.shipping_city}, ${r.shipping_state}</td>
 <td>${statusBadge}</td>
 <td style="font-size: 0.75rem;">${new Date(r.created_at).toLocaleDateString()}</td>
 <td>${actions}</td>
 </tr>
 `;
 }).join('');
 }
 } catch (e) { }
}
// Approve product request
async function approveProductRequest(requestId) {
 if (!confirm('Approve this product request and ship via Delhivery?')) return;
 
 try {
 const res = await fetch(`${API}/product-requests/${requestId}/approve`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ autoShip: true })
 });
 const data = await res.json();
 
 if (data.success) {
 showToast('Request approved and shipment booked!');
 loadProductRequests();
 } else {
 showToast(data.error || 'Failed to approve', true);
 }
 } catch (e) {
 showToast('Network error', true);
 }
}
// Reject product request
async function rejectProductRequest(requestId) {
 const reason = prompt('Enter rejection reason (min 10 characters):');
 if (!reason || reason.length < 10) {
 if (reason) showToast('Reason must be at least 10 characters', true);
 return;
 }
 
 try {
 const res = await fetch(`${API}/product-requests/${requestId}/reject`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ rejectionReason: reason })
 });
 const data = await res.json();
 
 if (data.success) {
 showToast('Request rejected');
 loadProductRequests();
 } else {
 showToast(data.error || 'Failed to reject', true);
 }
 } catch (e) {
 showToast('Network error', true);
 }
}
// Load all shipments - Complete implementation
async function loadAllShipments() {
 try {
 const url = `${API}/shipments/all`;
 console.log('Loading shipments from:', url);
 console.log('API base:', API);
 const res = await fetch(url, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 console.log('Response status:', res.status);
 if (!res.ok) {
 console.error('Failed to load shipments:', res.statusText);
 }
 const data = await res.json();
 
 if (data.success) {
 const tbody = document.getElementById('srShipmentsTableBody');
 if (data.shipments.length === 0) {
 tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 3rem; color: var(--muted);">No shipments found</td></tr>';
 return;
 }
 
 tbody.innerHTML = data.shipments.map(s => {
 const reelStatusBadge = s.reel_status ? getStatusBadge(s.reel_status) : '<span style="color: var(--muted); font-size: 0.7rem;">N/A</span>';
 const monthlyTargetBadge = s.is_monthly_target ? '<span style="color: var(--success); font-size: 0.7rem;">✓ Yes</span>' : '<span style="color: var(--muted); font-size: 0.7rem;">No</span>';
 const trackingLink = s.delhivery_tracking_url ? `<a href="${s.delhivery_tracking_url}" target="_blank" style="color: #4facfe; font-size: 0.7rem;">Track</a>` : '<span style="color: var(--muted); font-size: 0.7rem;">—</span>';
 
 return `
 <tr>
 <td>
 <div style="font-weight: 600;">${s.influencers?.name || 'Unknown'}</div>
 <div style="font-size: 0.7rem; color: var(--muted);">${s.influencers?.referral_code || ''}</div>
 </td>
 <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${s.product_title}">${s.product_title}</td>
 <td style="font-size: 0.75rem;">${new Date(s.sent_at || s.created_at).toLocaleDateString()}</td>
 <td style="font-size: 0.75rem;">${s.reel_due_date ? new Date(s.reel_due_date).toLocaleDateString() : '—'}</td>
 <td>${reelStatusBadge}</td>
 <td style="text-align: center;">${monthlyTargetBadge}</td>
 <td style="text-align: center;">${trackingLink}</td>
 <td>
 <button class="ia-btn" onclick="viewShipmentDetails('${s.id}')" style="padding: 0.3rem 0.6rem; font-size: 0.65rem; margin-right: 0.3rem;">View</button>
 ${s.delhivery_awb ? `<button class="ia-btn" onclick="trackShipment('${s.delhivery_awb}')" style="padding: 0.3rem 0.6rem; font-size: 0.65rem; color: #4facfe; border-color: #4facfe;">Track</button>` : ''}
 </td>
 </tr>
 `;
 }).join('');
 }
 } catch (e) { showToast('Failed to load shipments', true);
 }
}
// Open add shipment modal
// Open Add Shipment Modal - Complete manual shipment creation
// Initiate shipment from a product selected during application
function initiateShipmentFromProduct(influencerId, productTitle, productImageUrl) {
 // Close the details modal
 const detailsModal = document.getElementById('iaDetailsModal');
 if (detailsModal) detailsModal.remove();
 
 // Open the add shipment modal and pre-fill fields
 openAddShipmentModal();
 
 // Wait for modal to render, then pre-fill
 setTimeout(() => {
 // Pre-select the influencer
 const infSelect = document.getElementById('asInfluencer');
 if (infSelect) {
 // Wait for options to load
 const checkOptions = setInterval(() => {
 const option = Array.from(infSelect.options).find(o => o.value === String(influencerId));
 if (option) {
 infSelect.value = String(influencerId);
 clearInterval(checkOptions);
 }
 }, 200);
 setTimeout(() => clearInterval(checkOptions), 3000);
 }
 
 // Pre-fill product title
 const titleInput = document.getElementById('asProductTitle');
 if (titleInput) titleInput.value = productTitle || '';
 
 // Pre-fill shipping address from influencer data
 const inf = influencersData.find(i => String(i.id) === String(influencerId));
 if (inf) {
 const nameInput = document.getElementById('asFullName');
 if (nameInput) nameInput.value = inf.name || '';
 const addr1 = document.getElementById('asAddress1');
 if (addr1) addr1.value = inf.shipping_address || '';
 const cityInput = document.getElementById('asCity');
 if (cityInput) cityInput.value = inf.shipping_city || '';
 const stateInput = document.getElementById('asState');
 if (stateInput) stateInput.value = inf.shipping_state || '';
 const pinInput = document.getElementById('asPincode');
 if (pinInput) pinInput.value = inf.shipping_pin || '';
 const phoneInput = document.getElementById('asPhone');
 if (phoneInput) phoneInput.value = inf.phone || '';
 }
 }, 300);
}
function openAddShipmentModal() {
 const modal = document.createElement('div');
 modal.id = 'srAddShipmentModal';
 modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 2rem;';
 
 modal.innerHTML = `
 <div style="background: var(--surface); border: 1px solid var(--border); width: 100%; max-width: 700px; max-height: 90vh; overflow-y: auto; padding: 2rem;">
 <h3 style="font-size: 0.8rem; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 1.5rem;">Create Manual Shipment</h3>
 
 <div style="padding: 1rem; background: #4facfe20; border-left: 3px solid #4facfe; margin-bottom: 1.5rem;">
 <p style="font-size: 0.75rem; color: #4facfe; margin: 0; font-weight: 600;">ℹ️ This will create a shipment and auto-book via Delhivery</p>
 </div>
 
 <div class="ia-form-group">
 <label for="asInfluencer">Select Influencer *</label>
 <select id="asInfluencer" class="ia-input" required>
 <option value="">Choose influencer...</option>
 </select>
 </div>
 
 <div class="ia-form-group">
 <label for="asProductTitle">Product Title *</label>
 <input type="text" id="asProductTitle" class="ia-input" placeholder="e.g. Classic Black T-Shirt" required>
 </div>
 
 <div class="ia-form-group">
 <label for="asReelDueDate">Reel Due Date *</label>
 <input type="date" id="asReelDueDate" class="ia-input" required min="${new Date().toISOString().split('T')[0]}">
 </div>
 
 <div class="ia-form-group">
 <label for="asIsMonthlyTarget">Mark as Monthly Target? *</label>
 <select id="asIsMonthlyTarget" class="ia-input">
 <option value="true">Yes - Counts towards monthly reel quota</option>
 <option value="false">No - One-time shipment</option>
 </select>
 </div>
 
 <div style="border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 1rem;">
 <p style="font-size: 0.75rem; color: var(--muted); margin-bottom: 1rem; font-weight: 600;">SHIPPING ADDRESS</p>
 
 <div class="ia-form-group">
 <label for="asFullName">Full Name *</label>
 <input type="text" id="asFullName" class="ia-input" placeholder="Rahul Sharma" required>
 </div>
 
 <div class="ia-form-group">
 <label for="asAddress1">Address Line 1 *</label>
 <input type="text" id="asAddress1" class="ia-input" placeholder="123 Main Street" required>
 </div>
 
 <div class="ia-form-group">
 <label for="asAddress2">Address Line 2 (Optional)</label>
 <input type="text" id="asAddress2" class="ia-input" placeholder="Apt 4B">
 </div>
 
 <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
 <div class="ia-form-group">
 <label for="asCity">City *</label>
 <input type="text" id="asCity" class="ia-input" placeholder="Mumbai" required>
 </div>
 <div class="ia-form-group">
 <label for="asState">State *</label>
 <input type="text" id="asState" class="ia-input" placeholder="Maharashtra" required>
 </div>
 </div>
 
 <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
 <div class="ia-form-group">
 <label for="asPincode">Pincode * (6 digits)</label>
 <input type="text" id="asPincode" class="ia-input" placeholder="400001" maxlength="6" required>
 </div>
 <div class="ia-form-group">
 <label for="asPhone">Phone * (10 digits)</label>
 <input type="text" id="asPhone" class="ia-input" placeholder="9876543210" maxlength="10" required>
 </div>
 </div>
 </div>
 
 <div class="ia-form-group" style="margin-top: 1rem;">
 <label for="asNotes">Admin Notes (Optional)</label>
 <textarea id="asNotes" class="ia-input" rows="3" placeholder="Campaign details, special instructions..." style="resize: vertical;"></textarea>
 </div>
 
 <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
 <button onclick="closeAddShipmentModal()" style="flex: 1; padding: 0.8rem; background: transparent; border: 1px solid var(--border); color: var(--text); cursor: pointer; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600;">Cancel</button>
 <button onclick="createManualShipment()" style="flex: 1; padding: 0.8rem; background: var(--text); border: 1px solid var(--text); color: var(--bg); cursor: pointer; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; font-weight: 600;">Create & Ship via Delhivery</button>
 </div>
 </div>
 `;
 
 document.body.appendChild(modal);
 
 // Load influencers
 loadInfluencersForAddShipment();
}
function closeAddShipmentModal() {
 const modal = document.getElementById('srAddShipmentModal');
 if (modal) modal.remove();
}
async function loadInfluencersForAddShipment() {
 try {
 const res = await fetch(`${API}/list`, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 const data = await res.json();
 
 if (data.success || Array.isArray(data)) {
 const influencers = Array.isArray(data) ? data : (data.influencers || []);
 const select = document.getElementById('asInfluencer');
 select.innerHTML = '<option value="">Choose influencer...</option>' + 
 influencers.map(i => `<option value="${i.id}">${i.name || i.handle || 'Influencer'}</option>`).join('');

 // Auto-fill shipping address when influencer is selected
 select.addEventListener('change', function() {
   const sel = influencers.find(i => i.id == this.value);
   if (sel) {
     document.getElementById('asFullName').value = sel.name || '';
     document.getElementById('asPhone').value = sel.phone || '';
     document.getElementById('asAddress1').value = sel.shipping_address || '';
     document.getElementById('asAddress2').value = sel.shipping_landmark || '';
     document.getElementById('asCity').value = sel.shipping_city || sel.city || '';
     document.getElementById('asState').value = sel.shipping_state || '';
     document.getElementById('asPincode').value = sel.shipping_pin || '';
   }
 });
 }
 } catch (e) { }
}
async function createManualShipment() {
 const influencerId = document.getElementById('asInfluencer').value;
 const productTitle = document.getElementById('asProductTitle').value.trim();
 const reelDueDate = document.getElementById('asReelDueDate').value;
 const isMonthlyTarget = document.getElementById('asIsMonthlyTarget').value === 'true';
 const fullName = document.getElementById('asFullName').value.trim();
 const addressLine1 = document.getElementById('asAddress1').value.trim();
 const addressLine2 = document.getElementById('asAddress2').value.trim();
 const city = document.getElementById('asCity').value.trim();
 const state = document.getElementById('asState').value.trim();
 const pincode = document.getElementById('asPincode').value.trim();
 const phone = document.getElementById('asPhone').value.trim();
 const notes = document.getElementById('asNotes').value.trim();
 
 // Validation
 if (!influencerId) {
 alert('Please select an influencer');
 return;
 }
 if (!productTitle || productTitle.length < 3) {
 alert('Product title must be at least 3 characters');
 return;
 }
 if (!reelDueDate) {
 alert('Please select a reel due date');
 return;
 }
 if (!pincode || pincode.length !== 6) {
 alert('Invalid pincode (must be 6 digits)');
 return;
 }
 if (!phone || phone.length !== 10) {
 alert('Invalid phone number (must be 10 digits)');
 return;
 }
 
 try {
 const res = await fetch(`${API}/shipments/manual`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${authToken}`
 },
 body: JSON.stringify({
 influencerId,
 productTitle,
 reelDueDate,
 isMonthlyTarget,
 shippingFullName: fullName,
 shippingAddressLine1: addressLine1,
 shippingAddressLine2: addressLine2 || null,
 shippingCity: city,
 shippingState: state,
 shippingPincode: pincode,
 shippingPhone: phone,
 notes: notes || null
 })
 });
 
 const data = await res.json();
 
 if (data.success) {
 showToast('Shipment created and Delhivery booking initiated!');
 closeAddShipmentModal();
 loadAllShipments();
 } else {
 alert(data.error || 'Failed to create shipment');
 }
 } catch (e) {
 alert('Network error. Please try again.');
 }
}
// Helper: Get status badge HTML
function getStatusBadge(status) {
 const colors = {
 pending: 'var(--warning)',
 approved: 'var(--success)',
 rejected: 'var(--danger)',
 shipped: '#4facfe',
 delivered: 'var(--success)',
 received: 'var(--success)',
 overdue: 'var(--danger)'
 };
 const color = colors[status] || 'var(--muted)';
 return `<span style="display: inline-block; padding: 0.2rem 0.6rem; font-size: 0.65rem; font-weight: 600; text-transform: uppercase; background: ${color}20; color: ${color}; border: 1px solid ${color};">${status}</span>`;
}
// View shipment details modal
async function viewShipmentDetails(shipmentId) {
 try {
 const res = await fetch(`${API}/shipment-detail/${shipmentId}`, {
 headers: { 'Authorization': `Bearer ${authToken}` }
 });
 const data = await res.json();
 
 if (!data.success || !data.shipment) {
 showToast('Shipment not found', true);
 return;
 }
 
 const s = data.shipment;
 const modal = document.createElement('div');
 modal.id = 'srViewShipmentModal';
 modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 9999; padding: 2rem;';
 
 modal.innerHTML = `
 <div style="background: var(--surface); border: 1px solid var(--border); width: 100%; max-width: 700px; max-height: 90vh; overflow-y: auto; padding: 2rem;">
 <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
 <h3 style="font-size: 0.8rem; letter-spacing: 0.2em; text-transform: uppercase; margin: 0;">Shipment Details</h3>
 <button onclick="closeViewShipmentModal()" style="background: transparent; border: none; color: var(--text); cursor: pointer; font-size: 1.5rem;">&times;</button>
 </div>
 
 <div style="padding: 1rem; background: var(--subtle); margin-bottom: 1.5rem;">
 <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
 <div>
 <div style="font-size: 0.7rem; color: var(--muted); margin-bottom: 0.3rem;">Status</div>
 <div>${getStatusBadge(s.status)}</div>
 </div>
 <div>
 <div style="font-size: 0.7rem; color: var(--muted); margin-bottom: 0.3rem;">Reel Status</div>
 <div>${s.reel_status ? getStatusBadge(s.reel_status) : 'N/A'}</div>
 </div>
 </div>
 </div>
 
 <div style="margin-bottom: 1.5rem;">
 <h4 style="font-size: 0.7rem; color: var(--muted); margin-bottom: 0.5rem; text-transform: uppercase;">Ambassador</h4>
 <div style="padding: 1rem; background: var(--subtle);">
 <div style="font-weight: 600;">${s.influencers?.name || 'Unknown'}</div>
 <div style="font-size: 0.75rem; color: var(--muted);">${s.influencers?.referral_code || ''}</div>
 <div style="font-size: 0.75rem; color: var(--muted);">${s.influencers?.phone || ''}</div>
 </div>
 </div>
 
 <div style="margin-bottom: 1.5rem;">
 <h4 style="font-size: 0.7rem; color: var(--muted); margin-bottom: 0.5rem; text-transform: uppercase;">Product</h4>
 <div style="padding: 1rem; background: var(--subtle);">
 <div style="font-weight: 600;">${s.product_title}</div>
 <div style="font-size: 0.75rem; color: var(--muted);">Sent: ${new Date(s.sent_at || s.created_at).toLocaleDateString()}</div>
 ${s.reel_due_date ? `<div style="font-size: 0.75rem; color: var(--muted);">Reel Due: ${new Date(s.reel_due_date).toLocaleDateString()}</div>` : ''}
 </div>
 </div>
 
 <div style="margin-bottom: 1.5rem;">
 <h4 style="font-size: 0.7rem; color: var(--muted); margin-bottom: 0.5rem; text-transform: uppercase;">Shipping Address</h4>
 <div style="padding: 1rem; background: var(--subtle); font-size: 0.75rem; line-height: 1.6;">
 ${s.shipping_full_name || s.influencers?.name || ''}<br>
 ${s.shipping_address_line1 || ''}<br>
 ${s.shipping_address_line2 ? s.shipping_address_line2 + '<br>' : ''}
 ${s.shipping_city || ''}, ${s.shipping_state || ''} ${s.shipping_pincode || ''}<br>
 Phone: ${s.shipping_phone || s.influencers?.phone || ''}
 </div>
 </div>
 
 ${s.delhivery_awb ? `
 <div style="margin-bottom: 1.5rem;">
 <h4 style="font-size: 0.7rem; color: var(--muted); margin-bottom: 0.5rem; text-transform: uppercase;">Delhivery Tracking</h4>
 <div style="padding: 1rem; background: #4facfe20; border-left: 3px solid #4facfe;">
 <div style="font-size: 0.75rem; margin-bottom: 0.3rem;"><strong>AWB:</strong> ${s.delhivery_awb}</div>
 ${s.delhivery_tracking_url ? `<a href="${s.delhivery_tracking_url}" target="_blank" style="color: #4facfe; font-size: 0.75rem;">Track Shipment →</a>` : ''}
 </div>
 </div>
 ` : ''}
 
 ${s.notes ? `
 <div style="margin-bottom: 1.5rem;">
 <h4 style="font-size: 0.7rem; color: var(--muted); margin-bottom: 0.5rem; text-transform: uppercase;">Notes</h4>
 <div style="padding: 1rem; background: var(--subtle); font-size: 0.75rem; line-height: 1.6;">${s.notes}</div>
 </div>
 ` : ''}
 
 ${s.status === 'shipped' && s.reel_status !== 'received' ? `
 <div style="display: flex; gap: 0.5rem; padding-top: 1rem; border-top: 1px solid var(--border);">
 <button class="ia-btn ia-btn-primary" onclick="updateReelStatus('${s.id}', 'received')" style="padding: 0.5rem 1rem; font-size: 0.7rem;">Mark Reel Received</button>
 <button class="ia-btn" onclick="updateReelStatus('${s.id}', 'overdue')" style="padding: 0.5rem 1rem; font-size: 0.7rem; color: var(--danger); border-color: var(--danger);">Mark Overdue</button>
 </div>
 ` : ''}
 </div>
 `;
 
 document.body.appendChild(modal);
 } catch (e) { showToast('Failed to load shipment details', true);
 }
}
// Close view shipment details modal
function closeViewShipmentModal() {
 const modal = document.getElementById('srViewShipmentModal');
 if (modal) modal.remove();
}
// Update reel status
async function updateReelStatus(shipmentId, newStatus) {
 if (!confirm(`Mark reel as ${newStatus}?`)) return;
 
 try {
 const res = await fetch(`${API}/shipments/${shipmentId}/reel-status`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 'Authorization': `Bearer ${authToken}`
 },
 body: JSON.stringify({ reelStatus: newStatus })
 });
 const data = await res.json();
 
 if (data.success) {
 showToast(`Reel status updated to ${newStatus}`);
 closeViewShipmentModal();
 loadAllShipments();
 } else {
 showToast(data.error || 'Failed to update status', true);
 }
 } catch (e) {
 showToast('Network error', true);
 }
}
// Track shipment via Delhivery
function trackShipment(awb) {
 const url = `https://www.delhivery.com/track?wb=${awb}`;
 window.open(url, '_blank');
}
function promptModal(title, message, buttons) {
 alert(message);
}
// ═══════════════════════════════════════════════════════════════
// INFLUENCER DETAILS MODAL - 6 TABS
// ═══════════════════════════════════════════════════════════════
function viewInfluencerDetails(influencerId) { console.log('Available IDs in data:', influencersData.map(i => ({ id: i.id, type: typeof i.id })));
 
 // Convert to same type for comparison
 const inf = influencersData.find(i => String(i.id) === String(influencerId));
 if (!inf) { return;
 } showInfluencerDetailsModal(inf);
}
// Global cache for influencer detail modal data
let _detailModalData = { shipments: [], payouts: [], notes: [], analytics: null };
async function showInfluencerDetailsModal(inf, initialTab = 'overview') {
 // Remove existing modal
 const existing = document.getElementById('iaDetailsModal');
 if (existing) existing.remove();
 
 const modal = document.createElement('div');
 modal.id = 'iaDetailsModal';
 modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';
 
 // Fetch additional data
 let shipments = [], payouts = [], notes = [], analytics = null;
 try {
 const shipmentUrl = `${API}/shipments/${inf.id}`;
 const payoutUrl = `${API}/payouts/${inf.id}`;
 const notesUrl = `${API}/${inf.id}/notes`;
 const analyticsUrl = `${API}/analytics/${inf.id}`;
 
 const [shipRes, payRes, notesRes, analyticsRes] = await Promise.all([
 fetch(shipmentUrl, { headers: { 'Authorization': `Bearer ${authToken}` } }),
 fetch(payoutUrl, { headers: { 'Authorization': `Bearer ${authToken}` } }),
 fetch(notesUrl, { headers: { 'Authorization': `Bearer ${authToken}` } }).catch(() => null),
 fetch(analyticsUrl, { headers: { 'Authorization': `Bearer ${authToken}` } }).catch(() => null)
 ]);
 if (shipRes.ok) { const d = await shipRes.json(); shipments = d.shipments || []; }
 else if (shipRes.status !== 404) { console.warn('Failed to load shipments:', shipRes.status); }
 
 if (payRes.ok) { const d = await payRes.json(); payouts = d.payouts || []; }
 else if (payRes.status !== 404) { console.warn('Failed to load payouts:', payRes.status); }
 
 if (notesRes && notesRes.ok) { 
 const d = await notesRes.json(); 
 notes = d.notes || []; }
 else if (notesRes) { const errorText = await notesRes.text().catch(() => ''); } else { }
 
 if (analyticsRes && analyticsRes.ok) { analytics = await analyticsRes.json(); }
 else if (analyticsRes && analyticsRes.status !== 404) { console.warn('Failed to load analytics:', analyticsRes.status); }
 } catch (e) { console.error('Failed to load details', e); }
 
 // Cache data globally for tab switching
 _detailModalData = { shipments, payouts, notes, analytics };
 
 const tierColors = { 'Rising Star': '#3b82f6', 'Growing Creator': '#22c55e', 'Established Influencer': '#a855f7', 'Top Tier Creator': '#f59e0b' };
 const tierColor = tierColors[inf.follower_tier] || '#6366f1';
 const statusColors = { pending: '#f59e0b', active: '#22c55e', rejected: '#ef4444', paused: '#6b7280' };
 const statusColor = statusColors[inf.status] || '#6b7280';
 
 modal.innerHTML = `
 <div style="background:var(--surface);border:1px solid var(--border);width:100%;max-width:1000px;max-height:95vh;overflow-y:auto;animation:fadeUp .3s ease;">
 <div style="padding:1.5rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem;">
 <div>
 <div style="font-size:.65rem;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);margin-bottom:.5rem;">Influencer Details</div>
 <h2 style="font-size:1.3rem;font-weight:700;margin-bottom:.3rem;">${inf.name}</h2>
 <div style="font-size:.85rem;color:var(--muted);">${inf.instagram_handle || ''}</div>
 <div style="display:flex;gap:.5rem;margin-top:.75rem;flex-wrap:wrap;">
 <span style="padding:.25rem .6rem;font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;background:${tierColor}20;color:${tierColor};border:1px solid ${tierColor};">${inf.follower_tier || 'Rising Star'}</span>
 <span style="padding:.25rem .6rem;font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor};">${inf.status || 'pending'}</span>
 </div>
 </div>
 <button onclick="document.getElementById('iaDetailsModal').remove()" style="background:transparent;border:1px solid var(--border);color:var(--text);padding:.5rem 1rem;font-size:.7rem;cursor:pointer;">Close</button>
 </div>
 <div style="padding:0;border-bottom:1px solid var(--border);display:flex;overflow-x:auto;" id="iaDetailsTabs">
 <button class="ia-dt-tab active" data-tab="overview" onclick="switchDetailTab('overview')">Overview</button>
 <button class="ia-dt-tab" data-tab="application" onclick="switchDetailTab('application')">Application</button>
 <button class="ia-dt-tab" data-tab="performance" onclick="switchDetailTab('performance')">Performance</button>
 <button class="ia-dt-tab" data-tab="shipments" onclick="switchDetailTab('shipments')">Shipments</button>
 <button class="ia-dt-tab" data-tab="payouts" onclick="switchDetailTab('payouts')">Payouts</button>
 <button class="ia-dt-tab" data-tab="notes" onclick="switchDetailTab('notes')">Admin Notes</button>
 </div>
 <div id="iaDetailsContent" style="padding:1.5rem;min-height:400px;color:var(--text);">
</div>
 </div>
 <style>
 .ia-dt-tab { background:transparent;border:none;border-bottom:2px solid transparent;color:var(--muted);padding:.75rem 1rem;font-size:.75rem;font-weight:600;letter-spacing:.05em;cursor:pointer;white-space:nowrap;transition:.2s; }
 .ia-dt-tab:hover { color:var(--text); }
 .ia-dt-tab.active { color:var(--text);border-bottom-color:var(--text); }
 .ia-dt-card { background:var(--surface-2);border:1px solid var(--border);padding:1rem;margin-bottom:1rem;color:var(--text); }
 .ia-dt-card-title { font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:var(--text);margin-bottom:.75rem;font-weight:700;opacity:0.7; }
 .ia-dt-row { display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--subtle);font-size:.85rem;color:var(--text); }
 .ia-dt-row:last-child { border-bottom:none; }
 .ia-dt-label { color:var(--text);opacity:0.6; }
 .ia-dt-value { font-weight:600;color:var(--text); }
 .ia-dt-progress { height:6px;background:var(--subtle);margin-top:.5rem;position:relative; }
 .ia-dt-progress-fill { height:100%;background:var(--success);transition:width .3s; }
 .ia-dt-badge { display:inline-block;padding:.2rem .5rem;font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text); }
 .ia-dt-btn { padding:.5rem 1rem;border:1px solid var(--border);background:transparent;color:var(--text);font-size:.7rem;font-weight:600;cursor:pointer;transition:.2s; }
 .ia-dt-btn:hover { background:var(--text);color:var(--bg); }
 .ia-dt-btn-primary { background:var(--text);color:var(--bg); }
 </style>
 `;
 
 document.body.appendChild(modal);
 window.currentDetailInfluencer = inf;
 renderDetailTab(initialTab, inf, _detailModalData);
 // Highlight correct tab
 document.querySelectorAll('.ia-dt-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === initialTab));
}
function switchDetailTab(tab) {
 document.querySelectorAll('.ia-dt-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
 const inf = window.currentDetailInfluencer;
 if (!inf) return;
 renderDetailTab(tab, inf, _detailModalData);
}
function renderDetailTab(tab, inf, data = {}) {
 const content = document.getElementById('iaDetailsContent');
 if (!content) return;
 
 const tierColors = { 'Rising Star': '#3b82f6', 'Growing Creator': '#22c55e', 'Established Influencer': '#a855f7', 'Top Tier Creator': '#f59e0b' };
 const tierColor = tierColors[inf.follower_tier] || '#6366f1';
 
 // Use analytics data for orders/revenue if available
 const analytics = data.analytics || {};
 const summary = analytics.summary || {};
 const totalRevenue = summary.totalRevenue || 0;
 const totalOrders = summary.totalOrders || 0;
 const estimatedEarnings = summary.estimatedEarnings || 0;
 
 // Use payouts from API response
 const payoutItems = (data.analytics && data.analytics.payouts) ? data.analytics.payouts.items || [] : (data.payouts || []);
 const pendingPayouts = payoutItems.filter(p => p.status === 'pending').reduce((sum, p) => sum + (parseFloat(p.amount_due || p.amount || 0)), 0);
 const paidPayouts = payoutItems.filter(p => p.status === 'paid').reduce((sum, p) => sum + (parseFloat(p.amount_due || p.amount || 0)), 0);
 const monthlyTarget = inf.monthly_target || 12;
 const shipmentItems = data.shipments || [];
 
 if (tab === 'overview') {
 content.innerHTML = `
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Personal Information</div>
 <div class="ia-dt-row"><span class="ia-dt-label">Name</span><span class="ia-dt-value">${inf.name}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Email</span><span class="ia-dt-value">${inf.email || '-'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Phone</span><span class="ia-dt-value">${inf.phone || '-'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">City</span><span class="ia-dt-value">${inf.city || '-'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Referral Code</span><span class="ia-dt-value">${inf.referral_code}</span></div>
 </div>
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Shipping Address</div>
 <div style="font-size:.85rem;line-height:1.6;">
 ${inf.shipping_address ? `${inf.address_type === 'office' ? '\ud83c\udfe2 Office' : '\ud83c\udfe0 Home'}<br>${inf.shipping_address}${inf.shipping_landmark ? '<br>Near: ' + inf.shipping_landmark : ''}<br>${inf.shipping_city || ''}${inf.shipping_city && inf.shipping_state ? ', ' : ''}${inf.shipping_state || ''} ${inf.shipping_pin || ''}` : '<span style="color:var(--muted);">No address saved</span>'}
 </div>
 </div>
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Social Media & Reach</div>
 <div class="ia-dt-row"><span class="ia-dt-label">Instagram</span><span class="ia-dt-value">${inf.instagram_handle || '-'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">YouTube</span><span class="ia-dt-value">${inf.youtube_handle || '-'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Followers</span><span class="ia-dt-value">${inf.follower_count ? Number(inf.follower_count).toLocaleString() : '-'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Tier</span><span class="ia-dt-value" style="color:${tierColor}">${inf.follower_tier || 'Rising Star'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Niche</span><span class="ia-dt-value">${inf.niche || '-'}</span></div>
 </div>
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Content Commitment</div>
 <div class="ia-dt-row"><span class="ia-dt-label">Weekly Content</span><span class="ia-dt-value">${inf.content_weekly_count || 3} pieces</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Monthly Target</span><span class="ia-dt-value">${inf.monthly_target || 12} pieces</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Product Limit</span><span class="ia-dt-value">${inf.tier_override || (inf.follower_tier?.includes('Top') ? 5 : inf.follower_tier?.includes('Established') ? 4 : inf.follower_tier?.includes('Growing') ? 3 : 2)} products</span></div>
 </div>
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Quick Stats</div>
 <div class="ia-dt-row"><span class="ia-dt-label">Total Orders</span><span class="ia-dt-value">${totalOrders}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Total Revenue</span><span class="ia-dt-value">₹${totalRevenue.toLocaleString()}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Commission Rate</span><span class="ia-dt-value">${inf.commission_rate || 7}%</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Payouts Paid</span><span class="ia-dt-value">₹${paidPayouts.toLocaleString()}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Pending Payouts</span><span class="ia-dt-value">₹${pendingPayouts.toLocaleString()}</span></div>
 </div>
 </div>`;
 } else if (tab === 'application') {
 const selectedProds = inf.selected_products ? (typeof inf.selected_products === 'string' ? JSON.parse(inf.selected_products) : inf.selected_products) : [];
 content.innerHTML = `
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Application Timeline</div>
 <div class="ia-dt-row"><span class="ia-dt-label">Applied On</span><span class="ia-dt-value">${inf.applied_at ? new Date(inf.applied_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Reviewed By</span><span class="ia-dt-value">${inf.reviewed_by || '-'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Status</span><span class="ia-dt-value">${inf.status || 'pending'}</span></div>
 </div>
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Physical Details</div>
 <div class="ia-dt-row"><span class="ia-dt-label">Height</span><span class="ia-dt-value">${inf.height_cm ? inf.height_cm + ' cm' : '-'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Weight</span><span class="ia-dt-value">${inf.weight_kg ? inf.weight_kg + ' kg' : '-'}</span></div>
 </div>
 <div class="ia-dt-card" style="grid-column:1/-1;">
 <div class="ia-dt-card-title">Shipping Address</div>
 <div style="padding:.75rem;background:var(--subtle);font-size:.85rem;line-height:1.6;">
 ${inf.address_type === 'office' ? '🏢 Office' : '🏠 Home'}<br>
 ${inf.shipping_address || ''}${inf.shipping_address ? '<br>' : ''}
 ${inf.shipping_city || ''}${inf.shipping_city ? ', ' : ''}${inf.shipping_state || ''} ${inf.shipping_pin || ''}<br>
 ${inf.shipping_landmark ? 'Near: ' + inf.shipping_landmark : ''}
 </div>
 </div>
 <div class="ia-dt-card" style="grid-column:1/-1;">
 <div class="ia-dt-card-title">Selected Products (${selectedProds.length})</div>
 ${selectedProds.length > 0 ? `
 <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-top:.5rem;">
 ${selectedProds.map((p, idx) => {
 const isObj = typeof p === 'object' && p !== null;
 const title = isObj ? (p.title || 'Unknown Product') : p;
 const image = isObj ? p.image : null;
 const productId = isObj ? p.id : p;
 return `
 <div style="border:1px solid var(--border);padding:.75rem;background:var(--surface-2);">
 ${image ? `<img src="${image}" alt="${title}" style="width:100%;height:100px;object-fit:contain;background:var(--subtle);margin-bottom:.5rem;border:1px solid var(--border);">` : `<div style="width:100%;height:100px;background:var(--subtle);display:flex;align-items:center;justify-content:center;margin-bottom:.5rem;border:1px solid var(--border);font-size:.7rem;color:var(--muted);">No Image</div>`}
 <div style="font-size:.8rem;font-weight:600;margin-bottom:.5rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${title}">${title}</div>
 ${isObj && p.price ? `<div style="font-size:.7rem;color:var(--muted);margin-bottom:.5rem;">Rs. ${parseFloat(p.price).toLocaleString('en-IN')}</div>` : ''}
 <button onclick="initiateShipmentFromProduct('${inf.id}', '${title.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', '${image || ''}')" 
 style="width:100%;padding:.4rem;font-size:.65rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;background:var(--text);color:var(--bg);border:1px solid var(--text);cursor:pointer;"
 ${inf.status !== 'active' ? 'disabled title="Approve influencer first"' : ''}>
 Initiate Shipment
 </button>
 </div>
 `;
 }).join('')}
 </div>
 ` : '<div style="font-size:.85rem;color:var(--muted);">No products selected</div>'}
 </div>
 ${inf.why_join ? `
 <div class="ia-dt-card" style="grid-column:1/-1;">
 <div class="ia-dt-card-title">Why Offcomfrt?</div>
 <div style="font-size:.85rem;line-height:1.6;font-style:italic;">"${inf.why_join}"</div>
 </div>` : ''}
 </div>`;
 } else if (tab === 'performance') {
 const commRate = inf.commission_rate || 7;
 const monthlyData = (analytics.monthly || []).slice(-6);
 
 // Get recent conversions/orders from analytics data
 const recentOrders = (analytics.recentOrders || analytics.recentConversions || []).slice(0, 10);
 
 content.innerHTML = `
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Performance Overview</div>
 <div class="ia-dt-row"><span class="ia-dt-label">Total Orders</span><span class="ia-dt-value">${totalOrders}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Total Revenue</span><span class="ia-dt-value">₹${totalRevenue.toLocaleString()}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Commission Earned</span><span class="ia-dt-value">₹${estimatedEarnings.toLocaleString()}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">AOV</span><span class="ia-dt-value">₹${(summary.aov || 0).toLocaleString()}</span></div>
 </div>
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Shipment Progress</div>
 <div class="ia-dt-row"><span class="ia-dt-label">Total Shipments</span><span class="ia-dt-value">${shipmentItems.length}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Reels Received</span><span class="ia-dt-value">${shipmentItems.filter(s => s.reel_status === 'received').length}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Pending</span><span class="ia-dt-value">${shipmentItems.filter(s => s.reel_status === 'pending').length}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Overdue</span><span class="ia-dt-value">${shipmentItems.filter(s => s.reel_status === 'overdue').length}</span></div>
 <div class="ia-dt-progress"><div class="ia-dt-progress-fill" style="width:${shipmentItems.length ? Math.round(shipmentItems.filter(s => s.reel_status === 'received').length / shipmentItems.length * 100) : 0}%"></div></div>
 </div>
 ${monthlyData.length > 0 ? `
 <div class="ia-dt-card" style="grid-column:1/-1;">
 <div class="ia-dt-card-title">Monthly Breakdown (Last 6 Months)</div>
 ${monthlyData.map(m => `
 <div class="ia-dt-row">
 <span class="ia-dt-label">${m.month}</span>
 <span class="ia-dt-value">${m.orders} orders | ₹${parseFloat(m.revenue || 0).toLocaleString()} | ₹${parseFloat(m.commission || 0).toLocaleString()} commission</span>
 </div>
 `).join('')}
 </div>` : `
 <div class="ia-dt-card" style="grid-column:1/-1;">
 <div class="ia-dt-card-title">Monthly Breakdown</div>
 <div style="font-size:.85rem;color:var(--muted);">No monthly data available</div>
 </div>`}
<div class="ia-dt-card" style="grid-column:1/-1;">
 <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
 <div class="ia-dt-card-title" style="margin:0;">Recent Orders</div>
 <button class="ia-dt-btn" onclick="viewInfluencerStats('${inf.id}')" style="font-size:.65rem;padding:.3rem .6rem;">View All</button>
 </div>
 ${recentOrders.length > 0 ? `
 <div style="display:flex;flex-direction:column;gap:.5rem;">
 ${recentOrders.map(order => `
 <div style="padding:.75rem;background:var(--subtle);border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
 <div>
 <div style="font-weight:600;font-size:.85rem;margin-bottom:.2rem;">Order ${order.orderName || order.name || '-'}</div>
 <div style="font-size:.75rem;color:var(--muted);">
 ${order.date ? new Date(order.date).toLocaleDateString() : '-'} • ${order.customerName || 'Guest'}
 ${order.discountCode ? ' • Code: ' + order.discountCode : ''}
 </div>
 </div>
 <div style="text-align:right;">
 <div style="font-weight:700;font-size:.95rem;">₹${parseFloat(order.total || 0).toLocaleString()}</div>
 <div style="font-size:.65rem;color:var(--muted);">${order.currency || 'INR'}</div>
 </div>
 </div>
 `).join('')}
 </div>
 ` : '<div style="text-align:center;padding:2rem;color:var(--muted);">No orders found</div>'}
 </div>
 </div>`;
 } else if (tab === 'shipments') {
 content.innerHTML = `
 <div class="ia-dt-card">
 <div style="display:flex;justify-content:space-between;margin-bottom:1rem;">
 <div class="ia-dt-card-title" style="margin:0;">Shipment History (${shipmentItems.length})</div>
 </div>
 ${shipmentItems.map(s => `
 <div style="padding:.75rem;background:var(--subtle);margin-bottom:.5rem;border:1px solid var(--border);">
 <div style="display:flex;justify-content:space-between;margin-bottom:.3rem;">
 <span style="font-weight:600;font-size:.85rem;">${s.product_title || s.product_name || 'Product'}</span>
 <span style="font-size:.7rem;padding:.2rem .5rem;background:${s.reel_status === 'received' ? '#22c55e20' : s.reel_status === 'overdue' ? '#ef444420' : '#f59e0b20'};color:${s.reel_status === 'received' ? '#22c55e' : s.reel_status === 'overdue' ? '#ef4444' : '#f59e0b'};">${s.reel_status || 'pending'}</span>
 </div>
 <div style="font-size:.75rem;color:var(--muted);">
 ${s.delhivery_awb ? 'AWB: ' + s.delhivery_awb + ' | ' : ''}
 Sent: ${s.sent_at ? new Date(s.sent_at).toLocaleDateString() : (s.created_at ? new Date(s.created_at).toLocaleDateString() : '-')}
 ${s.reel_due_date ? ' | Due: ' + new Date(s.reel_due_date).toLocaleDateString() : ''}
 </div>
 ${s.reel_url ? `<div style="font-size:.75rem;margin-top:.3rem;"><a href="${s.reel_url}" target="_blank" style="color:#3b82f6;">View Reel</a></div>` : ''}
 </div>
 `).join('') || '<div style="text-align:center;padding:2rem;color:var(--muted);">No shipments yet</div>'}
 </div>`;
 } else if (tab === 'payouts') {
 content.innerHTML = `
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Payout Summary</div>
 <div class="ia-dt-row"><span class="ia-dt-label">Total Paid</span><span class="ia-dt-value">₹${paidPayouts.toLocaleString()}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Pending</span><span class="ia-dt-value">₹${pendingPayouts.toLocaleString()}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">UPI ID</span><span class="ia-dt-value">${inf.payout_upi || '-'}</span></div>
 </div>
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Payout History</div>
 ${payoutItems.map(p => `
 <div class="ia-dt-row">
 <span class="ia-dt-label">${p.period_start ? new Date(p.period_start).toLocaleDateString() + ' - ' + new Date(p.period_end).toLocaleDateString() : (p.period || '-')}</span>
 <span style="color:${p.status === 'paid' ? '#22c55e' : '#f59e0b'}">₹${parseFloat(p.amount_due || p.amount || 0).toLocaleString()} ${p.status === 'paid' ? '✓' : '⏳'}</span>
 </div>
 `).join('') || '<div style="font-size:.85rem;color:var(--muted);">No payouts yet</div>'}
 </div>
 </div>`;
 } else if (tab === 'notes') {
 console.log('[Notes Tab] Rendering with data:', {
 notesCount: (data.notes || []).length,
 notes: data.notes
 });
 content.innerHTML = `
 <div class="ia-dt-card">
 <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
 <div class="ia-dt-card-title" style="margin:0;">Admin Notes (Internal)</div>
 <button class="ia-dt-btn ia-dt-btn-primary" onclick="addDetailNote('${inf.id}')">+ Add Note</button>
 </div>
 ${(data.notes || []).map(n => `
 <div style="padding:.75rem;background:var(--subtle);margin-bottom:.5rem;border:1px solid var(--border);">
 <div style="font-size:.75rem;color:var(--muted);margin-bottom:.3rem;">${n.created_at ? new Date(n.created_at).toLocaleDateString() : '-'} | ${n.admin_name || 'Admin'}</div>
 <div style="font-size:.85rem;">${n.note_text || ''}</div>
 </div>
 `).join('') || '<div style="text-align:center;padding:2rem;color:var(--muted);">No notes yet</div>'}
 </div>
 <div class="ia-dt-card">
 <div class="ia-dt-card-title">Tier & Target Management</div>
 <div class="ia-dt-row"><span class="ia-dt-label">Current Tier</span><span class="ia-dt-value" style="color:${tierColor}">${inf.follower_tier || 'Rising Star'}</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Monthly Target</span><span class="ia-dt-value">${inf.monthly_target || 12} pieces</span></div>
 <div class="ia-dt-row"><span class="ia-dt-label">Product Override</span><span class="ia-dt-value">${inf.tier_override || 'None'}</span></div>
 </div>`;
 }
}
async function addDetailNote(influencerId) {
 const note = prompt('Enter admin note:');
 if (!note) return;
 try {
 const res = await fetch(`${API}/${influencerId}/notes`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
 body: JSON.stringify({ note })
 });
 if (res.ok) { showToast('Note added'); switchDetailTab('notes'); }
 else showToast('Failed to add note', true);
 } catch (e) { showToast('Network error', true); }
}

// ==================== MESSAGING SYSTEM ====================

// Message state
let currentMessageFilter = 'all';
let allInfluencersData = [];
let messagePollingInterval = null;

// Show messages page
function showMessagesPage() {
  loadMessages();
  loadInfluencerDropdown();
  startMessagePolling();
}

// Load messages from API
async function loadMessages() {
  try {
    const influencerId = document.getElementById('messageInfluencerFilter')?.value || '';
    const type = currentMessageFilter;
    
    const response = await fetch(`https://exchange-return-tracking.onrender.com/api/admin/messages?influencerId=${influencerId}&type=${type}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await response.json();
    
    if (data.success) {
      renderMessages(data.messages);
    }
  } catch (error) {
    console.error('Failed to load messages:', error);
  }
}

// Render messages list
function renderMessages(messages) {
  const container = document.getElementById('messagesList');
  
  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div class="ia-empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <p>No messages yet</p>
      </div>
    `;
    return;
  }

  container.innerHTML = messages.map(msg => {
    const isIncoming = msg.sender_type === 'influencer';
    const isBroadcast = msg.is_broadcast;
    const influencerName = msg.influencers?.name || (isBroadcast ? 'All Influencers' : (isIncoming ? 'Influencer' : 'Influencer'));
    const timeAgo = getTimeAgo(msg.created_at);
    
    return `
      <div class="ia-message-card ${isIncoming ? 'incoming' : 'outgoing'} ${isBroadcast ? 'broadcast' : ''}">
        <div class="ia-message-header">
          <div class="ia-message-sender">
            ${isBroadcast ? '<span class="ia-badge ia-badge-broadcast">BROADCAST</span>' : ''}
            <strong>${isBroadcast ? 'Admin' : (isIncoming ? influencerName : 'Admin')}</strong>
            ${!isBroadcast && isIncoming ? `<span class="ia-muted">→ Admin</span>` : ''}
            ${!isBroadcast && !isIncoming ? `<span class="ia-muted">→ ${influencerName}</span>` : ''}
            ${isBroadcast ? `<span class="ia-muted">→ All Influencers</span>` : ''}
          </div>
          <span class="ia-message-time">${timeAgo}</span>
        </div>
        ${msg.subject ? `<div class="ia-message-subject">${escapeHtml(msg.subject)}</div>` : ''}
        <div class="ia-message-content">${escapeHtml(msg.content)}</div>
      </div>
    `;
  }).join('');
}

// Open new message modal
async function openNewMessageModal() {
  openModal('newMessageModalOverlay');
  await loadInfluencerDropdown();
}

// Close new message modal
function closeNewMessageModal() {
  closeModal('newMessageModalOverlay');
  document.getElementById('messageSubject').value = '';
  document.getElementById('messageContent').value = '';
}

// Toggle message type (direct vs broadcast)
function toggleMessageType() {
  const isBroadcast = document.querySelector('input[name="messageType"]:checked').value === 'broadcast';
  const recipientGroup = document.getElementById('recipientSelectGroup');
  
  if (isBroadcast) {
    recipientGroup.classList.add('hidden');
  } else {
    recipientGroup.classList.remove('hidden');
  }
}

// Load influencer dropdown
async function loadInfluencerDropdown() {
  try {
    const response = await fetch(`${API}/list`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await response.json();
    
    if (data.success) {
      allInfluencersData = data.influencers;
      
      // Update message modal dropdown
      const select = document.getElementById('messageRecipient');
      select.innerHTML = data.influencers.map(inf => 
        `<option value="${inf.id}">${inf.name} (${inf.referral_code})</option>`
      ).join('');
      
      // Update filter dropdown
      const filterSelect = document.getElementById('messageInfluencerFilter');
      if (filterSelect) {
        filterSelect.innerHTML = '<option value="">All Influencers</option>' + 
          data.influencers.map(inf => 
            `<option value="${inf.id}">${inf.name} (${inf.referral_code})</option>`
          ).join('');
      }
    }
  } catch (error) {
    console.error('Failed to load influencers:', error);
  }
}

// Send message
async function sendMessage() {
  const isBroadcast = document.querySelector('input[name="messageType"]:checked').value === 'broadcast';
  const recipientId = document.getElementById('messageRecipient').value;
  const subject = document.getElementById('messageSubject').value;
  const content = document.getElementById('messageContent').value;

  if (!content.trim()) {
    alert('Please enter a message');
    return;
  }

  if (!isBroadcast && !recipientId) {
    alert('Please select a recipient');
    return;
  }

  try {
    const response = await fetch('https://exchange-return-tracking.onrender.com/api/admin/messages', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        recipientType: 'influencer',
        recipientId: isBroadcast ? null : recipientId,
        subject: subject || null,
        content,
        isBroadcast
      })
    });

    const data = await response.json();
    
    if (data.success) {
      closeNewMessageModal();
      loadMessages();
      showToast('Message sent successfully');
    } else {
      showToast(data.error || 'Failed to send message', true);
    }
  } catch (error) {
    console.error('Failed to send message:', error);
    showToast('Failed to send message', true);
  }
}

// Filter messages
function filterMessages(type, btn) {
  currentMessageFilter = type;
  
  // Update active button
  document.querySelectorAll('#page-messages .ia-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  
  loadMessages();
}

// Filter by influencer
function filterByInfluencer() {
  loadMessages();
}

// Start polling for new messages
function startMessagePolling() {
  if (messagePollingInterval) {
    clearInterval(messagePollingInterval);
  }
  
  messagePollingInterval = setInterval(() => {
    loadMessages();
  }, 30000); // 30 seconds
}

// Stop polling
function stopMessagePolling() {
  if (messagePollingInterval) {
    clearInterval(messagePollingInterval);
    messagePollingInterval = null;
  }
}

// Helper: Time ago
function getTimeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Helper: Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}