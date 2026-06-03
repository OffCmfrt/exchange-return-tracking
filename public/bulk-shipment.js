// Multi-Product Selection & Bulk Shipment Functions
// Extracted from page.influencer-admin.liquid to reduce file size

// Initialize selected products set
window.srSelectedProducts = new Set();

// Toggle individual product selection
function toggleProductSelection(productId) {
  const checkbox = document.getElementById(`select-product-${productId}`);
  const card = document.getElementById(`product-card-${productId}`);
  
  if (checkbox.checked) {
    window.srSelectedProducts.add(productId);
    card.style.borderColor = 'var(--text, #000)';
    card.style.boxShadow = '0 0 0 2px var(--text, #000)';
  } else {
    window.srSelectedProducts.delete(productId);
    card.style.borderColor = 'var(--border)';
    card.style.boxShadow = 'none';
  }
  
  updateSelectionUI();
}

// Toggle select all products
function toggleSelectAll() {
  const selectAllCheckbox = document.getElementById('srSelectAll');
  const products = window.srCurrentProducts || [];
  
  if (selectAllCheckbox.checked) {
    products.forEach(p => {
      window.srSelectedProducts.add(p.id);
      const checkbox = document.getElementById(`select-product-${p.id}`);
      const card = document.getElementById(`product-card-${p.id}`);
      if (checkbox) checkbox.checked = true;
      if (card) {
        card.style.borderColor = 'var(--text, #000)';
        card.style.boxShadow = '0 0 0 2px var(--text, #000)';
      }
    });
  } else {
    products.forEach(p => {
      window.srSelectedProducts.delete(p.id);
      const checkbox = document.getElementById(`select-product-${p.id}`);
      const card = document.getElementById(`product-card-${p.id}`);
      if (checkbox) checkbox.checked = false;
      if (card) {
        card.style.borderColor = 'var(--border)';
        card.style.boxShadow = 'none';
      }
    });
  }
  
  updateSelectionUI();
}

// Update selection UI (count and button state)
function updateSelectionUI() {
  const count = window.srSelectedProducts.size;
  const countEl = document.getElementById('srSelectedCount');
  const btn = document.getElementById('srBulkAssignBtn');
  const selectAllCheckbox = document.getElementById('srSelectAll');
  const products = window.srCurrentProducts || [];
  
  if (countEl) countEl.textContent = `${count} product${count !== 1 ? 's' : ''} selected`;
  
  if (btn) {
    if (count > 0) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    } else {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }
  }
  
  if (selectAllCheckbox && products.length > 0) {
    selectAllCheckbox.checked = count === products.length;
  }
}

// Open bulk assign modal for multiple products
function openBulkAssignModal() {
  const selectedIds = Array.from(window.srSelectedProducts);
  
  if (selectedIds.length === 0) {
    alert('Please select at least one product');
    return;
  }
  
  const products = (window.srCurrentProducts || []).filter(p => selectedIds.includes(p.id));
  window.srBulkProducts = products;
  
  const modal = document.createElement('div');
  modal.id = 'srBulkAssignModal';
  modal.className = 'modal-overlay';
  
  const productListHtml = products.map((p, index) => {
    const imageUrl = p.images[0]?.src || '';
    const variants = p.variants || [];
    
    // Build size options for this product
    const sizeOptionsHtml = variants.length > 1 
      ? variants.map((v, i) => `<option value="${v.id}" data-size="${v.title}" ${i === 0 ? 'selected' : ''}>${v.title} - Stock: ${v.inventoryQuantity}</option>`).join('')
      : `<option value="${variants[0]?.id}" data-size="${variants[0]?.title || 'Default'}" selected>${variants[0]?.title || 'Default'} - Stock: ${variants[0]?.inventoryQuantity || 0}</option>`;
    
    return `
      <div class="product-item" style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border);">
        ${imageUrl ? `<img src="${imageUrl}" class="product-thumb">` : '<div class="product-thumb" style="display: flex; align-items: center; justify-content: center; font-size: 0.6rem;">No img</div>'}
        <div class="product-info" style="flex: 1;">
          <p class="product-name">${p.title}</p>
          <p class="product-meta">&#8377;${p.variants[0]?.price || '0'} · ${p.totalStock} in stock</p>
          <div class="ia-form-group" style="margin-top: 0.5rem; margin-bottom: 0;">
            <label for="bulkSize_${p.id}" class="form-label-sm" style="font-size: 0.65rem;">Select Size *</label>
            <select id="bulkSize_${p.id}" class="ia-input form-input-sm" data-product-id="${p.id}">
              ${sizeOptionsHtml}
            </select>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3 class="modal-title">Assign ${products.length} Products & Create Shipment</h3>
        <button onclick="closeBulkAssignModal()" class="modal-close-btn">&times;</button>
      </div>
      
      <div style="padding: 1rem; background: var(--subtle); margin-bottom: 1.5rem; border-left: 3px solid var(--text); max-height: 200px; overflow-y: auto;">
        <p style="font-size: 0.75rem; font-weight: 600; margin: 0 0 0.75rem;">Selected Products:</p>
        ${productListHtml}
      </div>
      
      <div class="ia-form-group">
        <label for="bulkInfluencer" class="form-label">Select Ambassador *</label>
        <select id="bulkInfluencer" class="ia-input form-input" required>
          <option value="">Choose ambassador...</option>
        </select>
      </div>
      
      <div class="ia-form-group">
        <label for="bulkSentAt" class="form-label">Sent Date *</label>
        <input type="date" id="bulkSentAt" class="ia-input form-input" required value="${new Date().toISOString().split('T')[0]}">
      </div>
      
      <div class="ia-form-group">
        <label for="bulkReelDueDate" class="form-label">Reel Due Date (Optional)</label>
        <input type="date" id="bulkReelDueDate" class="ia-input form-input" min="${new Date().toISOString().split('T')[0]}">
        <span style="font-size: 0.65rem; color: var(--muted); margin-top: 0.3rem; display: block;">Leave blank for inventory-based shipments</span>
      </div>
      
      <div class="info-box">
        <p class="info-box-title">Shipping Address</p>
        <p class="info-box-desc">Will auto-fill when you select an ambassador</p>
      </div>
      
      <div class="grid-2">
        <div class="ia-form-group">
          <label for="bulkShipName" class="form-label-sm">Full Name *</label>
          <input type="text" id="bulkShipName" class="ia-input form-input-sm" required>
        </div>
        <div class="ia-form-group">
          <label for="bulkShipPhone" class="form-label-sm">Phone Number *</label>
          <input type="tel" id="bulkShipPhone" class="ia-input form-input-sm" required pattern="[0-9]{10}" maxlength="10">
        </div>
      </div>
      
      <div class="ia-form-group">
        <label for="bulkShipAddress1" class="form-label-sm">Address Line 1 *</label>
        <input type="text" id="bulkShipAddress1" class="ia-input form-input-sm" required>
      </div>
      
      <div class="ia-form-group">
        <label for="bulkShipAddress2" class="form-label-sm">Address Line 2 (Optional)</label>
        <input type="text" id="bulkShipAddress2" class="ia-input form-input-sm">
      </div>
      
      <div class="grid-3">
        <div class="ia-form-group">
          <label for="bulkShipCity" class="form-label-sm">City *</label>
          <input type="text" id="bulkShipCity" class="ia-input form-input-sm" required>
        </div>
        <div class="ia-form-group">
          <label for="bulkShipState" class="form-label-sm">State *</label>
          <input type="text" id="bulkShipState" class="ia-input form-input-sm" required>
        </div>
        <div class="ia-form-group">
          <label for="bulkShipPincode" class="form-label-sm">Pincode *</label>
          <input type="text" id="bulkShipPincode" class="ia-input form-input-sm" required pattern="[0-9]{6}" maxlength="6">
        </div>
      </div>
      
      <div class="ia-form-group">
        <label for="bulkIsMonthlyTarget" class="form-label">Mark as Monthly Target? *</label>
        <select id="bulkIsMonthlyTarget" class="ia-input form-input">
          <option value="true">Yes - Counts towards monthly reel quota</option>
          <option value="false" selected>No - Regular shipment only</option>
        </select>
      </div>
      
      <div class="ia-form-group">
        <label for="bulkNotes" class="form-label">Notes (Optional)</label>
        <textarea id="bulkNotes" class="ia-input form-input-sm" rows="2" placeholder="Any special instructions..." style="resize: vertical;"></textarea>
      </div>
      
      <div class="btn-row">
        <button onclick="closeBulkAssignModal()" class="btn-flex">Cancel</button>
        <button onclick="saveBulkShipment()" class="btn-flex-primary">Create Shipment for ${products.length} Products</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  loadInfluencersForBulkShipment();
}

function closeBulkAssignModal() {
  const modal = document.getElementById('srBulkAssignModal');
  if (modal) modal.remove();
}

async function loadInfluencersForBulkShipment() {
  try {
    const res = await fetch(`${API}/list`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    
    if (data.success || Array.isArray(data)) {
      const influencers = Array.isArray(data) ? data : (data.influencers || []);
      const select = document.getElementById('bulkInfluencer');
      select.innerHTML = '<option value="">Choose ambassador...</option>' + 
        influencers.map(i => `<option value="${i.id}">${i.name || i.handle || 'Influencer'}</option>`).join('');
      
      select.addEventListener('change', function() {
        const selectedInfluencer = influencers.find(i => i.id == this.value);
        if (selectedInfluencer) {
          document.getElementById('bulkShipName').value = selectedInfluencer.name || '';
          document.getElementById('bulkShipPhone').value = selectedInfluencer.phone || '';
          document.getElementById('bulkShipAddress1').value = selectedInfluencer.shipping_address || '';
          document.getElementById('bulkShipAddress2').value = selectedInfluencer.shipping_landmark || '';
          document.getElementById('bulkShipCity').value = selectedInfluencer.shipping_city || selectedInfluencer.city || '';
          document.getElementById('bulkShipState').value = selectedInfluencer.shipping_state || '';
          document.getElementById('bulkShipPincode').value = selectedInfluencer.shipping_pin || '';
        } else {
          ['bulkShipName', 'bulkShipPhone', 'bulkShipAddress1', 'bulkShipAddress2', 'bulkShipCity', 'bulkShipState', 'bulkShipPincode'].forEach(id => {
            document.getElementById(id).value = '';
          });
        }
      });
    }
  } catch (e) { }
}

async function saveBulkShipment() {
  const influencerId = document.getElementById('bulkInfluencer').value;
  const sentAt = document.getElementById('bulkSentAt').value;
  const reelDueDate = document.getElementById('bulkReelDueDate').value || null;
  const isMonthlyTarget = document.getElementById('bulkIsMonthlyTarget').value === 'true';
  const notes = document.getElementById('bulkNotes').value.trim() || null;
  
  const shippingFullName = document.getElementById('bulkShipName').value.trim();
  const shippingPhone = document.getElementById('bulkShipPhone').value.trim();
  const shippingAddressLine1 = document.getElementById('bulkShipAddress1').value.trim();
  const shippingAddressLine2 = document.getElementById('bulkShipAddress2').value.trim();
  const shippingCity = document.getElementById('bulkShipCity').value.trim();
  const shippingState = document.getElementById('bulkShipState').value.trim();
  const shippingPincode = document.getElementById('bulkShipPincode').value.trim();
  
  const products = window.srBulkProducts || [];
  
  if (!influencerId) { alert('Please select an ambassador'); return; }
  if (!sentAt) { alert('Please select a sent date'); return; }
  if (products.length === 0) { alert('No products selected'); return; }
  if (!shippingFullName) { alert('Please enter full name'); return; }
  if (!shippingPhone || shippingPhone.length !== 10) { alert('Please enter a valid 10-digit phone number'); return; }
  if (!shippingAddressLine1) { alert('Please enter address'); return; }
  if (!shippingCity) { alert('Please enter city'); return; }
  if (!shippingState) { alert('Please enter state'); return; }
  if (!shippingPincode || shippingPincode.length !== 6) { alert('Please enter a valid 6-digit pincode'); return; }
  
  const productsArray = products.map(p => {
    const sizeSelect = document.getElementById(`bulkSize_${p.id}`);
    const selectedVariantId = sizeSelect ? sizeSelect.value : (p.variants[0]?.id?.toString() || '');
    const selectedSize = sizeSelect && sizeSelect.options[sizeSelect.selectedIndex] 
      ? sizeSelect.options[sizeSelect.selectedIndex].getAttribute('data-size') 
      : (p.variants[0]?.title || '');
    
    return {
      productTitle: p.title,
      productImageUrl: p.images[0]?.src || '',
      shopifyProductId: p.id.toString(),
      variantId: selectedVariantId,
      size: selectedSize,
      quantity: 1
    };
  });
  
  try {
    const res = await fetch(`${API}/shipments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        influencerId,
        products: productsArray,
        sentAt,
        reelDueDate,
        isMonthlyTarget,
        notes,
        shippingFullName,
        shippingPhone,
        shippingAddressLine1,
        shippingAddressLine2,
        shippingCity,
        shippingState,
        shippingPincode
      })
    });
    
    const data = await res.json();
    
    if (data.success) {
      showToast(`Shipment created successfully for ${products.length} product${products.length > 1 ? 's' : ''}!`);
      closeBulkAssignModal();
      window.srSelectedProducts.clear();
      updateSelectionUI();
      searchShopifyProducts(srCurrentPage);
    } else {
      alert(data.error || 'Failed to create shipment');
    }
  } catch (e) {
    alert('Network error. Please try again.');
  }
}
