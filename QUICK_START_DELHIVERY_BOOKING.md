# Quick Start - Book Delhivery Pickups from CSV

## Step-by-Step Instructions

### Step 1: Prepare Your CSV File
Place your Shiprocket CSV export in this directory, for example:
```
shiprocket_returns.csv
```

### Step 2: Verify Environment Variables
Make sure your `.env` file has:
```env
DELHIVERY_API_KEY=your_api_key_here
DELHIVERY_PICKUP_LOCATION=Offcomfrt Warehouse
```

### Step 3: Run Dry Run (IMPORTANT - Do This First!)
```bash
node book-delhivery-pickups-from-csv.js shiprocket_returns.csv --dry-run
```

This will show you:
- How many requests will be processed (ALL requests from CSV)
- How many already have AWB codes
- Which specific requests (Order IDs and customer names)
- No API calls are made in dry run mode

### Step 4: Review the Output
Check that:
- ✅ You see the warning about existing AWB codes
- ✅ The count of requests with/without AWB is correct
- ✅ All requests you want to process are listed

### Step 5: Execute Actual Booking
```bash
node book-delhivery-pickups-from-csv.js shiprocket_returns.csv
```

You'll be asked to confirm after seeing a warning:
```
⚠️  WARNING: This will create NEW shipments in Delhivery for ALL requests
   Including 105 requests that already have AWB codes.
   This may result in duplicate shipments if not intended.
```
Type `yes` to proceed.

### Step 6: Monitor Progress
The script will show real-time progress:
```
[1/150] Processing REQ-31086 [Existing: 1.90419E+13 (Delhivery)]...
  ✅ Success: AWB 190419XXXXXXXX

[2/150] Processing REQ-26654...
  ✅ Success: AWB 190419YYYYYYYY
```

### Step 7: Review Results
After completion, check:
1. **Console output** - Summary of success/failure
2. **Results JSON file** - `delhivery_booking_results_2026-05-14.json`
   - Contains both original AWB and new Delhivery AWB
3. **Failed CSV (if any)** - `delhivery_failed_2026-05-14.csv`

### Step 8: Verify in Delhivery Dashboard
Log in to Delhivery and confirm:
- Pickups are scheduled
- AWB numbers match the output file
- Customer addresses are correct

## Common Commands

```bash
# Dry run (safe - no changes)
node book-delhivery-pickups-from-csv.csv --dry-run

# Actual booking with confirmation
node book-delhivery-pickups-from-csv your_file.csv

# Skip confirmation (be careful!)
node book-delhivery-pickups-from-csv your_file.csv --yes

# Custom output file
node book-delhivery-pickups-from-csv your_file.csv --output results.json
```

## What If Something Goes Wrong?

### Script says "No requests found in CSV file"
- Check that your CSV has an "Order ID" column
- Ensure the CSV file is not empty

### Some requests failed
- Check the `delhivery_failed_*.csv` file
- Review error messages
- Fix issues and re-run

### All requests failed
- Verify `DELHIVERY_API_KEY` in `.env`
- Check `DELHIVERY_PICKUP_LOCATION` is correct
- Test with one request first

### ⚠️ WARNING: Duplicate Shipments
- If you run this on orders already active in other couriers, you'll create duplicates
- Review the warning message carefully before proceeding
- Use dry-run mode first to see how many have existing AWBs

## Need Help?

Refer to the full documentation:
- [BOOK_DELHIVERY_PICKUPS_README.md](./BOOK_DELHIVERY_PICKUPS_README.md)

Or check:
- Console error messages
- Output JSON/CSV files for details
- Delhivery API documentation
