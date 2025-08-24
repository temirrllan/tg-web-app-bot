const db = require('../config/database');

async function monitorReminders() {
  try {
    console.log('📊 МОНИТОРИНГ НАПОМИНАНИЙ\n');
    console.log('=' .repeat(50));
    
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentDay = now.getDay() || 7;
    
    console.log(`⏰ Текущее время: ${currentTime}`);
    console.log(`📅 Текущий день: ${currentDay} (${['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][now.getDay()]})\n`);
    
    // Привычки, которые должны отправиться в эту минуту
    const nowReminders = await db.query(`
      SELECT 
        h.title,
        h.reminder_time,
        u.first_name,
        u.telegram_id
      FROM habits h
      JOIN users u ON h.user_id = u.id
      WHERE h.reminder_enabled = true
      AND h.is_active = true
      AND h.reminder_time = $1
      AND $2 = ANY(h.schedule_days)
    `, [`${currentTime}:00`, currentDay]);
    
    if (nowReminders.rows.length > 0) {
      console.log('🔔 НАПОМИНАНИЯ СЕЙЧАС:');
      for (const r of nowReminders.rows) {
        console.log(`   • "${r.title}" для ${r.first_name} (TG: ${r.telegram_id})`);
      }
    } else {
      console.log('📭 Нет напоминаний на текущую минуту');
    }
    
    // Следующие 5 напоминаний
    console.log('\n📋 БЛИЖАЙШИЕ НАПОМИНАНИЯ:');
    const upcoming = await db.query(`
      SELECT 
        h.title,
        h.reminder_time,
        h.schedule_days,
        u.first_name
      FROM habits h
      JOIN users u ON h.user_id = u.id
      WHERE h.reminder_enabled = true
      AND h.is_active = true
      AND h.reminder_time > $1
      ORDER BY h.reminder_time
      LIMIT 5
    `, [`${currentTime}:00`]);
    
    if (upcoming.rows.length > 0) {
      for (const r of upcoming.rows) {
        const willSendToday = r.schedule_days.includes(currentDay);
        const todayMark = willSendToday ? '✅' : '❌';
        console.log(`   ${todayMark} ${r.reminder_time.substring(0, 5)} - "${r.title}" (${r.first_name})`);
      }
    } else {
      console.log('   Нет запланированных напоминаний');
    }
    
    // Статистика
    const stats = await db.query(`
      SELECT 
        COUNT(DISTINCT h.id) as total_habits,
        COUNT(DISTINCT CASE WHEN h.reminder_enabled THEN h.id END) as with_reminders,
        COUNT(DISTINCT u.id) as total_users
      FROM habits h
      JOIN users u ON h.user_id = u.id
      WHERE h.is_active = true
    `);
    
    console.log('\n📈 СТАТИСТИКА:');
    console.log(`   Всего привычек: ${stats.rows[0].total_habits}`);
    console.log(`   С напоминаниями: ${stats.rows[0].with_reminders}`);
    console.log(`   Пользователей: ${stats.rows[0].total_users}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

monitorReminders();