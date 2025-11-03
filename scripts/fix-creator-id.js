const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE !== 'disable' ? { rejectUnauthorized: false } : false
});

async function fixCreatorIds() {
  try {
    console.log('🔧 Fixing creator_id in habits table...');
    
    // Проверяем сколько записей нужно обновить
    const checkResult = await pool.query(
      'SELECT COUNT(*) as count FROM habits WHERE creator_id IS NULL'
    );
    
    const nullCount = parseInt(checkResult.rows[0].count);
    console.log(`📊 Found ${nullCount} habits without creator_id`);
    
    if (nullCount === 0) {
      console.log('✅ All habits already have creator_id');
      return;
    }
    
    // Обновляем creator_id = user_id для всех записей без creator_id
    const updateResult = await pool.query(
      'UPDATE habits SET creator_id = user_id WHERE creator_id IS NULL'
    );
    
    console.log(`✅ Updated ${updateResult.rowCount} habits`);
    
    // Проверяем результат
    const verifyResult = await pool.query(
      'SELECT COUNT(*) as count FROM habits WHERE creator_id IS NULL'
    );
    
    const remainingNull = parseInt(verifyResult.rows[0].count);
    
    if (remainingNull === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log(`⚠️ Warning: ${remainingNull} habits still have NULL creator_id`);
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await pool.end();
  }
}

fixCreatorIds();