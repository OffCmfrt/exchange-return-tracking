const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️  Supabase credentials not found. Database features will not work.');
    console.warn('   Add SUPABASE_URL and SUPABASE_ANON_KEY to your .env file');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

module.exports = supabase;
