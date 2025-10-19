require('dotenv').config();
const db = require('../config/database');

async function verifyTables() {
  try {
    console.log('🔍 Verifying subscription tables...\n');
    
    // Проверяем users
    const usersCheck = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name IN ('is_premium', 'subscription_type', 'subscription_expires_at')
      ORDER BY column_name
    `);
    
    console.log('✅ Users table columns:');
    usersCheck.rows.forEach(row => {
      console.log(`   - ${row.column_name}: ${row.data_type}`);
    });
    
    // Проверяем subscriptions
    const subsCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'subscriptions'
      ) as exists
    `);
    
    console.log(`\n✅ Subscriptions table exists: ${subsCheck.rows[0].exists}`);
    
    if (subsCheck.rows[0].exists) {
      const subsColumns = await db.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'subscriptions'
        ORDER BY ordinal_position
      `);
      
      console.log('   Columns:');
      subsColumns.rows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type}`);
      });
    }
    
    // Проверяем telegram_payments
    const paymentsCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'telegram_payments'
      ) as exists
    `);
    
    console.log(`\n✅ Telegram_payments table exists: ${paymentsCheck.rows[0].exists}`);
    
    // Проверяем количество подписок
    if (subsCheck.rows[0].exists) {
      const countResult = await db.query('SELECT COUNT(*) as count FROM subscriptions');
      console.log(`\n📊 Total subscriptions: ${countResult.rows[0].count}`);
      
      const activeResult = await db.query('SELECT COUNT(*) as count FROM subscriptions WHERE is_active = true');
      console.log(`📊 Active subscriptions: ${activeResult.rows[0].count}`);
    }
    
    console.log('\n✅ Verification complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

verifyTables();