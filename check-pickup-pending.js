require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStatusDistribution() {
  console.log('Checking request status distribution...\n');

  // Get all requests
  const { data: allRequests, error: allError } = await supabase
    .from('requests')
    .select('status, request_id, created_at');

  if (allError) {
    console.error('Error fetching requests:', allError);
    return;
  }

  console.log(`Total requests: ${allRequests.length}\n`);

  // Count by status
  const statusCounts = {};
  allRequests.forEach(req => {
    statusCounts[req.status] = (statusCounts[req.status] || 0) + 1;
  });

  console.log('Status Distribution:');
  console.log('===================');
  Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      console.log(`${status}: ${count}`);
    });

  // Show pickup_pending requests specifically
  const pickupPending = allRequests.filter(r => r.status === 'pickup_pending');
  console.log(`\n\nPickup Pending Requests: ${pickupPending.length}`);
  if (pickupPending.length > 0) {
    console.log('Details:');
    pickupPending.forEach(req => {
      console.log(`  - ${req.request_id} (created: ${req.created_at})`);
    });
  }

  // Show pending requests (that could be approved)
  const pending = allRequests.filter(r => r.status === 'pending');
  console.log(`\n\nPending Requests (awaiting approval): ${pending.length}`);
  if (pending.length > 0) {
    console.log('Details:');
    pending.slice(0, 10).forEach(req => {
      console.log(`  - ${req.request_id} (created: ${req.created_at})`);
    });
    if (pending.length > 10) {
      console.log(`  ... and ${pending.length - 10} more`);
    }
  }
}

checkStatusDistribution().catch(console.error);
