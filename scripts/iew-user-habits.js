const db = require('../config/database');

async function viewUserHabits() {
  try {
    // Получаем всех пользователей
    const users = await db.query('SELECT id, username, telegram_id FROM users');
    console.log('\n👥 Users in database:');
    users.rows.forEach(user => {
      console.log(`  ID: ${user.id}, Username: ${user.username}, Telegram ID: ${user.telegram_id}`);
    });
    
    // Для каждого пользователя показываем привычки
    for (const user of users.rows) {
      const habits = await db.query(`
        SELECT h.*, c.name_en as category_name
        FROM habits h
        LEFT JOIN categories c ON h.category_id = c.id
        WHERE h.user_id = $1 AND h.is_active = true
      `, [user.id]);
      
      console.log(`\n📋 Habits for user ${user.username} (ID: ${user.id}):`);
      if (habits.rows.length === 0) {
        console.log('  No active habits');
      } else {
        habits.rows.forEach((habit, index) => {
          console.log(`  ${index + 1}. ${habit.title} (${habit.category_name || 'No category'})`);
          console.log(`     Goal: ${habit.goal}`);
          console.log(`     Type: ${habit.is_bad_habit ? 'Bad habit 😈' : 'Good habit ✨'}`);
        });
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

viewUserHabits();