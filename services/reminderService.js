const cron = require('node-cron');
const db = require('../config/database');
const { getToday, getAlmatyDate, TIMEZONE } = require('../utils/dateHelper');

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
      timezone: TIMEZONE
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
      const today = getToday();
      
      console.log(`🕐 Checking reminders: ${currentTime}, Day: ${currentDay} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]})`);
      
      // Получаем все привычки с напоминаниями на текущее время
      // + статус отметки за сегодня (LEFT JOIN вместо отдельного запроса)
      // + последнее напоминание за сегодня (LEFT JOIN вместо отдельного запроса)
      // Для shared-привычек проверяем что юзер — активный участник
      const result = await db.query(
        `SELECT
          h.id,
          h.title,
          h.goal,
          h.reminder_time,
          h.schedule_days,
          u.telegram_id,
          u.first_name,
          u.language,
          hm.status AS today_status,
          rh.sent_at AS last_reminder_sent_at
         FROM habits h
         JOIN users u ON h.user_id = u.id
         LEFT JOIN habit_marks hm ON hm.habit_id = h.id AND hm.date = $3::date
         LEFT JOIN reminder_history rh ON rh.habit_id = h.id AND DATE(rh.sent_at) = $3::date
         WHERE h.reminder_enabled = true
         AND h.reminder_time = $1
         AND h.is_active = true
         AND $2 = ANY(h.schedule_days)
         AND (
           h.parent_habit_id IS NULL
           OR EXISTS (
             SELECT 1 FROM habit_members hm2
             WHERE hm2.user_id = h.user_id
             AND hm2.is_active = true
             AND hm2.habit_id IN (
               SELECT id FROM habits
               WHERE id = COALESCE(h.parent_habit_id, h.id)
                  OR parent_habit_id = COALESCE(h.parent_habit_id, h.id)
             )
           )
         )`,
        [currentTime, currentDay, today]
      );

      if (result.rows.length > 0) {
        console.log(`📨 Found ${result.rows.length} habits with reminders at ${currentTime}`);

        for (const habit of result.rows) {
          const currentStatus = habit.today_status;

          // Определяем, нужно ли отправлять напоминание
          let shouldSendReminder = true;
          let reminderReason = 'pending';

          if (currentStatus) {
            console.log(`📊 Habit "${habit.title}" (ID: ${habit.id}) status: ${currentStatus}`);

            // Логика отправки напоминаний в зависимости от статуса
            switch(currentStatus) {
              case 'completed':
                shouldSendReminder = false;
                console.log(`✅ Habit already completed - skipping reminder`);
                break;
              case 'failed':
                shouldSendReminder = false;
                console.log(`❌ Habit marked as failed - skipping reminder`);
                break;
              case 'skipped':
                shouldSendReminder = true;
                reminderReason = 'skipped';
                console.log(`⏭ Habit was skipped - sending reminder again`);
                break;
              case 'pending':
              default:
                shouldSendReminder = true;
                reminderReason = 'pending';
                console.log(`⏰ Habit is pending - sending reminder`);
                break;
            }
          } else {
            // Нет отметки на сегодня - отправляем напоминание
            shouldSendReminder = true;
            reminderReason = 'no_mark';
            console.log(`📝 No mark for today - sending reminder`);
          }

          if (shouldSendReminder) {
            // Проверяем историю напоминаний из JOIN (без отдельного запроса)
            if (habit.last_reminder_sent_at && reminderReason === 'skipped') {
              const lastSentTime = new Date(habit.last_reminder_sent_at);
              const timeDiff = now - lastSentTime;
              const minutesDiff = Math.floor(timeDiff / 60000);

              // Если прошло меньше 60 минут с последнего напоминания, пропускаем
              if (minutesDiff < 60) {
                console.log(`⏰ Already sent reminder ${minutesDiff} minutes ago for skipped habit - skipping`);
                continue;
              }
            } else if (habit.last_reminder_sent_at && reminderReason !== 'skipped') {
              // Для обычных напоминаний - одно в день
              console.log(`⏭ Already sent reminder for habit "${habit.title}" today`);
              continue;
            }

            await this.sendReminder(habit, reminderReason);
            // Добавляем задержку между отправками
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    } catch (error) {
      console.error('❌ Error checking reminders:', error.message);
      console.error(error.stack);
    }
  }

  async sendReminder(habit, reason = 'pending') {
    try {
      const chatId = habit.telegram_id;
      const lang = habit.language || 'en';
      
      console.log(`📤 Sending reminder to ${chatId} for habit "${habit.title}" (reason: ${reason})`);
      
      // Формируем сообщение в зависимости от причины
      let message;
      
      if (reason === 'skipped') {
        // Особое сообщение для пропущенных привычек
        message = lang === 'ru' 
          ? `🔔 <b>Повторное напоминание!</b>

📝 <b>Привычка:</b> ${habit.title}
🎯 <b>Цель:</b> ${habit.goal}
⏰ <b>Время:</b> ${habit.reminder_time ? habit.reminder_time.substring(0, 5) : 'сейчас'}

Вы пропустили эту привычку сегодня. Никогда не поздно начать снова! 💪
Каждый момент - это новая возможность!`
          : `🔔 <b>Reminder Again!</b>

📝 <b>Habit:</b> ${habit.title}
🎯 <b>Goal:</b> ${habit.goal}
⏰ <b>Time:</b> ${habit.reminder_time ? habit.reminder_time.substring(0, 5) : 'now'}

You skipped this habit today. It's never too late to start again! 💪
Every moment is a new opportunity!`;
      } else {
        // Обычное напоминание
        message = lang === 'ru' 
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
      }
      
      // Кнопки для отметки (дата включена чтобы старые напоминания нельзя было нажать)
      const todayDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Almaty' });
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Done', callback_data: `mark_done_${habit.id}_${todayDate}` },
            { text: '⏭ Skip', callback_data: `mark_skip_${habit.id}_${todayDate}` }
          ],
          [
            { 
              text: '📱 Open App', 
              web_app: { 
                url: process.env.WEBAPP_URL || process.env.FRONTEND_URL || 'https://habit-tracker-tma.vercel.app/'
              } 
            }
          ]
        ]
      };
      
      await this.bot.sendMessage(chatId, message, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
      
      // Сохраняем в историю с указанием причины
      await db.query(
        `INSERT INTO reminder_history (habit_id, sent_at, reminder_reason) 
         VALUES ($1, NOW(), $2)
         ON CONFLICT (habit_id, DATE(sent_at)) 
         DO UPDATE SET 
           sent_at = NOW(),
           reminder_reason = $2`,
        [habit.id, reason]
      );
      
      console.log(`✅ Reminder sent for "${habit.title}" to user ${chatId} (reason: ${reason})`);
    } catch (error) {
      console.error(`❌ Failed to send reminder for habit ${habit.id}:`, error.message);
      
      if (error.response && error.response.statusCode === 403) {
        console.log(`⚠️ User ${habit.telegram_id} has blocked the bot`);
      }
    }
  }

  // Обновленный метод тестирования - показывает все привычки с напоминаниями и их статусы
  async testReminder(userId, chatId) {
    try {
      console.log(`🧪 Testing reminders for user ${userId}`);
      
      const today = getToday();
      
      // Получаем все активные привычки пользователя с напоминаниями и их статусами
      const result = await db.query(
        `SELECT 
          h.id,
          h.title,
          h.goal,
          h.reminder_time,
          h.reminder_enabled,
          h.schedule_days,
          u.language,
          hm.status as today_status
         FROM habits h
         JOIN users u ON h.user_id = u.id
         LEFT JOIN habit_marks hm ON (
           hm.habit_id = h.id 
           AND hm.date = $2::date
         )
         WHERE u.id = $1
         AND h.is_active = true
         AND h.reminder_enabled = true
         ORDER BY h.reminder_time`,
        [userId, today]
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
          
          const statusStr = habit.today_status || 'pending';
          let statusEmoji = '⏰';
          let willSendReminder = true;
          
          switch(statusStr) {
            case 'completed':
              statusEmoji = '✅';
              willSendReminder = false;
              break;
            case 'failed':
              statusEmoji = '❌';
              willSendReminder = false;
              break;
            case 'skipped':
              statusEmoji = '⏭';
              willSendReminder = true;
              break;
            default:
              statusEmoji = '⏰';
              willSendReminder = true;
          }
          
          const message = lang === 'ru'
            ? `🔔 <b>Тестовое напоминание</b>

📝 <b>Привычка:</b> ${habit.title}
🎯 <b>Цель:</b> ${habit.goal}
⏰ <b>Время напоминания:</b> ${timeStr}
📅 <b>Дни:</b> ${daysStr}
📊 <b>Статус сегодня:</b> ${statusEmoji} ${statusStr}
🔔 <b>Будет напоминание:</b> ${willSendReminder ? 'Да ✅' : 'Нет ❌'}

Это тестовое сообщение. Реальные напоминания будут приходить в ${timeStr}.`
            : `🔔 <b>Test Reminder</b>

📝 <b>Habit:</b> ${habit.title}
🎯 <b>Goal:</b> ${habit.goal}
⏰ <b>Reminder time:</b> ${timeStr}
📅 <b>Days:</b> ${daysStr}
📊 <b>Status today:</b> ${statusEmoji} ${statusStr}
🔔 <b>Will send reminder:</b> ${willSendReminder ? 'Yes ✅' : 'No ❌'}

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
      const today = getToday();
      
      const result = await db.query(
        `SELECT 
          h.title,
          h.reminder_time,
          u.first_name,
          hm.status as today_status
         FROM habits h
         JOIN users u ON h.user_id = u.id
         LEFT JOIN habit_marks hm ON (
           hm.habit_id = h.id 
           AND hm.date = $3::date
         )
         WHERE h.reminder_enabled = true
         AND h.is_active = true
         AND h.reminder_time > $1
         AND $2 = ANY(h.schedule_days)
         AND (hm.status IS NULL OR hm.status IN ('pending', 'skipped'))
         ORDER BY h.reminder_time
         LIMIT 1`,
        [currentTime, currentDay, today]
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