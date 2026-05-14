require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Recovery script to reset failed pickup requests back to pending status
 * 
 * Usage:
 * 1. First run find-failed-pickups.js to identify failed requests
 * 2. Copy the failed request IDs
 * 3. Paste them in the FAILED_REQUEST_IDS array below
 * 4. Run this script: node recover-failed-pickups.js
 */

// Failed request IDs from find-failed-pickups.js diagnostic (256 requests)
const FAILED_REQUEST_IDS = [
  "REQ-52445",
  "REQ-76588",
  "REQ-46236",
  "REQ-94549",
  "REQ-37677",
  "REQ-87356",
  "REQ-64222",
  "REQ-59999",
  "REQ-25141",
  "REQ-63182",
  "REQ-42690",
  "REQ-98048",
  "REQ-79976",
  "REQ-19144",
  "REQ-45340",
  "REQ-63821",
  "REQ-42073",
  "REQ-75011",
  "REQ-82055",
  "REQ-89898",
  "REQ-76850",
  "REQ-81209",
  "REQ-61267",
  "REQ-97417",
  "REQ-63514",
  "REQ-37942",
  "REQ-88676",
  "REQ-97065",
  "REQ-69439",
  "REQ-64731",
  "REQ-47978",
  "REQ-85915",
  "REQ-76232",
  "REQ-38562",
  "REQ-71736",
  "REQ-83933",
  "REQ-82816",
  "REQ-17034",
  "REQ-90633",
  "REQ-62212",
  "REQ-35381",
  "REQ-69152",
  "REQ-39847",
  "REQ-34401",
  "REQ-14017",
  "REQ-92492",
  "REQ-22298",
  "REQ-82855",
  "REQ-52121",
  "REQ-52343",
  "REQ-91595",
  "REQ-85652",
  "REQ-82457",
  "REQ-74731",
  "REQ-71563",
  "REQ-59861",
  "REQ-26805",
  "REQ-71194",
  "REQ-40410",
  "REQ-26201",
  "REQ-77089",
  "REQ-67818",
  "REQ-36717",
  "REQ-94213",
  "REQ-99968",
  "REQ-67796",
  "REQ-96751",
  "REQ-58112",
  "REQ-70109",
  "REQ-77854",
  "REQ-64641",
  "REQ-40473",
  "REQ-93340",
  "REQ-96608",
  "REQ-53952",
  "REQ-66474",
  "REQ-43007",
  "REQ-45101",
  "REQ-86133",
  "REQ-20554",
  "REQ-43013",
  "REQ-69840",
  "REQ-21620",
  "REQ-83970",
  "REQ-98306",
  "REQ-68038",
  "REQ-18934",
  "REQ-59699",
  "REQ-31086",
  "REQ-26654",
  "REQ-11182",
  "REQ-81899",
  "REQ-59026",
  "REQ-25046",
  "REQ-52943",
  "REQ-62371",
  "REQ-89472",
  "REQ-62561",
  "REQ-66494",
  "REQ-23693",
  "REQ-30079",
  "REQ-98363",
  "REQ-20592",
  "REQ-66353",
  "REQ-53540",
  "REQ-59299",
  "REQ-59383",
  "REQ-55043",
  "REQ-26030",
  "REQ-77591",
  "REQ-39133",
  "REQ-89679",
  "REQ-43179",
  "REQ-95510",
  "REQ-50736",
  "REQ-55272",
  "REQ-10723",
  "REQ-78835",
  "REQ-61035",
  "REQ-72103",
  "REQ-98982",
  "REQ-16519",
  "REQ-18762",
  "REQ-29481",
  "REQ-69777",
  "REQ-11442",
  "REQ-31914",
  "REQ-54708",
  "REQ-91689",
  "REQ-15266",
  "REQ-98964",
  "REQ-44503",
  "REQ-38282",
  "REQ-87223",
  "REQ-60288",
  "REQ-63646",
  "REQ-57051",
  "REQ-65065",
  "REQ-38547",
  "REQ-31443",
  "REQ-96987",
  "REQ-89761",
  "REQ-20309",
  "REQ-83805",
  "REQ-56861",
  "REQ-40411",
  "REQ-97812",
  "REQ-21600",
  "REQ-92966",
  "REQ-38482",
  "REQ-80826",
  "REQ-21169",
  "REQ-16586",
  "REQ-34914",
  "REQ-37324",
  "REQ-20286",
  "REQ-50858",
  "REQ-87696",
  "REQ-69288",
  "REQ-94929",
  "REQ-33758",
  "REQ-91861",
  "REQ-57329",
  "REQ-66813",
  "REQ-12002",
  "REQ-82267",
  "REQ-10256",
  "REQ-33209",
  "REQ-61203",
  "REQ-13861",
  "REQ-79326",
  "REQ-23989",
  "REQ-23068",
  "REQ-69042",
  "REQ-85092",
  "REQ-59357",
  "REQ-47128",
  "REQ-53301",
  "REQ-62793",
  "REQ-64907",
  "REQ-36753",
  "REQ-83625",
  "REQ-81675",
  "REQ-67778",
  "REQ-69953",
  "REQ-17783",
  "REQ-61661",
  "REQ-44281",
  "REQ-92684",
  "REQ-96937",
  "REQ-77923",
  "REQ-93876",
  "REQ-28004",
  "REQ-16414",
  "REQ-79737",
  "REQ-61767",
  "REQ-50689",
  "REQ-77596",
  "REQ-88827",
  "REQ-18253",
  "REQ-66713",
  "REQ-10697",
  "REQ-98038",
  "REQ-11533",
  "REQ-65785",
  "REQ-20874",
  "REQ-95312",
  "REQ-85179",
  "REQ-38791",
  "REQ-85130",
  "REQ-99740",
  "REQ-41247",
  "REQ-59696",
  "REQ-17468",
  "REQ-74730",
  "REQ-56045",
  "REQ-10420",
  "REQ-35025",
  "REQ-43806",
  "REQ-44719",
  "REQ-23278",
  "REQ-50998",
  "REQ-25836",
  "REQ-71659",
  "REQ-62347",
  "REQ-90148",
  "REQ-64696",
  "REQ-82819",
  "REQ-78462",
  "REQ-85146",
  "REQ-50894",
  "REQ-33217",
  "REQ-99897",
  "REQ-19394",
  "REQ-80114",
  "REQ-62284",
  "REQ-16584",
  "REQ-47134",
  "REQ-58334",
  "REQ-89561",
  "REQ-28805",
  "REQ-63169",
  "REQ-20211",
  "REQ-44365",
  "REQ-58551",
  "REQ-22929",
  "REQ-16962",
  "REQ-72264",
  "REQ-32678",
  "REQ-67382",
  "REQ-90214",
  "REQ-95123",
  "REQ-82935",
  "REQ-46492",
  "REQ-38782",
  "REQ-85625",
  "REQ-14667",
  "REQ-50789",
  "REQ-28796",
  "REQ-68140",
  "REQ-10851",
  "REQ-44880",
  "REQ-73380",
  "REQ-37246",
  "REQ-99709",
  "REQ-96848",
  "REQ-38223",
  "REQ-13885",
  "REQ-89315",
  "REQ-41438",
  "REQ-90829",
  "REQ-87335"
];

async function recoverFailedPickups(requestIds) {
  if (!requestIds || requestIds.length === 0) {
    console.error('No request IDs provided!');
    console.log('\nUsage:');
    console.log('1. Run find-failed-pickups.js first');
    console.log('2. Copy the failed request IDs from the output');
    console.log('3. Paste them in the FAILED_REQUEST_IDS array in this file');
    console.log('4. Run this script again\n');
    return;
  }

  console.log('=== Pickup Recovery Tool ===\n');
  console.log(`Attempting to recover ${requestIds.length} failed pickup requests...\n`);

  const results = {
    total: requestIds.length,
    successful: [],
    failed: [],
    skipped: []
  };

  for (const requestId of requestIds) {
    try {
      // Get current request details
      const { data: request, error: fetchError } = await supabase
        .from('requests')
        .select('*')
        .eq('request_id', requestId)
        .single();

      if (fetchError || !request) {
        console.error(`[${requestId}] Error: Request not found`);
        results.failed.push({ id: requestId, error: 'Request not found' });
        continue;
      }

      // Check if request is in a recoverable state
      const recoverableStatuses = ['pickup_pending', 'scheduled', 'pending'];
      if (!recoverableStatuses.includes(request.status)) {
        console.warn(`[${requestId}] Skipped: Status is '${request.status}' (not recoverable)`);
        results.skipped.push({ 
          id: requestId, 
          reason: `Status is '${request.status}', only pickup_pending/scheduled/pending can be recovered` 
        });
        continue;
      }

      // If already pending, no need to reset
      if (request.status === 'pending') {
        console.log(`[${requestId}] Already in pending status, skipping`);
        results.skipped.push({ id: requestId, reason: 'Already pending' });
        continue;
      }

      console.log(`[${requestId}] Resetting from '${request.status}' to 'pending'...`);
      console.log(`  Previous carrier: ${request.carrier || 'unknown'}`);
      console.log(`  Previous AWB: ${request.carrier_awb || request.awb_number || 'none'}`);

      // Reset the request to pending status
      const adminNotes = (request.admin_notes || '') + 
        `\n[SYSTEM ${new Date().toISOString()}] Pickup reset to pending by recovery script (was: ${request.carrier || 'unknown'}, AWB: ${request.carrier_awb || request.awb_number || 'none'})`;

      const { data: updatedRequest, error: updateError } = await supabase
        .from('requests')
        .update({
          status: 'pending',
          carrier: null,
          carrier_awb: null,
          carrier_shipment_id: null,
          awb_number: null,
          shipment_id: null,
          pickup_date: null,
          admin_notes: adminNotes
        })
        .eq('request_id', requestId)
        .select()
        .single();

      if (updateError) {
        console.error(`[${requestId}] Update failed: ${updateError.message}`);
        results.failed.push({ id: requestId, error: updateError.message });
      } else {
        console.log(`[${requestId}] ✅ Successfully reset to pending`);
        results.successful.push(requestId);
      }

    } catch (error) {
      console.error(`[${requestId}] Unexpected error: ${error.message}`);
      results.failed.push({ id: requestId, error: error.message });
    }
  }

  // Display results
  console.log('\n=== Recovery Results ===\n');
  console.log(`Total processed: ${results.total}`);
  console.log(`✅ Successful: ${results.successful.length}`);
  console.log(`⏭️  Skipped: ${results.skipped.length}`);
  console.log(`❌ Failed: ${results.failed.length}\n`);

  if (results.successful.length > 0) {
    console.log('Successfully recovered requests:');
    results.successful.forEach(id => console.log(`  - ${id}`));
    console.log('');
  }

  if (results.skipped.length > 0) {
    console.log('Skipped requests:');
    results.skipped.forEach(item => console.log(`  - ${item.id}: ${item.reason}`));
    console.log('');
  }

  if (results.failed.length > 0) {
    console.log('Failed requests:');
    results.failed.forEach(item => console.log(`  - ${item.id}: ${item.error}`));
    console.log('');
  }

  console.log('=== Next Steps ===');
  if (results.successful.length > 0) {
    console.log(`${results.successful.length} requests have been reset to pending status.`);
    console.log('You can now:');
    console.log('1. Use bulk pickup in admin dashboard to re-initiate all at once');
    console.log('2. Or approve them individually with carrier override\n');
  }

  console.log('=== Recovery Complete ===');
}

// Run recovery
recoverFailedPickups(FAILED_REQUEST_IDS).catch(console.error);
