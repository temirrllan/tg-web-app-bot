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
const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL;

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
    console.log('🔔 WEBHOOK RECEIVED:', JSON.stringify(req.body, null, 2));
    
    const secretHeader = req.get('x-telegram-bot-api-secret-token');
    
    if (!BOT_SECRET) {
      console.error('❌ BOT_SECRET not configured');
      return res.status(401).json({ success: false, error: 'Webhook secret is not configured' });
    }
    
    if (secretHeader !== BOT_SECRET) {
      console.error('❌ Invalid webhook secret. Expected:', BOT_SECRET, 'Got:', secretHeader);
      return res.status(401).json({ success: false, error: 'Unauthorized webhook' });
    }
    
    console.log('✅ Telegram webhook authorized');
    
    const update = req.body;
    // КРИТИЧЕСКИ ВАЖНО: Обрабатываем successful_payment
    if (update.message?.successful_payment) {
      console.log('💳 ========== SUCCESSFUL PAYMENT DETECTED ==========');
      const payment = update.message.successful_payment;
      const from_user_id = update.message.from.id;
      
      console.log('Payment details:', {
        currency: payment.currency,
        total_amount: payment.total_amount,
        invoice_payload: payment.invoice_payload,
        telegram_payment_charge_id: payment.telegram_payment_charge_id,
        from_user_id: from_user_id
      });
      
      // Проверяем что это Telegram Stars
      if (payment.currency === 'XTR') {
        const paymentData = {
          telegram_payment_charge_id: payment.telegram_payment_charge_id,
          provider_payment_charge_id: payment.provider_payment_charge_id,
          invoice_payload: payment.invoice_payload,
          total_amount: payment.total_amount,
          currency: payment.currency,
          from_user_id: from_user_id
        };
        
        console.log('💰 Processing Telegram Stars payment...');
        
        // Обрабатываем платёж
        const result = await TelegramStarsService.processSuccessfulPayment(paymentData);
        
        if (result.success) {
          console.log('✅ Payment processed successfully');
          console.log('✅ User ID:', result.user_id);
          console.log('✅ Subscription ID:', result.subscription_id);
          console.log('✅ Plan type:', result.plan_type);
          console.log('✅ Expires at:', result.expires_at);
          
          // Проверяем что данные обновились
          const verificationResult = await db.query(
            'SELECT id, is_premium, subscription_type, subscription_expires_at FROM users WHERE id = $1',
            [result.user_id]
          );
          
          console.log('🔍 User verification after payment:', verificationResult.rows[0]);
          
          // Отправляем подтверждение пользователю
          try {
            const userResult = await db.query(
              'SELECT language FROM users WHERE telegram_id = $1',
              [from_user_id.toString()]
            );
            
            const lang = userResult.rows.length > 0 ? userResult.rows[0].language : 'en';
            
            const messages = {
              ru: '🎉 <b>Оплата прошла успешно!</b>\n\nВаша Premium подписка активирована!\n\n✅ Безлимитные привычки\n✅ Безлимитные друзья\n✅ Расширенная статистика\n✅ Приоритетная поддержка\n\nОткройте приложение и наслаждайтесь! 💪',
              en: '🎉 <b>Payment successful!</b>\n\nYour Premium subscription is now active!\n\n✅ Unlimited habits\n✅ Unlimited friends\n✅ Advanced statistics\n✅ Priority support\n\nOpen the app and enjoy! 💪',
              kk: '🎉 <b>Төлем сәтті өтті!</b>\n\nСіздің Premium жазылымыңыз белсендірілді!\n\n✅ Шексіз әдеттер\n✅ Шексіз достар\n✅ Кеңейтілген статистика\n✅ Басым қолдау\n\nҚосымшаны ашып, ләззат алыңыз! 💪'
            };
            
            const message = messages[lang] || messages['en'];
            
            await bot.sendMessage(from_user_id, message, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: lang === 'ru' ? '📱 Открыть приложение' : lang === 'kk' ? '📱 Қосымшаны ашу' : '📱 Open App',
                    web_app: { 
                      url: process.env.WEBAPP_URL || process.env.FRONTEND_URL 
                    }
                  }
                ]]
              }
            });
            
            console.log('✅ Confirmation message sent to user');
          } catch (botError) {
            console.error('⚠️ Failed to send confirmation (non-critical):', botError.message);
          }
        } else {
          console.error('❌ Payment processing failed:', result.error);
        }
      } else {
        console.log('⚠️ Non-XTR payment, skipping');
      }
    }
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
// Экспортируем бота для использования в других модулях
module.exports.bot = bot;
const ReminderService = require('./services/reminderService');
const reminderService = new ReminderService(bot);

// ВАЖНО: Обработчик pre_checkout_query
bot.on('pre_checkout_query', async (query) => {
  console.log('💳 ========== PRE-CHECKOUT QUERY (Telegram Stars) ==========');
  console.log('Query ID:', query.id);
  console.log('From:', query.from.id, query.from.first_name);
  console.log('Currency:', query.currency);
  console.log('Total amount:', query.total_amount, 'XTR');
  console.log('Invoice payload:', query.invoice_payload);
  
  try {
    // Проверяем что это Telegram Stars
    if (query.currency !== 'XTR') {
      console.error('❌ Wrong currency:', query.currency);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'Only Telegram Stars (XTR) payments are accepted.'
      });
      return;
    }

    // const TelegramStarsService = require('./services/telegramStarsService');
    
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
    
    console.log('📋 Parsed payment data:', { userId, planType });
    
    const userResult = await db.query(
      'SELECT id, first_name FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      console.error('❌ User not found:', userId);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'User not found. Please try again.'
      });
      return;
    }
    
    const plan = TelegramStarsService.PLANS[planType];
    
    if (!plan) {
      console.error('❌ Invalid plan:', planType);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'Invalid subscription plan. Please try again.'
      });
      return;
    }
    
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
    
    // ВСЁ ХОРОШО - разрешаем оплату
    await bot.answerPreCheckoutQuery(query.id, true);
    console.log('✅ Pre-checkout query approved - payment can proceed');
    
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
// Обработчик successful_payment через bot.on
bot.on('successful_payment', async (msg) => {
  console.log('💳 ========== SUCCESSFUL PAYMENT EVENT ==========');
  console.log('Payment received from:', msg.from.id, msg.from.first_name);
  
  const payment = msg.successful_payment;
  
  if (payment.currency === 'XTR') {
    const paymentData = {
      telegram_payment_charge_id: payment.telegram_payment_charge_id,
      provider_payment_charge_id: payment.provider_payment_charge_id,
      invoice_payload: payment.invoice_payload,
      total_amount: payment.total_amount,
      currency: payment.currency,
      from_user_id: msg.from.id
    };
    
    console.log('💰 Processing payment through bot.on handler...');
    
    const result = await TelegramStarsService.processSuccessfulPayment(paymentData);
    
    if (result.success) {
      console.log('✅ Payment processed successfully via bot.on');
    }
  }
});
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  // Пропускаем сообщения с successful_payment - они обрабатываются отдельно
  if (msg.successful_payment) {
    return;
  }
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
      await bot.sendMessage(chatId, '❌ An error occurred. Please try again later.');
    }
    return;
  }

  if (text === '❓ Help' || text === '/help') {
    await bot.sendMessage(
      chatId,
      '📖 **Habit Tracker Help**\n\n' +
      '• Use /start to open the app\n' +
      '• Track your daily habits\n' +
      '• Build streaks and achieve goals\n' +
      '• Upgrade to Premium for unlimited habits'
    );
    return;
  }
// Команда для проверки подписки (для отладки)
  if (text === '/check_subscription') {
    try {
      const userResult = await db.query(
        `SELECT is_premium, subscription_type, subscription_expires_at 
         FROM users WHERE telegram_id = $1`,
        [chatId.toString()]
      );
      
      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        let message = `📊 <b>Your subscription status:</b>\n\n`;
        message += `Premium: ${user.is_premium ? '✅ Yes' : '❌ No'}\n`;
        
        if (user.is_premium && user.subscription_type) {
          message += `Plan: ${user.subscription_type}\n`;
          if (user.subscription_expires_at) {
            message += `Expires: ${new Date(user.subscription_expires_at).toLocaleDateString()}\n`;
          } else {
            message += `Expires: Never (Lifetime)\n`;
          }
        }
        
        await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      } else {
        await bot.sendMessage(chatId, 'User not found in database.');
      }
    } catch (error) {
      console.error('Error checking subscription:', error);
      await bot.sendMessage(chatId, 'Error checking subscription status.');
    }
    return;
  }

  console.log('⚠️ Unknown command');
});

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
  
  keepAliveService.start();
  reminderService.start();
  subscriptionCron.start();
  
  // АВТОМАТИЧЕСКАЯ УСТАНОВКА WEBHOOK
  if (BACKEND_PUBLIC_URL && BOT_TOKEN && BOT_SECRET) {
    try {
      const webhookUrl = `${BACKEND_PUBLIC_URL}${WEBHOOK_PATH}`;
      
      console.log(`\n🔗 Setting webhook to: ${webhookUrl}`);
      console.log(`🔑 Using secret: ${BOT_SECRET}`);
      
      // Сначала удаляем старый webhook
      await bot.deleteWebHook({ drop_pending_updates: false });
      console.log('🗑️ Old webhook deleted');
      
      // Устанавливаем новый
      const result = await bot.setWebHook(webhookUrl, {
        secret_token: BOT_SECRET,
        drop_pending_updates: false,
        allowed_updates: ['message', 'callback_query', 'pre_checkout_query', 'successful_payment']
      });
      
      if (result) {
        console.log('✅ Webhook установлен успешно');
      } else {
        console.error('❌ Failed to set webhook');
      }
      
      // Проверяем webhook
      const webhookInfo = await bot.getWebhookInfo();
      console.log('📊 Webhook Info:', {
        url: webhookInfo.url,
        has_custom_certificate: webhookInfo.has_custom_certificate,
        pending_update_count: webhookInfo.pending_update_count,
        allowed_updates: webhookInfo.allowed_updates,
        last_error_date: webhookInfo.last_error_date,
        last_error_message: webhookInfo.last_error_message
      });
      
      // Если есть ошибки в webhook, выводим их
      if (webhookInfo.last_error_message) {
        console.error('⚠️ Last webhook error:', webhookInfo.last_error_message);
      }
      
    } catch (e) {
      console.error('❌ Ошибка установки webhook:', e.message);
      console.error('Stack:', e.stack);
    }
  } else {
    console.log('⚠️ Webhook не установлен - отсутствуют необходимые параметры:');
    console.log('BACKEND_PUBLIC_URL:', BACKEND_PUBLIC_URL);
    console.log('BOT_TOKEN:', BOT_TOKEN ? 'Present' : 'Missing');
    console.log('BOT_SECRET:', BOT_SECRET ? 'Present' : 'Missing');
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

// module.exports.bot = bot;