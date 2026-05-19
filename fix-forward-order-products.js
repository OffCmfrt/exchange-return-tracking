/**
 * Fix forward orders created with WRONG products
 * 
 * The previous recovery script used ORIGINAL Shopify items instead of 
 * REPLACEMENT items from the database. This script fixes that by using
 * the correct exchange products (new size/color/variant).
 * 
 * Run: node fix-forward-order-products.js
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
      email: 'returns@offcomfort.com',
      nickname: 'Primary'
    };
  }

  return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
}

function sanitizeAddress(str) {
  if (!str) return '';
  return str.replace(/[&#%;\\]/g, '').trim();
}

async function createDelhiveryForwardOrder(requestData, warehouseLocation) {
  try {
    // Parse items - THESE ARE THE CORRECT REPLACEMENT ITEMS FROM DB
    let items = requestData.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (e) { items = []; }
    }

    if (!items || items.length === 0) {
      console.error('❌ No replacement items found in database!');
      return null;
    }

    console.log(`📦 Processing ${requestData.request_id || requestData.requestId}...`);
    console.log(`   Order #: ${requestData.order_number || requestData.orderNumber}`);
    console.log(`   Replacement Items (${items.length}):`);
    items.forEach((item, idx) => {
      const isDifferentProduct = item.replacementProductId && item.replacementProductId !== item.productId;
      const title = item.replacementProductTitle || item.name;
      const variant = item.replacementVariant || item.variant;
      const originalVariant = item.variant;
      
      console.log(`   ${idx + 1}. ${title}`);
      console.log(`      Original: ${item.name} (Variant: ${originalVariant})`);
      console.log(`      Replacement: ${variant}`);
      console.log(`      Replacement Variant ID: ${item.replacementVariantId || 'N/A'}`);
      console.log(`      Price: ₹${item.replacementPrice || item.price}`);
      console.log(`      Quantity: ${item.quantity}`);
    });

    // Build item details for Delhivery
    const orderItems = items.map(item => ({
      title: item.replacementProductTitle || item.name || 'Product',
      sku: item.replacementVariantId || item.variantId || item.sku || 'SKU',
      quantity: item.quantity || 1,
      grams: item.grams || 500,
      price: parseFloat(item.replacementPrice || item.price) || 0
    }));

    // Calculate total value
    const totalValue = orderItems.reduce((sum, item) => {
      return sum + (item.price * item.quantity);
    }, 0);

    // Build forward order ID - keep the same fws- prefix
    const oldForwardOrderId = `fws-${requestData.request_id || requestData.requestId}`;
    // Create new order ID with -fixed suffix to avoid duplicate ID errors
    const forwardOrderId = `fws-${requestData.request_id || requestData.requestId}-FIXED`;

    // Get customer info from database
    const customerName = requestData.customer_name || requestData.customerName || 'Customer';
    const customerAddress = `${requestData.customer_address || ''} ${requestData.customer_address2 || ''}`.trim();
    const customerCity = requestData.customer_city || 'City';
    const customerState = requestData.customer_state || 'State';
    const customerPincode = requestData.customer_zip || requestData.customer_pincode;
    const customerCountry = requestData.customer_country || 'IN';
    
    // Get and sanitize phone number
    let customerPhone = requestData.customer_phone || requestData.customerPhone || '';
    let cleanPhone = String(customerPhone || '').replace(/\D/g, '');
    
    // Remove country code if present
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      cleanPhone = cleanPhone.substring(2);
    }
    if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.substring(1);
    }
    
    // Only use 10-digit numbers
    if (cleanPhone.length === 10 && /^[6-9]\d{9}$/.test(cleanPhone)) {
      customerPhone = cleanPhone;
    } else {
      customerPhone = '9999999999'; // Fallback
    }

    console.log(`   📍 Shipping to: ${customerName}, ${customerCity}, ${customerState} ${customerPincode}`);
    console.log(`   📞 Phone: ${customerPhone}`);
    console.log(`   💰 Total Value: ₹${totalValue}`);

    // Build products array for Delhivery
    console.log(`\n📦 Preparing ${items.length} product(s) for Delhivery...`);
    const products = items.map(item => {
      const title = item.replacementProductTitle || item.name || 'Product';
      const variantStr = (item.replacementVariant && item.replacementVariant !== 'Same') ? ` (${item.replacementVariant})` : '';
      const productName = title + variantStr;
      const quantity = parseInt(item.quantity) || 1;
      const price = parseFloat(item.replacementPrice || item.price) || 0;
      
      console.log(`  - Product: ${productName}`);
      console.log(`    Quantity: ${quantity}`);
      console.log(`    Price: ₹${price}`);
      
      return {
        name: sanitizeAddress(productName),
        quantity: quantity,
        price: price,
        selling_price: price,
        sku: String(item.replacementVariantId || item.variantId || item.sku || 'SKU') + '-EXCH',
        hsn_code: '9965'  // Default HSN for apparel/general goods
      };
    });

    // Get GST TIN for Delhivery (mandatory per Delhivery docs)
    const sellerGstTin = process.env.DELHIVERY_SELLER_GST || '06AAKFO0351L1Z7';
    console.log(`✅ Prepared ${products.length} product(s) for Delhivery`);
    console.log(`🔢 Seller GST: ${sellerGstTin}\n`);

    // Build Delhivery payload
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
        return_phone: warehouseLocation.phone,
        seller_gst_tin: sellerGstTin,  // Mandatory for GST compliance
        products: products  // Include product details
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

    console.log('\n🚀 Creating Delhivery Forward Order with CORRECT replacement products...');

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

    const waybill = data.packages?.[0]?.waybill;
    const shipmentId = data.packages?.[0]?.shipment_id || forwardOrderId;

    if (waybill) {
      console.log(`✅ Delhivery Forward Success!`);
      console.log(`   Waybill: ${waybill}`);
      console.log(`   Order ID: ${forwardOrderId}`);
      
      return {
        waybill,
        shipment_id: shipmentId,
        order_id: forwardOrderId
      };
    } else {
      console.error('❌ No waybill in response');
      return null;
    }

  } catch (error) {
    console.error('❌ Error creating forward order:', error);
    return null;
  }
}

async function main() {
  console.log('\n=== FORWARD ORDER PRODUCT FIX ===\n');
  console.log('🔧 This script will:');
  console.log('   1. Find forward orders created with WRONG products');
  console.log('   2. Re-create them with CORRECT replacement products');
  console.log('   3. Update database with new AWBs\n');

  // Get the 20 orders we previously recovered
  const requestIds = [
    'REQ-40602', 'REQ-52395', 'REQ-85787', 'REQ-29995', 'REQ-76559',
    'REQ-29252', 'REQ-43490', 'REQ-37156', 'REQ-76322', 'REQ-66602',
    'REQ-10309', 'REQ-41721', 'REQ-60414', 'REQ-66532', 'REQ-13161',
    'REQ-94765', 'REQ-35188', 'REQ-57939', 'REQ-22347', 'REQ-51923'
  ];

  console.log(`📋 Fetching ${requestIds.length} orders from database...\n`);

  const { data: orders, error } = await supabase
    .from('requests')
    .select('*')
    .in('request_id', requestIds)
    .eq('status', 'approved')
    .not('forward_awb_number', 'is', null);

  if (error) {
    console.error('❌ Error fetching orders:', error);
    return;
  }

  console.log(`✅ Found ${orders.length} orders with existing forward shipments\n`);

  const warehouseLocation = await getWarehouseLocation();
  console.log('🏭 Warehouse:', warehouseLocation.name, warehouseLocation.city);
  console.log('📦 Pickup Location:', process.env.DELHIVERY_PICKUP_LOCATION || warehouseLocation.nickname || 'Primary\n');

  let successCount = 0;
  let failCount = 0;
  const results = [];

  for (const order of orders) {
    console.log(`\n${'='.repeat(80)}`);
    
    const forwardOrder = await createDelhiveryForwardOrder(order, warehouseLocation);

    if (forwardOrder && forwardOrder.waybill) {
      // Update database with new AWB
      const { error: updateError } = await supabase
        .from('requests')
        .update({
          forwardShipmentId: forwardOrder.shipment_id,
          forwardAwbNumber: forwardOrder.waybill,
          forwardStatus: 'scheduled',
          admin_notes: (order.admin_notes || '') + `\n${new Date().toISOString()} - FIXED: Re-created with CORRECT replacement products. New AWB: ${forwardOrder.waybill}`
        })
        .eq('request_id', order.request_id);

      if (updateError) {
        console.error(`❌ Failed to update database: ${updateError.message}`);
        failCount++;
      } else {
        console.log(`✅ SUCCESS - New AWB: ${forwardOrder.waybill}`);
        successCount++;
        results.push({ 
          requestId: order.request_id, 
          oldAwb: order.forward_awb_number,
          newAwb: forwardOrder.waybill, 
          status: 'fixed' 
        });
      }
    } else {
      console.error(`❌ FAILED - Could not create forward shipment`);
      failCount++;
      results.push({ requestId: order.request_id, status: 'failed' });
    }
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 SUMMARY:`);
  console.log(`   ✅ Fixed: ${successCount} orders`);
  console.log(`   ❌ Failed: ${failCount} orders`);
  console.log(`   📦 Total: ${orders.length} orders`);
  
  if (results.length > 0) {
    console.log(`\n📋 DETAILED RESULTS:`);
    results.forEach(r => {
      if (r.status === 'fixed') {
        console.log(`   ${r.requestId}: ${r.oldAwb} → ${r.newAwb} ✅`);
      } else {
        console.log(`   ${r.requestId}: FAILED ❌`);
      }
    });
  }

  console.log(`\n${'='.repeat(80)}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
