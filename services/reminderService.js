const cron = require('node-cron');
const db = require('../config/database');

class ReminderService {
  constructor(bot) {
    this.bot = bot;
    this.tasks = new Map();
    this.isRunning = false;
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
    console.log('✅ Reminder service started');
  }

  async checkAndSendReminders() {
    try {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
      const currentDay = now.getDay() || 7; // 0 (Sunday) = 7
      
      console.log(`🕐 Checking reminders for ${currentTime} on day ${currentDay}`);
      
      // Получаем все привычки с напоминаниями на текущее время
      const result = await db.query(
        `SELECT h.*, u.telegram_id, u.first_name, u.language
         FROM habits h
         JOIN users u ON h.user_id = u.id
         WHERE h.reminder_enabled = true
         AND h.reminder_time = $1
         AND h.is_active = true
         AND $2 = ANY(h.schedule_days)
         AND NOT EXISTS (
           SELECT 1 FROM reminder_history rh 
           WHERE rh.habit_id = h.id 
           AND DATE(rh.sent_at) = CURRENT_DATE
         )`,
        [currentTime, currentDay]
      );
      
      if (result.rows.length > 0) {
        console.log(`📨 Found ${result.rows.length} habits to remind`);
        
        // Отправляем напоминания
        for (const habit of result.rows) {
          await this.sendReminder(habit);
        }
      }
    } catch (error) {
      console.error('❌ Error checking reminders:', error);
    }
  }

  async sendReminder(habit) {
    try {
      const chatId = habit.telegram_id;
      const lang = habit.language || 'en';
      
      // Формируем сообщение
      const message = lang === 'ru' 
        ? `🔔 <b>Напоминание!</b>\n\n⏰ Время для: <b>${habit.title}</b>\n💪 Цель: ${habit.goal}\n\nОтметьте выполнение привычки:`
        : `🔔 <b>Reminder!</b>\n\n⏰ Time for: <b>${habit.title}</b>\n💪 Goal: ${habit.goal}\n\nMark your habit:`;
      
      // Кнопки для отметки
      const keyboard = {
        inline_keyboard: [[
          { text: '✅ Done', callback_data: `mark_done_${habit.id}` },
          { text: '⏭ Skip', callback_data: `mark_skip_${habit.id}` }
        ], [
          { text: '📱 Open App', web_app: { url: process.env.WEBAPP_URL || process.env.FRONTEND_URL } }
        ]]
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
      
      console.log(`✅ Reminder sent for habit "${habit.title}" to user ${chatId}`);
    } catch (error) {
      console.error(`❌ Failed to send reminder for habit ${habit.id}:`, error.message);
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