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

app.set('trust proxy', 1);

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
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true
  })
);
app.use(express.json());
app.use(logger);

// Webhook от Telegram для команд бота
const WEBHOOK_PATH = `/api/telegram/webhook/${BOT_TOKEN}`;

app.post(WEBHOOK_PATH, async (req, res) => {
  try {
    console.log('🔔 WEBHOOK RECEIVED:', JSON.stringify(req.body, null, 2)); // ДОБАВЬТЕ ЭТУ СТРОКУ
    
    const secretHeader = req.get('x-telegram-bot-api-secret-token');
    
    if (!BOT_SECRET) {
      console.error('❌ BOT_SECRET not configured');
      return res.status(401).json({ success: false, error: 'Webhook secret is not configured' });
    }
    
    if (secretHeader !== BOT_SECRET) {
      console.error('❌ Invalid webhook secret');
      return res.status(401).json({ success: false, error: 'Unauthorized webhook' });
    }
    
    console.log('✅ Telegram webhook authorized');
    
    const update = req.body;
    
    bot.processUpdate(update);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Telegram webhook error:', error);
    res.status(200).json({ success: false, error: error.message });
  }
});

app.use(generalLimiter);

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

app.use('/api/auth', authRoutes);
app.use('/api', habitRoutes);

const paymentRoutes = require('./routes/paymentRoutes');
app.use('/api/payment', paymentRoutes);

console.log('\n🤖 Запуск Telegram бота (webhook)...');

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

const ReminderService = require('./services/reminderService');
const reminderService = new ReminderService(bot);

// ВАЖНО: Обработчик pre_checkout_query
bot.on('pre_checkout_query', async (query) => {
  console.log('💳 ========== PRE-CHECKOUT QUERY ==========');
  console.log('Query ID:', query.id);
  console.log('From:', query.from.id, query.from.first_name);
  console.log('Currency:', query.currency);
  console.log('Total amount:', query.total_amount);
  console.log('Invoice payload:', query.invoice_payload);
  
  try {
    // Проверяем валидность платежа
    const TelegramStarsService = require('./services/telegramStarsService');
    
    // Парсим payload
    let parsed;
    try {
      parsed = TelegramStarsService.parseInvoicePayload(query.invoice_payload);
    } catch (parseError) {
      console.error('❌ Invalid payload:', parseError);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'Invalid payment data. Please try again.'
      });
      return;
    }
    
    const userId = parseInt(parsed.userId);
    const planType = parsed.planType;
    
    console.log('Parsed payment data:', { userId, planType });
    
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
    
    try {
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'Payment processing error. Please try again.'
      });
    } catch (e) {
      console.error('Failed to reject pre-checkout:', e);
    }
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  
  console.log(`📨 NEW MESSAGE: "${text}" from ${chatId}`);

  if (text.startsWith('/start')) {
    console.log('👋 Processing /start command');
    
    try {
      let userResult = await db.query(
        'SELECT id FROM users WHERE telegram_id = $1',
        [chatId.toString()]
      );
      
      if (userResult.rows.length === 0) {
        await db.query(
          `INSERT INTO users (telegram_id, username, first_name, last_name, language, is_premium)
           VALUES ($1, $2, $3, $4, $5, false)`,
          [
            chatId.toString(),
            msg.from.username || null,
            msg.from.first_name || '',
            msg.from.last_name || '',
            msg.from.language_code || 'en'
          ]
        );
        console.log('✅ New user created');
      }
      
      await bot.sendMessage(
        chatId,
        '👋 **Welcome to Habit Tracker!**\n\nTrack your habits, build streaks, and achieve your goals!',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [[{ text: '📱 Open Habit Tracker', web_app: { url: WEBAPP_URL } }]],
            resize_keyboard: true
          }
        }
      );
      
      console.log('✅ Welcome message sent');
    } catch (error) {
      console.error('❌ /start error:', error);
    }
    return;
  }

  if (text === '❓ Help' || text === '/help') {
    await bot.sendMessage(chatId, 'Help info here');
    return;
  }

  console.log('⚠️ Unknown command');
});

// Обработчик callback кнопок из напоминаний
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  
  console.log(`📲 Callback received: ${data} from chat ${chatId}`);
  
  if (data.startsWith('mark_done_')) {
    const habitId = data.replace('mark_done_', '');
    
    try {
      await db.query(
        `INSERT INTO habit_marks (habit_id, date, status) 
         VALUES ($1, CURRENT_DATE, 'completed')
         ON CONFLICT (habit_id, date) 
         DO UPDATE SET status = 'completed', marked_at = CURRENT_TIMESTAMP`,
        [habitId]
      );
      
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
    const parts = data.split('_');
    const habitId = parts[2];
    const date = parts[3] || new Date().toISOString().split('T')[0];
    
    try {
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
      
      await db.query(
        `INSERT INTO habit_marks (habit_id, date, status) 
         VALUES ($1, $2::date, 'completed')
         ON CONFLICT (habit_id, date) 
         DO UPDATE SET status = 'completed', marked_at = CURRENT_TIMESTAMP`,
        [userHabitId, date]
      );
      
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
    // Устанавливаем webhook для бота
    const publicBase = process.env.BACKEND_PUBLIC_URL || '';
    
    if (publicBase) {
      const webhookUrl = `${publicBase}${WEBHOOK_PATH}`;
      
      console.log(`\n🔗 Setting webhook to: ${webhookUrl}`);
      
      await bot.setWebHook(webhookUrl, {
        secret_token: BOT_SECRET,
        drop_pending_updates: true,
        allowed_updates: ['message', 'callback_query', 'pre_checkout_query']
      });
      
      console.log('✅ Webhook установлен успешно');
      
      // Проверяем webhook
      const webhookInfo = await bot.getWebhookInfo();
      console.log('📊 Webhook Info:', {
        url: webhookInfo.url,
        has_custom_certificate: webhookInfo.has_custom_certificate,
        pending_update_count: webhookInfo.pending_update_count,
        allowed_updates: webhookInfo.allowed_updates
      });
      
    } else {
      console.log('ℹ️ BACKEND_PUBLIC_URL не задан — webhook не установлен');
      console.log('⚠️ Для работы бота в production необходимо установить BACKEND_PUBLIC_URL');
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
  subscriptionCron.stop();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  reminderService.stop();
  keepAliveService.stop();
  subscriptionCron.stop();
  server.close(() => process.exit(0));
});

// Экспортируем бота для использования в других модулях
module.exports.bot = bot;