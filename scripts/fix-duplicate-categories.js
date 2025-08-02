const db = require('../config/database');

async function fixDuplicateCategories() {
  try {
    console.log('🔍 Checking for duplicate categories...');
    
    // Получаем все категории
    const result = await db.query(`
      SELECT name_en, COUNT(*) as count, MIN(id) as keep_id
      FROM categories
      GROUP BY name_en
      HAVING COUNT(*) > 1
    `);
    
    if (result.rows.length === 0) {
      console.log('✅ No duplicate categories found');
      return;
    }
    
    console.log(`Found ${result.rows.length} duplicate category names`);
    
    // Удаляем дубликаты, оставляя только записи с минимальным ID
    for (const row of result.rows) {
      console.log(`Fixing duplicates for: ${row.name_en}`);
      
      // Сначала обновляем привычки, чтобы они ссылались на основную категорию
      await db.query(`
        UPDATE habits 
        SET category_id = $1 
        WHERE category_id IN (
          SELECT id FROM categories 
          WHERE name_en = $2 AND id != $1
        )
      `, [row.keep_id, row.name_en]);
      
      // Затем удаляем дубликаты
      const deleteResult = await db.query(`
        DELETE FROM categories 
        WHERE name_en = $1 AND id != $2
      `, [row.name_en, row.keep_id]);
      
      console.log(`  Deleted ${deleteResult.rowCount} duplicates`);
    }
    
    // Показываем финальный список категорий
    const finalCategories = await db.query('SELECT * FROM categories ORDER BY sort_order');
    console.log(`\n✅ Fixed! Now have ${finalCategories.rows.length} categories`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixDuplicateCategories();