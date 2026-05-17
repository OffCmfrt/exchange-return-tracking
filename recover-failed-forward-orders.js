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
  try {
    const response = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASSWORD
      })
    });
    
    const data = await response.json();
    if (!data.token) {
      console.error('❌ Shiprocket login failed:', JSON.stringify(data));
      throw new Error('Failed to get Shiprocket token');
    }
    console.log('✅ Shiprocket token obtained successfully');
    return data.token;
  } catch (error) {
    console.error('❌ Error getting Shiprocket token:', error.message);
    throw error;
  }
}

async function createShiprocketForwardOrder(requestData) {
  try {
    const token = await getShiprocketToken();

    console.log(`\n📦 Processing ${requestData.requestId}...`);
    console.log(`   Order #: ${requestData.order_number || requestData.orderNumber}`);
    console.log(`   Customer: ${requestData.customer_name || requestData.customerName || 'N/A'}`);
    console.log(`   Phone: ${requestData.customer_phone || requestData.customerPhone || 'N/A'}`);

    // Use data directly from database
    let customerName = requestData.customer_name || requestData.customerName || 'Customer';
    if (customerName === 'Customer' || customerName === 'null' || !customerName) {
      customerName = 'Customer';
    }

    // Get phone from database - this is the critical field
    let customerPhone = requestData.customer_phone || requestData.customerPhone || '';
    
    // Sanitize phone number
    let cleanPhone = String(customerPhone || '').replace(/\D/g, '');
    
    // Remove country code if present
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      cleanPhone = cleanPhone.substring(2);
    }
    if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.substring(1);
    }
    
    // Validate Indian phone number (10 digits, starts with 6-9)
    if (cleanPhone.length === 10 && /^[6-9]\d{9}$/.test(cleanPhone)) {
      customerPhone = cleanPhone;
      console.log(`   ✅ Valid phone: ${customerPhone}`);
    } else {
      console.error(`   ❌ Invalid/missing phone in database: '${customerPhone}' (cleaned: '${cleanPhone}')`);
      console.error(`   💡 This order needs a valid 10-digit Indian phone number`);
      return null;
    }

    // Get address from database
    let billingAddress = requestData.new_address || requestData.newAddress || 
                         requestData.shipping_address || requestData.shippingAddress || '';
    let billingCity = requestData.new_city || requestData.newCity || 
                      requestData.city || '';
    let billingPincode = requestData.new_pincode || requestData.newPincode || 
                         requestData.pincode || '';
    let billingState = requestData.new_state || requestData.newState || 
                       requestData.state || '';

    // Parse address if it's in concatenated format
    if (!billingCity && billingAddress) {
      const parts = billingAddress.split(',').map(p => p.trim());
      if (parts.length >= 4) {
        billingAddress = parts.slice(0, -4).join(', ') || parts[0];
        billingCity = parts[parts.length - 4] || '';
        billingState = parts[parts.length - 3] || '';
        billingPincode = parts[parts.length - 2] || '';
      }
    }

    // Extract pincode from address if not found
    if (!billingPincode || !billingPincode.match(/^\d{6}$/)) {
      const pinMatch = billingAddress.match(/\b\d{6}\b/);
      if (pinMatch) billingPincode = pinMatch[0];
    }

    // Fallback for missing fields
    if (!billingAddress) billingAddress = 'Address not available';
    if (!billingCity) billingCity = 'City';
    if (!billingPincode || !billingPincode.match(/^\d{6}$/)) {
      console.warn(`   ⚠️ Invalid pincode: '${billingPincode}', using 110001`);
      billingPincode = '110001';
    }
    if (!billingState) billingState = 'State';

    console.log(`   📍 Address: ${billingAddress}, ${billingCity}, ${billingState} - ${billingPincode}`);

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
      order_id: requestData.request_id || requestData.requestId + '-FWD',
      order_date: new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0],
      pickup_location: pickupLocationNickname,
      billing_customer_name: customerName,
      billing_last_name: '',
      billing_address: billingAddress.substring(0, 190),
      billing_city: billingCity,
      billing_pincode: billingPincode,
      billing_state: billingState,
      billing_country: 'India',
      billing_email: requestData.email || requestData.customer_email || '',
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
