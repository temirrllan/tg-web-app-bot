const cron = require('node-cron');
const db = require('../config/database');

class ReminderService {
  constructor(bot) {
    this.bot = bot;
    this.tasks = new Map();
    this.isRunning = false;
    console.log('🔔 ReminderService initialized');
  }

  start() {
    if (this.isRunning) {
      console.log('⚠️ Reminder service is already running');
      return;
    }

    console.log('🔔 Starting reminder service...');
    
    // Проверяем напоминания каждую минуту
    const task = cron.schedule('* * * * *', async () => {
      await this.checkAndSendReminders();
    }, {
      scheduled: true,
      timezone: process.env.TZ || "UTC" // Используем часовой пояс из переменных окружения
    });
    
    this.tasks.set('main', task);
    this.isRunning = true;
    console.log('✅ Reminder service started - checking every minute');
    console.log(`📍 Timezone: ${process.env.TZ || 'UTC'}`);
    
    // Сразу проверяем при запуске
    setTimeout(() => this.checkAndSendReminders(), 5000);
  }

  async checkAndSendReminders() {
    try {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
      const currentDay = now.getDay() || 7; // 0 (Sunday) = 7
      
      console.log(`🕐 Checking reminders: ${currentTime}, Day: ${currentDay} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]})`);
      
      // Получаем все привычки с напоминаниями на текущее время
      const result = await db.query(
        `SELECT 
          h.id,
          h.title,
          h.goal,
          h.reminder_time,
          h.schedule_days,
          u.telegram_id,
          u.first_name,
          u.language
         FROM habits h
         JOIN users u ON h.user_id = u.id
         WHERE h.reminder_enabled = true
         AND h.reminder_time = $1
         AND h.is_active = true
         AND $2 = ANY(h.schedule_days)`,
        [currentTime, currentDay]
      );
      
      if (result.rows.length > 0) {
        console.log(`📨 Found ${result.rows.length} habits to remind about at ${currentTime}`);
        
        for (const habit of result.rows) {
          // Проверяем, не отправляли ли уже сегодня
          const sentToday = await db.query(
            `SELECT id FROM reminder_history 
             WHERE habit_id = $1 
             AND DATE(sent_at) = CURRENT_DATE`,
            [habit.id]
          );
          
          if (sentToday.rows.length === 0) {
            await this.sendReminder(habit);
            // Добавляем задержку между отправками
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            console.log(`⏭ Already sent reminder for habit "${habit.title}" (ID: ${habit.id}) today`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error checking reminders:', error.message);
      console.error(error.stack);
    }
  }

  async sendReminder(habit) {
    try {
      const chatId = habit.telegram_id;
      const lang = habit.language || 'en';
      
      console.log(`📤 Sending reminder to ${chatId} for habit "${habit.title}"`);
      
      // Формируем сообщение с названием и целью
      const message = lang === 'ru' 
        ? `🔔 <b>Напоминание о привычке!</b>

📝 <b>Привычка:</b> ${habit.title}
🎯 <b>Цель:</b> ${habit.goal}
⏰ <b>Время:</b> ${habit.reminder_time ? habit.reminder_time.substring(0, 5) : 'сейчас'}

Не забудьте отметить выполнение:`
        : `🔔 <b>Habit Reminder!</b>

📝 <b>Habit:</b> ${habit.title}
🎯 <b>Goal:</b> ${habit.goal}
⏰ <b>Time:</b> ${habit.reminder_time ? habit.reminder_time.substring(0, 5) : 'now'}

Don't forget to mark your progress:`;
      
      // Кнопки для отметки
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Done', callback_data: `mark_done_${habit.id}` },
            { text: '⏭ Skip', callback_data: `mark_skip_${habit.id}` }
          ],
          [
            { 
              text: '📱 Open App', 
              web_app: { 
                url: process.env.WEBAPP_URL || process.env.FRONTEND_URL || 'https://lighthearted-phoenix-e42a4f.netlify.app'
              } 
            }
          ]
        ]
      };
      
      await this.bot.sendMessage(chatId, message, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
      
      // Сохраняем в историю
      await db.query(
        'INSERT INTO reminder_history (habit_id, sent_at) VALUES ($1, NOW())',
        [habit.id]
      );
      
      console.log(`✅ Reminder sent for "${habit.title}" to user ${chatId}`);
    } catch (error) {
      console.error(`❌ Failed to send reminder for habit ${habit.id}:`, error.message);
      
      if (error.response && error.response.statusCode === 403) {
        console.log(`⚠️ User ${habit.telegram_id} has blocked the bot`);
      }
    }
  }

  // Обновленный метод тестирования - показывает все привычки с напоминаниями
  async testReminder(userId, chatId) {
    try {
      console.log(`🧪 Testing reminders for user ${userId}`);
      
      // Получаем все активные привычки пользователя с напоминаниями
      const result = await db.query(
        `SELECT 
          h.id,
          h.title,
          h.goal,
          h.reminder_time,
          h.reminder_enabled,
          h.schedule_days,
          u.language
         FROM habits h
         JOIN users u ON h.user_id = u.id
         WHERE u.id = $1
         AND h.is_active = true
         AND h.reminder_enabled = true
         ORDER BY h.reminder_time`,
        [userId]
      );
      
      if (result.rows.length > 0) {
        const lang = result.rows[0].language || 'en';
        
        // Отправляем информацию о каждой привычке
        for (const habit of result.rows) {
          const timeStr = habit.reminder_time ? 
            habit.reminder_time.substring(0, 5) : 'не установлено';
          
          const daysMap = {
            1: 'Mon', 2: 'Tue', 3: 'Wed', 
            4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun'
          };
          
          const daysStr = habit.schedule_days ? 
            habit.schedule_days.map(d => daysMap[d]).join(', ') : 'Every day';
          
          const message = lang === 'ru'
            ? `🔔 <b>Тестовое напоминание</b>

📝 <b>Привычка:</b> ${habit.title}
🎯 <b>Цель:</b> ${habit.goal}
⏰ <b>Время напоминания:</b> ${timeStr}
📅 <b>Дни:</b> ${daysStr}

Это тестовое сообщение. Реальные напоминания будут приходить в ${timeStr}.`
            : `🔔 <b>Test Reminder</b>

📝 <b>Habit:</b> ${habit.title}
🎯 <b>Goal:</b> ${habit.goal}
⏰ <b>Reminder time:</b> ${timeStr}
📅 <b>Days:</b> ${daysStr}

This is a test message. Real reminders will come at ${timeStr}.`;
          
          await this.bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { 
                  text: '📱 Open App', 
                  web_app: { 
                    url: process.env.WEBAPP_URL || process.env.FRONTEND_URL
                  } 
                }
              ]]
            }
          });
          
          // Небольшая задержка между сообщениями
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return result.rows.length;
      } else {
        console.log('❌ No active habits with reminders found for user');
        return 0;
      }
    } catch (error) {
      console.error('❌ Test reminder failed:', error);
      return 0;
    }
  }

  // Метод для получения следующего напоминания
  async getNextReminder() {
    try {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
      const currentDay = now.getDay() || 7;
      
      const result = await db.query(
        `SELECT 
          h.title,
          h.reminder_time,
          u.first_name
         FROM habits h
         JOIN users u ON h.user_id = u.id
         WHERE h.reminder_enabled = true
         AND h.is_active = true
         AND h.reminder_time > $1
         AND $2 = ANY(h.schedule_days)
         ORDER BY h.reminder_time
         LIMIT 1`,
        [currentTime, currentDay]
      );
      
      if (result.rows.length > 0) {
        return result.rows[0];
      }
      return null;
    } catch (error) {
      console.error('Error getting next reminder:', error);
      return null;
    }
  }

  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Reminder service is not running');
      return;
    }
    
    this.tasks.forEach(task => task.stop());
    this.tasks.clear();
    this.isRunning = false;
    console.log('🛑 Reminder service stopped');
  }
}

module.exports = ReminderService;