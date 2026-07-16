/**
 * Marketing Dashboard - Utility Functions
 * Shared helpers for API calls, formatting, and UI interactions
 */

// ── API Helper ──
let authToken = null;

async function apiCall(endpoint, options = {}) {
    const url = `/api/admin/marketing/${endpoint}`;
    const config = {
        headers: { 'Content-Type': 'application/json' },
        ...options
    };
    if (authToken) {
        config.headers['Authorization'] = `Bearer ${authToken}`;
    }
    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }
    
    const response = await fetch(url, config);
    
    if (response.status === 401) {
        logout();
        throw new Error('Session expired. Please login again.');
    }
    
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
}

// ── Auth ──
async function handleLogin(event) {
    event.preventDefault();
    const password = document.getElementById('adminPassword').value;
    const btn = document.getElementById('loginBtnText');
    const spinner = document.getElementById('loginSpinner');
    
    btn.textContent = 'Logging in...';
    spinner.classList.remove('hidden');
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await response.json();
        
        if (response.ok && data.token) {
            authToken = data.token;
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('dashboardSection').classList.remove('hidden');
            initDashboard();
        } else {
            showLoginAlert(data.error || 'Invalid password', 'error');
        }
    } catch (error) {
        showLoginAlert('Connection error. Please try again.', 'error');
    } finally {
        btn.textContent = 'Login';
        spinner.classList.add('hidden');
    }
}

function showLoginAlert(message, type) {
    const alertEl = document.getElementById('loginAlert');
    alertEl.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
    setTimeout(() => { alertEl.innerHTML = ''; }, 5000);
}

function logout() {
    authToken = null;
    document.getElementById('dashboardSection').classList.add('hidden');
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('adminPassword').value = '';
}

// ── Navigation ──
function switchSection(section) {
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-section="${section}"]`);
    if (navItem) navItem.classList.add('active');
    
    // Update content
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    const sectionEl = document.getElementById(`section-${section}`);
    if (sectionEl) sectionEl.classList.add('active');
    
    // Update title
    const titles = {
        'overview': 'Overview', 'customers': 'Customer Intelligence',
        'campaigns': 'Campaign Management', 'templates': 'Message Templates',
        'coupons': 'Coupon Management', 'abandoned-carts': 'Abandoned Cart Recovery',
        'recovered-carts': 'Recovered Carts',
        'analytics': 'Analytics', 'settings': 'Settings', 'audit-log': 'Audit Log'
    };
    document.getElementById('sectionTitle').textContent = titles[section] || 'Marketing';
    
    // Load section data
    const loaders = {
        'overview': loadOverview, 'customers': loadCustomers,
        'campaigns': loadCampaigns, 'templates': loadTemplates,
        'coupons': loadCoupons, 'abandoned-carts': loadAbandonedCarts,
        'recovered-carts': loadRecoveredCarts,
        'analytics': loadAnalytics, 'settings': loadSettings,
        'audit-log': loadAuditLogs
    };
    if (loaders[section]) loaders[section]();
    
    // Close sidebar on mobile
    document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        // Mobile: toggle open/close slide
        sidebar.classList.toggle('open');
    } else {
        // Desktop: toggle collapsed state
        sidebar.classList.toggle('collapsed');
        // Save state to localStorage
        const isCollapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('marketing-sidebar-collapsed', isCollapsed);
    }
}

// Initialize sidebar state from localStorage
function initSidebarState() {
    const sidebar = document.getElementById('sidebar');
    const isMobile = window.innerWidth <= 768;
    
    if (!isMobile) {
        const isCollapsed = localStorage.getItem('marketing-sidebar-collapsed') === 'true';
        if (isCollapsed) {
            sidebar.classList.add('collapsed');
        }
    }
}

// Call on page load
document.addEventListener('DOMContentLoaded', initSidebarState);

// ── Modal ──
function openModal(title, content) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = content;
    document.getElementById('modalOverlay').classList.remove('hidden');
}

function closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('modalOverlay').classList.add('hidden');
}

// ── Toast ──
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';
    toast.innerHTML = `<i class="fas fa-${icon}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 4000);
}

// ── Formatting ──
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatNumber(num) {
    return new Intl.NumberFormat('en-IN').format(num || 0);
}

function timeAgo(dateStr) {
    if (!dateStr) return '-';
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return formatDate(dateStr);
}

// ── Badge Helper ──
function statusBadge(status) {
    if (!status) return '<span class="badge badge-draft">Unknown</span>';
    const s = status.toLowerCase().replace(/[\s_]/g, '-');
    return `<span class="badge badge-${s}">${status.replace(/_/g, ' ')}</span>`;
}

// ── Pagination ──
function renderPagination(containerId, pagination, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container || !pagination || pagination.totalPages <= 1) {
        if (container) container.innerHTML = '';
        return;
    }
    
    let html = '';
    html += `<button ${pagination.page <= 1 ? 'disabled' : ''} onclick="${onPageChange}(${pagination.page - 1})">Prev</button>`;
    
    const start = Math.max(1, pagination.page - 2);
    const end = Math.min(pagination.totalPages, pagination.page + 2);
    
    if (start > 1) html += `<button onclick="${onPageChange}(1)">1</button>`;
    if (start > 2) html += `<button disabled>...</button>`;
    
    for (let i = start; i <= end; i++) {
        html += `<button class="${i === pagination.page ? 'active' : ''}" onclick="${onPageChange}(${i})">${i}</button>`;
    }
    
    if (end < pagination.totalPages - 1) html += `<button disabled>...</button>`;
    if (end < pagination.totalPages) html += `<button onclick="${onPageChange}(${pagination.totalPages})">${pagination.totalPages}</button>`;
    
    html += `<button ${pagination.page >= pagination.totalPages ? 'disabled' : ''} onclick="${onPageChange}(${pagination.page + 1})">Next</button>`;
    
    container.innerHTML = html;
}

// ── Debounce ──
function debounce(fn, delay) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ── Escape HTML ──
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Get Initials ──
function getInitials(firstName, lastName) {
    const f = (firstName || '').charAt(0).toUpperCase();
    const l = (lastName || '').charAt(0).toUpperCase();
    return (f + l) || '?';
}
