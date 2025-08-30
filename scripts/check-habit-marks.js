const db = require('../config/database');

async function checkHabitMarks() {
  try {
    console.log('🔍 Checking habit marks in database...\n');
    
    // Получаем последние отметки
    const marks = await db.query(`
      SELECT 
        hm.id,
        hm.habit_id,
        hm.date,
        hm.status,
        hm.marked_at,
        h.title,
        u.username
      FROM habit_marks hm
      JOIN habits h ON hm.habit_id = h.id
      JOIN users u ON h.user_id = u.id
      ORDER BY hm.marked_at DESC
      LIMIT 20
    `);
    
    console.log(`Found ${marks.rows.length} recent marks:\n`);
    
    marks.rows.forEach(mark => {
      const statusEmoji = {
        'completed': '✅',
        'failed': '❌',
        'skipped': '⏭️',
        'pending': '⏸️'
      }[mark.status] || '❓';
      
      console.log(`${statusEmoji} ${mark.status.padEnd(10)} | ${mark.date.toISOString().split('T')[0]} | "${mark.title}" (${mark.username})`);
    });
    
    // Статистика по статусам
    const stats = await db.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM habit_marks
      GROUP BY status
      ORDER BY count DESC
    `);
    
    console.log('\n📊 Status statistics:');
    stats.rows.forEach(stat => {
      console.log(`  ${stat.status}: ${stat.count} marks`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkHabitMarks();  