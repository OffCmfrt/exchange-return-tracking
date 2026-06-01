# Deploy Bulk Shipment JS to Shopify Theme

## 📋 What Changed

- Extracted bulk shipment functions from `page.influencer-admin.liquid`
- Created separate `bulk-shipment.js` file (321 lines)
- Updated script tag to use Shopify's asset_url filter

---

## 🚀 Deployment Steps

### Option 1: Using Shopify CLI (Recommended)

```bash
# Navigate to your Shopify theme directory
cd your-shopify-theme/

# Copy the JS file to assets folder
cp /path/to/exchange-return-tracking-main/public/bulk-shipment.js assets/

# Push to Shopify
shopify theme push

# Or push to production directly
shopify theme push --live
```

### Option 2: Manual Upload via Shopify Admin

1. **Go to**: Shopify Admin > Online Store > Themes
2. **Click**: "..." (Actions) > Edit code
3. **Navigate to**: Assets folder
4. **Click**: "Add a new asset"
5. **Upload**: `bulk-shipment.js` file
6. **Save** the theme

---

## ✅ Verify the Setup

### 1. Check File Location
```
shopify-theme/
├── assets/
│   └── bulk-shipment.js          ← Should be here
├── templates/
│   └── page.influencer-admin.liquid
```

### 2. Check Script Tag in Liquid File
Should see:
```liquid
<script src="{{ 'bulk-shipment.js' | asset_url }}" defer></script>
```

### 3. Test in Browser
1. Open your influencer admin page
2. Open DevTools (F12) > Network tab
3. Look for `bulk-shipment.js` loading successfully
4. Check Console for any errors

---

## 🔧 What the JS File Contains

All bulk shipment functionality:
- ✅ `toggleProductSelection()` - Individual product selection
- ✅ `toggleSelectAll()` - Select all products
- ✅ `updateSelectionUI()` - Update counter and button state
- ✅ `openBulkAssignModal()` - Open bulk assignment modal
- ✅ `closeBulkAssignModal()` - Close modal
- ✅ `loadInfluencersForBulkShipment()` - Load influencer dropdown
- ✅ `saveBulkShipment()` - Create multi-product shipment

---

## 📊 File Size Reduction

- **Before**: 276 KB (exceeded 256 KB limit)
- **After**: 229 KB (under limit)
- **Saved**: 47 KB (17% reduction)

---

## ⚠️ Important Notes

1. **Asset URL**: Shopify serves assets from CDN, not your server
2. **Cache**: Browser may cache the JS file - use hard refresh (Ctrl+F5)
3. **Theme Sync**: Keep local copy in sync with Shopify theme
4. **Version Control**: Both files should be in your git repo

---

## 🐛 Troubleshooting

### Script Not Loading
- Check file is in `assets/` folder
- Verify script tag uses `{{ 'bulk-shipment.js' | asset_url }}`
- Clear browser cache

### Functions Not Defined
- Check for JavaScript errors in console
- Ensure script loads before functions are called
- Verify `defer` attribute doesn't cause timing issues

### 404 Error
- File might not be uploaded to Shopify
- Check file name matches exactly: `bulk-shipment.js`
- Verify theme is published/previewed

---

## 📁 Files Modified

1. `public/page.influencer-admin.liquid` - Updated script tag
2. `public/bulk-shipment.js` - New file (copy to Shopify assets/)

---

**Ready to deploy!** 🚀
