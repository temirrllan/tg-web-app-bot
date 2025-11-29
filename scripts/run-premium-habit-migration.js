// scripts/run-premium-habit-migration.js
// Запуск: node scripts/run-premium-habit-migration.js

require('dotenv').config();
const { Pool } = require('pg');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting premium habit migration...');
    
    await client.query('BEGIN');
    
    // 1. Добавляем колонки
    console.log('📝 Adding columns...');
    await client.query(`
      ALTER TABLE habits 
      ADD COLUMN IF NOT EXISTS is_premium_habit BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS locked_reason VARCHAR(50)
    `);
    
    // 2. Помечаем существующие привычки сверх лимита как премиум
    console.log('🔖 Marking existing habits as premium...');
    const result = await client.query(`
      WITH user_habits AS (
        SELECT 
          h.id,
          h.user_id,
          h.created_at,
          ROW_NUMBER() OVER (PARTITION BY h.user_id ORDER BY h.created_at) as habit_number,
          u.is_premium
        FROM habits h
        JOIN users u ON u.id = h.user_id
        WHERE h.is_active = true
      )
      UPDATE habits
      SET is_premium_habit = true
      FROM user_habits uh
      WHERE habits.id = uh.id
      AND uh.habit_number > 3
      RETURNING habits.id, habits.user_id, habits.title
    `);
    
    console.log(`✅ Marked ${result.rows.length} habits as premium`);
    
    // 3. Блокируем премиум привычки у пользователей без подписки
    console.log('🔒 Locking premium habits for non-premium users...');
    const lockResult = await client.query(`
      UPDATE habits
      SET 
        locked_at = CURRENT_TIMESTAMP,
        locked_reason = 'subscription_expired'
      WHERE is_premium_habit = true
      AND user_id IN (
        SELECT id FROM users WHERE is_premium = false
      )
      AND locked_at IS NULL
      RETURNING id, user_id, title
    `);
    
    console.log(`✅ Locked ${lockResult.rows.length} habits`);
    
    // 4. Создаём индекс
    console.log('📊 Creating index...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_habits_locked 
      ON habits(user_id, locked_at) 
      WHERE locked_at IS NOT NULL
    `);
    
    // 5. Добавляем комментарии
    await client.query(`
      COMMENT ON COLUMN habits.is_premium_habit IS 'Флаг для привычек, созданных во время премиум-подписки';
      COMMENT ON COLUMN habits.locked_at IS 'Время блокировки привычки после окончания подписки';
      COMMENT ON COLUMN habits.locked_reason IS 'Причина блокировки: subscription_expired, subscription_cancelled';
    `);
    
    await client.query('COMMIT');
    
    console.log('🎉 Migration completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`  - Premium habits marked: ${result.rows.length}`);
    console.log(`  - Habits locked: ${lockResult.rows.length}`);
    
    // Показываем примеры
    if (lockResult.rows.length > 0) {
      console.log('\n🔒 Locked habits examples:');
      lockResult.rows.slice(0, 5).forEach(h => {
        console.log(`  - User ${h.user_id}: "${h.title}" (ID: ${h.id})`);
      });
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });