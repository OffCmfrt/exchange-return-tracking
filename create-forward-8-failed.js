/**
 * Create forward shipments for the 8 failed orders
 * Using CORRECT replacement products from database
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getWarehouseLocation() {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'warehouse_location')
    .single();

  if (error || !data) {
    return {
      name: 'BURB MANUFACTURES PVT LTD',
      address: 'VILLAGE - BAIRAWAS, NEAR GOVT. SCHOOL',
      city: 'MAHENDERGARH',
      state: 'Haryana',
      country: 'IN',
      pincode: '123028',
      phone: '9138514222',
      nickname: 'Primary'
    };
  }

  return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
}

function sanitizeAddress(str) {
  if (!str) return '';
  return str.replace(/[&#%;\\]/g, '').trim();
}

async function createForwardForFailedOrders() {
  console.log('\n=== CREATING FORWARD SHIPMENTS FOR 8 FAILED ORDERS ===\n');

  const requestIds = [
    'REQ-60414', 'REQ-66532', 'REQ-13161', 'REQ-94765',
    'REQ-35188', 'REQ-57939', 'REQ-22347', 'REQ-51923'
  ];

  const { data: orders, error } = await supabase
    .from('requests')
    .select('*')
    .in('request_id', requestIds);

  if (error) {
    console.error('❌ Error fetching orders:', error);
    return;
  }

  console.log(`✅ Found ${orders.length} orders\n`);

  const warehouseLocation = await getWarehouseLocation();

  let successCount = 0;
  let failCount = 0;

  for (const order of orders) {
    console.log(`\n${'='.repeat(80)}`);
    
    // Get replacement items from database
    let items = order.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (e) { items = []; }
    }

    console.log(`📦 ${order.request_id} - Order #${order.order_number}`);
    console.log(`   Customer: ${order.customer_name || 'Customer'}`);
    console.log(`   Replacement Products:`);
    items.forEach((item, idx) => {
      console.log(`   ${idx + 1}. ${item.replacementProductTitle || item.name}`);
      console.log(`      Original: ${item.variant} → Replacement: ${item.replacementVariant}`);
      console.log(`      Variant ID: ${item.replacementVariantId}`);
      console.log(`      Price: ₹${item.replacementPrice || item.price}`);
    });

    // Sanitize phone
    let customerPhone = order.customer_phone || '';
    let cleanPhone = String(customerPhone).replace(/\D/g, '');
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) cleanPhone = cleanPhone.substring(2);
    if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    customerPhone = (cleanPhone.length === 10 && /^[6-9]\d{9}$/.test(cleanPhone)) ? cleanPhone : '9999999999';

    // Parse shipping address - it's a single string like "address, city, state, pincode, country"
    const fullAddress = order.shipping_address || '';
    const addressParts = fullAddress.split(',').map(s => s.trim());
    
    // Extract components from the address string
    let customerAddress = fullAddress; // Use full address as default
    let customerCity = 'City';
    let customerState = 'State';
    let customerPincode = '110001';
    let customerCountry = 'IN';
    
    if (addressParts.length >= 3) {
      // Try to parse: [...address..., city, state, pincode, country]
      customerAddress = addressParts.slice(0, -3).join(', '); // Everything except last 3
      customerCity = addressParts[addressParts.length - 4] || 'City';
      customerState = addressParts[addressParts.length - 3] || 'State';
      
      // Extract pincode (should be 6 digits)
      const pincodeMatch = addressParts.find(part => /\b\d{6}\b/.test(part));
      if (pincodeMatch) {
        customerPincode = pincodeMatch.match(/\b\d{6}\b/)[0];
      }
      
      // Last part is usually country
      const lastPart = addressParts[addressParts.length - 1];
      if (lastPart && !/\d/.test(lastPart)) {
        customerCountry = lastPart.toUpperCase() === 'INDIA' ? 'IN' : lastPart;
      }
    }

    console.log(`   📍 Address: ${customerAddress}`);
    console.log(`   🏙️  ${customerCity}, ${customerState} ${customerPincode}`);

    const forwardOrderId = `fws-${order.request_id}`;

    // Build Delhivery payload
    const payload = {
      shipments: [{
        name: sanitizeAddress(order.customer_name || 'Customer'),
        add: sanitizeAddress(customerAddress),
        pin: customerPincode,
        city: sanitizeAddress(customerCity),
        state: sanitizeAddress(customerState),
        country: customerCountry,
        phone: customerPhone,
        payment_mode: 'Prepaid',
        order: forwardOrderId,
        cod_amount: 0,
        return_pin: warehouseLocation.pincode,
        return_add: sanitizeAddress(warehouseLocation.address),
        return_city: sanitizeAddress(warehouseLocation.city),
        return_state: sanitizeAddress(warehouseLocation.state),
        return_country: 'IN',
        return_phone: warehouseLocation.phone
      }],
      pickup_location: {
        name: process.env.DELHIVERY_PICKUP_LOCATION || warehouseLocation.nickname || 'Primary',
        add: sanitizeAddress(warehouseLocation.address),
        pin: warehouseLocation.pincode,
        city: sanitizeAddress(warehouseLocation.city),
        state: sanitizeAddress(warehouseLocation.state),
        country: 'IN',
        phone: warehouseLocation.phone
      }
    };

    console.log(`\n🚀 Creating forward shipment...`);

    const response = await fetch('https://track.delhivery.com/api/cmu/create.json', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.DELHIVERY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: `format=json&data=${JSON.stringify(payload)}`
    });

    const data = await response.json();
    console.log(`   📬 Response:`, JSON.stringify(data, null, 2));

    if (data.packages?.[0]?.waybill) {
      const waybill = data.packages[0].waybill;
      
      console.log(`✅ SUCCESS - AWB: ${waybill}`);

      // Update database
      const { error: updateError } = await supabase
        .from('requests')
        .update({
          forwardShipmentId: data.packages[0].shipment_id || forwardOrderId,
          forwardAwbNumber: waybill,
          forwardStatus: 'scheduled',
          admin_notes: (order.admin_notes || '') + `\n${new Date().toISOString()} - Forward created with CORRECT replacement products: AWB ${waybill}`
        })
        .eq('request_id', order.request_id);

      if (updateError) {
        console.error(`   ❌ DB update failed: ${updateError.message}`);
        failCount++;
      } else {
        successCount++;
      }
    } else {
      console.error(`❌ FAILED:`, data.error || data.message || data.packages?.[0]?.status || 'Unknown error');
      if (data.packages?.[0]?.error) {
        console.error(`   Details:`, data.packages[0].error);
      }
      failCount++;
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 FINAL RESULTS:`);
  console.log(`   ✅ Created: ${successCount} forward shipments`);
  console.log(`   ❌ Failed: ${failCount} orders`);
  console.log(`   📦 Total: ${orders.length} orders`);
  console.log(`${'='.repeat(80)}\n`);
}

createForwardForFailedOrders().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
