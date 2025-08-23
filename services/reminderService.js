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
    });
    
    this.tasks.set('main', task);
    this.isRunning = true;
    console.log('✅ Reminder service started - checking every minute');
    
    // Сразу проверяем при запуске
    this.checkAndSendReminders();
  }

  async checkAndSendReminders() {
    try {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
      const currentDay = now.getDay() || 7; // 0 (Sunday) = 7
      
      console.log(`🕐 Checking reminders for ${currentTime} on day ${currentDay}`);
      
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
        console.log(`📨 Found ${result.rows.length} habits to remind about`);
        
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
          } else {
            console.log(`⏭ Already sent reminder for habit ${habit.id} today`);
          }
        }
      } else {
        console.log('📭 No reminders to send at this time');
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
      
      console.log(`📤 Sending reminder for habit "${habit.title}" to user ${chatId}`);
      
      // Формируем сообщение
      const message = lang === 'ru' 
        ? `🔔 <b>Напоминание!</b>

⏰ Время для: <b>${habit.title}</b>
💪 Цель: ${habit.goal}

Отметьте выполнение привычки:`
        : `🔔 <b>Reminder!</b>

⏰ Time for: <b>${habit.title}</b>
💪 Goal: ${habit.goal}

Mark your habit:`;
      
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
      
      const sentMessage = await this.bot.sendMessage(chatId, message, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
      
      // Сохраняем в историю
      await db.query(
        'INSERT INTO reminder_history (habit_id, sent_at) VALUES ($1, NOW())',
        [habit.id]
      );
      
      console.log(`✅ Reminder sent successfully for habit ${habit.id}`);
    } catch (error) {
      console.error(`❌ Failed to send reminder for habit ${habit.id}:`, error.message);
      
      // Если ошибка связана с тем, что бот не может отправить сообщение пользователю
      if (error.response && error.response.statusCode === 403) {
        console.log(`⚠️ User ${habit.telegram_id} has blocked the bot`);
      }
    }
  }

  // Метод для тестирования - отправить напоминание прямо сейчас
  async testReminder(userId) {
    try {
      console.log(`🧪 Testing reminder for user ${userId}`);
      
      // Получаем первую активную привычку пользователя
      const result = await db.query(
        `SELECT h.*, u.telegram_id, u.language
         FROM habits h
         JOIN users u ON h.user_id = u.id
         WHERE u.id = $1
         AND h.is_active = true
         LIMIT 1`,
        [userId]
      );
      
      if (result.rows.length > 0) {
        await this.sendReminder(result.rows[0]);
        return true;
      } else {
        console.log('❌ No active habits found for user');
        return false;
      }
    } catch (error) {
      console.error('❌ Test reminder failed:', error);
      return false;
    }
  }

  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Reminder service is not running');
      return;
    }
    
    // Останавливаем все задачи
    this.tasks.forEach(task => task.stop());
    this.tasks.clear();
    this.isRunning = false;
    console.log('🛑 Reminder service stopped');
  }
}

module.exports = ReminderService;