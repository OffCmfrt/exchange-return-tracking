/**
 * Apply Operators & Activity Log migration
 *
 * Creates the `operators` and `operator_activity_logs` tables
 * (see supabase_migration_operators.sql).
 *
 * Run: node apply-operators-migration.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
    const sqlPath = path.join(__dirname, 'supabase_migration_operators.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('🔧 Applying operators migration via exec_sql RPC...\n');

    const { error } = await supabase.rpc('exec_sql', { sql });

    if (error) {
        console.log('⚠️  Direct SQL RPC not available:', error.message);
        console.log('📋 Please run the migration manually in your Supabase SQL Editor:');
        console.log('─'.repeat(70));
        console.log('   1. Go to: https://app.supabase.com/project/_/sql');
        console.log('   2. Paste the full contents of supabase_migration_operators.sql');
        console.log('   3. Click "Run"');
        console.log('─'.repeat(70));
        process.exit(1);
    }

    console.log('✅ Migration applied successfully.');

    // Verify tables exist
    const { error: checkError } = await supabase.from('operators').select('id').limit(1);
    if (checkError) {
        console.error('❌ Verification failed:', checkError.message);
        process.exit(1);
    }
    const { error: logCheckError } = await supabase.from('operator_activity_logs').select('id').limit(1);
    if (logCheckError) {
        console.error('❌ Verification failed for activity logs:', logCheckError.message);
        process.exit(1);
    }

    console.log('✅ Verified: operators + operator_activity_logs tables are live.');
}

applyMigration().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
