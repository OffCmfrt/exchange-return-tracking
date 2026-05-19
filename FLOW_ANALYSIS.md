# Complete Exchange Return Tracking Flow Analysis

## 📋 Overview
This document provides a comprehensive analysis of the entire exchange return tracking system flow, from customer request initiation to final delivery.

---

## 🔄 Complete Flow Diagram

```
Customer Request → Admin Review → Pickup Booking → Quality Check → Forward Dispatch → Delivery
```

---

## 1️⃣ CUSTOMER REQUEST INITIATION

### Entry Points:
- **Customer Portal**: `/page.influencer-portal.liquid` (for influencers)
- **Standard Form**: Customer submits return/exchange request
- **Admin Manual Creation**: `/api/admin/create-request` (bypasses eligibility checks)

### Data Captured:
```javascript
{
  orderNumber: "#1001",
  type: "exchange" | "return",
  reason: "Size issue, Quality, etc.",
  items: [
    {
      productId: "12345",
      variantId: "67890",
      quantity: 1,
      // For exchanges:
      replacementProductId: "11111",
      replacementVariantId: "22222",
      replacementProductTitle: "New Product Name",
      replacementVariant: "Medium / Blue"
    }
  ],
  customerPhone: "9876543210",
  newName: "Customer Name",
  newAddress: "New shipping address (for exchange)",
  newCity: "City",
  newState: "State",
  newPincode: "123456"
}
```

### API Endpoint: `POST /api/create-request`
- Validates order eligibility from Shopify
- Checks for duplicate requests
- Generates unique `requestId` (format: `REQ-XXXXX`)
- Stores in Supabase `requests` table with initial status: `pending`

---

## 2️⃣ ADMIN REVIEW & APPROVAL

### Admin Dashboard: `/admin/index.html`

#### Review Process:
1. **View Request Details**
   - Original order from Shopify
   - Customer information
   - Items to be returned/exchanged
   - Replacement product details (for exchanges)

2. **Quality Check Status Updates**:
   - `pending` → `quality_check` (Item received at warehouse)
   - `quality_check` → `approved` (Final approval)

3. **Carrier Configuration**:
   - **Pickup Carrier Mode**: Controls return pickup logistics
     - `shiprocket_only`
     - `delhivery_only`
     - `shiprocket_with_fallback`
     - `delhivery_with_fallback`
   
   - **Dispatch Carrier Mode**: Controls forward shipment (exchanges only)
     - Same options as pickup
     - Configured separately for flexibility

---

## 3️⃣ PICKUP BOOKING (Return Item from Customer)

### Trigger Points:
- **Single Pickup**: Admin clicks "Initiate Pickup" on individual request
- **Bulk Pickup**: Admin selects multiple requests and initiates bulk pickup

### Carrier Resolution Logic:
```javascript
const carrierMode = await getCarrierMode('pickup');
const carrierResolution = resolveCarrier(carrierMode, carrierOverride, 'pickup');
```

#### Resolution Matrix:
| Mode | Primary | Fallback |
|------|---------|----------|
| `shiprocket_only` | Shiprocket | ❌ No |
| `delhivery_only` | Delhivery | ❌ No |
| `shiprocket_with_fallback` | Shiprocket | ✅ Delhivery |
| `delhivery_with_fallback` | Delhivery | ✅ Shiprocket |

### 3.1 Shiprocket Return Pickup

**Function**: `createShiprocketReturnOrder(requestData, shopifyOrder)`

**Flow**:
1. Get Shiprocket auth token (cached for 24 hours)
2. Fetch customer address from Shopify order
3. Load warehouse location from `store_settings`
4. Build payload with:
   - Customer address (pickup location)
   - Warehouse address (delivery location)
   - Order items with SKU, price, quantity
   - `pickup_location` nickname from settings

**API Call**: `POST https://apiv2.shiprocket.in/v1/external/orders/create/adhoc`

**Response**:
```javascript
{
  shipment_id: "12345678",
  awb_code: "AWB123456789",
  pickup_scheduled_date: "2024-01-15"
}
```

**Database Update**:
```javascript
{
  awb_number: "AWB123456789",
  shipment_id: "12345678",
  carrier: "shiprocket",
  status: "pickup_booked" | "pickup_scheduled"
}
```

### 3.2 Delhivery Return Pickup

**Function**: `createDelhiveryReturnOrder(requestData, shopifyOrder)`

**Flow**:
1. Fetch customer address from Shopify
2. Load warehouse location
3. Sanitize addresses (remove `&`, `#`, `%`, `;`, `\`)
4. Build CMU API payload:
   ```javascript
   {
     shipments: [{
       name: "Customer Name",
       add: "Customer Address",
       pin: "123456",
       city: "City",
       state: "State",
       phone: "9876543210",
       payment_mode: "Pickup",  // Reverse pickup
       order: "REQ-XXXXX",
       products_desc: "Product 1, Product 2",
       hsn_code: "9965",
       return_pin: "Warehouse Pincode",
       return_add: "Warehouse Address",
       return_city: "Warehouse City",
       return_state: "Warehouse State",
       pickup_location: "warehouse_nickname",
       seller_gst_tin: "06AAKFO0351L1Z7",
       products: [...]
     }]
   }
   ```

**API Call**: `POST https://track.delhivery.com/api/cmu/create.json`

**Response**:
```javascript
{
  packages: [{
    waybill: "DL123456789",
    shipment_id: "REQ-XXXXX",
    status: "Success"
  }]
}
```

**Database Update**:
```javascript
{
  awb_number: "DL123456789",
  shipment_id: "REQ-XXXXX",
  carrier: "delhivery",
  status: "pickup_booked"
}
```

### 3.3 Fallback Logic

```javascript
try {
  // Try primary carrier
  response = await createPrimaryCarrierOrder(requestData);
} catch (primaryError) {
  console.error("Primary carrier failed:", primaryError.message);
  
  if (useFallback) {
    try {
      // Try fallback carrier
      response = await createFallbackCarrierOrder(requestData);
      carrierUsed = fallbackCarrier;
    } catch (fallbackError) {
      // Both failed
      throw new Error("Both carriers failed");
    }
  }
}
```

---

## 4️⃣ EXCHANGE FORWARD DISPATCH (Send Replacement to Customer)

### Trigger:
- Admin approves request after quality check passes
- Only for `type: 'exchange'` requests
- Status transition: `quality_check` → `approved`

### API Endpoint: `POST /api/admin/approve-request/:requestId`

### Carrier Resolution:
```javascript
const carrierMode = await getCarrierMode('dispatch');
const carrierResolution = resolveCarrier(carrierMode, null, 'dispatch');
```

### 4.1 Shiprocket Forward Order

**Function**: `createShiprocketForwardOrder(requestData, shopifyOrder)`

**Flow**:
1. Get Shiprocket token
2. Fetch Shopify order for customer address
3. Load warehouse location (shipping FROM)
4. Build payload:
   ```javascript
   {
     order_id: "REQ-XXXXX-FWD",
     order_date: "2024-01-15 10:30:00",
     pickup_location: "warehouse_nickname",
     billing_customer_name: "Customer Name",
     billing_address: "Customer Address (TO)",
     billing_city: "City",
     billing_pincode: "123456",
     billing_state: "State",
     shipping_customer_name: "Warehouse Name (FROM)",
     shipping_address: "Warehouse Address",
     shipping_city: "Warehouse City",
     shipping_pincode: "Warehouse Pincode",
     order_items: [
       {
         name: "Replacement Product (Variant)",
         sku: "variantId-EXCH",
         units: 1,
         selling_price: 999,
         discount: 0,
         tax: 0
       }
     ],
     payment_method: "Prepaid",
     sub_total: 999
   }
   ```

**API Call**: `POST https://apiv2.shiprocket.in/v1/external/orders/create/adhoc`

**Response**:
```javascript
{
  shipment_id: "87654321",
  awb_code: "AWB987654321"
}
```

### 4.2 Delhivery Forward Order

**Function**: `createDelhiveryForwardOrder(requestData, shopifyOrder)`

**Critical Direction Logic**:
- **FROM**: Warehouse (pickup_location)
- **TO**: Customer (shipping address)
- **Order ID**: `fws-REQ-XXXXX` (fws- prefix required by Delhivery)

**Flow**:
1. Fetch Shopify order for customer address
2. Load warehouse location
3. Use exchange address fields (`newName`, `newAddress`, etc.)
4. Process replacement items:
   ```javascript
   products.push({
     name: "Replacement Product (Variant)",
     quantity: 1,
     price: 999,
     selling_price: 999,
     sku: "replacementVariantId-EXCH",
     hsn_code: "9965"
   });
   ```

5. Build CMU payload (FORWARD direction):
   ```javascript
   {
     shipments: [{
       order: "fws-REQ-XXXXX",  // fws- prefix mandatory
       name: "Customer Name",    // TO customer
       add: "Customer Address",
       pin: "Customer Pincode",
       city: "Customer City",
       state: "Customer State",
       phone: "Customer Phone",
       payment_mode: "Prepaid",  // Forward = prepaid
       order_date: "2024-01-15",
       total_amount: 999,
       quantity: 1,
       weight: 500,  // grams
       products_desc: "Replacement Product",
       hsn_code: "9965",
       pickup_location: "warehouse_nickname",  // FROM warehouse
       seller_gst_tin: "06AAKFO0351L1Z7",
       products: [...]
     }],
     pickup_location: {
       name: "warehouse_nickname",
       add: "Warehouse Address",
       pin: "Warehouse Pincode",
       city: "Warehouse City",
       state: "Warehouse State",
       phone: "Warehouse Phone"
     }
   }
   ```

**API Call**: `POST https://track.delhivery.com/api/cmu/create.json`

**Response**:
```javascript
{
  packages: [{
    waybill: "DL987654321",
    shipment_id: "fws-REQ-XXXXX",
    status: "Success"
  }]
}
```

### 4.3 Database Update on Approval

```javascript
{
  status: "approved",
  forward_shipment_id: "87654321" | "fws-REQ-XXXXX",
  forward_awb_number: "AWB987654321" | "DL987654321",
  forward_status: "scheduled",
  forward_carrier: "shiprocket" | "delhivery",
  admin_notes: "Replacement Shipment Created (shiprocket: Shiprocket ID: 87654321)"
}
```

### 4.4 Approval Failure Handling

If forward shipment creation fails:
```javascript
{
  status: "quality_check",  // NOT approved
  admin_notes: "Failed to create replacement shipment. Check logs."
}
// Returns 500 error to admin
```

---

## 5️⃣ STATUS TRACKING & UPDATES

### Status Flow for Returns:
```
pending → pickup_booked → pickup_scheduled → picked_up → received_at_warehouse → resolved
```

### Status Flow for Exchanges:
```
pending → pickup_booked → picked_up → quality_check → approved → forward_shipped → delivered
```

### Tracking API:
```javascript
GET /api/admin/tracking/:requestId
```

**Shiprocket Tracking**:
```javascript
GET https://apiv2.shiprocket.in/v1/external/courier/track/shipment_id/{shipment_id}
```

**Delhivery Tracking**:
```javascript
GET https://track.delhivery.com/api/v1/packages/json/?waybill={waybill}
```

---

## 6️⃣ WAREHOUSE & PICKUP LOCATION CONFIGURATION

### Stored in Supabase `store_settings` table:

#### Warehouse Location:
```javascript
{
  key: "warehouse_location",
  value: {
    name: "BURB MANUFACTURES PVT LTD",
    address: "VILLAGE - BAIRAWAS, NEAR GOVT. SCHOOL",
    city: "MAHENDERGARH",
    state: "Haryana",
    pin_code: "123028",
    country: "IN",
    phone: "9138514222",
    email: "returns@offcomfort.com",
    pickup_location: "warehouse"  // Delhivery nickname
  }
}
```

#### Delhivery Pickup Location:
```javascript
{
  key: "delhivery_pickup_location",
  value: "warehouse"  // Must match Delhivery dashboard nickname exactly
}
```

#### Carrier Modes:
```javascript
{ key: "carrier_mode_pickup", value: "shiprocket_with_fallback" }
{ key: "carrier_mode_dispatch", value: "delhivery_with_fallback" }
```

---

## 7️⃣ RE-DISPATCH FUNCTIONALITY

### Use Case:
- Forward shipment failed/cancelled
- Need to re-create forward order

### API Endpoint: `POST /api/admin/redispatch/:requestId`

**Flow**:
1. Validates request is in `cancelled` or `failed` status
2. Resets forward shipment fields:
   ```javascript
   {
     forward_shipment_id: null,
     forward_awb_number: null,
     forward_status: null,
     forward_carrier: null,
     status: "approved"  // Ready for re-dispatch
   }
   ```
3. Admin can then approve again to trigger new forward shipment

---

## 8️⃣ BULK PICKUP INITIATION

### API Endpoint: `POST /api/admin/bulk-initiate-pickup`

**Features**:
- Select multiple requests (checkboxes)
- Choose carrier override (optional)
- Progress tracking for each request
- Client disconnect safety (uses streaming response)

**Flow**:
```javascript
for (const requestId of requestIds) {
  // Resolve carrier
  const carrierMode = await getCarrierMode('pickup');
  const carrierResolution = resolveCarrier(carrierMode, carrierOverride, 'pickup');
  
  // Create pickup order with fallback
  const result = await schedulePickup(token, requestId, order, items, type, carrierOverride);
  
  // Update database
  await updateRequestStatus(requestId, {
    awb_number: result.awbNumber,
    shipment_id: result.shipmentId,
    carrier: result.carrierUsed,
    status: "pickup_booked"
  });
}
```

---

## 9️⃣ ERROR HANDLING & RECOVERY

### Common Failure Scenarios:

#### 1. Forward Orders Missing Shipment ID
**Script**: `recover-failed-forward-orders.js`
- Finds `approved` exchanges with `forward_shipment_id IS NULL`
- Re-creates forward shipments
- Updates database

#### 2. Delhivery Orders in "Pending Review"
**Script**: `recover-pending-delhivery-orders.js`
- Queries Delhivery API by reference number
- Extracts waybill if found
- Updates status to `pickup_booked`

#### 3. Duplicate Delhivery Orders
**Script**: `cleanup-duplicates.js`
- Identifies duplicate orders by reference number
- Keeps latest valid order
- Archives duplicates

#### 4. Carrier Sync Gaps
**Script**: `sync-usage-from-shopify.js`
- Syncs Shopify order data with local database
- Updates carrier information
- Reconciles tracking numbers

---

## 🔟 DELHIVERY FORWARD ORDER FIXES (Key Learnings)

### Issue 1: Wrong Direction Logic
**Problem**: Forward orders were sending FROM customer TO warehouse (reverse)
**Fix**: 
- Customer = destination (TO)
- Warehouse = pickup_location (FROM)
- Use `payment_mode: "Prepaid"` for forward
- Use `fws-` prefix for order ID

### Issue 2: Missing Product Details
**Problem**: Delhivery dashboard showed empty product info
**Fix**: Added `products` array with:
```javascript
{
  name: "Product Name",
  quantity: 1,
  price: 999,
  selling_price: 999,
  sku: "variantId-EXCH",
  hsn_code: "9965"
}
```

### Issue 3: Missing GST/HSN Fields
**Problem**: Delhivery rejected orders without GST
**Fix**: Added mandatory fields:
- `seller_gst_tin`: From `.env` or default
- `hsn_code`: "9965" for apparel

### Issue 4: Pickup Location Mismatch
**Problem**: `ClientWarehouse not found` error
**Fix**: 
- `pickup_location` must exactly match Delhivery dashboard nickname
- Store in `delhivery_pickup_location` setting
- Fallback to `warehouse_location.pickup_location`

---

## 📊 DATABASE SCHEMA (Key Tables)

### `requests` Table:
```sql
request_id VARCHAR PRIMARY KEY,
order_number VARCHAR,
type VARCHAR (return/exchange),
status VARCHAR,
customer_name VARCHAR,
customer_phone VARCHAR,
customer_address TEXT,
items JSONB,
awb_number VARCHAR,
shipment_id VARCHAR,
carrier VARCHAR,
forward_shipment_id VARCHAR,
forward_awb_number VARCHAR,
forward_status VARCHAR,
forward_carrier VARCHAR,
admin_notes TEXT,
created_at TIMESTAMP,
updated_at TIMESTAMP
```

### `store_settings` Table:
```sql
key VARCHAR PRIMARY KEY,
value JSONB,
updated_at TIMESTAMP
```

---

## 🔧 ENVIRONMENT VARIABLES

```env
# Shopify
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxx

# Shiprocket
SHIPROCKET_EMAIL=your@email.com
SHIPROCKET_PASSWORD=password

# Delhivery
DELHIVERY_API_KEY=token_xxxx
DELHIVERY_PICKUP_LOCATION=warehouse
DELHIVERY_SELLER_GST=06AAKFO0351L1Z7
DELHIVERY_DEFAULT_WEIGHT=500
DELHIVERY_DEFAULT_LENGTH=30
DELHIVERY_DEFAULT_WIDTH=40
DELHIVERY_DEFAULT_HEIGHT=2

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxxx
```

---

## 🚀 TESTING FLOW

### Test Script: `test-delhivery-forward-order.js`

**Validates**:
1. ✅ Order ID has `fws-` prefix
2. ✅ Customer is destination (TO)
3. ✅ Warehouse is pickup (FROM)
4. ✅ Payment mode is `Prepaid`
5. ✅ Pickup location is configured
6. ✅ No forbidden characters in addresses
7. ✅ Products array is populated
8. ✅ GST TIN is included

**Run Test**:
```bash
node test-delhivery-forward-order.js
```

---

## 📋 COMPLETE FLOW CHECKLIST

### For Exchange Request:

- [ ] **1. Customer submits exchange request**
  - Order validated from Shopify
  - Replacement product selected
  - New shipping address captured
  - Request stored with status: `pending`

- [ ] **2. Admin reviews request**
  - Views original order details
  - Checks replacement product availability
  - Verifies customer address

- [ ] **3. Admin initiates pickup**
  - Carrier resolved based on `carrier_mode_pickup`
  - Pickup order created (Shiprocket/Delhivery)
  - AWB generated and stored
  - Status updated to: `pickup_booked`

- [ ] **4. Customer hands over item**
  - Carrier picks up item
  - Status updates via tracking: `picked_up`

- [ ] **5. Warehouse receives item**
  - Admin marks: `received_at_warehouse` or `quality_check`
  - Quality inspection performed

- [ ] **6. Admin approves exchange**
  - Status: `quality_check` → `approved`
  - Forward shipment created based on `carrier_mode_dispatch`
  - Replacement order created (Shiprocket/Delhivery)
  - Forward AWB generated
  - Database updated with forward shipment details

- [ ] **7. Forward shipment dispatched**
  - Carrier picks up from warehouse
  - Status: `forward_status: "scheduled"` → `"shipped"`

- [ ] **8. Customer receives replacement**
  - Tracking shows: `delivered`
  - Request marked as: `resolved`

---

## ⚠️ CRITICAL POINTS TO VERIFY

### 1. Carrier Mode Configuration
```javascript
// Check in admin dashboard settings
carrier_mode_pickup: "shiprocket_with_fallback"
carrier_mode_dispatch: "delhivery_with_fallback"
```

### 2. Warehouse Location Setup
```javascript
// Must have valid pickup_location nickname
warehouse_location.pickup_location: "warehouse"
```

### 3. Delhivery Pickup Location
```javascript
// Must match Delhivery dashboard exactly
delhivery_pickup_location: "warehouse"
```

### 4. Forward Order Direction (CRITICAL)
```javascript
// Forward = FROM warehouse TO customer
pickup_location: warehouse  // FROM
name: customer              // TO
payment_mode: "Prepaid"
order: "fws-REQ-XXXXX"
```

### 5. Return Order Direction
```javascript
// Return = FROM customer TO warehouse
name: customer              // FROM
return_add: warehouse       // TO
payment_mode: "Pickup"
order: "REQ-XXXXX"
```

### 6. Product Details in Delhivery
```javascript
// Both required for dashboard visibility
products_desc: "Product 1, Product 2",  // Simple text
products: [...]                          // Detailed array
```

### 7. GST Compliance
```javascript
// Mandatory for Delhivery
seller_gst_tin: "06AAKFO0351L1Z7",
hsn_code: "9965"
```

---

## 🔍 DEBUGGING TIPS

### Check Carrier Resolution:
```javascript
// Add logs in approve endpoint
console.log("Carrier Mode:", carrierMode);
console.log("Carrier Resolution:", carrierResolution);
```

### Verify Payload Before API Call:
```javascript
console.log("Payload:", JSON.stringify(payload, null, 2));
```

### Track API Response:
```javascript
console.log("Delhivery Response:", JSON.stringify(data, null, 2));
```

### Check Database State:
```javascript
// Query request
SELECT * FROM requests WHERE request_id = 'REQ-XXXXX';

// Check settings
SELECT * FROM store_settings WHERE key IN ('carrier_mode_pickup', 'carrier_mode_dispatch', 'warehouse_location', 'delhivery_pickup_location');
```

---

## 📝 SUMMARY

The exchange return tracking system handles:
- ✅ Multi-carrier support (Shiprocket + Delhivery)
- ✅ Automatic fallback logic
- ✅ Separate pickup/dispatch carrier modes
- ✅ Forward order creation with correct direction
- ✅ Product details and GST compliance
- ✅ Status tracking and updates
- ✅ Bulk operations
- ✅ Recovery scripts for failed orders
- ✅ Admin dashboard for management

**Key Success Factors**:
1. Correct carrier mode configuration
2. Valid warehouse/pickup location setup
3. Proper forward order direction (warehouse → customer)
4. Complete product and GST information
5. Robust error handling with fallback

---

*Generated: 2026-05-19*
*System Version: Production*
