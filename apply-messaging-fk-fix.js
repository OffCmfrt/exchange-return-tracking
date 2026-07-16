/**
 * Apply Foreign Key Fix for influencer_messages table
 * 
 * This script adds the missing foreign key constraint between 
 * influencer_messages.sender_id and influencers.id
 * 
 * Run: node apply-messaging-fk-fix.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyFKFix() {
    console.log('🔧 Adding foreign key constraint to influencer_messages table...\n');

    // Execute raw SQL to add the foreign key constraint
    const { data, error } = await supabase.rpc('exec_sql', {
        sql: `
            ALTER TABLE influencer_messages
              ADD CONSTRAINT fk_influencer_messages_sender
              FOREIGN KEY (sender_id)
              REFERENCES influencers(id)
              ON DELETE SET NULL;
        `
    });

    if (error) {
        // If RPC doesn't exist, we'll use the REST API workaround
        console.log('⚠️  Direct SQL RPC not available, trying alternative approach...\n');
        console.log('📋 Please run this SQL manually in your Supabase SQL Editor:');
        console.log('─'.repeat(70));
        console.log(`
ALTER TABLE influencer_messages
  ADD CONSTRAINT fk_influencer_messages_sender
  FOREIGN KEY (sender_id)
  REFERENCES influencers(id)
  ON DELETE SET NULL;
        `.trim());
        console.log('─'.repeat(70));
        console.log('\n💡 Steps:');
        console.log('   1. Go to: https://app.supabase.com/project/_/sql');
        console.log('   2. Paste the SQL above');
        console.log('   3. Click "Run"');
        console.log('   4. Verify with this query:');
        console.log(`
SELECT 
  conname AS constraint_name,
  conrelid::regclass AS table_name,
  confrelid::regclass AS references_table
FROM pg_constraint
WHERE conname = 'fk_influencer_messages_sender';
        `.trim());
        return;
    }

    console.log('✅ Foreign key constraint added successfully!\n');
    console.log('🔍 Verifying constraint...');

    // Verify the constraint exists
    const { data: verification, error: verifyError } = await supabase.rpc('exec_sql', {
        sql: `
            SELECT 
              conname AS constraint_name,
              conrelid::regclass AS table_name,
              confrelid::regclass AS references_table
            FROM pg_constraint
            WHERE conname = 'fk_influencer_messages_sender';
        `
    });

    if (verifyError) {
        console.error('❌ Verification failed:', verifyError.message);
        return;
    }

    console.log('✅ Constraint verified:');
    console.table(verification);
    console.log('\n🎉 Migration complete! The messaging system should now work correctly.');
}

// Run the migration
applyFKFix().catch(err => {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
});
