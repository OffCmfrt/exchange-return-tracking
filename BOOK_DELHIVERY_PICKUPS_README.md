# Bulk Delhivery Pickup Booking Script

This script reads your Shiprocket CSV export and creates **ALL** return shipments in Delhivery, including requests that already have AWB codes from other couriers.

## Prerequisites

1. Ensure your `.env` file has the following variables set:
   ```env
   DELHIVERY_API_KEY=your_delhivery_api_key
   DELHIVERY_PICKUP_LOCATION=Offcomfrt Warehouse
   ```

2. Have your Shiprocket CSV export file ready

## Usage

### 1. Dry Run (Recommended First)

Preview what will be processed without making any API calls:

```bash
node book-delhivery-pickups-from-csv.js path/to/your/csv.csv --dry-run
```

This will show you:
- Total number of rows in CSV
- Number of requests that will be processed
- List of all pending requests with customer details

### 2. Actual Execution

Once you've verified the dry run output, run the actual booking:

```bash
node book-delhivery-pickups-from-csv.js path/to/your/csv.csv
```

You'll be prompted to confirm before proceeding.

### 3. Skip Confirmation

To skip the confirmation prompt (useful for automation):

```bash
node book-delhivery-pickups-from-csv.js path/to/your/csv.csv --yes
```

### 4. Custom Output File

Specify a custom output file name:

```bash
node book-delhivery-pickups-from-csv.js path/to/your/csv.csv --output my-results.json
```

## What the Script Does

1. **Reads CSV**: Parses your Shiprocket export file
2. **Processes ALL Requests**: Creates Delhivery shipments for:
   - **ALL requests with Order IDs** (no filtering by status or AWB)
   - Including requests that already have AWB codes from other couriers
   - Including all statuses (PENDING, DELIVERED, OUT_FOR_DELIVERY, CANCELLED)
3. **Creates Delhivery Shipments**: For each request:
   - Creates a NEW return shipment in Delhivery
   - Uses customer address from CSV
   - Uses warehouse address from your config
   - Books pickup automatically
4. **Generates Reports**: Saves detailed results showing:
   - Original AWB code (if any)
   - New Delhivery AWB code
   - Success/failure status

## Output Files

### Success Results JSON
```
delhivery_booking_results_2026-05-14.json
```

Contains:
- All successful bookings with AWB numbers
- Failed requests with error messages
- Summary statistics

### Failed Requests CSV (if any failures)
```
delhivery_failed_2026-05-14.csv
```

Contains only the failed requests for easy review and re-processing.

## Example Output

```
=== Delhivery Pickup Booking Script ===

Reading CSV: shiprocket_returns.csv
Total rows: 150
Total requests to process: 150 (ALL requests from CSV)

  - Requests with existing AWB: 105
  - Requests without AWB: 45
  - Will create NEW Delhivery shipments for ALL

⚠️  WARNING: This will create NEW shipments in Delhivery for ALL requests
   Including 105 requests that already have AWB codes.
   This may result in duplicate shipments if not intended.

Proceed with booking 150 pickups in Delhivery? (yes/no): yes

--- ACTUAL EXECUTION ---

[1/150] Processing REQ-31086 [Existing: 1.90419E+13 (Delhivery)]...
  ✅ Success: AWB 190419XXXXXXXX

[2/150] Processing REQ-26654...
  ✅ Success: AWB 190419YYYYYYYY

[3/150] Processing REQ-98363 [Existing: 1.90421E+13 (BlueDart)]...
  ✅ Success: AWB 190419ZZZZZZZZ

...

=== SUMMARY ===
Total Processed: 150
Success: 148
Failed: 2

Results saved to: delhivery_booking_results_2026-05-14.json
Failed requests saved to: delhivery_failed_2026-05-14.csv
```

## Safety Features

- ✅ **Dry run mode** - Preview before executing
- ✅ **Warning about duplicates** - Shows how many requests already have AWB codes
- ✅ **Confirmation prompt** - Prevents accidental execution
- ✅ **Rate limiting** - 1 second delay between API calls
- ✅ **Error handling** - Continues even if individual requests fail
- ✅ **Detailed logging** - Full audit trail with original and new AWB codes
- ✅ **Original AWB tracking** - Shows which courier was used before

## Troubleshooting

### Error: DELHIVERY_API_KEY not set
- Check your `.env` file has `DELHIVERY_API_KEY` configured
- Run `node -e "require('dotenv').config(); console.log(process.env.DELHIVERY_API_KEY)"` to verify

### Error: Invalid pincode
- Verify the pincode in your CSV is a valid 6-digit Indian pincode
- Check for extra spaces or characters

### Error: ClientWarehouse matching query does not exist
- Verify `DELHIVERY_PICKUP_LOCATION` in `.env` matches your registered pickup location in Delhivery
- Current value should be: `Offcomfrt Warehouse`

### Some requests failed
- Review `delhivery_failed_YYYY-MM-DD.csv` for error details
- Fix the issues and re-run the script

## ⚠️ Important Notes

- **This script processes ALL requests** from your CSV, including those with existing AWB codes
- **May create duplicate shipments** if you run it on orders that are already active in other couriers
- **Original AWB codes are preserved** in the output JSON for reference
- **Review the warning carefully** before confirming execution
- **Use --dry-run first** to see what will be processed

## CSV Format Expected

The script expects the Shiprocket export format with these columns:
- Order ID (e.g., REQ-31086)
- Customer Name
- Customer Mobile
- Address Line 1
- Address Line 2
- Address City
- Address State
- Address Pincode
- Status
- AWB Code

## Next Steps After Booking

1. **Verify in Delhivery Dashboard**: Log in to Delhivery and confirm pickups are scheduled
2. **Update Database**: If needed, update your Supabase database with the new AWB codes
3. **Notify Customers**: Send pickup confirmation SMS/emails to customers
4. **Monitor Pickups**: Track pickup status in Delhivery dashboard

## Support

If you encounter issues:
1. Check the error messages in the console output
2. Review the failed requests CSV file
3. Verify your Delhivery API key and pickup location
4. Check server logs for detailed API request/response data
