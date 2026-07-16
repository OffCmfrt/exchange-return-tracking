/**
 * Update status logic: pickup_pending → pickup_booked for successful shipments
 */

const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'server.js');
let content = fs.readFileSync(serverFile, 'utf8');

console.log('🔧 Updating status logic in server.js...\n');

// Change 1: Line ~2685 - Background auto-pickup
content = content.replace(
    /(\/\/ Update with success data\s+if \(carrierUsed\) \{\s+)updates\.status = 'pickup_pending';/,
    '$1updates.status = \'pickup_booked\';'
);

// Change 2: Line ~4060 - Admin approve endpoint  
content = content.replace(
    /(updates\.carrierFallbackReason = fallbackReason;\s+})\s+updates\.status = 'pickup_pending';/,
    "$1\n                    updates.status = 'pickup_booked';"
);

// Change 3: Line ~4064 - Response message
content = content.replace(
    /Pickup initiated via \$\{carrierUsed\} and status updated to pickup_pending/,
    'Pickup initiated via ${carrierUsed} and status updated to pickup_booked'
);

// Change 4: Line ~4656 - Manual pickup booking
content = content.replace(
    /status: 'pickup_pending',\s+adminNotes,/g,
    "status: 'pickup_booked',\n                        adminNotes,"
);

// Change 5: Duplicate order recovery in createDelhiveryReturnOrder
content = content.replace(
    /(waybill: existingWaybill,\s+shipment_id: existingPkg\.refnum \|\| requestData\.requestId,\s+)success: true,/,
    '$1success: true,'
);

fs.writeFileSync(serverFile, content, 'utf8');

console.log('✅ Changes applied:\n');
console.log('1. Line ~2685: Background auto-pickup → pickup_booked');
console.log('2. Line ~4060: Admin approve endpoint → pickup_booked');
console.log('3. Line ~4064: Response message updated');
console.log('4. Line ~4656: Manual pickup booking → pickup_booked');
console.log('\n📝 Note: pickup_pending will now only be used when:');
console.log('   - Shipment creation fails and needs manual intervention');
console.log('   - Sync detects AWB generated but not yet booked');
console.log('\n✅ Done! Restart your server to apply changes.');
