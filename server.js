require('dotenv').config();

const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const logger = require('./middleware/logger');
const authRoutes = require('./routes/authRoutes');
const habitRoutes = require('./routes/habitRoutes');
const { generalLimiter } = require('./middleware/rateLimit');
const keepAliveService = require('./services/keepAlive');
const db = require('./config/database');
const subscriptionCron = require('./services/subscriptionCron');
const app = express();

const PORT = Number(process.env.PORT || 3001);
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_SECRET = process.env.BOT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;
const WEBAPP_URL = process.env.WEBAPP_URL || FRONTEND_URL;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не найден в переменных окружения!');
  process.exit(1);
}
if (!BOT_SECRET) {
  console.error('❌ BOT_SECRET не найден в переменных окружения!');
  process.exit(1);
}

/** чтобы rate-limit и IP работали за nginx/render */
app.set('trust proxy', 1);

/** CORS */
const extraOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = [
  FRONTEND_URL,
  WEBAPP_URL,
  'https://web.telegram.org',
  'http://localhost:5173',
  'http://localhost:5174',
  ...extraOrigins
].filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // mobile apps / curl
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // Мягкий CORS (не роняем запросы из незнакомых ориджинов, но не выдаём креды)
      return cb(null, false);
    },
    credentials: true
  })
);

app.use(express.json());
app.use(logger);
app.use(generalLimiter);

/** Health */
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'habit-tracker',
    timestamp: new Date().toISOString(),
    bot: 'active'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/** API */
app.use('/api/auth', authRoutes);
app.use('/api', habitRoutes);

/** ---------- TELEGRAM BOT (WEBHOOK) ---------- */
console.log('\n🤖 Запуск Telegram бота (webhook)...');

/** создаём бота без polling */
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Подготавливаем сервис напоминаний (запустим после старта сервера)
const ReminderService = require('./services/reminderService');
const reminderService = new ReminderService(bot);

/** единый путь webhook — включаем токен в путь */
const WEBHOOK_PATH = `/api/telegram/webhook/${BOT_TOKEN}`;

/** защита webhook секретом */
app.post(WEBHOOK_PATH, (req, res) => {
  try {
    const secretHdr = req.get('x-telegram-bot-api-secret-token');
    if (secretHdr !== BOT_SECRET) {
      return res.sendStatus(401);
    }
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook processUpdate error:', e);
    res.sendStatus(500);
  }
});

/** Хэндлеры бота */
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';

  if (text.startsWith('/start')) {
    const startParam = text.split(' ')[1];
    
    if (startParam && startParam.startsWith('join_')) {
      const shareCode = startParam.replace('join_', '');
      
      try {
        // Получаем или создаем пользователя
        let userResult = await db.query(
          'SELECT id, telegram_id FROM users WHERE telegram_id = $1',
          [chatId.toString()]
        );
        
        let userId;
        
        if (userResult.rows.length === 0) {
          // Создаем нового пользователя
          const tgUser = msg.from;
          const newUserResult = await db.query(
            `INSERT INTO users (
              telegram_id, username, first_name, last_name, language
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING id`,
            [
              chatId.toString(),
              tgUser.username || null,
              tgUser.first_name || '',
              tgUser.last_name || '',
              tgUser.language_code || 'en'
            ]
          );
          userId = newUserResult.rows[0].id;
        } else {
          userId = userResult.rows[0].id;
        }
        
        // Проверяем существование share code и получаем данные привычки
        const shareResult = await db.query(
          `SELECT sh.*, h.*, u.first_name as owner_name
           FROM shared_habits sh
           JOIN habits h ON sh.habit_id = h.id
           JOIN users u ON sh.owner_user_id = u.id
           WHERE sh.share_code = $1`,
          [shareCode]
        );
        
        if (shareResult.rows.length > 0) {
          const sharedHabit = shareResult.rows[0];
          
          // Проверяем, не является ли пользователь уже участником (включая неактивных)
          const memberCheck = await db.query(
            'SELECT * FROM habit_members WHERE habit_id = $1 AND user_id = $2',
            [sharedHabit.habit_id, userId]
          );
          
          // Если есть неактивная запись, активируем её
          if (memberCheck.rows.length > 0 && !memberCheck.rows[0].is_active) {
            await db.query(
              'UPDATE habit_members SET is_active = true WHERE habit_id = $1 AND user_id = $2',
              [sharedHabit.habit_id, userId]
            );
            
            // Проверяем существование привычки у пользователя
            const userHabitCheck = await db.query(
              'SELECT * FROM habits WHERE user_id = $1 AND parent_habit_id = $2',
              [userId, sharedHabit.habit_id]
            );
            
            let userHabitId;
            
            if (userHabitCheck.rows.length > 0) {
              // Активируем существующую привычку
              await db.query(
                'UPDATE habits SET is_active = true WHERE id = $1',
                [userHabitCheck.rows[0].id]
              );
              userHabitId = userHabitCheck.rows[0].id;
            } else {
              // Создаем новую копию привычки
              const newHabitResult = await db.query(
                `INSERT INTO habits (
                  user_id, category_id, title, goal, schedule_type, 
                  schedule_days, reminder_time, reminder_enabled, is_bad_habit,
                  parent_habit_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id`,
                [
                  userId,
                  sharedHabit.category_id,
                  sharedHabit.title,
                  sharedHabit.goal,
                  sharedHabit.schedule_type,
                  sharedHabit.schedule_days,
                  sharedHabit.reminder_time,
                  sharedHabit.reminder_enabled,
                  sharedHabit.is_bad_habit,
                  sharedHabit.habit_id
                ]
              );
              userHabitId = newHabitResult.rows[0].id;
            }
            
            // Восстанавливаем связь владельца с привычкой пользователя
            const ownerMemberCheck = await db.query(
              'SELECT * FROM habit_members WHERE habit_id = $1 AND user_id = $2',
              [userHabitId, sharedHabit.owner_user_id]
            );
            
            if (ownerMemberCheck.rows.length > 0) {
              await db.query(
                'UPDATE habit_members SET is_active = true WHERE habit_id = $1 AND user_id = $2',
                [userHabitId, sharedHabit.owner_user_id]
              );
            } else {
              await db.query(
                'INSERT INTO habit_members (habit_id, user_id) VALUES ($1, $2)',
                [userHabitId, sharedHabit.owner_user_id]
              );
            }
            
            // Уведомляем владельца
            const ownerData = await db.query(
              'SELECT telegram_id FROM users WHERE id = $1',
              [sharedHabit.owner_user_id]
            );
            
            if (ownerData.rows.length > 0) {
              await bot.sendMessage(
                ownerData.rows[0].telegram_id,
                `🎉 ${msg.from.first_name} rejoined your habit "${sharedHabit.title}"!`,
                { parse_mode: 'Markdown' }
              );
            }
            
            await bot.sendMessage(
              chatId,
              `✅ **Welcome back!**\n\n` +
              `You've rejoined the habit:\n` +
              `📝 **${sharedHabit.title}**\n` +
              `🎯 Goal: ${sharedHabit.goal}\n` +
              `👤 Shared by: ${sharedHabit.owner_name}\n\n` +
              `Open the app to continue tracking this habit!`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[
                    {
                      text: '📱 Open Habit Tracker',
                      web_app: { url: WEBAPP_URL }
                    }
                  ]]
                }
              }
            );
            
            return;
          }
          
          if (memberCheck.rows.length === 0) {
            // АВТОМАТИЧЕСКИ добавляем пользователя к привычке
            
            // Создаем копию привычки для нового пользователя
            const newHabitResult = await db.query(
              `INSERT INTO habits (
                user_id, category_id, title, goal, schedule_type, 
                schedule_days, reminder_time, reminder_enabled, is_bad_habit,
                parent_habit_id
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              RETURNING id`,
              [
                userId,
                sharedHabit.category_id,
                sharedHabit.title,
                sharedHabit.goal,
                sharedHabit.schedule_type,
                sharedHabit.schedule_days,
                sharedHabit.reminder_time,
                sharedHabit.reminder_enabled,
                sharedHabit.is_bad_habit,
                sharedHabit.habit_id // Ссылка на оригинальную привычку
              ]
            );
            
            const newHabitId = newHabitResult.rows[0].id;
            
            // Добавляем пользователя как участника оригинальной привычки
            await db.query(
              'INSERT INTO habit_members (habit_id, user_id) VALUES ($1, $2)',
              [sharedHabit.habit_id, userId]
            );
            
            // Добавляем владельца как участника новой привычки пользователя
            await db.query(
              'INSERT INTO habit_members (habit_id, user_id) VALUES ($1, $2)',
              [newHabitId, sharedHabit.owner_user_id]
            );
            
            // Уведомляем владельца привычки о новом участнике
            const ownerData = await db.query(
              'SELECT telegram_id FROM users WHERE id = $1',
              [sharedHabit.owner_user_id]
            );
            
            if (ownerData.rows.length > 0) {
              await bot.sendMessage(
                ownerData.rows[0].telegram_id,
                `🎉 ${msg.from.first_name} joined your habit "${sharedHabit.title}"!`,
                { parse_mode: 'Markdown' }
              );
            }
            
            await bot.sendMessage(
              chatId,
              `✅ **Success!**\n\n` +
              `You've joined the habit:\n` +
              `📝 **${sharedHabit.title}**\n` +
              `🎯 Goal: ${sharedHabit.goal}\n` +
              `👤 Shared by: ${sharedHabit.owner_name}\n\n` +
              `Open the app to start tracking this habit together!`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[
                    {
                      text: '📱 Open Habit Tracker',
                      web_app: { url: WEBAPP_URL }
                    }
                  ]]
                }
              }
            );
          } else {
            // Пользователь уже активный участник
            await bot.sendMessage(
              chatId,
              `ℹ️ You're already tracking this habit!\n\n` +
              `📝 **${sharedHabit.title}**\n\n` +
              `Open the app to continue:`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[
                    {
                      text: '📱 Open Habit Tracker',
                      web_app: { url: WEBAPP_URL }
                    }
                  ]]
                }
              }
            );
          }
          
          return;
        } else {
          await bot.sendMessage(
            chatId,
            '❌ Invalid or expired invitation link.\n\n' +
            'Please ask your friend to share a new link.',
            { parse_mode: 'Markdown' }
          );
          return;
        }
      } catch (error) {
        console.error('Error processing join code:', error);
        await bot.sendMessage(
          chatId,
          '❌ An error occurred while joining the habit.\n' +
          'Please try again later.',
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }
    
    // Обычный старт (без параметров)
    await bot.sendMessage(
      chatId,
      'Добро пожаловать в Habit Tracker! 🎯\n\nИспользуйте кнопки ниже для навигации:',
      {
        reply_markup: {
          keyboard: [
            [{ text: '📊 Мои привычки' }],
            [{ text: 'ℹ️ Информация о боте' }],
            [{ text: '⚙️ Настройки' }]
          ],
          resize_keyboard: true
        }
      }
    );

    await bot.sendMessage(chatId, 'Откройте приложение для управления привычками:', {
      reply_markup: {
        inline_keyboard: [[{
          text: '📱 Открыть Habit Tracker',
          web_app: { url: WEBAPP_URL }
        }]]
      }
    });
  }

  if (text === '⚙️ Настройки') {
    await bot.sendMessage(
      chatId,
      'Настройки можно изменить в приложении.\n' +
      'Доступные настройки:\n' +
      '• Язык интерфейса (RU/EN)\n' +
      '• Время напоминаний\n' +
      '• Уведомления',
      {
        reply_markup: {
          inline_keyboard: [[{
            text: '⚙️ Открыть настройки',
            web_app: { url: `${WEBAPP_URL}#settings` }
          }]]
        }
      }
    );
    return;
  }

  // Команда для тестирования напоминаний
  if (text === '/testreminder') {
    try {
      // Получаем user_id из базы данных
      const userResult = await db.query(
        'SELECT id FROM users WHERE telegram_id = $1',
        [chatId.toString()]
      );
      
      if (userResult.rows.length > 0 && reminderService) {
        const userId = userResult.rows[0].id;
        const count = await reminderService.testReminder(userId, chatId);
        
        if (count > 0) {
          await bot.sendMessage(
            chatId, 
            `✅ Отправлено ${count} тестовых напоминаний.\n\nРеальные напоминания будут приходить автоматически в указанное время.`
          );
        } else {
          await bot.sendMessage(
            chatId, 
            '❌ У вас нет активных привычек с включенными напоминаниями.\n\nСоздайте привычку и установите время напоминания в приложении.'
          );
        }
      } else {
        await bot.sendMessage(
          chatId, 
          '❌ Пользователь не найден или сервис напоминаний недоступен.'
        );
      }
    } catch (error) {
      console.error('Test reminder error:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при отправке тестового напоминания.');
    }
    return;
  }

  // Команда для проверки статуса напоминаний
  if (text === '/reminderstatus') {
    try {
      if (reminderService) {
        const next = await reminderService.getNextReminder();
        if (next) {
          await bot.sendMessage(
            chatId,
            `📅 Следующее напоминание:\n\n` +
            `📝 Привычка: ${next.title}\n` +
            `⏰ Время: ${next.reminder_time.substring(0, 5)}\n` +
            `👤 Пользователь: ${next.first_name}`
          );
        } else {
          await bot.sendMessage(chatId, '📭 Нет запланированных напоминаний на сегодня.');
        }
      } else {
        await bot.sendMessage(chatId, '❌ Сервис напоминаний недоступен.');
      }
    } catch (error) {
      console.error('Status error:', error);
      await bot.sendMessage(chatId, '❌ Ошибка при проверке статуса.');
    }
    return;
  }
});

// Обработчик callback кнопок из напоминаний
// Обработчик callback кнопок из напоминаний
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  
  console.log(`📲 Callback received: ${data} from chat ${chatId}`);
  
  if (data.startsWith('mark_done_')) {
    const habitId = data.replace('mark_done_', '');
    
    try {
      // Отмечаем привычку как выполненную
      await db.query(
        `INSERT INTO habit_marks (habit_id, date, status) 
         VALUES ($1, CURRENT_DATE, 'completed')
         ON CONFLICT (habit_id, date) 
         DO UPDATE SET status = 'completed', marked_at = CURRENT_TIMESTAMP`,
        [habitId]
      );
      
      // Обновляем streak
      await db.query(
        `UPDATE habits 
         SET streak_current = streak_current + 1,
             streak_best = GREATEST(streak_current + 1, streak_best)
         WHERE id = $1`,
        [habitId]
      );
      
      await bot.editMessageText('✅ Отлично! Привычка отмечена как выполненная.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[
            { text: '📱 Открыть приложение', web_app: { url: WEBAPP_URL } }
          ]]
        }
      });
      
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '✅ Выполнено!'
      });
      
      console.log(`✅ Habit ${habitId} marked as done`);
    } catch (error) {
      console.error('Error marking habit done:', error);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Ошибка'
      });
    }
  } else if (data.startsWith('mark_skip_')) {
    const habitId = data.replace('mark_skip_', '');
    
    try {
      await db.query(
        `INSERT INTO habit_marks (habit_id, date, status) 
         VALUES ($1, CURRENT_DATE, 'skipped')
         ON CONFLICT (habit_id, date) 
         DO UPDATE SET status = 'skipped', marked_at = CURRENT_TIMESTAMP`,
        [habitId]
      );
      
      // Сбрасываем streak при пропуске
      await db.query(
        'UPDATE habits SET streak_current = 0 WHERE id = $1',
        [habitId]
      );
      
      await bot.editMessageText('⏭ Привычка пропущена на сегодня.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [[
            { text: '📱 Открыть приложение', web_app: { url: WEBAPP_URL } }
          ]]
        }
      });
      
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '⏭ Пропущено'
      });
      
      console.log(`⏭ Habit ${habitId} marked as skipped`);
    } catch (error) {
      console.error('Error marking habit skipped:', error);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Ошибка'
      });
    }
  } else if (data.startsWith('quick_done_')) {
    // Новый обработчик для быстрой отметки из уведомления друга
    const parts = data.split('_');
    const habitId = parts[2];
    const date = parts[3] || new Date().toISOString().split('T')[0];
    
    try {
      // Получаем пользователя по telegram_id
      const userResult = await db.query(
        'SELECT id, first_name FROM users WHERE telegram_id = $1',
        [chatId.toString()]
      );
      
      if (userResult.rows.length === 0) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: '❌ Пользователь не найден'
        });
        return;
      }
      
      const userId = userResult.rows[0].id;
      const userName = userResult.rows[0].first_name;
      
      // Находим привычку пользователя связанную с этой группой
      const userHabitResult = await db.query(
        `SELECT h.id, h.title 
         FROM habits h
         WHERE h.user_id = $1
         AND (h.parent_habit_id = $2 OR h.id = $2 OR h.parent_habit_id = (
           SELECT parent_habit_id FROM habits WHERE id = $2
         ))
         AND h.is_active = true
         LIMIT 1`,
        [userId, habitId]
      );
      
      if (userHabitResult.rows.length === 0) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: '❌ Привычка не найдена'
        });
        return;
      }
      
      const userHabitId = userHabitResult.rows[0].id;
      const habitTitle = userHabitResult.rows[0].title;
      
      // Отмечаем привычку как выполненную
      await db.query(
        `INSERT INTO habit_marks (habit_id, date, status) 
         VALUES ($1, $2::date, 'completed')
         ON CONFLICT (habit_id, date) 
         DO UPDATE SET status = 'completed', marked_at = CURRENT_TIMESTAMP`,
        [userHabitId, date]
      );
      
      // Обновляем streak
      await db.query(
        `UPDATE habits 
         SET streak_current = streak_current + 1,
             streak_best = GREATEST(streak_current + 1, streak_best)
         WHERE id = $1`,
        [userHabitId]
      );
      
      await bot.editMessageText(
        `✅ <b>Отлично, ${userName}!</b>\n\nПривычка <b>"${habitTitle}"</b> отмечена как выполненная!\n\nПродолжайте в том же духе! 💪`, 
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '📱 Открыть приложение', web_app: { url: WEBAPP_URL } }
            ]]
          }
        }
      );
      
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '✅ Выполнено! Отличная работа!'
      });
      
      // Запускаем проверку и отправку уведомлений друзьям
      const habitResult = await db.query(
        'SELECT * FROM habits WHERE id = $1',
        [userHabitId]
      );
      
      if (habitResult.rows.length > 0) {
        const sendFriendNotifications = require('./controllers/markController').sendFriendNotifications;
        await sendFriendNotifications(habitResult.rows[0], userId, date);
      }
      
      console.log(`✅ Quick habit ${userHabitId} marked as done for user ${userId}`);
    } catch (error) {
      console.error('Error quick marking habit:', error);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Ошибка при отметке'
      });
    }
  }
});

/** ---------- Запуск HTTP и установка webhook ---------- */
const server = app.listen(PORT, async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
  
  // Запускаем фоновые сервисы
  keepAliveService.start();
  
  // Запускаем сервис напоминаний после старта сервера
  reminderService.start();
  // Запускаем cron для проверки подписок
subscriptionCron.start();
  try {
    // Ставим/обновляем webhook ОДНИМ способом и ОБЯЗАТЕЛЬНО с секретом
    const publicBase = process.env.BACKEND_PUBLIC_URL || ''; // если зададите — поставим отсюда
    if (publicBase) {
      const webhookUrl = `${publicBase}${WEBHOOK_PATH}`;
      await bot.setWebHook(webhookUrl, { secret_token: BOT_SECRET, drop_pending_updates: true });
      console.log(`✅ Webhook установлен: ${webhookUrl}`);
    } else {
      console.log('ℹ️ BACKEND_PUBLIC_URL не задан — webhook не переустанавливаем на старте (используйте setWebhook вручную).');
    }
  } catch (e) {
    console.error('❌ Ошибка установки webhook:', e);
  }
});

/** Грейсфул шатдаун */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  reminderService.stop();
  keepAliveService.stop();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  reminderService.stop();
  keepAliveService.stop();
  server.close(() => process.exit(0));
});
subscriptionCron.stop();
// Экспортируем бота для использования в других модулях
module.exports.bot = bot;