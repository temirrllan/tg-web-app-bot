const db = require('../config/database');

async function checkReminders() {
  try {
    console.log('🔍 Проверяем привычки с напоминаниями...\n');
    
    const now = new Date();
    const currentDay = now.getDay() || 7;
    
    // Получаем все привычки с включенными напоминаниями
    const result = await db.query(`
      SELECT 
        h.id,
        h.title,
        h.reminder_time,
        h.reminder_enabled,
        h.schedule_days,
        u.telegram_id,
        u.username,
        u.first_name
      FROM habits h
      JOIN users u ON h.user_id = u.id
      WHERE h.reminder_enabled = true
      AND h.is_active = true
      ORDER BY h.reminder_time
    `);
    
    console.log(`Найдено ${result.rows.length} привычек с напоминаниями:\n`);
    
    for (const habit of result.rows) {
      const timeStr = habit.reminder_time ? 
        habit.reminder_time.substring(0, 5) : 'не установлено';
      
      const daysStr = habit.schedule_days ? 
        habit.schedule_days.join(', ') : 'все дни';
      
      const willRemindToday = habit.schedule_days && 
        habit.schedule_days.includes(currentDay);
      
      console.log(`📌 "${habit.title}"`);
      console.log(`   Пользователь: ${habit.first_name} (@${habit.username})`);
      console.log(`   Telegram ID: ${habit.telegram_id}`);
      console.log(`   Время: ${timeStr}`);
      console.log(`   Дни: [${daysStr}]`);
      console.log(`   Сегодня (день ${currentDay}): ${willRemindToday ? '✅ будет напоминание' : '❌ нет напоминания'}`);
      console.log('');
    }
    
    // Проверяем напоминания на ближайший час
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    const nextTime = `${String(nextHour.getHours()).padStart(2, '0')}:00:00`;
    
    const nextReminders = await db.query(`
      SELECT COUNT(*) as count
      FROM habits h
      WHERE h.reminder_enabled = true
      AND h.is_active = true
      AND h.reminder_time >= $1
      AND h.reminder_time < $2
      AND $3 = ANY(h.schedule_days)
    `, [
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`,
      nextTime,
      currentDay
    ]);
    
    console.log(`\n📅 В ближайший час будет отправлено напоминаний: ${nextReminders.rows[0].count}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

checkReminders();