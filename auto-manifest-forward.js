/**
 * Automated Forward Manifest Scheduler
 * 
 * This script automatically:
 * 1. Finds all approved exchange orders missing forward shipments
 * 2. Creates Delhivery forward shipments for them
 * 3. Retries previously failed orders (insufficient balance)
 * 4. Can be scheduled via cron to run daily
 * 
 * Run manually: node auto-manifest-forward.js
 * Schedule daily: 0 9 * * * cd /path && node auto-manifest-forward.js
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
    console.log(`\n📦 Creating Delhivery Forward Order for ${requestData.request_id || requestData.requestId}...`);
    
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
      console.log('⚠️ Using DEFAULT warehouse location');
    } else {
      console.log('✅ Using warehouse from settings:', warehouseLocation.nickname || warehouseLocation.name);
    }
    
    console.log('📦 Warehouse Details:');
    console.log(`   Name: ${warehouseLocation.name}`);
    console.log(`   Address: ${warehouseLocation.address}`);
    console.log(`   City: ${warehouseLocation.city}, ${warehouseLocation.state} ${warehouseLocation.pincode}`);
    console.log(`   Phone: ${warehouseLocation.phone}`);
    console.log(`   Pickup Location Nickname: ${process.env.DELHIVERY_PICKUP_LOCATION || warehouseLocation.nickname || 'Primary'}`);


    // Parse items
    let items = requestData.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (e) { items = []; }
    }
    if (!items || !Array.isArray(items)) {
      items = [];
    }

    // If items are empty, try to get from Shopify order
    if ((items.length === 0) && shopifyOrder && shopifyOrder.line_items) {
      items = shopifyOrder.line_items.map(item => ({
        title: item.title || 'Product',
        sku: item.variant_sku || item.sku || 'SKU',
        quantity: item.quantity || 1,
        grams: item.grams || 500,
        price: item.price || 0
      }));
    }

    // Ensure we have at least one item
    if (items.length === 0) {
      items = [{
        title: 'Product',
        sku: 'SKU',
        quantity: 1,
        grams: 500,
        price: 0
      }];
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

    // Build forward order ID with fws- prefix (required by Delhivery for forward shipments)
    const forwardOrderId = `fws-${requestData.request_id || requestData.requestId}`;

    const payload = {
      format: 'json',
      data: JSON.stringify({
        shipments: [{
          order: forwardOrderId,
          payment_mode: "Prepaid",
          return_pincode: warehouseLocation.pincode || warehouseLocation.pin_code,
          return_city: warehouseLocation.city,
          return_state: warehouseLocation.state || 'Haryana',
          return_country: "India",
          return_name: warehouseLocation.name || "Warehouse",
          return_address: warehouseLocation.address || warehouseLocation.address_line_1,
          return_phone: warehouseLocation.phone,
          pickup_location: warehouseLocation.nickname || warehouseLocation.pickup_location || "Primary",
          shipping_pincode: requestData.shipping_pincode || requestData.pincode,
          shipping_city: requestData.shipping_city || requestData.city,
          shipping_state: requestData.shipping_state || requestData.state || 'Delhi',
          shipping_country: "India",
          shipping_name: sanitizeAddress(requestData.shipping_name || requestData.customer_name || requestData.customerName || 'Customer'),
          shipping_address: sanitizeAddress(requestData.shipping_address || requestData.address),
          shipping_phone: requestData.shipping_phone || requestData.customer_phone || requestData.customerPhone,
          order_items: items.map(item => ({
            title: item.title || 'Product',
            sku: item.sku || item.variant_sku || 'SKU',
            quantity: item.quantity || 1,
            grams: item.grams || 500,
            price: item.price || item.variant_price || 0
          })),
          total_amount: totalValue
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
      })
    };

    console.log('🚀 Sending to Delhivery CMU API...');
    console.log(`   Order ID: ${forwardOrderId}`);
    console.log(`   Customer: ${requestData.shipping_name || requestData.customer_name || requestData.customerName || 'Customer'}`);
    console.log(`   City: ${requestData.shipping_city || requestData.city}, ${requestData.shipping_state || requestData.state || 'Delhi'}`);
    console.log(`   Items: ${items.length} items`);
    console.log(`   Phone: ${requestData.shipping_phone || requestData.customer_phone || requestData.customerPhone}`);

    // Build the payload data object
    const payloadData = {
      shipments: [{
        order: forwardOrderId,
        name: sanitizeAddress(requestData.shipping_name || requestData.customer_name || requestData.customerName || 'Customer'),
        add: sanitizeAddress(requestData.shipping_address || requestData.address),
        pin: requestData.shipping_pincode || requestData.pincode,
        city: sanitizeAddress(requestData.shipping_city || requestData.city),
        state: sanitizeAddress(requestData.shipping_state || requestData.state || 'Delhi'),
        country: "India",
        phone: requestData.shipping_phone || requestData.customer_phone || requestData.customerPhone,
        payment_mode: "Prepaid",
        cod_amount: 0,
        return_pin: warehouseLocation.pincode || warehouseLocation.pin_code,
        return_add: sanitizeAddress(warehouseLocation.address || warehouseLocation.address_line_1),
        return_city: sanitizeAddress(warehouseLocation.city),
        return_state: sanitizeAddress(warehouseLocation.state || 'Haryana'),
        return_country: "India",
        return_phone: warehouseLocation.phone,
        order_items: items.map(item => ({
          title: item.title || 'Product',
          sku: item.sku || item.variant_sku || 'SKU',
          quantity: item.quantity || 1,
          grams: item.grams || 500,
          price: item.price || item.variant_price || 0
        })),
        total_amount: totalValue
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

    console.log('📦 Payload built successfully');

    const response = await fetch('https://track.delhivery.com/api/cmu/create.json', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.DELHIVERY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: `format=json&data=${JSON.stringify(payloadData)}`
    });

    let data;
    try {
      data = await response.json();
      console.log('📦 Delhivery Response Status:', response.status);
      console.log('📦 Delhivery Response:', JSON.stringify(data).substring(0, 500));
    } catch (parseError) {
      console.error('❌ Failed to parse Delhivery response:', parseError.message);
      const responseText = await response.text();
      console.error('❌ Raw response:', responseText.substring(0, 500));
      return null;
    }

    if (!response.ok) {
      console.error(`❌ Delhivery API Error (HTTP ${response.status}):`, JSON.stringify(data));
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

  if (error || !data) {
    return defaultValue;
  }

  return data.value;
}

async function autoManifestForwardOrders() {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 AUTOMATED FORWARD MANIFEST SCHEDULER');
  console.log('='.repeat(80));
  console.log(`Started at: ${new Date().toISOString()}`);

  // Get all approved exchange orders missing forward shipments
  const { data: failedOrders, error } = await supabase
    .from('requests')
    .select('*')
    .eq('type', 'exchange')
    .eq('status', 'approved')
    .is('forward_shipment_id', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Database error:', error.message);
    process.exit(1);
  }

  if (!failedOrders || failedOrders.length === 0) {
    console.log('\n✅ No pending forward orders to manifest!');
    console.log('All approved exchanges have forward shipments created.');
    return;
  }

  console.log(`\n📋 Found ${failedOrders.length} pending forward order(s) to manifest:\n`);
  console.log('━'.repeat(80));

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

      // Prepare request data with Shopify address
      const requestData = { ...order };
      
      // Ensure requestId is available in both formats
      requestData.requestId = order.request_id;
      
      if (shopifyOrder && shopifyOrder.shipping_address) {
        const addr = shopifyOrder.shipping_address;
        requestData.shipping_name = `${addr.first_name || ''} ${addr.last_name || ''}`.trim() || order.customer_name || 'Customer';
        requestData.shipping_address = `${addr.address1}${addr.address2 ? ', ' + addr.address2 : ''}`;
        requestData.shipping_city = addr.city;
        requestData.shipping_state = addr.province;
        requestData.shipping_pincode = addr.zip;
        requestData.shipping_phone = addr.phone || shopifyOrder.customer?.phone || '';
        
        console.log(`   📍 Using Shopify address: ${requestData.shipping_city}, ${requestData.shipping_state}`);
      }

      // Create Delhivery forward shipment
      const forwardOrder = await createDelhiveryForwardOrder(requestData, shopifyOrder);

      if (forwardOrder && forwardOrder.waybill) {
        // Update database with forward shipment details
        const { error: updateError } = await supabase
          .from('requests')
          .update({
            forward_shipment_id: forwardOrder.shipment_id,
            forward_awb_number: forwardOrder.waybill,
            forward_status: 'scheduled',
            admin_notes: (order.admin_notes || '') + `\n${new Date().toISOString()} - Forward shipment auto-manifested via Delhivery: AWB ${forwardOrder.waybill}`
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
        console.error(`❌ Failed to create forward shipment`);
        failCount++;
        results.push({ requestId: order.request_id, awb: null, status: 'failed' });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error(`❌ Unexpected error for ${order.request_id}:`, error.message);
      failCount++;
      results.push({ requestId: order.request_id, awb: null, status: 'error', error: error.message });
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 MANIFEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Processed: ${failedOrders.length}`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log('='.repeat(80));

  if (successCount > 0) {
    console.log('\n✅ Successfully Manifested:');
    results.filter(r => r.status === 'success').forEach(r => {
      console.log(`   ${r.requestId}: AWB ${r.awb}`);
    });
  }

  if (failCount > 0) {
    console.log('\n❌ Failed Orders (will retry on next run):');
    results.filter(r => r.status !== 'success').forEach(r => {
      console.log(`   ${r.requestId}${r.error ? ` - ${r.error}` : ''}`);
    });
    console.log('\n💡 These orders will be automatically retried on the next scheduled run.');
    console.log('   Common reasons for failure:');
    console.log('   - Insufficient Delhivery account balance');
    console.log('   - Invalid customer address/phone');
    console.log('   - Shopify order not found');
  }

  console.log('\n✅ Auto-manifest complete!\n');
}

// Run the script
autoManifestForwardOrders().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
