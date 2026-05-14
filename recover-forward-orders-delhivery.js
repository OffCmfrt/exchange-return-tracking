/**
 * Recover failed forward orders using Delhivery
 * 
 * This script finds exchange orders marked as "approved" but missing forward shipment IDs,
 * and creates Delhivery forward shipments for them.
 * 
 * Run: node recover-forward-orders-delhivery.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function shopifyAPI(endpoint) {
  const shopifyDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;
  
  if (!shopifyDomain) {
    throw new Error('SHOPIFY_STORE_DOMAIN not set in .env');
  }
  
  const url = `https://${shopifyDomain}/admin/api/2024-01/${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': shopifyToken,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Shopify API Error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

async function createDelhiveryForwardOrder(requestData, shopifyOrder) {
  try {
    console.log(`\n📦 Creating Delhivery Forward Order for ${requestData.requestId}...`);
    
    // Get address from Shopify order
    const address = shopifyOrder ? (shopifyOrder.shipping_address || (shopifyOrder.customer && shopifyOrder.customer.default_address)) : null;
    
    if (!address) {
      console.error(`❌ No address found for ${requestData.requestId}`);
      return null;
    }

    // Get warehouse location for pickup (with defaults)
    let warehouseLocation = await getSetting('warehouse_location', null);
    
    // Use defaults if not configured
    if (!warehouseLocation) {
      warehouseLocation = {
        name: 'BURB MANUFACTURES PVT LTD',
        address: 'VILLAGE - BAIRAWAS, NEAR GOVT. SCHOOL',
        city: 'MAHENDERGARH',
        state: 'Haryana',
        country: 'IN',
        pincode: '123028',
        phone: '9138514222',
        email: 'returns@offcomfort.com',
        nickname: 'Primary'
      };
      console.log('⚠️ Using default warehouse location');
    }

    // Parse items
    let items = requestData.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (e) { items = []; }
    }

    // If items are empty, try to get from Shopify order
    if ((!items || items.length === 0) && shopifyOrder && shopifyOrder.line_items) {
      items = shopifyOrder.line_items.map(item => ({
        title: item.title || 'Product',
        sku: item.variant_sku || item.sku || 'SKU',
        quantity: item.quantity || 1,
        grams: item.grams || 500,
        price: item.price || 0
      }));
    }

    // Calculate total value
    const totalValue = items.reduce((sum, item) => {
      return sum + ((item.price || item.variant_price || 0) * (item.quantity || 1));
    }, 0);

    // Sanitize addresses - Delhivery doesn't accept: &, #, %, ;, \
    const sanitizeAddress = (str) => {
      if (!str) return '';
      return str.replace(/[&#%;\\]/g, '').trim();
    };

    // Get customer name and address
    const customerName = shopifyOrder.customer ? 
      `${shopifyOrder.customer.first_name || ''} ${shopifyOrder.customer.last_name || ''}`.trim() : 
      'Customer';
    const customerAddress = `${address.address1 || ''} ${address.address2 || ''}`.trim();
    const customerCity = address.city || 'City';
    const customerState = address.province || 'State';
    const customerPincode = address.zip;
    const customerCountry = address.country_code || 'IN';
    
    // Get phone number
    let customerPhone = address.phone || shopifyOrder.customer?.phone || '';
    let digits = String(customerPhone).replace(/\D/g, '');
    customerPhone = digits.length >= 10 ? digits.slice(-10) : '9999999999';

    // Build forward order ID with fws_ prefix (required by Delhivery for forward shipments)
    const forwardOrderId = `fws-${requestData.request_id || requestData.requestId}`;

    // Build payload matching server.js format
    const payload = {
      shipments: [{
        name: sanitizeAddress(customerName),
        add: sanitizeAddress(customerAddress),
        pin: customerPincode,
        city: sanitizeAddress(customerCity),
        state: sanitizeAddress(customerState),
        country: customerCountry,
        phone: customerPhone,
        payment_mode: 'Prepaid',
        order: forwardOrderId,
        cod_amount: 0,
        return_pin: warehouseLocation.pincode || warehouseLocation.pin_code,
        return_add: sanitizeAddress(warehouseLocation.address || warehouseLocation.address_line_1),
        return_city: sanitizeAddress(warehouseLocation.city),
        return_state: sanitizeAddress(warehouseLocation.state || 'Haryana'),
        return_country: 'IN',
        return_phone: warehouseLocation.phone
      }],
      pickup_location: {
        name: process.env.DELHIVERY_PICKUP_LOCATION || warehouseLocation.nickname || warehouseLocation.pickup_location || 'Primary',
        add: sanitizeAddress(warehouseLocation.address || warehouseLocation.address_line_1),
        pin: warehouseLocation.pincode || warehouseLocation.pin_code,
        city: sanitizeAddress(warehouseLocation.city),
        state: sanitizeAddress(warehouseLocation.state || 'Haryana'),
        country: 'IN',
        phone: warehouseLocation.phone
      }
    };

    console.log('🚀 Sending to Delhivery:', JSON.stringify(payload, null, 2));

    const response = await fetch('https://track.delhivery.com/api/cmu/create.json', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.DELHIVERY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: `format=json&data=${JSON.stringify(payload)}`
    });

    const data = await response.json();
    console.log('📬 Delhivery Response:', JSON.stringify(data, null, 2));

    if (data.error || data.status === "Error") {
      console.error('❌ Delhivery Error:', data.error || data.message);
      return null;
    }

    // Extract waybill and shipment details
    const waybill = data.packages?.[0]?.waybill;
    const shipmentId = data.packages?.[0]?.shipment_id || forwardOrderId;
    const isSuccess = data.success || data.packages?.[0]?.status !== 'Fail';

    if (waybill) {
      console.log(`✅ Delhivery Forward Success!`);
      console.log(`   Waybill: ${waybill}`);
      console.log(`   Order ID: ${forwardOrderId}`);
      
      return {
        waybill,
        shipment_id: shipmentId,
        order_id: forwardOrderId
      };
    } else if (data.packages?.[0]?.waybill) {
      // Even if status is Fail but waybill exists, return it
      console.log(`⚠️ Delhivery Forward Partial Success (has waybill despite error)`);
      console.log(`   Waybill: ${data.packages[0].waybill}`);
      console.log(`   Order ID: ${forwardOrderId}`);
      
      return {
        waybill: data.packages[0].waybill,
        shipment_id: shipmentId,
        order_id: forwardOrderId
      };
    } else {
      console.error('❌ Delhivery did not return waybill');
      console.error('   Error:', data.rmk || data.error);
      return null;
    }

  } catch (error) {
    console.error(`❌ Error creating Delhivery forward order:`, error.message);
    return null;
  }
}

async function getSetting(key, defaultValue) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();
  
  if (error || !data) return defaultValue;
  
  try {
    return JSON.parse(data.value);
  } catch {
    return data.value || defaultValue;
  }
}

async function recoverFailedForwardOrders() {
  console.log('\n🔍 Searching for failed forward orders...\n');

  // Find approved exchange orders without forward shipment IDs
  const { data: failedOrders, error } = await supabase
    .from('requests')
    .select('*')
    .eq('type', 'exchange')
    .eq('status', 'approved')
    .or('forward_shipment_id.is.null,forward_shipment_id.eq.null')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('❌ Database error:', error.message);
    return;
  }

  if (!failedOrders || failedOrders.length === 0) {
    console.log('✅ No failed forward orders found!');
    return;
  }

  console.log(`📋 Found ${failedOrders.length} failed forward orders\n`);
  console.log('━'.repeat(80));

  // Show summary
  failedOrders.forEach((order, index) => {
    console.log(`${index + 1}. ${order.request_id} | Order: ${order.order_number || order.orderNumber} | Customer: ${order.customer_name || order.customerName || 'N/A'}`);
  });
  console.log('━'.repeat(80));

  // Process each order
  let successCount = 0;
  let failCount = 0;
  const results = [];

  for (const order of failedOrders) {
    try {
      console.log(`\n[${order.request_id}] Processing...`);

      // Get Shopify order for address
      let shopifyOrder = null;
      try {
        const orderName = order.order_number || order.orderNumber;
        const shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderName)}&status=any&limit=1`);
        shopifyOrder = shopifyData.orders?.[0];
        
        if (!shopifyOrder) {
          console.warn(`⚠️ Shopify order not found: ${orderName}`);
        }
      } catch (e) {
        console.error(`❌ Failed to fetch Shopify order:`, e.message);
      }

      // Create Delhivery forward shipment
      const forwardOrder = await createDelhiveryForwardOrder(order, shopifyOrder);

      if (forwardOrder && forwardOrder.waybill) {
        // Update database with forward shipment details
        const { error: updateError } = await supabase
          .from('requests')
          .update({
            forward_shipment_id: forwardOrder.shipment_id,
            forward_awb_number: forwardOrder.waybill,
            forward_status: 'scheduled',
            admin_notes: (order.admin_notes || '') + `\n${new Date().toISOString()} - Forward shipment created via Delhivery: AWB ${forwardOrder.waybill}`
          })
          .eq('request_id', order.request_id);

        if (updateError) {
          console.error(`❌ Failed to update database: ${updateError.message}`);
          failCount++;
        } else {
          console.log(`✅ SUCCESS - AWB: ${forwardOrder.waybill}`);
          successCount++;
          results.push({ requestId: order.request_id, awb: forwardOrder.waybill, status: 'success' });
        }
      } else {
        console.error(`❌ FAILED - Could not create Delhivery forward shipment`);
        failCount++;
        results.push({ requestId: order.request_id, status: 'failed' });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`❌ Unexpected error for ${order.request_id}:`, error.message);
      failCount++;
      results.push({ requestId: order.request_id, status: 'error', error: error.message });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 RECOVERY SUMMARY');
  console.log('='.repeat(80));
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📝 Total: ${failedOrders.length}`);
  console.log('='.repeat(80));

  // Show successful AWBs
  if (successCount > 0) {
    console.log('\n✅ SUCCESSFUL FORWARD SHIPMENTS:');
    results.filter(r => r.status === 'success').forEach(r => {
      console.log(`   ${r.requestId}: AWB ${r.awb}`);
    });
  }

  // Show failures
  if (failCount > 0) {
    console.log('\n❌ FAILED ORDERS:');
    results.filter(r => r.status !== 'success').forEach(r => {
      console.log(`   ${r.requestId}: ${r.status}${r.error ? ' - ' + r.error : ''}`);
    });
  }
}

// Run the recovery
recoverFailedForwardOrders().catch(console.error);
