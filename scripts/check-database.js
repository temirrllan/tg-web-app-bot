const db = require('../config/database');

async function checkDatabase() {
  console.log('🔍 Checking database structure...\n');
  
  try {
    // Проверка таблицы telegram_payments
    console.log('📊 Checking telegram_payments table...');
    const paymentsCheck = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'telegram_payments'
      ORDER BY ordinal_position
    `);
    
    if (paymentsCheck.rows.length === 0) {
      console.log('❌ Table telegram_payments does not exist!\n');
      console.log('Creating table...\n');
      
      await db.query(`
        CREATE TABLE IF NOT EXISTS telegram_payments (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          telegram_payment_charge_id VARCHAR(255) UNIQUE,
          provider_payment_charge_id VARCHAR(255),
          invoice_payload VARCHAR(500) NOT NULL,
          currency VARCHAR(10) DEFAULT 'XTR',
          total_amount INTEGER NOT NULL,
          plan_type VARCHAR(50) NOT NULL,
          status VARCHAR(50) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          processed_at TIMESTAMP,
          CONSTRAINT unique_payment_charge UNIQUE (telegram_payment_charge_id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_telegram_payments_user_id ON telegram_payments(user_id);
        CREATE INDEX IF NOT EXISTS idx_telegram_payments_invoice_payload ON telegram_payments(invoice_payload);
        CREATE INDEX IF NOT EXISTS idx_telegram_payments_status ON telegram_payments(status);
      `);
      
      console.log('✅ Table telegram_payments created\n');
    } else {
      console.log('✅ Table telegram_payments exists');
      console.log('Columns:');
      paymentsCheck.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
      });
      console.log('');
    }
    
    // Проверка таблицы subscriptions
    console.log('📊 Checking subscriptions table...');
    const subscriptionsCheck = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'subscriptions'
      ORDER BY ordinal_position
    `);
    
    if (subscriptionsCheck.rows.length === 0) {
      console.log('❌ Table subscriptions does not exist!\n');
      console.log('Creating table...\n');
      
      await db.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plan_type VARCHAR(50) NOT NULL,
          plan_name VARCHAR(255) NOT NULL,
          price_stars INTEGER DEFAULT 0,
          started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP,
          is_active BOOLEAN DEFAULT true,
          is_trial BOOLEAN DEFAULT false,
          payment_method VARCHAR(50) DEFAULT 'telegram_stars',
          telegram_payment_charge_id VARCHAR(255),
          cancelled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (telegram_payment_charge_id) REFERENCES telegram_payments(telegram_payment_charge_id) ON DELETE SET NULL
        );
        
        CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active);
      `);
      
      console.log('✅ Table subscriptions created\n');
    } else {
      console.log('✅ Table subscriptions exists');
      console.log('Columns:');
      subscriptionsCheck.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
      });
      console.log('');
    }
    
    // Проверка таблицы subscription_history
    console.log('📊 Checking subscription_history table...');
    const historyCheck = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'subscription_history'
      ORDER BY ordinal_position
    `);
    
    if (historyCheck.rows.length === 0) {
      console.log('❌ Table subscription_history does not exist!\n');
      console.log('Creating table...\n');
      
      await db.query(`
        CREATE TABLE IF NOT EXISTS subscription_history (
          id SERIAL PRIMARY KEY,
          subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          action VARCHAR(50) NOT NULL,
          plan_type VARCHAR(50),
          price_stars INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_subscription_history_user_id ON subscription_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_subscription_history_subscription_id ON subscription_history(subscription_id);
      `);
      
      console.log('✅ Table subscription_history created\n');
    } else {
      console.log('✅ Table subscription_history exists');
      console.log('Columns:');
      historyCheck.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type} ${row.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
      });
      console.log('');
    }
    
    // Проверка полей в таблице users
    console.log('📊 Checking users table premium fields...');
    const usersCheck = await db.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users' 
      AND column_name IN ('is_premium', 'subscription_type', 'subscription_expires_at')
      ORDER BY ordinal_position
    `);
    
    if (usersCheck.rows.length < 3) {
      console.log('⚠️ Missing premium fields in users table\n');
      console.log('Adding fields...\n');
      
      const existingColumns = usersCheck.rows.map(r => r.column_name);
      
      if (!existingColumns.includes('is_premium')) {
        await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false');
        console.log('✅ Added is_premium column');
      }
      
      if (!existingColumns.includes('subscription_type')) {
        await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_type VARCHAR(50)');
        console.log('✅ Added subscription_type column');
      }
      
      if (!existingColumns.includes('subscription_expires_at')) {
        await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP');
        console.log('✅ Added subscription_expires_at column');
      }
      
      console.log('');
    } else {
      console.log('✅ All premium fields exist in users table');
      usersCheck.rows.forEach(row => {
        console.log(`  - ${row.column_name}: ${row.data_type}`);
      });
      console.log('');
    }
    
    console.log('✅ Database structure check complete!\n');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error checking database:', error);
    process.exit(1);
  }
}

checkDatabase();