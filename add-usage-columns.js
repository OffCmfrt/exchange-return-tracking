require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addUsageColumns() {
    console.log('=== Adding Usage Tracking Columns to Influencers Table ===\n');
    
    try {
        // Check if columns already exist
        const { data: columns, error: columnsError } = await supabase
            .from('influencers')
            .select('*')
            .limit(1);
        
        if (columnsError) {
            console.error('❌ Error checking table:', columnsError.message);
            return;
        }
        
        const existingColumns = columns.length > 0 ? Object.keys(columns[0]) : [];
        console.log('Existing columns:', existingColumns.join(', '));
        console.log('');
        
        const needsUsageCount = !existingColumns.includes('usage_count');
        const needsLastSynced = !existingColumns.includes('last_synced_at');
        
        if (!needsUsageCount && !needsLastSynced) {
            console.log('✅ All required columns already exist!');
            return;
        }
        
        // Note: Supabase doesn't support ALTER TABLE directly through JS API
        // You need to run this SQL in your Supabase Dashboard SQL Editor:
        
        console.log('📋 Please run the following SQL in your Supabase Dashboard:\n');
        console.log('=== COPY THIS SQL ===\n');
        
        if (needsUsageCount) {
            console.log('ALTER TABLE influencers ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;');
        }
        
        if (needsLastSynced) {
            console.log('ALTER TABLE influencers ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP WITH TIME ZONE;');
        }
        
        console.log('\n=== END SQL ===\n');
        console.log('After running the SQL, come back and run: node sync-usage-from-shopify.js');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

addUsageColumns().catch(console.error);
