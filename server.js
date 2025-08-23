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

  if (text === '/start') {
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
    return;
  }

  if (text === '📊 Мои привычки') {
    await bot.sendMessage(chatId, 'Откройте приложение для просмотра ваших привычек:', {
      reply_markup: {
        inline_keyboard: [[{
          text: '📱 Открыть приложение',
          web_app: { url: WEBAPP_URL }
        }]]
      }
    });
    return;
  }

  if (text === 'ℹ️ Информация о боте' || text === 'Получите информацию о бота') {
    await bot.sendMessage(
      chatId,
      '*Habit Tracker Bot* 🤖\n\n' +
      'Этот бот поможет вам:\n' +
      '• ✅ Создавать и отслеживать привычки\n' +
      '• 📅 Устанавливать расписание\n' +
      '• 🔔 Получать напоминания\n' +
      '• 📊 Следить за прогрессом\n' +
      '• 🔥 Поддерживать мотивацию\n\n' +
      'Нажмите кнопку "Открыть Habit Tracker" для начала работы!',
      { parse_mode: 'Markdown' }
    );
    return;
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