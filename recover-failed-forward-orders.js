/**
 * Recover failed forward dispatch orders
 * 
 * This script finds exchange orders that are marked as "approved" but don't have
 * forward shipment IDs, and attempts to create the forward shipments for them.
 * 
 * Run: node recover-failed-forward-orders.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getShiprocketToken() {
  const response = await fetch('https://apiv2.shiprocket.in/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD
    })
  });
  
  const data = await response.json();
  if (!data.token) {
    throw new Error('Failed to get Shiprocket token');
  }
  return data.token;
}

async function createShiprocketForwardOrder(requestData) {
  try {
    const token = await getShiprocketToken();

    // Fetch Shopify Order for address/customer data
    let shopifyOrder = null;
    const needsAddress = !requestData.newAddress;
    const needsCustomer = !requestData.customerName || requestData.customerName === 'Customer' || !requestData.customerPhone || requestData.customerPhone === 'null';

    if (needsAddress || needsCustomer) {
      try {
        let orderName = requestData.orderNumber;
        let shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(orderName)}&status=any&limit=1`);

        if (!shopifyData.orders || shopifyData.orders.length === 0) {
          const altName = orderName.startsWith('#') ? orderName.substring(1) : `#${orderName}`;
          shopifyData = await shopifyAPI(`orders.json?name=${encodeURIComponent(altName)}&status=any&limit=1`);
        }

        shopifyOrder = shopifyData.orders && shopifyData.orders[0];
      } catch (e) {
        console.error('Failed to fetch original order for forward creation:', e);
      }
    }

    // Determine Address
    let billingAddress = requestData.newAddress;
    let billingCity = requestData.newCity;
    let billingPincode = requestData.newPincode;
    let billingState = '';

    if (!billingAddress) {
      if (shopifyOrder && shopifyOrder.shipping_address) {
        billingAddress = shopifyOrder.shipping_address.address1;
        billingCity = shopifyOrder.shipping_address.city;
        billingPincode = shopifyOrder.shipping_address.zip;
        billingState = shopifyOrder.shipping_address.province;
      } else if (requestData.shippingAddress) {
        const parts = requestData.shippingAddress.split(',').map(p => p.trim());
        billingAddress = parts.slice(0, -4).join(', ') || parts[0];
        billingCity = parts[parts.length - 4] || '';
        billingState = parts[parts.length - 3] || '';
        billingPincode = parts[parts.length - 2] || '';

        if (!billingPincode.match(/^\d{6}$/)) {
          const pinMatch = requestData.shippingAddress.match(/\b\d{6}\b/);
          if (pinMatch) billingPincode = pinMatch[0];
        }
      }
    }

    // Determine Customer Details
    let customerName = requestData.customerName;
    if (!customerName || customerName === 'Customer' || customerName === 'null') {
      if (shopifyOrder) {
        customerName = `${shopifyOrder.customer?.first_name || ''} ${shopifyOrder.customer?.last_name || ''}`.trim();
        if (!customerName) customerName = shopifyOrder.shipping_address?.name || 'Customer';
      } else {
        customerName = 'Customer';
      }
    }

    let customerPhone = requestData.customerPhone;
    if (!customerPhone || customerPhone === 'null' || customerPhone === '9999999999') {
      if (shopifyOrder) {
        customerPhone = shopifyOrder.shipping_address?.phone || shopifyOrder.customer?.phone || '';
      }
    }

    let cleanPhone = String(customerPhone).replace(/\D/g, '');
    customerPhone = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : '9999999999';

    customerPhone = (customerPhone || '').replace(/\D/g, '');
    if (customerPhone.length === 12 && customerPhone.startsWith('91')) {
      customerPhone = customerPhone.substring(2);
    }
    if (customerPhone.length > 10) {
      customerPhone = customerPhone.slice(-10);
    }
    if (customerPhone.length < 10) {
      customerPhone = '9999999999';
    }

    // Forward Order Items (Replacement Items)
    const items = Array.isArray(requestData.items) ? requestData.items : [];
    const orderItems = items.map(item => {
      const title = item.replacementProductTitle || item.name;
      const variantStr = (item.replacementVariant && item.replacementVariant !== 'Same') ? ` (${item.replacementVariant})` : '';
      const finalName = title + variantStr;
      const finalVariantId = (item.replacementVariantId && item.replacementVariantId !== 'Same') ? item.replacementVariantId : (item.variantId || item.id);

      return {
        name: finalName,
        sku: String(finalVariantId) + '-EXCH',
        units: parseInt(item.quantity) || 1,
        selling_price: parseFloat(item.replacementPrice || item.price) || 0,
        discount: 0,
        tax: 0
      };
    });

    const pickupLocationNickname = 'Primary';

    const payload = {
      order_id: requestData.requestId + '-FWD',
      order_date: new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0],
      pickup_location: pickupLocationNickname,
      billing_customer_name: customerName,
      billing_last_name: '',
      billing_address: (billingAddress || 'Address not available').substring(0, 190),
      billing_city: billingCity || billingState || 'City',
      billing_pincode: billingPincode || '110001',
      billing_state: billingState || billingCity || 'State',
      billing_country: 'India',
      billing_email: requestData.email || '',
      billing_phone: customerPhone,
      shipping_is_billing: true,
      order_items: orderItems,
      payment_method: 'Prepaid',
      sub_total: orderItems.reduce((sum, item) => sum + (item.selling_price * item.units), 0),
      length: 10, breadth: 10, height: 10, weight: 0.5
    };

    console.log(`🚀 Creating Forward Order for ${requestData.requestId}...`);

    const response = await fetch('https://apiv2.shiprocket.in/v1/external/orders/create/adhoc', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.status_code === 400 || data.status_code === 422 || (data.errors && Object.keys(data.errors).length > 0)) {
      console.error(`❌ Shiprocket Validation Error for ${requestData.requestId}:`, JSON.stringify(data));
      console.error('❌ Payload:', JSON.stringify(payload, null, 2));
      return null;
    }

    if (!response.ok) {
      console.error(`❌ Shiprocket API Error (HTTP ${response.status}) for ${requestData.requestId}:`, JSON.stringify(data));
      return null;
    }

    console.log(`✅ Success for ${requestData.requestId}: Shipment ID ${data.shipment_id}, AWB ${data.awb_code || 'Pending'}`);
    return data;
  } catch (error) {
    console.error(`❌ Failed to create forward order for ${requestData.requestId}:`, error.message);
    return null;
  }
}

async function shopifyAPI(endpoint) {
  const shopifyDomain = process.env.SHOPIFY_SHOP_DOMAIN;
  const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;
  
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

async function main() {
  console.log('\n🔍 Finding failed forward dispatch orders...\n');
  console.log('Looking for exchange orders that are:');
  console.log('  - Status: approved');
  console.log('  - Type: exchange');
  console.log('  - Missing forwardShipmentId\n');

  // Find approved exchange orders without forward shipment
  const { data: failedOrders, error: fetchError } = await supabase
    .from('requests')
    .select('*')
    .eq('type', 'exchange')
    .eq('status', 'approved')
    .is('forward_shipment_id', null)
    .order('created_at', { ascending: false });

  if (fetchError) {
    console.error('❌ Error fetching orders:', fetchError.message);
    process.exit(1);
  }

  if (!failedOrders || failedOrders.length === 0) {
    console.log('✅ No failed forward orders found!');
    return;
  }

  console.log(`📋 Found ${failedOrders.length} failed forward order(s):\n`);
  failedOrders.forEach((order, index) => {
    console.log(`${index + 1}. ${order.request_id} - Order #${order.order_number}`);
    console.log(`   Created: ${order.created_at}`);
    console.log(`   Items: ${order.items ? (typeof order.items === 'string' ? order.items : JSON.stringify(order.items)) : 'N/A'}\n`);
  });

  console.log('\n🔧 Attempting to create forward shipments...\n');

  let successCount = 0;
  let failCount = 0;

  for (const order of failedOrders) {
    try {
      let items = order.items;
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch (e) {
          items = [];
        }
      }

      const forwardOrder = await createShiprocketForwardOrder({
        ...order,
        items
      });

      if (forwardOrder && forwardOrder.shipment_id) {
        // Update the database with forward shipment details
        const { error: updateError } = await supabase
          .from('requests')
          .update({
            forward_shipment_id: String(forwardOrder.shipment_id),
            forward_awb_number: forwardOrder.awb_code || '',
            forward_status: 'scheduled',
            admin_notes: (order.admin_notes || '') + `\n[RECOVERY] Forward shipment created on ${new Date().toISOString()} (Shipment ID: ${forwardOrder.shipment_id})`,
            updated_at: new Date().toISOString()
          })
          .eq('request_id', order.request_id);

        if (updateError) {
          console.error(`❌ Database update failed for ${order.request_id}:`, updateError.message);
          failCount++;
        } else {
          console.log(`✅ Database updated for ${order.request_id}\n`);
          successCount++;
        }
      } else {
        console.error(`❌ Forward order creation failed for ${order.request_id}\n`);
        failCount++;
      }
    } catch (error) {
      console.error(`❌ Error processing ${order.request_id}:`, error.message);
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 RECOVERY SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Orders Processed: ${failedOrders.length}`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log('='.repeat(60));
  
  if (successCount > 0) {
    console.log('\n💡 Next Steps:');
    console.log('   1. Check Shiprocket dashboard for the created shipments');
    console.log('   2. Monitor pickup scheduling');
    console.log('   3. Track forward shipment delivery\n');
  }
}

main().catch(console.error);
