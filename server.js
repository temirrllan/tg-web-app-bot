require("dotenv").config();

const express = require("express");
const cors = require("cors");
const TelegramBot = require("node-telegram-bot-api");
const logger = require("./middleware/logger");
const authRoutes = require("./routes/authRoutes");
const habitRoutes = require("./routes/habitRoutes");
const { generalLimiter } = require("./middleware/rateLimit");
const keepAliveService = require("./services/keepAlive");
const db = require("./config/database");
const subscriptionCron = require("./services/subscriptionCron");
const app = express();

const PORT = Number(process.env.PORT || 3001);
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_SECRET = process.env.BOT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;
const WEBAPP_URL = process.env.WEBAPP_URL || FRONTEND_URL;
const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN не найден в переменных окружения!");
  process.exit(1);
}
if (!BOT_SECRET) {
  console.error("❌ BOT_SECRET не найден в переменных окружения!");
  process.exit(1);
}

app.set("trust proxy", 1);

const extraOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = [
  FRONTEND_URL,
  WEBAPP_URL,
  "https://web.telegram.org",
  "http://localhost:5173",
  "http://localhost:5174",
  ...extraOrigins,
].filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(logger);

// Webhook от Telegram для команд бота
const WEBHOOK_PATH = `/api/telegram/webhook/${BOT_TOKEN}`;

app.post(WEBHOOK_PATH, async (req, res) => {
  try {
    console.log("🔔 ========== WEBHOOK RECEIVED ==========");
    console.log('Update:', JSON.stringify(req.body, null, 2));

    const secretHeader = req.get("x-telegram-bot-api-secret-token");

    if (secretHeader !== BOT_SECRET) {
      console.error("❌ Invalid webhook secret");
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const update = req.body;

    // 🔥 КРИТИЧНО: Обрабатываем successful_payment ЗДЕСЬ
    if (update.message?.successful_payment) {
      console.log("💳 ========== SUCCESSFUL PAYMENT ==========");
      const payment = update.message.successful_payment;
      const from_user_id = update.message.from.id;

      console.log('Payment details:', {
        currency: payment.currency,
        total_amount: payment.total_amount,
        invoice_payload: payment.invoice_payload,
        telegram_payment_charge_id: payment.telegram_payment_charge_id,
        from_user_id: from_user_id,
      });

      if (payment.currency === "XTR") {
        const paymentData = {
          telegram_payment_charge_id: payment.telegram_payment_charge_id,
          provider_payment_charge_id: payment.provider_payment_charge_id,
          invoice_payload: payment.invoice_payload,
          total_amount: payment.total_amount,
          currency: payment.currency,
          from_user_id: from_user_id,
        };

        console.log("💰 Processing Telegram Stars payment...");

        // 🔥 ОБРАБАТЫВАЕМ ПЛАТЁЖ
        const result = await TelegramStarsService.processSuccessfulPayment(paymentData);

        if (result.success) {
          console.log("✅ ========== PAYMENT SUCCESS ==========");
          console.log("User ID:", result.user_id);
          console.log("Subscription ID:", result.subscription_id);
          console.log("Plan:", result.plan_type);

          // 🔥 ПРОВЕРКА: Действительно ли обновился пользователь?
          const verifyResult = await db.query(
            'SELECT id, telegram_id, is_premium, subscription_type FROM users WHERE id = $1',
            [result.user_id]
          );

          console.log("🔍 Verification:", verifyResult.rows[0]);

          // 🔥 ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ
          try {
            const bot = require("./server").bot;

            const userResult = await db.query(
              "SELECT language FROM users WHERE telegram_id = $1",
              [from_user_id.toString()]
            );

            const lang = userResult.rows.length > 0 ? userResult.rows[0].language : "en";

            const messages = {
              ru: "🎉 <b>Оплата прошла успешно!</b>\n\nВаша Premium подписка активирована!\n\n✅ Безлимитные привычки\n✅ Безлимитные друзья\n✅ Расширенная статистика\n\nОткройте приложение! 💪",
              en: "🎉 <b>Payment successful!</b>\n\nYour Premium subscription is now active!\n\n✅ Unlimited habits\n✅ Unlimited friends\n✅ Advanced statistics\n\nOpen the app! 💪",
              kk: "🎉 <b>Төлем сәтті!</b>\n\nPremium жазылымыңыз белсендірілді!\n\n✅ Шексіз әдеттер\n✅ Шексіз достар\n✅ Статистика\n\nҚосымшаны ашыңыз! 💪",
            };

            const message = messages[lang] || messages["en"];

            await bot.sendMessage(from_user_id, message, {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: lang === "ru" ? "📱 Открыть" : "📱 Open App",
                    web_app: { url: WEBAPP_URL }
                  }
                ]]
              },
            });

            console.log("✅ Confirmation sent");
          } catch (botError) {
            console.error("⚠️ Failed to send confirmation:", botError.message);
          }

          return res.status(200).json({
            success: true,
            user_id: result.user_id,
          });
        } else {
          console.error("❌ Payment processing failed:", result.error);
          return res.status(200).json({ success: false, error: result.error });
        }
      }
    }

    // Передаём update боту
    bot.processUpdate(update);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    console.error("Stack:", error.stack);
    res.status(200).json({ success: false, error: error.message });
  }
});

app.use(generalLimiter);

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "habit-tracker",
    timestamp: new Date().toISOString(),
    bot: "active",
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api", habitRoutes);

const paymentRoutes = require("./routes/paymentRoutes");
app.use("/api/payment", paymentRoutes);

console.log("\n🤖 Запуск Telegram бота (webhook)...");

const bot = new TelegramBot(BOT_TOKEN, { polling: false });
// Экспортируем бота для использования в других модулях
module.exports.bot = bot;
const ReminderService = require("./services/reminderService");
const reminderService = new ReminderService(bot);
const TelegramStarsService = require("./services/telegramStarsService");

// ВАЖНО: Обработчик pre_checkout_query
bot.on("pre_checkout_query", async (query) => {
  console.log("💳 ========== PRE-CHECKOUT ==========");
  console.log("Query ID:", query.id);
  console.log("From:", query.from.id, query.from.first_name);
  console.log("Currency:", query.currency);
  console.log("Amount:", query.total_amount);
  console.log("Payload:", query.invoice_payload);

  try {
    if (query.currency !== "XTR") {
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "Only Telegram Stars (XTR) accepted.",
      });
      return;
    }

    let parsed;
    try {
      parsed = TelegramStarsService.parseInvoicePayload(query.invoice_payload);
    } catch (parseError) {
      console.error("❌ Invalid payload:", parseError);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "Invalid payment data.",
      });
      return;
    }

    const userId = parseInt(parsed.userId);
    const planType = parsed.planType;

    console.log("📋 Parsed:", { userId, planType });

    const userResult = await db.query(
      "SELECT id, first_name FROM users WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) {
      console.error("❌ User not found:", userId);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "User not found.",
      });
      return;
    }

    const plan = TelegramStarsService.PLANS[planType];
    if (!plan) {
      console.error("❌ Invalid plan:", planType);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "Invalid plan.",
      });
      return;
    }

    const expectedAmount = TelegramStarsService.getPlanPrice(planType);
    if (query.total_amount !== expectedAmount) {
      console.error("❌ Amount mismatch:", {
        expected: expectedAmount,
        got: query.total_amount,
      });
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "Invalid amount.",
      });
      return;
    }

    await bot.answerPreCheckoutQuery(query.id, true);
    console.log("✅ Pre-checkout approved");
  } catch (error) {
    console.error("❌ Pre-checkout error:", error);
    try {
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "Processing error.",
      });
    } catch (e) {
      console.error("Failed to reject:", e);
    }
  }
});
// Обработчик successful_payment через bot.on
bot.on("successful_payment", async (msg) => {
  console.log("💳 ========== SUCCESSFUL PAYMENT EVENT ==========");
  console.log("Payment received from:", msg.from.id, msg.from.first_name);

  const payment = msg.successful_payment;

  if (payment.currency === "XTR") {
    const paymentData = {
      telegram_payment_charge_id: payment.telegram_payment_charge_id,
      provider_payment_charge_id: payment.provider_payment_charge_id,
      invoice_payload: payment.invoice_payload,
      total_amount: payment.total_amount,
      currency: payment.currency,
      from_user_id: msg.from.id,
    };

    console.log("💰 Processing payment through bot.on handler...");

    const result = await TelegramStarsService.processSuccessfulPayment(
      paymentData
    );

    if (result.success) {
      console.log("✅ Payment processed successfully via bot.on");
    }
  }
});
// Фрагмент из server.js - обработчик bot.on('message')
// Этот код заменяет существующий обработчик в вашем server.js

// Фрагмент из server.js - bot.on('message') - ИСПРАВЛЕННАЯ ВЕРСИЯ
// Замени существующий обработчик на этот код

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  
  // Пропускаем сообщения с successful_payment
  if (msg.successful_payment) {
    return;
  }
  
  console.log(`📨 NEW MESSAGE: "${text}" from ${chatId}`);

  if (text.startsWith('/start')) {
    console.log('👋 Processing /start command');
    
    try {
      // 🔥 Извлекаем параметр после /start
      const params = text.split(' ');
      const startParam = params[1]; // Может быть join_XXXXX или undefined
      
      console.log('🔍 Start command params:', { 
        fullText: text, 
        params, 
        startParam 
      });
      
      // 🔥 КРИТИЧНО: НЕ СОЗДАЕМ ПОЛЬЗОВАТЕЛЯ ЗДЕСЬ!
      // Пользователь будет создан при первом открытии приложения через /auth/telegram
      
      // Определяем язык для welcome message
      let userLanguage = 'en';
      const langCode = msg.from.language_code?.toLowerCase() || 'en';
      
      if (langCode === 'ru' || langCode.startsWith('ru-')) {
        userLanguage = 'ru';
      } else if (langCode === 'kk' || langCode === 'kz' || langCode.startsWith('kk-')) {
        userLanguage = 'kk';
      }
      
      console.log('🌍 User language detected:', userLanguage);
      
      // 🎯 ОБРАБОТКА DEEP LINK - ПРИСОЕДИНЕНИЕ К ПРИВЫЧКЕ
      if (startParam && startParam.startsWith('join_')) {
        const shareCode = startParam;
        
        console.log('🔗 JOIN INVITATION DETECTED:', shareCode);
        
        // Получаем информацию о привычке
        const shareResult = await db.query(
          `SELECT sh.*, h.title, h.goal, u.first_name as owner_name
           FROM shared_habits sh
           JOIN habits h ON sh.habit_id = h.id
           JOIN users u ON sh.owner_user_id = u.id
           WHERE sh.share_code = $1`,
          [shareCode]
        );
        
        if (shareResult.rows.length > 0) {
          const habitInfo = shareResult.rows[0];
          
          console.log('📋 Found habit for invitation:', {
            habitId: habitInfo.habit_id,
            title: habitInfo.title,
            owner: habitInfo.owner_name
          });
          
          // Отправляем приглашение с информацией о привычке
          const inviteMessages = {
            en: `🎉 <b>You've been invited!</b>\n\n${habitInfo.owner_name} wants you to join their habit:\n\n<b>"${habitInfo.title}"</b>\n📝 Goal: ${habitInfo.goal}\n\nOpen the app to join and start tracking together! 👇`,
            ru: `🎉 <b>Вас пригласили!</b>\n\n${habitInfo.owner_name} хочет, чтобы вы присоединились к привычке:\n\n<b>"${habitInfo.title}"</b>\n📝 Цель: ${habitInfo.goal}\n\nОткройте приложение, чтобы присоединиться и начать отслеживать вместе! 👇`,
            kk: `🎉 <b>Сізді шақырды!</b>\n\n${habitInfo.owner_name} сізді өз әдетіне қосылуға шақырады:\n\n<b>"${habitInfo.title}"</b>\n📝 Мақсат: ${habitInfo.goal}\n\nҚосылу және бірге бақылауды бастау үшін қосымшаны ашыңыз! 👇`
          };
          
          const webAppUrl = `${process.env.WEBAPP_URL || process.env.FRONTEND_URL}?action=join&code=${shareCode}`;
          
          await bot.sendMessage(
            chatId,
            inviteMessages[userLanguage] || inviteMessages['en'],
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: userLanguage === 'ru' ? '📱 Открыть и присоединиться' : 
                          userLanguage === 'kk' ? '📱 Ашу және қосылу' : 
                          '📱 Open & Join',
                    web_app: { url: webAppUrl }
                  }
                ]]
              }
            }
          );
          
          console.log('✅ Invitation message sent with deep link');
          return; // Завершаем, не показываем обычное приветствие
        } else {
          console.log('⚠️ Share code not found:', shareCode);
          // Продолжаем как обычный /start
        }
      }
      
      // 👋 ОБЫЧНОЕ ПРИВЕТСТВИЕ
      const welcomeMessages = {
        en: `👋 <b>Welcome to Habit Tracker!</b>\n\nI'll help you build good habits and achieve your goals.\n\n🎯 Track your progress daily\n👥 Share habits with friends\n📊 View detailed statistics\n⏰ Get reminders\n\nLet's start! 👇`,
        ru: `👋 <b>Добро пожаловать в Habit Tracker!</b>\n\nЯ помогу вам развить полезные привычки и достичь целей.\n\n🎯 Отслеживайте прогресс каждый день\n👥 Делитесь привычками с друзьями\n📊 Смотрите детальную статистику\n⏰ Получайте напоминания\n\nДавайте начнём! 👇`,
        kk: `👋 <b>Habit Tracker-ге қош келдіңіз!</b>\n\nМен сізге пайдалы әдеттерді қалыптастыруға және мақсаттарға жетуге көмектесемін.\n\n🎯 Күн сайын прогрессті қадағалаңыз\n👥 Достарыңызбен әдеттерді бөлісіңіз\n📊 Егжей-тегжейлі статистиканы қараңыз\n⏰ Еске салғыштар алыңыз\n\nБастайық! 👇`
      };
      
      const openAppTexts = {
        en: '📱 Open Habit Tracker',
        ru: '📱 Открыть Habit Tracker',
        kk: '📱 Habit Tracker ашу'
      };
      
      const welcomeMessage = welcomeMessages[userLanguage] || welcomeMessages['en'];
      const openAppText = openAppTexts[userLanguage] || openAppTexts['en'];
      
      const webAppUrl = process.env.WEBAPP_URL || process.env.FRONTEND_URL;
      
      console.log('🔗 Sending button with URL:', webAppUrl);
      
      await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { 
              text: openAppText, 
              web_app: { url: webAppUrl }
            }
          ]]
        }
      });
      
      console.log('✅ Welcome message sent (user will be created on first app open)');
      
    } catch (error) {
      console.error('❌ /start error:', error);
      await bot.sendMessage(chatId, '❌ An error occurred. Please try again later.');
    }
    return;
  }

  // 🆕 Команда /app для быстрого открытия приложения
  if (text === '/app') {
    console.log('📱 Processing /app command');
    
    try {
      // Проверяем язык пользователя из БД (если есть)
      const userResult = await db.query(
        'SELECT language FROM users WHERE telegram_id = $1',
        [chatId.toString()]
      );
      
      let userLanguage = 'en';
      
      if (userResult.rows.length > 0) {
        userLanguage = userResult.rows[0].language || 'en';
      } else {
        // Если пользователя нет в БД, определяем язык из Telegram
        const langCode = msg.from.language_code?.toLowerCase() || 'en';
        if (langCode === 'ru' || langCode.startsWith('ru-')) {
          userLanguage = 'ru';
        } else if (langCode === 'kk' || langCode === 'kz' || langCode.startsWith('kk-')) {
          userLanguage = 'kk';
        }
      }
      
      const messages = {
        en: '📱 <b>Open Habit Tracker</b>\n\nClick the button below to launch the app:',
        ru: '📱 <b>Открыть Habit Tracker</b>\n\nНажмите кнопку ниже для запуска приложения:',
        kk: '📱 <b>Habit Tracker ашу</b>\n\nҚосымшаны іске қосу үшін төмендегі батырманы басыңыз:'
      };
      
      const openAppTexts = {
        en: '🚀 Launch App',
        ru: '🚀 Запустить приложение',
        kk: '🚀 Қосымшаны іске қосу'
      };
      
      await bot.sendMessage(chatId, messages[userLanguage] || messages['en'], {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { 
              text: openAppTexts[userLanguage] || openAppTexts['en'],
              web_app: { url: process.env.WEBAPP_URL || process.env.FRONTEND_URL } 
            }
          ]]
        }
      });
      
      console.log('✅ /app command processed');
    } catch (error) {
      console.error('❌ /app error:', error);
      await bot.sendMessage(chatId, '❌ An error occurred. Please try /start');
    }
    return;
  }

  // Обработка других команд...
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
  
  console.log('⚠️ Unknown command');
});

bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  console.log(`📲 Callback received: ${data} from chat ${chatId}`);

  if (data.startsWith("mark_done_")) {
    const habitId = data.replace("mark_done_", "");

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

      await bot.editMessageText(
        "✅ Отлично! Привычка отмечена как выполненная.",
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "📱 Открыть приложение", web_app: { url: WEBAPP_URL } }],
            ],
          },
        }
      );

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "✅ Выполнено!",
      });

      console.log(`✅ Habit ${habitId} marked as done`);
    } catch (error) {
      console.error("Error marking habit done:", error);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ Ошибка",
      });
    }
  } else if (data.startsWith("mark_skip_")) {
    const habitId = data.replace("mark_skip_", "");

    try {
      await db.query(
        `INSERT INTO habit_marks (habit_id, date, status) 
         VALUES ($1, CURRENT_DATE, 'skipped')
         ON CONFLICT (habit_id, date) 
         DO UPDATE SET status = 'skipped', marked_at = CURRENT_TIMESTAMP`,
        [habitId]
      );

      await db.query("UPDATE habits SET streak_current = 0 WHERE id = $1", [
        habitId,
      ]);

      await bot.editMessageText("⏭ Привычка пропущена на сегодня.", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: "📱 Открыть приложение", web_app: { url: WEBAPP_URL } }],
          ],
        },
      });

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "⏭ Пропущено",
      });

      console.log(`⏭ Habit ${habitId} marked as skipped`);
    } catch (error) {
      console.error("Error marking habit skipped:", error);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ Ошибка",
      });
    }
  } else if (data.startsWith("quick_done_")) {
    const parts = data.split("_");
    const habitId = parts[2];
    const date = parts[3] || new Date().toISOString().split("T")[0];

    try {
      const userResult = await db.query(
        "SELECT id, first_name FROM users WHERE telegram_id = $1",
        [chatId.toString()]
      );

      if (userResult.rows.length === 0) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ Пользователь не найден",
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
          text: "❌ Привычка не найдена",
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
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "📱 Открыть приложение", web_app: { url: WEBAPP_URL } }],
            ],
          },
        }
      );

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "✅ Выполнено! Отличная работа!",
      });

      const habitResult = await db.query("SELECT * FROM habits WHERE id = $1", [
        userHabitId,
      ]);

      if (habitResult.rows.length > 0) {
        const sendFriendNotifications =
          require("./controllers/markController").sendFriendNotifications;
        await sendFriendNotifications(habitResult.rows[0], userId, date);
      }

      console.log(
        `✅ Quick habit ${userHabitId} marked as done for user ${userId}`
      );
    } catch (error) {
      console.error("Error quick marking habit:", error);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ Ошибка при отметке",
      });
    }
  }
});

/** ---------- Запуск HTTP и установка webhook ---------- */
const server = app.listen(PORT, async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
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
      console.log("🗑️ Old webhook deleted");

      // Устанавливаем новый
      const result = await bot.setWebHook(webhookUrl, {
        secret_token: BOT_SECRET,
        drop_pending_updates: false,
        allowed_updates: [
          "message",
          "callback_query",
          "pre_checkout_query",
          "successful_payment",
        ],
      });

      if (result) {
        console.log("✅ Webhook установлен успешно");
      } else {
        console.error("❌ Failed to set webhook");
      }

      // Проверяем webhook
      const webhookInfo = await bot.getWebhookInfo();
      console.log("📊 Webhook Info:", {
        url: webhookInfo.url,
        has_custom_certificate: webhookInfo.has_custom_certificate,
        pending_update_count: webhookInfo.pending_update_count,
        allowed_updates: webhookInfo.allowed_updates,
        last_error_date: webhookInfo.last_error_date,
        last_error_message: webhookInfo.last_error_message,
      });

      // Если есть ошибки в webhook, выводим их
      if (webhookInfo.last_error_message) {
        console.error("⚠️ Last webhook error:", webhookInfo.last_error_message);
      }
    } catch (e) {
      console.error("❌ Ошибка установки webhook:", e.message);
      console.error("Stack:", e.stack);
    }
  } else {
    console.log(
      "⚠️ Webhook не установлен - отсутствуют необходимые параметры:"
    );
    console.log("BACKEND_PUBLIC_URL:", BACKEND_PUBLIC_URL);
    console.log("BOT_TOKEN:", BOT_TOKEN ? "Present" : "Missing");
    console.log("BOT_SECRET:", BOT_SECRET ? "Present" : "Missing");
  }
});

/** Грейсфул шатдаун */
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  reminderService.stop();
  keepAliveService.stop();
  subscriptionCron.stop();
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing HTTP server");
  reminderService.stop();
  keepAliveService.stop();
  subscriptionCron.stop();
  server.close(() => process.exit(0));
});

// module.exports.bot = bot;
