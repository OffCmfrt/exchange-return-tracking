/**
 * Marketing Dashboard - Chart Initialization
 * Chart.js configurations and update functions
 * Gracefully degrades if Chart.js CDN is blocked (e.g. by CSP headers)
 */

if (typeof Chart !== 'undefined') {

// Chart.js global defaults
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#64748b';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.padding = 16;

const chartInstances = {};

function initRevenueChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Total Revenue', data: [], borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.1)', fill: true, tension: 0.4, pointRadius: 3 },
                { label: 'Marketing Revenue', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.4, pointRadius: 3 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: true, aspectRatio: 2,
            scales: { y: { beginAtZero: true, ticks: { callback: v => '₹' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v) } } },
            plugins: { tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ₹' + ctx.parsed.y.toLocaleString('en-IN') } } }
        }
    });
}

function updateRevenueChart(canvasId, dailyData) {
    const chart = chartInstances[canvasId];
    if (!chart) return;
    chart.data.labels = dailyData.map(d => formatDate(d.date));
    chart.data.datasets[0].data = dailyData.map(d => parseFloat(d.total_revenue) || 0);
    chart.data.datasets[1].data = dailyData.map(d => parseFloat(d.marketing_attributed_revenue) || 0);
    chart.update();
}

function initCampaignChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                { label: 'Sent', data: [], backgroundColor: '#4f46e5' },
                { label: 'Delivered', data: [], backgroundColor: '#10b981' },
                { label: 'Read', data: [], backgroundColor: '#06b6d4' },
                { label: 'Failed', data: [], backgroundColor: '#ef4444' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: true, aspectRatio: 2,
            scales: { y: { beginAtZero: true } },
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

function updateCampaignChart(canvasId, dailyData) {
    const chart = chartInstances[canvasId];
    if (!chart) return;
    chart.data.labels = dailyData.map(d => formatDate(d.date));
    chart.data.datasets[0].data = dailyData.map(d => d.campaigns_sent || 0);
    chart.data.datasets[1].data = dailyData.map(d => d.campaigns_delivered || 0);
    chart.data.datasets[2].data = dailyData.map(d => d.campaigns_read || 0);
    chart.data.datasets[3].data = dailyData.map(d => d.campaigns_failed || 0);
    chart.update();
}

function initSegmentChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['General', 'VIP', 'Repeat', 'New', 'At Risk', 'Dormant'],
            datasets: [{ data: [0, 0, 0, 0, 0, 0], backgroundColor: ['#4f46e5', '#10b981', '#06b6d4', '#f59e0b', '#ef4444', '#8b5cf6'], borderWidth: 0 }]
        },
        options: {
            responsive: true, maintainAspectRatio: true, aspectRatio: 1.5,
            plugins: { legend: { position: 'bottom' } },
            cutout: '60%'
        }
    });
}

function updateSegmentChart(canvasId, segments) {
    const chart = chartInstances[canvasId];
    if (!chart) return;
    const labels = Object.keys(segments);
    const data = Object.values(segments);
    chart.data.labels = labels.map(l => l.charAt(0).toUpperCase() + l.slice(1));
    chart.data.datasets[0].data = data;
    chart.update();
}

function initRecoveryChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Recovered', 'Pending', 'Expired'],
            datasets: [{ data: [0, 0, 0], backgroundColor: ['#10b981', '#f59e0b', '#94a3b8'], borderWidth: 0 }]
        },
        options: {
            responsive: true, maintainAspectRatio: true, aspectRatio: 1.5,
            plugins: { legend: { position: 'bottom' } },
            cutout: '60%'
        }
    });
}

function updateRecoveryChart(canvasId, stats) {
    const chart = chartInstances[canvasId];
    if (!chart) return;
    chart.data.datasets[0].data = [
        stats.recoveredCount || 0,
        stats.statuses?.pending || 0,
        stats.statuses?.expired || 0
    ];
    chart.update();
}

function initDailyRevenueChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Revenue', data: [], borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.1)', fill: true, tension: 0.4 },
                { label: 'Coupon Revenue', data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', fill: true, tension: 0.4 },
                { label: 'Spend', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: true, aspectRatio: 3,
            scales: { y: { beginAtZero: true, ticks: { callback: v => '₹' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v) } } }
        }
    });
}

function updateDailyRevenueChart(canvasId, dailyData) {
    const chart = chartInstances[canvasId];
    if (!chart) return;
    chart.data.labels = dailyData.map(d => formatDate(d.date));
    chart.data.datasets[0].data = dailyData.map(d => parseFloat(d.total_revenue) || 0);
    chart.data.datasets[1].data = dailyData.map(d => parseFloat(d.coupon_revenue) || 0);
    chart.data.datasets[2].data = dailyData.map(d => parseFloat(d.total_spend) || 0);
    chart.update();
}

function initAnalyticsCampaignChart(canvasId) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                { label: 'Delivered', data: [], backgroundColor: '#4f46e5' },
                { label: 'Read', data: [], backgroundColor: '#10b981' },
                { label: 'Replied', data: [], backgroundColor: '#06b6d4' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: true, aspectRatio: 3,
            indexAxis: 'y',
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

} // end typeof Chart check