const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;

// Use the service role key to securely bypass RLS in the server environment
// If not available, fallback to the anon key (not recommended for backend as it requires permissive RLS)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️  Supabase credentials not found. Database features will not work.');
    console.warn('   Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your .env file');
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_ANON_KEY) {
    console.warn('⚠️  WARNING: Using SUPABASE_ANON_KEY in the backend.');
    console.warn('   This requires permissive RLS policies which are a security risk.');
    console.warn('   Please configure SUPABASE_SERVICE_ROLE_KEY to securely bypass RLS.');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

module.exports = supabase;
