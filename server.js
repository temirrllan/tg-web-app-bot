require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const TelegramBot = require("node-telegram-bot-api");
const logger = require("./middleware/logger");
const authRoutes = require("./routes/authRoutes");
const habitRoutes = require("./routes/habitRoutes");
const userRoutes = require("./routes/userRoutes");
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

const ADMIN_IDS = [
  1313126991, // ← СЮДА ВАШ ID
];

const broadcastState = new Map();

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

async function sendBroadcast(message, options = {}) {
  try {
    console.log('📢 Starting broadcast...');
    
    const usersResult = await db.query(
      'SELECT telegram_id, first_name FROM users WHERE telegram_id IS NOT NULL'
    );
    
    const users = usersResult.rows;
    console.log(`📊 Found ${users.length} users for broadcast`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const user of users) {
      try {
        await bot.sendMessage(user.telegram_id, message, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...options
        });
        
        successCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (err) {
        console.error(`Failed to send to ${user.telegram_id}:`, err.message);
        failCount++;
      }
    }
    
    console.log(`✅ Broadcast completed: ${successCount} sent, ${failCount} failed`);
    
    return { successCount, failCount, total: users.length };
    
  } catch (error) {
    console.error('❌ Broadcast error:', error);
    throw error;
  }
}
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

const isProduction = process.env.NODE_ENV === 'production';

const allowedOrigins = [
  FRONTEND_URL,
  WEBAPP_URL,
  "https://web.telegram.org",
  ...(isProduction ? [] : ["http://localhost:5173", "http://localhost:5174"]),
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
// Scope body parsers to /api only.
// AdminJS uses express-formidable internally and throws OldBodyParserUsedError
// if express.json() / express.urlencoded() already ran on its requests.
app.use('/api', express.json());
app.use('/api', express.urlencoded({ extended: false }));
app.use(logger);

// Webhook от Telegram для команд бота
const WEBHOOK_PATH = `/api/telegram/webhook/${BOT_TOKEN}`;

app.post(WEBHOOK_PATH, async (req, res) => {
  try {
    console.log("🔔 WEBHOOK RECEIVED:", JSON.stringify(req.body, null, 2));

    const secretHeader = req.get("x-telegram-bot-api-secret-token");

    if (!BOT_SECRET) {
      console.error("❌ BOT_SECRET not configured");
      return res
        .status(401)
        .json({ success: false, error: "Webhook secret is not configured" });
    }

    if (secretHeader !== BOT_SECRET) {
      console.error("❌ Invalid webhook secret token");
      return res
        .status(401)
        .json({ success: false, error: "Unauthorized webhook" });
    }

    console.log("✅ Telegram webhook authorized");

    const update = req.body;
    // КРИТИЧЕСКИ ВАЖНО: Обрабатываем successful_payment
    if (update.message?.successful_payment) {
      console.log("💳 ========== SUCCESSFUL PAYMENT DETECTED ==========");
      const payment = update.message.successful_payment;
      const from_user_id = update.message.from.id;

      console.log("Payment details:", {
        currency: payment.currency,
        total_amount: payment.total_amount,
        invoice_payload: payment.invoice_payload,
        telegram_payment_charge_id: payment.telegram_payment_charge_id,
        from_user_id: from_user_id,
      });

      // Проверяем что это Telegram Stars
      if (payment.currency === "XTR") {
        const invoicePayload = payment.invoice_payload || "";

        // ── Pack purchase payment ──────────────────────────────────────────
        if (invoicePayload.startsWith("pack_")) {
          console.log("🎁 Processing pack purchase payment...");
          try {
            // payload format: pack_PACKID_USERID_TIMESTAMP
            const parts = invoicePayload.split("_");
            const packId = parseInt(parts[1]);

            // Resolve internal user id from telegram_id
            const userRes = await db.query(
              "SELECT id FROM users WHERE telegram_id = $1",
              [from_user_id.toString()]
            );

            if (userRes.rows.length > 0) {
              const userId = userRes.rows[0].id;
              const { createPackHabitsForUser } = require("./controllers/specialHabitsController");
              await createPackHabitsForUser(userId, packId, payment.telegram_payment_charge_id);

              console.log(`✅ Pack ${packId} unlocked for user ${userId}`);

              // Confirmation message to user
              try {
                const langRes = await db.query("SELECT language FROM users WHERE id=$1", [userId]);
                const lang = langRes.rows[0]?.language || "en";
                const msg = lang === "ru"
                  ? "🎉 <b>Оплата прошла!</b>\n\nВаш Celebrity Habit Pack активирован. Откройте приложение и найдите привычки во вкладке <b>Special</b>! ✨"
                  : lang === "kk"
                  ? "🎉 <b>Төлем өтті!</b>\n\nСіздің Celebrity Habit Pack белсендірілді. Қосымшаны ашып, <b>Special</b> қойындысынан әдеттерді табыңыз! ✨"
                  : "🎉 <b>Payment successful!</b>\n\nYour Celebrity Habit Pack is now active! Open the app and find your habits in the <b>Special</b> tab. ✨";
                await bot.sendMessage(from_user_id, msg, { parse_mode: "HTML" });
              } catch (msgErr) {
                console.warn("⚠️ Failed to send pack confirmation:", msgErr.message);
              }
            } else {
              console.error("❌ User not found for pack payment:", from_user_id);
            }
          } catch (packErr) {
            console.error("❌ Pack payment processing error:", packErr);
          }

          bot.processUpdate(update);
          return res.status(200).json({ success: true });
        }

        // ── Subscription payment (existing flow) ───────────────────────────
        const paymentData = {
          telegram_payment_charge_id: payment.telegram_payment_charge_id,
          provider_payment_charge_id: payment.provider_payment_charge_id,
          invoice_payload: invoicePayload,
          total_amount: payment.total_amount,
          currency: payment.currency,
          from_user_id: from_user_id,
        };

        console.log("💰 Processing Telegram Stars payment...");

        // Обрабатываем платёж
        const result = await TelegramStarsService.processSuccessfulPayment(
          paymentData
        );

        if (result.success) {
          console.log("✅ Payment processed successfully");
          console.log("✅ User ID:", result.user_id);
          console.log("✅ Subscription ID:", result.subscription_id);
          console.log("✅ Plan type:", result.plan_type);
          console.log("✅ Expires at:", result.expires_at);

          // Проверяем что данные обновились
          const verificationResult = await db.query(
            "SELECT id, is_premium, subscription_type, subscription_expires_at FROM users WHERE id = $1",
            [result.user_id]
          );

          console.log(
            "🔍 User verification after payment:",
            verificationResult.rows[0]
          );

          // Отправляем подтверждение пользователю
          try {
            const userResult = await db.query(
              "SELECT language FROM users WHERE telegram_id = $1",
              [from_user_id.toString()]
            );

            const lang =
              userResult.rows.length > 0 ? userResult.rows[0].language : "en";

            const messages = {
              ru: "🎉 <b>Оплата прошла успешно!</b>\n\nВаша Premium подписка активирована!\n\n✅ Безлимитные привычки\n✅ Безлимитные друзья\n✅ Расширенная статистика\n✅ Приоритетная поддержка\n\nОткройте приложение и наслаждайтесь! 💪",
              en: "🎉 <b>Payment successful!</b>\n\nYour Premium subscription is now active!\n\n✅ Unlimited habits\n✅ Unlimited friends\n✅ Advanced statistics\n✅ Priority support\n\nOpen the app and enjoy! 💪",
              kk: "🎉 <b>Төлем сәтті өтті!</b>\n\nСіздің Premium жазылымыңыз белсендірілді!\n\n✅ Шексіз әдеттер\n✅ Шексіз достар\n✅ Кеңейтілген статистика\n✅ Басым қолдау\n\nҚосымшаны ашып, ләззат алыңыз! 💪",
            };

            const message = messages[lang] || messages["en"];

            await bot.sendMessage(from_user_id, message, {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text:
                        lang === "ru"
                          ? "📱 Открыть приложение"
                          : lang === "kk"
                          ? "📱 Қосымшаны ашу"
                          : "📱 Open App",
                      web_app: {
                        url: process.env.WEBAPP_URL || process.env.FRONTEND_URL,
                      },
                    },
                  ],
                ],
              },
            });

            console.log("✅ Confirmation message sent to user");
          } catch (botError) {
            console.error(
              "⚠️ Failed to send confirmation (non-critical):",
              botError.message
            );
          }
        } else {
          console.error("❌ Payment processing failed:", result.error);
        }
      } else {
        console.log("⚠️ Non-XTR payment, skipping");
      }
    }
    bot.processUpdate(update);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Telegram webhook error:", error);
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
app.use("/api/users", userRoutes);
app.use("/api", habitRoutes);

const paymentRoutes = require("./routes/paymentRoutes");
app.use("/api/payment", paymentRoutes);

// Special Habits routes
const specialHabitsRoutes = require("./routes/specialHabitsRoutes");
app.use("/api/special-habits", specialHabitsRoutes);

// Admin panel — AdminJS (async init, ready in ~1-2s after start)
// Note: express.urlencoded() is intentionally NOT placed here.
// AdminJS uses express-formidable for its own body parsing.

// Fix: AdminJS stores its bundle in .adminjs/ (dotfile directory) by default,
// but Express 'send' ignores dotfile directories. Setting ADMIN_JS_TMP_DIR to
// an absolute non-dotfile path ensures the bundle is always found regardless of CWD.
if (!process.env.ADMIN_JS_TMP_DIR) {
  process.env.ADMIN_JS_TMP_DIR = path.join(__dirname, 'adminjs_bundle');
}

let _adminRouter = null;
app.use('/admin', (req, res, next) => {
  if (_adminRouter) return _adminRouter(req, res, next);
  res.status(503).send(
    '<h2 style="font-family:sans-serif;padding:40px;color:#555">' +
    '⏳ Admin panel is initializing...<br><small>Refresh in a moment</small></h2>'
  );
});

const { buildAdminRouter } = require('./admin/adminSetup');
buildAdminRouter()
  .then(({ adminJs, router }) => {
    _adminRouter = router;
    console.log('✅ AdminJS ready at', adminJs.options.rootPath);
  })
  .catch(err => console.error('❌ AdminJS init failed:', err));

console.log("\n🤖 Запуск Telegram бота (webhook)...");

const bot = new TelegramBot(BOT_TOKEN, { polling: false });
// Экспортируем бота для использования в других модулях
module.exports.bot = bot;
const ReminderService = require("./services/reminderService");
const reminderService = new ReminderService(bot);
const TelegramStarsService = require("./services/telegramStarsService");

// ========================================
// 📚 СИСТЕМА ИНСТРУКЦИЙ
// ========================================

const INSTRUCTIONS = {
  en: {
    menu_title: "📖 <b>Habit Tracker Instructions</b>\n\nChoose a topic to learn more:",
    
    registration: {
      title: "🔐 Registration",
      text: "🔐 <b>Registration</b>\n\n✨ Good news - there's no registration needed!\n\nJust open the app and you're ready to go. Your Telegram account is used automatically.\n\n• No forms to fill\n• No passwords to remember\n• Instant access\n\nTap \"Open App\" and start building habits right away! 🚀"
    },
    
    creating_habit: {
      title: "➕ Creating a Habit",
      text: "➕ <b>Creating Your First Habit</b>\n\n1️⃣ Open the app and tap the <b>\"+ New Habit\"</b> button\n\n2️⃣ Fill in the details:\n   • Habit name (e.g., \"Morning Run\")\n   • Goal description\n   • Choose frequency (daily/weekly)\n   • Set reminder time (optional)\n\n3️⃣ Tap <b>\"Create\"</b> - done! ✅\n\n💡 <b>Tip:</b> Start with 1-2 habits. It's better to be consistent with a few than overwhelmed with many!"
    },
    
    punching_friend: {
      title: "👊 Punching a Friend",
      text: "👊 <b>Punching Friends</b>\n\n\"Punch\" is a fun way to encourage your friends!\n\n<b>How it works:</b>\n1️⃣ Add friends to your habit\n2️⃣ When they complete their habit, you can \"punch\" them\n3️⃣ It's a virtual high-five! 🙌\n\n<b>To punch:</b>\n• Go to shared habits\n• See your friend's progress\n• Tap the punch emoji 👊\n\n<b>Why punch?</b>\n• Show support\n• Keep each other motivated\n• Make habit building fun!\n\nYour friends will get a notification and feel encouraged! 💪"
    },
    
    sharing_habits: {
      title: "🤝 Sharing Habits",
      text: "🤝 <b>Sharing Habits with Friends</b>\n\n<b>Share your habits to stay accountable together!</b>\n\n📤 <b>How to share:</b>\n1️⃣ Open your habit\n2️⃣ Tap the <b>\"Share\"</b> button\n3️⃣ Send the invite link to friends\n\n✅ <b>What happens:</b>\n• Friends see your progress\n• You see theirs\n• Encourage each other\n• Build streaks together\n\n💡 <b>Pro tip:</b> Shared habits have higher success rates! Having an accountability partner increases your chances by 65%."
    },
    
    tracking_progress: {
      title: "📊 Tracking Progress",
      text: "📊 <b>Tracking Your Progress</b>\n\n<b>Check your progress:</b>\n\n📈 <b>Statistics you'll see:</b>\n• Current streak 🔥\n• Best streak 🏆\n• Completion rate 📊\n• Weekly/monthly overview 📅\n\n✅ <b>Marking habits:</b>\n• Tap the checkmark to complete\n• Use reminders to stay on track\n• Review your calendar view\n\n🎯 <b>Stay motivated:</b>\n• Watch your streaks grow\n• See visual progress\n• Celebrate milestones\n\nEvery day counts! Keep going! 💪"
    },
    
    reminders: {
      title: "⏰ Setting Reminders",
      text: "⏰ <b>Setting Up Reminders</b>\n\n<b>Never forget your habits!</b>\n\n🔔 <b>How to set reminders:</b>\n1️⃣ Open your habit settings\n2️⃣ Enable \"Reminder\"\n3️⃣ Choose your preferred time\n4️⃣ Select reminder days\n\n💡 <b>Best practices:</b>\n• Set reminders for the same time daily\n• Choose realistic times\n• Not too many at once\n\n📱 <b>You'll receive:</b>\n• Telegram notification\n• Quick action buttons\n• Motivational messages\n\nStay consistent with smart reminders! ⏰"
    },
    
    premium: {
      title: "⭐ Premium Features",
      text: "⭐ <b>Premium Subscription</b>\n\n<b>Upgrade for unlimited possibilities!</b>\n\n🎁 <b>Premium includes:</b>\n✅ Unlimited habits (Free: 5)\n✅ Unlimited friends\n✅ Advanced statistics\n✅ Priority support\n✅ Custom habit icons\n✅ Export your data\n\n💎 <b>Plans available:</b>\n• Monthly: 50 ⭐ Telegram Stars\n• Yearly: 500 ⭐ (Save 17%!)\n\n🚀 <b>Go Premium:</b>\nOpen Settings → Subscription → Choose Plan\n\nInvest in your personal growth! 🌟"
    },
    
    back_button: "◀️ Back to Menu",
    open_app_button: "📱 Open App"
  },
  
  ru: {
    menu_title: "📖 <b>Инструкция по Habit Tracker</b>\n\nВыберите тему для изучения:",
    
    registration: {
      title: "🔐 Регистрация",
      text: "🔐 <b>Регистрация</b>\n\n✨ Хорошие новости - регистрация не требуется!\n\nПросто откройте приложение и всё готово. Ваш Telegram аккаунт используется автоматически.\n\n• Никаких форм\n• Никаких паролей\n• Мгновенный доступ\n\nНажмите \"Открыть приложение\" и начинайте строить привычки прямо сейчас! 🚀"
    },
    
    creating_habit: {
      title: "➕ Создание привычки",
      text: "➕ <b>Создание первой привычки</b>\n\n1️⃣ Откройте приложение и нажмите на кнопку <b>\"+\"</b>\n\n2️⃣ Заполните детали:\n   • Название привычки (например, \"Утренняя пробежка\")\n   • Описание цели\n   • Выберите частоту (ежедневно/еженедельно)\n   • Установите время напоминания (опционально)\n\n3️⃣ Нажмите <b>\"Создать\"</b> - готово! ✅\n\n💡 <b>Совет:</b> Начните с 1-2 привычек. Лучше быть последовательным с несколькими, чем перегруженным многими!"
    },
    
    punching_friend: {
      title: "👊 Панч друга",
      text: "👊 <b>Панч друзей</b>\n\n\"Панч\" - это веселый способ поддержать друзей!\n\n<b>Как это работает:</b>\n1️⃣ Добавьте друзей к своей привычке\n2️⃣ Когда они не выполняют привычку, вы можете \"запанчить\" их\n3️⃣ Это виртуальная пятюня! 🙌\n\n<b>Как запанчить:</b>\n• Перейдите к общим привычкам\n• Найдите нужного друга\n• Свайпните друга влево\n\n<b>Зачем панчить?</b>\n• Показать поддержку\n• Мотивировать друг друга\n• Сделать выработку привычек веселее!\n\nВаши друзья получат уведомление и почувствуют поддержку! 💪"
    },
    
    sharing_habits: {
      title: "🤝 Совместные привычки",
      text: "🤝 <b>Совместные привычки с друзьями</b>\n\n<b>Делитесь привычками для взаимной ответственности!</b>\n\n📤 <b>Как поделиться:</b>\n1️⃣ Откройте вашу привычку\n2️⃣ Нажмите кнопку <b>\"Пригласить друга\"</b>\n3️⃣ Отправьте ссылку-приглашение друзьям\n\n✅ <b>Что происходит:</b>\n• Друзья видят ваш прогресс\n• Вы видите их\n• Поддерживаете друг друга\n• Строите серии вместе\n\n💡 <b>Совет:</b> Совместные привычки имеют более высокий процент успеха! Партнер по ответственности увеличивает ваши шансы на 65%."
    },
    
    tracking_progress: {
      title: "📊 Отслеживание прогресса",
      text: "📊 <b>Отслеживание прогресса</b>\n\n<b>Проверяйте свой прогресс:</b>\n\n📈 <b>Статистика, которую вы увидите:</b>\n• Текущая серия 🔥\n• Лучшая серия 🏆\n• Процент выполнения 📊\n• Недельный/месячный обзор 📅\n\n✅ <b>Отметка привычек:</b>\n• Нажмите галочку для выполнения\n• Используйте напоминания\n• Смотрите календарный вид\n\n🎯 <b>Оставайтесь мотивированными:</b>\n• Наблюдайте за ростом серий\n• Видьте визуальный прогресс\n• Празднуйте достижения\n\nКаждый день имеет значение! Продолжайте! 💪"
    },
    
    reminders: {
      title: "⏰ Напоминания",
      text: "⏰ <b>Настройка напоминаний</b>\n\n<b>Никогда не забывайте о привычках!</b>\n\n🔔 <b>Как настроить:</b>\n1️⃣ Откройте настройки привычки\n2️⃣ Включите \"Напоминание\"\n3️⃣ Выберите удобное время\n4️⃣ Выберите дни напоминаний\n\n💡 <b>Лучшие практики:</b>\n• Устанавливайте на одно время каждый день\n• Выбирайте реалистичное время\n• Не слишком много за раз\n\n📱 <b>Вы получите:</b>\n• Уведомление в Telegram\n• Кнопки быстрых действий\n• Мотивационные сообщения\n\nБудьте последовательны с умными напоминаниями! ⏰"
    },
    
    premium: {
      title: "⭐ Premium",
      text: "⭐ <b>Premium подписка</b>\n\n<b>Обновитесь для неограниченных возможностей!</b>\n\n🎁 <b>Premium включает:</b>\n✅ Безлимитные привычки (Бесплатно: 5)\n✅ Безлимитные друзья\n✅ Расширенная статистика\n✅ Приоритетная поддержка\n✅ Кастомные иконки привычек\n✅ Экспорт данных\n\n💎 <b>Доступные планы:</b>\n• Месячный: 50 ⭐ Telegram Stars\n• Годовой: 500 ⭐ (Экономия 17%!)\n\n🚀 <b>Получить Premium:</b>\nОткройте Настройки → Подписка → Выберите план\n\nИнвестируйте в личный рост! 🌟"
    },
    
    back_button: "◀️ Назад в меню",
    open_app_button: "📱 Открыть приложение"
  },
  
  kk: {
    menu_title: "📖 <b>Habit Tracker нұсқаулығы</b>\n\nТақырыпты таңдаңыз:",
    
    registration: {
      title: "🔐 Тіркелу",
      text: "🔐 <b>Тіркелу</b>\n\n✨ Жақсы жаңалық - тіркелу қажет емес!\n\nҚосымшаны ашыңыз, барлығы дайын. Сіздің Telegram аккаунтыңыз автоматты түрде қолданылады.\n\n• Нысандар жоқ\n• Құпия сөздер жоқ\n• Лезде қолжетімді\n\n\"Қосымшаны ашу\" батырмасын басыңыз және әдеттерді құруды бастаңыз! 🚀"
    },
    
    creating_habit: {
      title: "➕ Әдет құру",
      text: "➕ <b>Бірінші әдетті құру</b>\n\n1️⃣ Қосымшаны ашып, <b>\"+ Жаңа әдет\"</b> батырмасын басыңыз\n\n2️⃣ Мәліметтерді толтырыңыз:\n   • Әдет атауы (мысалы, \"Таңғы жүгіру\")\n   • Мақсат сипаттамасы\n   • Жиілігін таңдаңыз (күнделікті/апталық)\n   • Еске салғыш уақытын орнатыңыз (қалауыңызша)\n\n3️⃣ <b>\"Құру\"</b> батырмасын басыңыз - дайын! ✅\n\n💡 <b>Кеңес:</b> 1-2 әдеттен бастаңыз. Көбірек әдеттермен шамадан тыс жүктелгеннен гөрі, бірнешеуімен тұрақты болған дұрыс!"
    },
    
    punching_friend: {
      title: "👊 Досты панчтау",
      text: "👊 <b>Достарды панчтау</b>\n\n\"Панч\" - достарыңызды қолдаудың қызықты әдісі!\n\n<b>Қалай жұмыс істейді:</b>\n1️⃣ Достарды әдетке қосыңыз\n2️⃣ Олар әдетті орындағанда, оларды \"панчтай\" аласыз\n3️⃣ Бұл виртуалды бесжарыс! 🙌\n\n<b>Қалай панчтау керек:</b>\n• Ортақ әдеттерге өтіңіз\n• Досыңыздың прогресін қараңыз\n• Панч эмодзиін басыңыз 👊\n\n<b>Неге панчтау керек?</b>\n• Қолдау көрсету\n• Бір-біріңізді мотивациялау\n• Әдет құруды қызықты ету!\n\nДостарыңыз хабарландыру алады және қолдау сезінеді! 💪"
    },
    
    sharing_habits: {
      title: "🤝 Ортақ әдеттер",
      text: "🤝 <b>Достармен ортақ әдеттер</b>\n\n<b>Өзара жауапкершілік үшін әдеттерді бөлісіңіз!</b>\n\n📤 <b>Қалай бөлісу керек:</b>\n1️⃣ Әдетіңізді ашыңыз\n2️⃣ <b>\"Бөлісу\"</b> батырмасын басыңыз\n3️⃣ Шақыру сілтемесін достарға жіберіңіз\n\n✅ <b>Не болады:</b>\n• Достар сіздің прогресіңізді көреді\n• Сіз олардікін көресіз\n• Бір-біріңізді қолдайсыз\n• Бірге серияларды құрасыз\n\n💡 <b>Кеңес:</b> Ортақ әдеттердің табыс пайызы жоғары! Жауапкершілік серіктесі сіздің мүмкіндіктеріңізді 65%-ға арттырады."
    },
    
    tracking_progress: {
      title: "📊 Прогресті бақылау",
      text: "📊 <b>Прогресті бақылау</b>\n\n<b>Прогресіңізді тексеріңіз:</b>\n\n📈 <b>Көретін статистика:</b>\n• Ағымдағы серия 🔥\n• Ең жақсы серия 🏆\n• Орындау пайызы 📊\n• Апталық/айлық шолу 📅\n\n✅ <b>Әдеттерді белгілеу:</b>\n• Орындау үшін белгіні басыңыз\n• Еске салғыштарды пайдаланыңыз\n• Күнтізбе көрінісін қараңыз\n\n🎯 <b>Мотивацияны сақтаңыз:</b>\n• Сериялардың өсуін бақылаңыз\n• Визуалды прогресті көріңіз\n• Жетістіктерді атап өтіңіз\n\nӘр күн маңызды! Жалғастырыңыз! 💪"
    },
    
    reminders: {
      title: "⏰ Еске салғыштар",
      text: "⏰ <b>Еске салғыштарды баптау</b>\n\n<b>Әдеттерді ешқашан ұмытпаңыз!</b>\n\n🔔 <b>Қалай баптау керек:</b>\n1️⃣ Әдет параметрлерін ашыңыз\n2️⃣ \"Еске салғыш\" қосыңыз\n3️⃣ Қолайлы уақытты таңдаңыз\n4️⃣ Еске салғыш күндерін таңдаңыз\n\n💡 <b>Үздік тәжірибелер:</b>\n• Күн сайын бір уақытқа орнатыңыз\n• Шынайы уақытты таңдаңыз\n• Бір мезгілде көп болмасын\n\n📱 <b>Аласыз:</b>\n• Telegram хабарландыруы\n• Жылдам әрекет батырмалары\n• Мотивациялық хабарлар\n\nАқылды еске салғыштармен тұрақты болыңыз! ⏰"
    },
    
    premium: {
      title: "⭐ Premium",
      text: "⭐ <b>Premium жазылым</b>\n\n<b>Шексіз мүмкіндіктер үшін жаңартыңыз!</b>\n\n🎁 <b>Premium қамтиды:</b>\n✅ Шексіз әдеттер (Тегін: 5)\n✅ Шексіз достар\n✅ Кеңейтілген статистика\n✅ Басым қолдау\n✅ Таңдауыңызша әдет белгішелері\n✅ Деректерді экспорттау\n\n💎 <b>Қолжетімді жоспарлар:</b>\n• Айлық: 50 ⭐ Telegram Stars\n• Жылдық: 500 ⭐ (17% үнемдеу!)\n\n🚀 <b>Premium алу:</b>\nПараметрлер → Жазылым → Жоспарды таңдау\n\nЖеке өсуге инвестиция салыңыз! 🌟"
    },
    
    back_button: "◀️ Мәзірге оралу",
    open_app_button: "📱 Қосымшаны ашу"
  }
};

// Функция для получения языка пользователя
function getUserLanguage(langCode) {
  if (langCode === 'ru' || langCode?.startsWith('ru-')) return 'ru';
  if (langCode === 'kk' || langCode === 'kz' || langCode?.startsWith('kk-')) return 'kk';
  return 'en';
}

// Создание главного меню инструкций
function getInstructionsMainMenu(lang) {
  const texts = INSTRUCTIONS[lang];
  
  return {
    text: texts.menu_title,
    keyboard: [
      [{ text: texts.registration.title, callback_data: 'instr_registration' }],
      [{ text: texts.creating_habit.title, callback_data: 'instr_creating_habit' }],
      [{ text: texts.punching_friend.title, callback_data: 'instr_punching_friend' }],
      [{ text: texts.sharing_habits.title, callback_data: 'instr_sharing_habits' }],
      [{ text: texts.tracking_progress.title, callback_data: 'instr_tracking_progress' }],
      [{ text: texts.reminders.title, callback_data: 'instr_reminders' }],
      [{ text: texts.premium.title, callback_data: 'instr_premium' }],
      [{ text: texts.open_app_button, web_app: { url: WEBAPP_URL } }]
    ]
  };
}

// Создание страницы инструкции
function getInstructionPage(lang, section) {
  const texts = INSTRUCTIONS[lang];
  const sectionData = texts[section];
  
  if (!sectionData) return null;
  
  return {
    text: sectionData.text,
    keyboard: [
      [{ text: texts.back_button, callback_data: 'instr_main_menu' }],
      [{ text: texts.open_app_button, web_app: { url: WEBAPP_URL } }]
    ]
  };
}

// ========================================
// КОНЕЦ СИСТЕМЫ ИНСТРУКЦИЙ
// ========================================

// ВАЖНО: Обработчик pre_checkout_query
bot.on("pre_checkout_query", async (query) => {
  console.log("💳 ========== PRE-CHECKOUT QUERY (Telegram Stars) ==========");
  console.log("Query ID:", query.id);
  console.log("From:", query.from.id, query.from.first_name);
  console.log("Currency:", query.currency);
  console.log("Total amount:", query.total_amount, "XTR");
  console.log("Invoice payload:", query.invoice_payload);

  try {
    // Проверяем что это Telegram Stars
    if (query.currency !== "XTR") {
      console.error("❌ Wrong currency:", query.currency);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "Only Telegram Stars (XTR) payments are accepted.",
      });
      return;
    }

    const invoicePayload = query.invoice_payload;

    // --- PACK PURCHASE (payload: pack_{packId}_{userId}_{timestamp}) ---
    if (invoicePayload.startsWith('pack_')) {
      const parts = invoicePayload.split('_');
      if (parts.length < 4) {
        console.error('❌ Invalid pack payload format:', invoicePayload);
        await bot.answerPreCheckoutQuery(query.id, false, {
          error_message: 'Invalid payment data. Please try again.',
        });
        return;
      }
      const packId = parseInt(parts[1]);
      const packResult = await db.query(
        'SELECT price_stars, name FROM special_habit_packs WHERE id = $1 AND is_active = true',
        [packId]
      );
      if (packResult.rows.length === 0) {
        console.error('❌ Pack not found or inactive:', packId);
        await bot.answerPreCheckoutQuery(query.id, false, {
          error_message: 'Pack not found. Please try again.',
        });
        return;
      }
      const packExpectedAmount = packResult.rows[0].price_stars;
      if (query.total_amount !== packExpectedAmount) {
        console.error('❌ Pack amount mismatch:', { expected: packExpectedAmount, got: query.total_amount });
        await bot.answerPreCheckoutQuery(query.id, false, {
          error_message: 'Invalid payment amount. Please try again.',
        });
        return;
      }
      await bot.answerPreCheckoutQuery(query.id, true);
      console.log('✅ Pack pre-checkout approved - pack:', packId, packResult.rows[0].name);
      return;
    }

    // --- SUBSCRIPTION PURCHASE (payload: userId|planType|timestamp|random) ---
    let parsed;
    try {
      parsed = TelegramStarsService.parseInvoicePayload(invoicePayload);
    } catch (parseError) {
      console.error("❌ Invalid payload:", parseError);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "Invalid payment data. Please try again.",
      });
      return;
    }

    const userId = parseInt(parsed.userId);
    const planType = parsed.planType;

    console.log("📋 Parsed payment data:", { userId, planType });

    const userResult = await db.query(
      "SELECT id, first_name FROM users WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) {
      console.error("❌ User not found:", userId);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "User not found. Please try again.",
      });
      return;
    }

    const plan = TelegramStarsService.PLANS[planType];

    if (!plan) {
      console.error("❌ Invalid plan:", planType);
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "Invalid subscription plan. Please try again.",
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
        error_message: "Invalid payment amount. Please try again.",
      });
      return;
    }

    // ВСЁ ХОРОШО - разрешаем оплату
    await bot.answerPreCheckoutQuery(query.id, true);
    console.log("✅ Pre-checkout query approved - payment can proceed");
  } catch (error) {
    console.error("❌ Pre-checkout error:", error);

    try {
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: "Payment processing error. Please try again.",
      });
    } catch (e) {
      console.error("Failed to reject pre-checkout:", e);
    }
  }
});

// Обработчик successful_payment через bot.on
bot.on("successful_payment", async (msg) => {
  console.log("💳 ========== SUCCESSFUL PAYMENT EVENT ==========");
  console.log("Payment received from:", msg.from.id, msg.from.first_name);

  const payment = msg.successful_payment;

  if (payment.currency === "XTR") {
    const payload = payment.invoice_payload;

    // --- PACK PURCHASE (payload: pack_{packId}_{userId}_{timestamp}) ---
    if (payload.startsWith('pack_')) {
      console.log("🎁 Processing pack purchase payment...");
      const parts = payload.split('_');
      if (parts.length >= 4) {
        const packId = parseInt(parts[1]);
        try {
          const userResult = await db.query(
            'SELECT id, first_name FROM users WHERE telegram_id = $1',
            [msg.from.id.toString()]
          );
          if (userResult.rows.length === 0) {
            console.error('❌ User not found for telegram_id:', msg.from.id);
            return;
          }
          const internalUserId = userResult.rows[0].id;
          const { createPackHabitsForUser } = require('./controllers/specialHabitsController');
          await createPackHabitsForUser(internalUserId, packId, payment.telegram_payment_charge_id);
          console.log(`✅ Pack ${packId} payment processed for user ${internalUserId} (${userResult.rows[0].first_name})`);
        } catch (packErr) {
          console.error('❌ Error processing pack payment:', packErr);
        }
      } else {
        console.error('❌ Invalid pack payload in successful_payment:', payload);
      }
      return;
    }

    // --- SUBSCRIPTION PURCHASE ---
    const paymentData = {
      telegram_payment_charge_id: payment.telegram_payment_charge_id,
      provider_payment_charge_id: payment.provider_payment_charge_id,
      invoice_payload: payload,
      total_amount: payment.total_amount,
      currency: payment.currency,
      from_user_id: msg.from.id,
    };

    console.log("💰 Processing subscription payment through bot.on handler...");

    const result = await TelegramStarsService.processSuccessfulPayment(
      paymentData
    );

    if (result.success) {
      console.log("✅ Subscription payment processed successfully via bot.on");
    }
  }
});

// ОБРАБОТЧИК СООБЩЕНИЙ
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || '';
  
  // Пропускаем сообщения с successful_payment
  if (msg.successful_payment) {
    return;
  }
  // ============================================
  // 📢 ADMIN КОМАНДЫ
  // ============================================
  
  // Команда /broadcast
  if (text === '/broadcast') {
    if (!isAdmin(userId)) {
      await bot.sendMessage(chatId, '❌ У вас нет прав администратора');
      return;
    }
    
    broadcastState.set(userId, { step: 'waiting_message' });
    
    await bot.sendMessage(
      chatId,
      '📢 <b>Режим массовой рассылки</b>\n\n' +
      'Отправьте сообщение для рассылки всем пользователям.\n\n' +
      '💡 HTML форматирование:\n' +
      '• &lt;b&gt;жирный&lt;/b&gt;\n' +
      '• &lt;i&gt;курсив&lt;/i&gt;\n\n' +
      'Для отмены: /cancel',
      { parse_mode: 'HTML' }
    );
    
    return;
  }
  
  // Команда /cancel
  if (text === '/cancel') {
    if (isAdmin(userId) && broadcastState.has(userId)) {
      broadcastState.delete(userId);
      await bot.sendMessage(chatId, '❌ Рассылка отменена');
      return;
    }
  }
  
  // Команда /stats
  if (text === '/stats') {
    if (!isAdmin(userId)) {
      await bot.sendMessage(chatId, '❌ У вас нет прав администратора');
      return;
    }
    
    try {
      const totalUsers = await db.query('SELECT COUNT(*) FROM users');
      const premiumUsers = await db.query('SELECT COUNT(*) FROM users WHERE is_premium = true');
      const activeToday = await db.query(
        'SELECT COUNT(DISTINCT user_id) FROM habits WHERE created_at >= CURRENT_DATE'
      );
      
      await bot.sendMessage(
        chatId,
        `📊 <b>Статистика</b>\n\n` +
        `👥 Всего пользователей: ${totalUsers.rows[0].count}\n` +
        `💎 Premium: ${premiumUsers.rows[0].count}\n` +
        `🔥 Активных сегодня: ${activeToday.rows[0].count}`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      await bot.sendMessage(chatId, '❌ Ошибка получения статистики');
    }
    
    return;
  }
  
  // Обработка текста для рассылки
  if (broadcastState.has(userId)) {
    const state = broadcastState.get(userId);
    
    if (state.step === 'waiting_message') {
      state.message = text;
      state.step = 'confirm';
      
      await bot.sendMessage(
        chatId,
        '📢 <b>Предпросмотр:</b>\n\n' +
        '─────────────────\n' +
        text + '\n' +
        '─────────────────\n\n' +
        'Отправить всем?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Да, отправить', callback_data: 'broadcast_confirm' },
                { text: '❌ Отменить', callback_data: 'broadcast_cancel' }
              ]
            ]
          }
        }
      );
      
      return;
    }
  }
  console.log(`📨 NEW MESSAGE: "${text}" from ${chatId}`);

  if (text.startsWith('/start')) {
    console.log('👋 Processing /start command');
    
    try {
      // Извлекаем параметр после /start
      const params = text.split(' ');
      const startParam = params[1];
      
      console.log('🔍 Start command params:', { 
        fullText: text, 
        params, 
        startParam 
      });
      
      // Определяем язык для welcome message
      let userLanguage = 'en';
      const langCode = msg.from.language_code?.toLowerCase() || 'en';
      
      if (langCode === 'ru' || langCode.startsWith('ru-')) {
        userLanguage = 'ru';
      } else if (langCode === 'kk' || langCode === 'kz' || langCode.startsWith('kk-')) {
        userLanguage = 'kk';
      }
      
      console.log('🌍 User language detected:', userLanguage);
      
      // ОБРАБОТКА DEEP LINK - ПРИСОЕДИНЕНИЕ К ПРИВЫЧКЕ
      if (startParam && startParam.startsWith('join_')) {
        const shareCode = startParam;
        
        console.log('🔗 JOIN INVITATION DETECTED:', shareCode);
        
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
          
          const inviteMessages = {
            en: `🎉 <b>You've been invited!</b>\n\n${habitInfo.owner_name} wants you to join their habit:\n\n<b>"${habitInfo.title}"</b>\n📝 Goal: ${habitInfo.goal}\n\nOpen the app to join and start tracking together! 👇`,
            ru: `🎉 <b>Вас пригласили!</b>\n\n${habitInfo.owner_name} хочет, чтобы вы присоединились к привычке:\n\n<b>"${habitInfo.title}"</b>\n📝 Цель: ${habitInfo.goal}\n\nОткройте приложение, чтобы присоединиться и начать отслеживать вместе! 👇`,
            kk: `🎉 <b>Сізді шақырды!</b>\n\n${habitInfo.owner_name} сізді өз әдетіне қосылуға шақырады:\n\n<b>"${habitInfo.title}"</b>\n📝 Мақсат: ${habitInfo.goal}\n\nҚосылу және бірге бақылауды бастау үшін қосымшаны ашыңыз! 👇`
          };
          
          const webAppUrl = `${WEBAPP_URL}?action=join&code=${shareCode}`;
          
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
          return;
        } else {
          console.log('⚠️ Share code not found:', shareCode);
        }
      }
      
      // ОБЫЧНОЕ ПРИВЕТСТВИЕ
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
      
      const instructionsTexts = {
        en: '📖 Instructions',
        ru: '📖 Инструкция',
        kk: '📖 Нұсқаулық'
      };
      
      const welcomeMessage = welcomeMessages[userLanguage] || welcomeMessages['en'];
      const openAppText = openAppTexts[userLanguage] || openAppTexts['en'];
      const instructionsText = instructionsTexts[userLanguage] || instructionsTexts['en'];
      
      console.log('🔗 Sending button with URL:', WEBAPP_URL);
      
      await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { 
                text: openAppText, 
                web_app: { url: WEBAPP_URL }
              }
            ],
            [
              {
                text: instructionsText,
                callback_data: 'instr_main_menu'
              }
            ]
          ]
        }
      });
      
      console.log('✅ Welcome message sent with instructions button');
      
    } catch (error) {
      console.error('❌ /start error:', error);
      await bot.sendMessage(chatId, '❌ An error occurred. Please try again later.');
    }
    return;
  }

  // Команда /app для быстрого открытия приложения
  if (text === '/app') {
    console.log('📱 Processing /app command');
    
    try {
      const userResult = await db.query(
        'SELECT language FROM users WHERE telegram_id = $1',
        [chatId.toString()]
      );
      
      let userLanguage = 'en';
      
      if (userResult.rows.length > 0) {
        userLanguage = userResult.rows[0].language || 'en';
      } else {
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
              web_app: { url: WEBAPP_URL } 
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

  // Обработка других команд
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

// ОБРАБОТЧИК CALLBACK QUERY
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;
  const userId = callbackQuery.from.id;
  console.log("🔔 CALLBACK RECEIVED:", callbackQuery.data); // добавь это

  console.log(`📲 Callback received: ${data} from chat ${chatId}`);
// ============================================
  // 📢 BROADCAST CALLBACKS - ДОБАВЬТЕ ЭТО
  // ============================================
  
  // Подтверждение рассылки
  if (data === 'broadcast_confirm') {
    if (!isAdmin(userId)) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Недостаточно прав'
      });
      return;
    }
    
    const state = broadcastState.get(userId);
    
    if (!state || !state.message) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Сообщение не найдено'
      });
      return;
    }
    
    await bot.editMessageText('⏳ Начинаю рассылку...', {
      chat_id: chatId,
      message_id: messageId
    });
    
    try {
      const result = await sendBroadcast(state.message);
      
      broadcastState.delete(userId);
      
      await bot.editMessageText(
        `✅ <b>Готово!</b>\n\n` +
        `📊 Статистика:\n` +
        `• Всего: ${result.total}\n` +
        `• Отправлено: ${result.successCount}\n` +
        `• Ошибок: ${result.failCount}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML'
        }
      );
      
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `✅ Отправлено ${result.successCount} пользователям!`
      });
      
    } catch (error) {
      console.error('Broadcast error:', error);
      
      await bot.editMessageText('❌ Ошибка: ' + error.message, {
        chat_id: chatId,
        message_id: messageId
      });
      
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Ошибка рассылки'
      });
    }
    
    return;
  }
  
  // Отмена рассылки
  if (data === 'broadcast_cancel') {
    if (!isAdmin(userId)) {
      return;
    }
    
    broadcastState.delete(userId);
    
    await bot.editMessageText('❌ Рассылка отменена', {
      chat_id: chatId,
      message_id: messageId
    });
    
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: 'Отменено'
    });
    
    return;
  }
  // ========================================
  // ОБРАБОТКА ИНСТРУКЦИЙ
  // ========================================
  if (data.startsWith('instr_')) {
    try {
      // Получаем язык пользователя
      const userResult = await db.query(
        'SELECT language FROM users WHERE telegram_id = $1',
        [chatId.toString()]
      );
      
      let userLanguage = 'en';
      if (userResult.rows.length > 0) {
        userLanguage = userResult.rows[0].language || 'en';
      } else {
        const langCode = callbackQuery.from.language_code?.toLowerCase() || 'en';
        userLanguage = getUserLanguage(langCode);
      }

      // Главное меню инструкций
      if (data === 'instr_main_menu') {
        const menu = getInstructionsMainMenu(userLanguage);
        
        await bot.editMessageText(menu.text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: menu.keyboard
          }
        });
        
        await bot.answerCallbackQuery(callbackQuery.id);
        return;
      }

      // Конкретная страница инструкции
      const section = data.replace('instr_', '');
      const page = getInstructionPage(userLanguage, section);
      
      if (page) {
        await bot.editMessageText(page.text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: page.keyboard
          }
        });
        
        await bot.answerCallbackQuery(callbackQuery.id);
        return;
      }
      
    } catch (error) {
      console.error('❌ Instructions callback error:', error);
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: '❌ Error loading instructions'
      });
      return;
    }
  }
  // ========================================
  // КОНЕЦ ОБРАБОТКИ ИНСТРУКЦИЙ
  // ========================================

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

/** ---------- Автоматический запуск миграций ---------- */
async function runMigrations() {
  const fs   = require('fs');
  const path = require('path');
  const dir  = path.join(__dirname, 'migrations');

  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // 001_, 002_, 003_ … по порядку

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    try {
      await db.query(sql);
      console.log(`✅ Migration applied: ${file}`);
    } catch (err) {
      // Большинство миграций идемпотентны (IF NOT EXISTS), но логируем ошибки
      console.error(`⚠️  Migration ${file} error:`, err.message);
    }
  }
}

/** ---------- Запуск HTTP и установка webhook ---------- */
const server = app.listen(PORT, async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);

  // Применяем все миграции из папки migrations/
  await runMigrations();

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