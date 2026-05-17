/**
 * Ship CSV Orders to Delhivery - Initiate Pickup
 * 
 * This script reads a CSV file with order request IDs and creates Delhivery shipments
 * to initiate pickup for orders that were originally booked in Shiprocket.
 * 
 * The Delhivery CMU API automatically creates the shipment AND schedules pickup.
 * 
 * CSV Format (from your export):
 *   Order ID, Customer Name, Customer Mobile, Address Line 1, Address Line 2, 
 *   Address City, Address State, Address Pincode, Payment Method, Order Total, Status
 * 
 * Usage:
 *   node ship-csv-to-delhivery.js public/delhivery-pickup-requests-73.csv
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Parse CSV file
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  
  if (lines.length < 2) {
    throw new Error('CSV file must have at least a header row and one data row');
  }
  
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  console.log('📋 CSV Headers:', headers);
  
  if (!headers.includes('order id')) {
    throw new Error('CSV must contain an "Order ID" column');
  }
  
  const orders = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const order = {};
    
    headers.forEach((header, index) => {
      order[header] = values[index] || '';
    });
    
    // Map CSV columns to expected format
    order.request_id = order['order id'] || order['Order ID'];
    order.customer_name = order['customer name'] || order['Customer Name'];
    order.customer_phone = order['customer mobile'] || order['Customer Mobile'];
    order.customer_address = (order['address line 1'] || '') + ' ' + (order['address line 2'] || '');
    order.customer_city = order['address city'] || order['city'] || '';
    order.customer_state = order['address state'] || order['state'] || '';
    order.customer_pincode = order['address pincode'] || order['pincode'] || '';
    
    orders.push(order);
  }
  
  console.log(`📊 Parsed ${orders.length} orders from CSV\n`);
  
  // Filter out cancelled orders
  const activeOrders = orders.filter(o => {
    const status = (o['status'] || '').toUpperCase();
    return !status.includes('CANCELLED');
  });
  
  console.log(`📊 Active orders (excluding cancelled): ${activeOrders.length}\n`);
  
  // Remove duplicates based on request_id
  const uniqueOrders = [];
  const seenIds = new Set();
  
  for (const order of activeOrders) {
    if (!seenIds.has(order.request_id)) {
      seenIds.add(order.request_id);
      uniqueOrders.push(order);
    }
  }
  
  const duplicatesRemoved = activeOrders.length - uniqueOrders.length;
  if (duplicatesRemoved > 0) {
    console.log(`⚠️  Removed ${duplicatesRemoved} duplicate order(s)\n`);
  }
  
  return uniqueOrders;
}

// Sanitize addresses - Delhivery doesn't accept: &, #, %, ;, \
const sanitizeAddress = (str) => {
  if (!str) return '';
  return str.replace(/[&#%;\\]/g, '').trim();
};

// Create Delhivery order (this also initiates pickup)
async function createDelhiveryOrder(requestData) {
  const apiKey = process.env.DELHIVERY_API_KEY;
  if (!apiKey) {
    throw new Error('DELHIVERY_API_KEY not configured in .env');
  }

  const requestId = requestData.request_id;
  
  // For forward dispatch (exchange), use 'fws' prefix to avoid duplicate order errors
  // We'll determine the order type after fetching from database
  
  console.log(`\n📦 [${requestId}] Creating Delhivery Order...`);

  // Warehouse (pickup) details
  const pickupLocationNickname = process.env.DELHIVERY_PICKUP_LOCATION || 'Primary';
  const warehouseAddress = 'VILLAGE - BAIRAWAS, NEAR GOVT. SCHOOL';
  const warehouseCity = 'MAHENDERGARH';
  const warehouseState = 'Haryana';
  const warehousePincode = '123028';
  const warehousePhone = '9138514222';

  // Fetch order details from database
  const { data: order, error } = await supabase
    .from('requests')
    .select('*')
    .eq('request_id', requestId)
    .single();

  if (error || !order) {
    throw new Error(`Order ${requestId} not found in database`);
  }

  // Determine order type from database
  const orderType = order.type || 'return';
  
  // IMPORTANT: fws- prefix is ONLY for forward dispatch orders (when forward_shipment_id exists)
  // NOT for pickup/return orders, even if type is 'exchange'
  const isForwardDispatch = order.forward_shipment_id || order.forward_awb_number;
  const orderIdPrefix = isForwardDispatch ? 'fws-' : '';
  const delhiveryOrderId = `${orderIdPrefix}${requestId}`;

  console.log(`   Delhivery Order ID: ${delhiveryOrderId}`);
  console.log(`   Order Type: ${orderType}`);
  console.log(`   Is Forward Dispatch: ${isForwardDispatch ? 'YES (fws- prefix)' : 'NO (pickup/return)'}`);
  console.log(`   Status: ${order.status}`);
  console.log(`   Order Number: ${order.order_number}`);
  console.log(`   Forward Shipment ID: ${order.forward_shipment_id || 'None'}`);

  // Parse items
  let items = order.items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch (e) {
      items = [];
    }
  }

  // Customer details - USE DATABASE DATA, not CSV
  let customerName = 'Customer';
  let customerAddress = '';
  let customerCity = '';
  let customerState = '';
  let customerPincode = '';
  let customerPhone = '';

  // Get customer name
  if (order.new_name) {
    customerName = order.new_name;
  } else if (order.customer_name) {
    customerName = order.customer_name;
  }

  // Get address - use new_* fields first (for exchanges), fallback to shipping_address
  if (order.new_address) {
    customerAddress = order.new_address;
    customerCity = order.new_city || '';
    customerState = order.new_state || '';
    customerPincode = order.new_pincode || '';
  } else if (order.shipping_address) {
    // Parse shipping_address format: "street, city, state, pincode, country"
    const parts = order.shipping_address.split(',').map(p => p.trim());
    if (parts.length >= 4) {
      customerAddress = parts.slice(0, -3).join(', ');  // Everything except last 3 parts
      customerPincode = parts[parts.length - 4]?.trim() || '';  // 4th from last should be pincode
      customerState = parts[parts.length - 3]?.trim() || '';
      customerCity = parts[parts.length - 5]?.trim() || parts[parts.length - 6]?.trim() || '';  // Try to get city
      
      // Better parsing: try to find 6-digit pincode
      const pinMatch = order.shipping_address.match(/\b(\d{6})\b/);
      if (pinMatch) {
        customerPincode = pinMatch[1];
        // Find the index of pincode and work backwards
        const pinIndex = order.shipping_address.indexOf(customerPincode);
        const beforePin = order.shipping_address.substring(0, pinIndex).trim();
        const afterPin = order.shipping_address.substring(pinIndex + 6).trim();
        
        const beforeParts = beforePin.split(',').map(p => p.trim()).filter(p => p);
        const afterParts = afterPin.split(',').map(p => p.trim()).filter(p => p);
        
        if (beforeParts.length > 0) {
          customerCity = beforeParts[beforeParts.length - 1];  // Last part before pincode is city
          customerAddress = beforeParts.slice(0, -1).join(', ');  // Rest is address
        }
        if (afterParts.length > 0) {
          customerState = afterParts[0];  // First part after pincode is state
        }
      }
    } else {
      customerAddress = order.shipping_address;
    }
  }

  customerPhone = order.customer_phone || order.phone || '';
  
  // Clean phone number
  customerPhone = String(customerPhone).replace(/\D/g, '');
  if (customerPhone.length === 12 && customerPhone.startsWith('91')) {
    customerPhone = customerPhone.substring(2);
  }
  if (customerPhone.length > 10) {
    customerPhone = customerPhone.slice(-10);
  }
  if (customerPhone.length < 10) {
    customerPhone = '9999999999';
  }

  if (!customerAddress || !customerPincode) {
    throw new Error(`Missing customer address or pincode for ${requestId}`);
  }

  const payload = {
    shipments: [{
      name: sanitizeAddress(customerName),
      add: sanitizeAddress(customerAddress),
      pin: customerPincode,
      city: sanitizeAddress(customerCity),
      state: sanitizeAddress(customerState),
      country: 'IN',
      phone: customerPhone,
      payment_mode: 'Pickup',
      order: delhiveryOrderId,
      cod_amount: 0,
      return_pin: warehousePincode,
      return_add: sanitizeAddress(warehouseAddress),
      return_city: sanitizeAddress(warehouseCity),
      return_state: sanitizeAddress(warehouseState),
      return_country: 'IN',
      return_phone: warehousePhone
    }],
    pickup_location: {
      name: pickupLocationNickname,
      add: sanitizeAddress(warehouseAddress),
      pin: warehousePincode,
      city: sanitizeAddress(warehouseCity),
      state: sanitizeAddress(warehouseState),
      country: 'IN',
      phone: warehousePhone
    }
  };

  console.log(`   📍 Customer: ${customerName}`);
  console.log(`   📍 Pickup Location: ${pickupLocationNickname}`);
  console.log(`   📞 Customer Phone: ${customerPhone}`);

  // Delhivery requires format=json&data=<json_string> in the body
  const bodyString = `format=json&data=${JSON.stringify(payload)}`;

  const response = await fetch('https://track.delhivery.com/api/cmu/create.json', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: bodyString
  });

  const data = await response.json();

  // Check for success
  if (data && data.packages && data.packages.length > 0) {
    const pkg = data.packages[0];
    
    // Handle duplicate order - try to recover existing waybill
    const remarks = Array.isArray(pkg.remarks) ? pkg.remarks : (pkg.remarks ? [pkg.remarks] : []);
    if (pkg.status === 'Fail' && remarks.some(r => String(r).toLowerCase().includes('duplicate'))) {
      console.warn(`   ⚠️ Duplicate order detected. Attempting to recover existing waybill...`);
      
      try {
        const trackingData = await fetch(
          `https://track.delhivery.com/api/v1/packages/json/?refnos=${requestId}`,
          {
            headers: {
              'Authorization': `Token ${apiKey}`
            }
          }
        ).then(res => res.json());

        if (trackingData && trackingData.packages && trackingData.packages.length > 0) {
          const existingPkg = trackingData.packages[0];
          if (existingPkg.waybill_code || existingPkg.awb) {
            const existingWaybill = existingPkg.waybill_code || existingPkg.awb;
            console.log(`   ✅ Recovered existing waybill: ${existingWaybill}`);
            return {
              waybill: existingWaybill,
              shipment_id: existingPkg.refnum || requestId,
              success: true,
              recovered: true
            };
          }
        }
      } catch (recoverError) {
        console.error(`   ❌ Failed to recover waybill:`, recoverError.message);
      }
      
      throw new Error(`Duplicate order: ${requestId} already exists in Delhivery`);
    }
    
    // Check for success
    if (pkg.status === 'Success' && pkg.waybill) {
      console.log(`   ✅ AWB: ${pkg.waybill}`);
      return {
        waybill: pkg.waybill,
        shipment_id: pkg.refnum || requestId,
        success: true
      };
    } else if (pkg.status && pkg.status !== 'Success') {
      const errorMsg = remarks && remarks.length > 0 ? remarks.join(', ') : pkg.status;
      throw new Error(`Delhivery error: ${errorMsg}`);
    }
  }

  // Check for error responses
  if (data && data.rmk) {
    throw new Error(`Delhivery API Error: ${data.rmk}`);
  }

  if (data && data.message) {
    throw new Error(`Delhivery API Error: ${data.message}`);
  }

  throw new Error('Delhivery returned unexpected response format');
}

// Update order in database with Delhivery info
async function updateOrderWithDelhiveryInfo(requestId, waybill, shipmentId, isRecovered = false) {
  // Get current admin_notes first
  const { data: currentRequest } = await supabase
    .from('requests')
    .select('admin_notes')
    .eq('request_id', requestId)
    .single();

  const adminNote = isRecovered 
    ? `\n[${new Date().toISOString()}] Pickup re-initiated via Delhivery (RECOVERED from duplicate). AWB: ${waybill}`
    : `\n[${new Date().toISOString()}] Pickup initiated via Delhivery from CSV. AWB: ${waybill}`;

  const { data, error } = await supabase
    .from('requests')
    .update({
      awb_number: waybill,
      shipment_id: shipmentId,
      carrier: 'delhivery',
      carrier_awb: waybill,
      carrier_shipment_id: shipmentId,
      status: 'pickup_booked',
      pickup_date: new Date().toISOString(),
      admin_notes: (currentRequest?.admin_notes || '') + adminNote
    })
    .eq('request_id', requestId);

  if (error) {
    throw new Error(`Database update failed: ${error.message}`);
  }

  return true;
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node ship-csv-to-delhivery.js <path-to-csv-file>');
    console.log('\nExample:');
    console.log('  node ship-csv-to-delhivery.js public/delhivery-pickup-requests-73.csv');
    process.exit(1);
  }

  const csvFilePath = path.resolve(args[0]);
  
  if (!fs.existsSync(csvFilePath)) {
    console.error(`❌ File not found: ${csvFilePath}`);
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('🚀 DELHIVERY PICKUP INITIATION FROM CSV');
  console.log('='.repeat(60));
  console.log(`File: ${csvFilePath}\n`);

  // Parse CSV
  const orders = parseCSV(csvFilePath);

  console.log('Starting Delhivery pickup initiation...\n');

  let successCount = 0;
  let failedCount = 0;
  let recoveredCount = 0;
  const results = [];

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const requestId = order.request_id;

    try {
      console.log(`\n[${i + 1}/${orders.length}] Processing ${requestId}...`);

      // Create Delhivery order (this initiates pickup)
      const delhiveryResult = await createDelhiveryOrder(order);

      // Update database
      await updateOrderWithDelhiveryInfo(
        requestId,
        delhiveryResult.waybill,
        delhiveryResult.shipment_id,
        delhiveryResult.recovered
      );

      if (delhiveryResult.recovered) {
        console.log(`   ✅ ${requestId} - RECOVERED (AWB: ${delhiveryResult.waybill})`);
        recoveredCount++;
      } else {
        console.log(`   ✅ ${requestId} - SUCCESS (AWB: ${delhiveryResult.waybill})`);
      }

      successCount++;
      results.push({
        requestId,
        waybill: delhiveryResult.waybill,
        status: delhiveryResult.recovered ? 'recovered' : 'success'
      });

      // Rate limiting delay
      if (i < orders.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } catch (error) {
      console.error(`   ❌ ${requestId} - FAILED: ${error.message}`);
      failedCount++;
      results.push({
        requestId,
        status: 'failed',
        error: error.message
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Orders: ${orders.length}`);
  console.log(`✅ Successful: ${successCount - recoveredCount}`);
  console.log(`🔄 Recovered: ${recoveredCount}`);
  console.log(`❌ Failed: ${failedCount}`);
  console.log('='.repeat(60));

  if (results.filter(r => r.status === 'success' || r.status === 'recovered').length > 0) {
    console.log('\n📋 SUCCESSFUL ORDERS:');
    results
      .filter(r => r.status === 'success' || r.status === 'recovered')
      .forEach(r => {
        console.log(`   ${r.requestId} → AWB: ${r.waybill} [${r.status.toUpperCase()}]`);
      });
  }

  if (results.filter(r => r.status === 'failed').length > 0) {
    console.log('\n❌ FAILED ORDERS:');
    results
      .filter(r => r.status === 'failed')
      .forEach(r => {
        console.log(`   ${r.requestId} - ${r.error}`);
      });
  }

  console.log('\n✅ Pickup initiation complete!');
  console.log('\n💡 Next Steps:');
  console.log('   1. Check Delhivery dashboard for pickup scheduling');
  console.log('   2. Monitor pickup status in admin dashboard');
  console.log('   3. Track shipments after pickup\n');
}

// Run the script
main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
