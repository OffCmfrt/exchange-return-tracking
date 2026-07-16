/**
 * Extract requests without AWB codes from the Shiprocket CSV
 * Creates a clean CSV for manual Delhivery upload
 */

const fs = require('fs');

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
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

// Read original CSV
const originalFile = 'secure_3715753_reports_1778738462251483822-56220a32d16dec73af4356440ec64d0f-.csv';
const content = fs.readFileSync(originalFile, 'utf-8');
const lines = content.split('\n').filter(line => line.trim());

// Parse headers
const headers = parseCSVLine(lines[0]);

// Parse all rows
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

console.log(`Total rows in original CSV: ${rows.length}`);

// Filter rows WITHOUT AWB codes
const rowsWithoutAwb = rows.filter(row => {
  const awbCode = row['AWB Code'] || '';
  return awbCode === 'N/A' || awbCode === '' || awbCode === "'N/A'";
});

console.log(`Rows without AWB: ${rowsWithoutAwb.length}`);

// Create CSV content
const csvHeaders = [
  'Order ID',
  'Customer Name',
  'Customer Mobile',
  'Address Line 1',
  'Address Line 2',
  'Address City',
  'Address State',
  'Address Pincode',
  'Payment Method',
  'Order Total',
  'Status'
];

const csvRows = rowsWithoutAwb.map(row => [
  row['Order ID'] || '',
  row['Customer Name'] || '',
  row['Customer Mobile'] || '',
  row['Address Line 1'] || '',
  row['Address Line 2'] || '',
  row['Address City'] || '',
  row['Address State'] || '',
  row['Address Pincode'] || '',
  row['Payment Method'] || '',
  row['Order Total'] || '',
  row['Status'] || ''
]);

// Build CSV string
const csvContent = [
  csvHeaders.join(','),
  ...csvRows.map(row => 
    row.map(val => {
      // Escape quotes and wrap in quotes if contains comma
      const escaped = String(val).replace(/"/g, '""');
      return escaped.includes(',') || escaped.includes('"') ? `"${escaped}"` : escaped;
    }).join(',')
  )
].join('\n');

// Save to file
const outputFile = 'delhivery-pickup-requests-73.csv';
fs.writeFileSync(outputFile, csvContent, 'utf-8');

console.log(`\n✅ CSV file created: ${outputFile}`);
console.log(`📦 Contains ${rowsWithoutAwb.length} requests without AWB codes`);
console.log('\nColumns included:');
csvHeaders.forEach(h => console.log(`  - ${h}`));
