/**
 * Bulk Delhivery Pickup Booking from CSV
 * 
 * Reads Shiprocket CSV export, filters pending returns, creates Delhivery shipments, and books pickups.
 * 
 * Usage:
 *   node book-delhivery-pickups-from-csv.js <csv-file> [--dry-run] [--output <file>] [--yes]
 * 
 * Examples:
 *   node book-delhivery-pickups-from-csv.js returns.csv --dry-run
 *   node book-delhivery-pickups-from-csv.js returns.csv --output results.json
 *   node book-delhivery-pickups-from-csv.js returns.csv --yes
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// ==================== CONFIGURATION ====================

const DELHIVERY_API_KEY = process.env.DELHIVERY_API_KEY;
const DELHIVERY_PICKUP_LOCATION = process.env.DELHIVERY_PICKUP_LOCATION || 'Offcomfrt Warehouse';

// Warehouse default details (from server.js)
const WAREHOUSE = {
  name: 'BURB MANUFACTURES PVT LTD',
  address: 'VILLAGE - BAIRAWAS, NEAR GOVT. SCHOOL',
  city: 'MAHENDERGARH',
  state: 'Haryana',
  country: 'IN',
  pincode: '123028',
  email: 'returns@offcomfort.com',
  phone: '9138514222'
};

// Rate limiting delay between API calls (in ms)
const API_DELAY_MS = 1000;

// ==================== CSV PARSING ====================

/**
 * Parse CSV file manually (no external dependencies)
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  
  if (lines.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);
  
  // Parse data rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((header, index) => {
        row[header.trim()] = values[index].trim();
      });
      rows.push(row);
    }
  }

  return { headers, rows };
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

// ==================== DELHIVERY API ====================

/**
 * Create return shipment in Delhivery
 */
async function createDelhiveryShipment(requestData) {
  const {
    requestId,
    customerName,
    customerAddress,
    customerCity,
    customerState,
    customerPincode,
    customerPhone
  } = requestData;

  // Sanitize addresses - Delhivery doesn't accept: &, #, %, ;, \
  const sanitizeAddress = (str) => {
    if (!str) return '';
    return str.replace(/[&#%;\\]/g, '').trim();
  };

  // Build payload for Delhivery CMU API
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
      order: requestId,
      cod_amount: 0,
      return_pin: WAREHOUSE.pincode,
      return_add: sanitizeAddress(WAREHOUSE.address),
      return_city: sanitizeAddress(WAREHOUSE.city),
      return_state: sanitizeAddress(WAREHOUSE.state),
      return_country: WAREHOUSE.country,
      return_phone: WAREHOUSE.phone
    }],
    pickup_location: {
      name: DELHIVERY_PICKUP_LOCATION,
      add: sanitizeAddress(WAREHOUSE.address),
      pin: WAREHOUSE.pincode,
      city: sanitizeAddress(WAREHOUSE.city),
      state: sanitizeAddress(WAREHOUSE.state),
      country: WAREHOUSE.country,
      phone: WAREHOUSE.phone
    }
  };

  // Delhivery requires format=json&data=<json_string> in the body
  const bodyString = `format=json&data=${JSON.stringify(payload)}`;

  const response = await fetch('https://track.delhivery.com/api/cmu/create.json', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${DELHIVERY_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: bodyString
  });

  const data = await response.json();

  // Check for error responses
  if (data && data.rmk) {
    throw new Error(`Delhivery API Error: ${data.rmk}`);
  }

  if (data && data.message) {
    throw new Error(`Delhivery API Error: ${data.message}`);
  }

  // Check for success
  if (data && data.packages && data.packages.length > 0) {
    const pkg = data.packages[0];
    if (pkg.status === 'Success' && pkg.waybill) {
      return {
        waybill: pkg.waybill,
        shipment_id: pkg.refnum || null,
        success: true,
        data: data
      };
    } else if (pkg.status && pkg.status !== 'Success') {
      throw new Error(`Delhivery package error: ${pkg.status}`);
    }
  }

  throw new Error(`Unexpected Delhivery response: ${JSON.stringify(data).substring(0, 200)}`);
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== MAIN SCRIPT ====================

async function main() {
  console.log('=== Delhivery Pickup Booking Script ===\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const csvFile = args[0];
  const isDryRun = args.includes('--dry-run');
  const yesFlag = args.includes('--yes');
  const outputIndex = args.indexOf('--output');
  const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : null;

  // Validate arguments
  if (!csvFile) {
    console.error('Usage: node book-delhivery-pickups-from-csv.js <csv-file> [--dry-run] [--output <file>] [--yes]');
    process.exit(1);
  }

  if (!fs.existsSync(csvFile)) {
    console.error(`Error: File not found: ${csvFile}`);
    process.exit(1);
  }

  if (!DELHIVERY_API_KEY) {
    console.error('Error: DELHIVERY_API_KEY not set in .env file');
    process.exit(1);
  }

  console.log(`Reading CSV: ${csvFile}`);
  if (isDryRun) {
    console.log('--- DRY RUN MODE (no API calls will be made) ---\n');
  }

  try {
    // Parse CSV
    const { headers, rows } = parseCSV(csvFile);
    console.log(`Total rows: ${rows.length}`);
    console.log(`Columns found: ${headers.length}\n`);

    // Filter requests that need processing
    // Process ONLY requests without AWB codes
    const requestsToProcess = rows.filter(row => {
      const orderId = row['Order ID'] || '';
      const awbCode = row['AWB Code'] || '';
      
      // Must have Order ID
      const hasOrderId = orderId && orderId.trim();
      
      // Must NOT have an existing AWB (or AWB is 'N/A')
      const noAwb = awbCode === 'N/A' || awbCode === '' || awbCode === "'N/A'";
      
      return hasOrderId && noAwb;
    });

    console.log(`Total requests to process: ${requestsToProcess.length} (Only requests WITHOUT AWB)\n`);

    // Show statistics about existing AWBs
    const withExistingAwb = rows.filter(row => {
      const awbCode = row['AWB Code'] || '';
      return awbCode && awbCode !== 'N/A' && awbCode !== "'N/A'";
    }).length;
    
    const withoutAwb = rows.length - withExistingAwb;
    console.log(`  - Requests with existing AWB: ${withExistingAwb} (will be SKIPPED)`);
    console.log(`  - Requests without AWB: ${withoutAwb} (will be processed)`);
    console.log(`  - Creating NEW Delhivery shipments for requests without AWB only\n`);

    if (requestsToProcess.length === 0) {
      console.log('No requests found in CSV file.');
      process.exit(0);
    }

    // Show preview
    console.log('Requests to process:');
    requestsToProcess.forEach((row, index) => {
      const orderId = row['Order ID'];
      const customerName = row['Customer Name'] || 'N/A';
      const city = row['Address City'] || 'N/A';
      const pincode = row['Address Pincode'] || 'N/A';
      console.log(`  ${index + 1}. ${orderId}: ${customerName} (${city}, ${pincode})`);
    });
    console.log('');

    // Dry run - stop here
    if (isDryRun) {
      console.log('Run without --dry-run to execute actual bookings.');
      process.exit(0);
    }

    // Confirmation prompt
    if (!yesFlag) {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        rl.question(`Proceed with booking ${requestsToProcess.length} pickups in Delhivery? (yes/no): `, resolve);
        rl.close();
      });

      if (answer.toLowerCase() !== 'yes') {
        console.log('Aborted by user.');
        process.exit(0);
      }
      console.log('');
    }

    // Process each request
    const results = {
      total: requestsToProcess.length,
      success: [],
      failed: [],
      timestamp: new Date().toISOString()
    };

    console.log('--- ACTUAL EXECUTION ---\n');

    for (let i = 0; i < requestsToProcess.length; i++) {
      const row = requestsToProcess[i];
      const requestId = row['Order ID'];
      const customerName = row['Customer Name'] || 'Customer';
      const customerPhone = row['Customer Mobile'] || '';
      const addressLine1 = row['Address Line 1'] || '';
      const addressLine2 = row['Address Line 2'] || '';
      const customerCity = row['Address City'] || '';
      const customerState = row['Address State'] || '';
      const customerPincode = row['Address Pincode'] || '';
      const originalAwb = row['AWB Code'] || '';
      const originalCourier = row['Courier Company'] || '';

      // Clean phone number (extract 10 digits)
      let cleanPhone = customerPhone.replace(/\D/g, '');
      if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
        cleanPhone = cleanPhone.substring(2);
      }
      if (cleanPhone.length > 10) {
        cleanPhone = cleanPhone.slice(-10);
      }
      if (cleanPhone.length < 10) {
        cleanPhone = '9999999999'; // Fallback
      }

      // Combine address
      const customerAddress = `${addressLine1} ${addressLine2}`.trim();

      // Show existing AWB info if present
      let awbNote = '';
      if (originalAwb && originalAwb !== 'N/A' && originalAwb !== "'N/A'") {
        awbNote = ` [Existing: ${originalAwb} (${originalCourier})]`;
      }

      console.log(`[${i + 1}/${requestsToProcess.length}] Processing ${requestId}${awbNote}...`);

      try {
        // Create shipment in Delhivery
        const shipmentData = {
          requestId,
          customerName,
          customerAddress,
          customerCity,
          customerState,
          customerPincode,
          customerPhone: cleanPhone
        };

        const response = await createDelhiveryShipment(shipmentData);

        console.log(`  ✅ Success: AWB ${response.waybill}\n`);

        results.success.push({
          requestId,
          customerName,
          city: customerCity,
          state: customerState,
          pincode: customerPincode,
          originalAwb: originalAwb && originalAwb !== 'N/A' && originalAwb !== "'N/A'" ? originalAwb : null,
          originalCourier: originalCourier || null,
          newWaybill: response.waybill,
          shipment_id: response.shipment_id,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.log(`  ❌ Failed: ${error.message}\n`);

        results.failed.push({
          requestId,
          customerName,
          city: customerCity,
          state: customerState,
          pincode: customerPincode,
          originalAwb: originalAwb && originalAwb !== 'N/A' && originalAwb !== "'N/A'" ? originalAwb : null,
          originalCourier: originalCourier || null,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }

      // Rate limiting - delay between requests
      if (i < requestsToProcess.length - 1) {
        await sleep(API_DELAY_MS);
      }
    }

    // Print summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total Processed: ${results.total}`);
    console.log(`Success: ${results.success.length}`);
    console.log(`Failed: ${results.failed.length}`);

    // Save results to file
    const defaultOutputFile = `delhivery_booking_results_${new Date().toISOString().split('T')[0]}.json`;
    const finalOutputFile = outputFile || defaultOutputFile;

    fs.writeFileSync(finalOutputFile, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to: ${finalOutputFile}`);

    // Save failed requests to CSV for easy review
    if (results.failed.length > 0) {
      const failedCsvFile = `delhivery_failed_${new Date().toISOString().split('T')[0]}.csv`;
      const failedCsvHeaders = ['Order ID', 'Customer Name', 'City', 'State', 'Pincode', 'Original AWB', 'Error'];
      const failedCsvRows = results.failed.map(r => [
        r.requestId,
        r.customerName,
        r.city,
        r.state,
        r.pincode,
        r.originalAwb || 'N/A',
        r.error
      ]);

      const failedCsvContent = [
        failedCsvHeaders.join(','),
        ...failedCsvRows.map(row => row.map(val => `"${val}"`).join(','))
      ].join('\n');

      fs.writeFileSync(failedCsvFile, failedCsvContent);
      console.log(`Failed requests saved to: ${failedCsvFile}`);
    }

    // Exit with appropriate code
    if (results.failed.length > 0) {
      console.log('\n⚠️  Some requests failed. Review the output files for details.');
      process.exit(1);
    } else {
      console.log('\n✅ All requests processed successfully!');
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ Script error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
main();
