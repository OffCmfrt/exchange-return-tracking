require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');

const SQL_FILE = 'supabase_migration_athlete_program.sql';
const CONNECTION_STRING = process.env.SHOPPERHUB_DB_URL || 
  'postgresql://postgres.xjeuxzyupmvyfxqiitty:namanOFFcmfrt%4041@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

async function run() {
  console.log('=== Running Athlete Program Schema Migration ===\n');
  
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const client = new Client({ connectionString: CONNECTION_STRING });
  
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL\n');
    
    // Execute the full migration SQL
    await client.query(sql);
    
    console.log('\nMigration executed successfully!\n');
    
    // Verify tables were created
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('influencer_socials','applications','access_tokens','comfort_levels',
        'level_history','ledger_entries','task_templates','assignments','submissions',
        'submission_metrics','shipment_requests','discount_codes','attributed_orders',
        'payout_methods','payouts','program_settings')
      ORDER BY table_name
    `);
    
    console.log(`Tables created/verified: ${tables.length}/16`);
    tables.forEach(t => console.log(`  ✓ ${t.table_name}`));
    
    // Verify comfort_levels seed data
    const { rows: levels } = await client.query('SELECT ordinal, code, display_name, display_number FROM comfort_levels ORDER BY ordinal');
    console.log(`\nComfort levels seeded: ${levels.length}/6`);
    levels.forEach(l => console.log(`  ${l.ordinal}. ${l.display_name} (display: ${l.display_number || 'NULL'})`));
    
    // Verify program_settings seed data
    const { rows: settings } = await client.query('SELECT COUNT(*) as count FROM program_settings');
    console.log(`\nProgram settings seeded: ${settings[0].count}`);
    
    // Verify new columns on influencers
    const { rows: cols } = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'influencers' 
      AND column_name IN ('athlete_no','level_id','xp_total','coin_balance','standing_score','athlete_status','manager_id','referred_by_id','joined_at','graduated_at','level_since','benefit_value_fy','leaderboard_opt_out')
      ORDER BY column_name
    `);
    console.log(`\nNew columns on influencers: ${cols.length}/13`);
    cols.forEach(c => console.log(`  ✓ ${c.column_name}`));
    
    console.log('\n=== Schema Migration Complete ===');
    
  } catch (err) {
    console.error('\nMigration error:', err.message);
    if (err.position) console.error('At SQL position:', err.position);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
