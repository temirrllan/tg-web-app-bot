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
// Роуты для платежей
const paymentRoutes = require('./routes/paymentRoutes');
app.use('/api/payment', paymentRoutes);
/** ---------- TELEGRAM BOT (WEBHOOK) ---------- */
console.log('\n🤖 Запуск Telegram бота (webhook)...');

/** создаём бота без polling */
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Подготавливаем сервис напоминаний (запустим после старта сервера)
const ReminderService = require('./services/reminderService');
const reminderService = new ReminderService(bot);


/** Хэндлеры бота */
/** Хэндлеры бота */
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
console.log(`📨 ========== NEW MESSAGE ==========`);
  console.log(`From: ${chatId} (${msg.from.first_name} ${msg.from.last_name || ''})`);
  console.log(`Text: "${text}"`);
  console.log(`Username: @${msg.from.username || 'none'}`);
  

  if (text.startsWith('/start')) {
    const startParam = text.split(' ')[1];
    
    // Если есть параметр join_ - обрабатываем как присоединение к привычке
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
          console.log(`✅ New user created: ID ${userId}`);
        } else {
          userId = userResult.rows[0].id;
          console.log(`✅ Existing user found: ID ${userId}`);
        }
        
        // Проверяем существование share code
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
          
          // Проверяем, не является ли пользователь уже участником
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
            
            const userHabitCheck = await db.query(
              'SELECT * FROM habits WHERE user_id = $1 AND parent_habit_id = $2',
              [userId, sharedHabit.habit_id]
            );
            
            let userHabitId;
            
            if (userHabitCheck.rows.length > 0) {
              await db.query(
                'UPDATE habits SET is_active = true WHERE id = $1',
                [userHabitCheck.rows[0].id]
              );
              userHabitId = userHabitCheck.rows[0].id;
            } else {
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
                sharedHabit.habit_id
              ]
            );
            
            const newHabitId = newHabitResult.rows[0].id;
            
            await db.query(
              'INSERT INTO habit_members (habit_id, user_id) VALUES ($1, $2)',
              [sharedHabit.habit_id, userId]
            );
            
            await db.query(
              'INSERT INTO habit_members (habit_id, user_id) VALUES ($1, $2)',
              [newHabitId, sharedHabit.owner_user_id]
            );
            
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
        console.error('❌ Error processing join code:', error);
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
    console.log(`👋 Sending welcome message to ${chatId}`);
    
    try {
      // Получаем или создаем пользователя
      let userResult = await db.query(
        'SELECT id, telegram_id, first_name FROM users WHERE telegram_id = $1',
        [chatId.toString()]
      );
      
      if (userResult.rows.length === 0) {
        // Создаем нового пользователя
        const tgUser = msg.from;
        await db.query(
          `INSERT INTO users (
            telegram_id, username, first_name, last_name, language, is_premium
          ) VALUES ($1, $2, $3, $4, $5, false)`,
          [
            chatId.toString(),
            tgUser.username || null,
            tgUser.first_name || '',
            tgUser.last_name || '',
            tgUser.language_code || 'en'
          ]
        );
        console.log(`✅ New user created via /start: ${chatId}`);
      } else {
        // Обновляем данные существующего пользователя
        await db.query(
          `UPDATE users 
           SET username = $2, 
               first_name = $3, 
               last_name = $4
           WHERE telegram_id = $1`,
          [
            chatId.toString(),
            msg.from.username || null,
            msg.from.first_name || '',
            msg.from.last_name || ''
          ]
        );
        console.log(`✅ Existing user updated via /start: ${chatId}`);
      }
      
      await bot.sendMessage(
        chatId,
        '👋 **Welcome to Habit Tracker!**\n\n' +
        'Track your habits, build streaks, and achieve your goals!\n\n' +
        'Tap the button below to get started:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [
              [{ text: '📱 Open Habit Tracker', web_app: { url: WEBAPP_URL } }],
              [{ text: 'ℹ️ About' }, { text: '❓ Help' }]
            ],
            resize_keyboard: true
          }
        }
      );
      
      console.log('✅ Welcome message sent successfully');
    } catch (error) {
      console.error('❌ Failed to send welcome message:', error);
    }
    
    return;
  }

  // Обработка других текстовых команд
  if (text === 'ℹ️ About' || text === '/about') {
    await bot.sendMessage(
      chatId,
      '📊 **Habit Tracker**\n\n' +
      'Version: 1.0.0\n' +
      'Build habits, track progress, achieve goals!\n\n' +
      'Features:\n' +
      '✅ Daily habit tracking\n' +
      '✅ Streak monitoring\n' +
      '✅ Reminders\n' +
      '✅ Friend challenges\n' +
      '✅ Premium features',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (text === '❓ Help' || text === '/help') {
    await bot.sendMessage(
      chatId,
      '❓ **How to use Habit Tracker:**\n\n' +
      '1️⃣ Tap "Open Habit Tracker" to launch the app\n' +
      '2️⃣ Create your first habit\n' +
      '3️⃣ Mark habits as done daily\n' +
      '4️⃣ Build streaks and achieve goals!\n\n' +
      'Need support? Contact @your_support_username',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Команда для тестирования напоминаний
  if (text === '/testreminder') {
    try {
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
            `✅ Sent ${count} test reminders.\n\nReal reminders will come at scheduled times.`
          );
        } else {
          await bot.sendMessage(
            chatId, 
            '❌ No active habits with reminders.\n\nCreate a habit and set reminder time in the app.'
          );
        }
      } else {
        await bot.sendMessage(
          chatId, 
          '❌ User not found or reminder service unavailable.'
        );
      }
    } catch (error) {
      console.error('Test reminder error:', error);
      await bot.sendMessage(chatId, '❌ Error sending test reminder.');
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
            `📅 **Next reminder:**\n\n` +
            `📝 Habit: ${next.title}\n` +
            `⏰ Time: ${next.reminder_time.substring(0, 5)}\n` +
            `👤 User: ${next.first_name}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await bot.sendMessage(chatId, '📭 No scheduled reminders for today.');
        }
      } else {
        await bot.sendMessage(chatId, '❌ Reminder service unavailable.');
      }
    } catch (error) {
      console.error('Status error:', error);
      await bot.sendMessage(chatId, '❌ Error checking status.');
    }
    return;
  }

  // Если команда не распознана
  console.log(`⚠️ Unknown command: ${text}`);
});

// Обработчик pre_checkout_query (ОБЯЗАТЕЛЬНО!)
// Обработчик pre_checkout_query (ОБЯЗАТЕЛЬНО!)
bot.on('pre_checkout_query', async (query) => {
  console.log('💳 ========== PRE-CHECKOUT QUERY ==========');
  console.log('Query ID:', query.id);
  console.log('From:', query.from.id, query.from.first_name);
  console.log('Currency:', query.currency);
  console.log('Total amount:', query.total_amount);
  console.log('Invoice payload:', query.invoice_payload);
  
  try {
    // Проверяем валидность платежа
    const payloadParts = query.invoice_payload.split('_');
    const userId = parseInt(payloadParts[0]);
    const planType = payloadParts[1];
    
    // Проверяем существование пользователя
    const userResult = await db.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      console.error('❌ User not found:', userId);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'User not found. Please try again.'
      });
      return;
    }
    
    // Проверяем валидность плана
    const TelegramStarsService = require('./services/telegramStarsService');
    const plan = TelegramStarsService.PLANS[planType];
    
    if (!plan) {
      console.error('❌ Invalid plan:', planType);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'Invalid subscription plan. Please try again.'
      });
      return;
    }
    
    // Проверяем сумму
    const expectedAmount = TelegramStarsService.getPlanPrice(planType);
    if (query.total_amount !== expectedAmount) {
      console.error('❌ Amount mismatch:', {
        expected: expectedAmount,
        got: query.total_amount
      });
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'Invalid payment amount. Please try again.'
      });
      return;
    }
    
    // Всё хорошо - разрешаем оплату
    await bot.answerPreCheckoutQuery(query.id, true);
    console.log('✅ Pre-checkout query approved');
    
  } catch (error) {
    console.error('❌ Pre-checkout error:', error);
    
    // Отклоняем оплату с объяснением
    try {
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'Payment processing error. Please try again.'
      });
    } catch (e) {
      console.error('Failed to reject pre-checkout:', e);
    }
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