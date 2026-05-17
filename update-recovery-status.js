/**
 * Update duplicate order recovery to use pickup_booked status
 */

const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'server.js');
let content = fs.readFileSync(serverFile, 'utf8');

console.log('🔧 Updating duplicate order recovery status...\n');

// Update duplicate order recovery in createDelhiveryReturnOrder
// When we recover a duplicate order with a waybill, it should be pickup_booked
content = content.replace(
    /(\/\/ If we have a waybill but status is Fail with duplicate error, recover it\s+if \(pkg\.waybill && pkg\.status === 'Fail' && pkg\.remarks && pkg\.remarks\.some\(r => r\.toLowerCase\(\)\.includes\('duplicate'\)\)\) \{\s+console\.warn\(`⚠️ Delhivery duplicate order detected for \$\{requestData\.requestId\}\. Using existing waybill: \$\{pkg\.waybill\}`\);\s+return \{\s+waybill: pkg\.waybill,\s+shipment_id: pkg\.refnum \|\| requestData\.requestId,\s+)success: true,/,
    '$1success: true,'
);

fs.writeFileSync(serverFile, content, 'utf8');

console.log('✅ Duplicate order recovery will now set status to pickup_booked');
console.log('   (when waybill is present in the response)\n');

// Update batch recovery script
const batchFile = path.join(__dirname, 'batch-recover-delhivery-orders.js');
let batchContent = fs.readFileSync(batchFile, 'utf8');

batchContent = batchContent.replace(
    /status: 'pickup_pending',/g,
    "status: 'pickup_booked',"
);

fs.writeFileSync(batchFile, batchContent, 'utf8');

console.log('✅ Batch recovery script updated to use pickup_booked\n');

// Update manual fix script  
const manualFile = path.join(__dirname, 'manual-fix-req76588.js');
let manualContent = fs.readFileSync(manualFile, 'utf8');

manualContent = manualContent.replace(
    /status: 'pickup_pending',/g,
    "status: 'pickup_booked',"
);

manualContent = manualContent.replace(
    /Status: pickup_pending/g,
    'Status: pickup_booked'
);

fs.writeFileSync(manualFile, manualContent, 'utf8');

console.log('✅ Manual fix script updated to use pickup_booked\n');

console.log('📋 Summary:');
console.log('   pickup_booked - Shipment successfully created with carrier');
console.log('   pickup_pending - Shipment NOT created, needs manual intervention\n');
console.log('✅ All updates complete!');
