require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const logger = require('./middleware/logger');
const authRoutes = require('./routes/authRoutes');
const habitRoutes = require('./routes/habitRoutes');
const { generalLimiter } = require('./middleware/rateLimit');

const app = express();
const PORT = process.env.PORT || 3001;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://eventmate.asia';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не найден в переменных окружения!');
  process.exit(1);
}

// доверяем реальным IP за Nginx (исправляет express-rate-limit и пр.)
app.set('trust proxy', 1);

// базовые миддлы
app.use(cors({
  origin: [
    'https://eventmate.asia',
    'https://web.telegram.org',
    'http://localhost:5173',
    'http://localhost:5174',
    'https://lighthearted-phoenix-e42a4f.netlify.app'
  ],
  credentials: true
}));
app.use(express.json());
app.use(logger);

// ====== TELEGRAM: webhook вместо polling ======
console.log('\n🤖 Запуск Telegram бота (webhook)...');
const bot = new TelegramBot(BOT_TOKEN);

// вебхук-роут ОБЯЗАТЕЛЬНО до rate limiter
app.post('/api/bot/webhook', (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook process error:', e);
    res.sendStatus(500);
  }
});

// ====== API ======

// health
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

// rate limiter СТАВИМ ПОСЛЕ webhook, чтобы не блокировать Telegram
app.use(generalLimiter);

// остальная API
app.use('/api/auth', authRoutes);
app.use('/api', habitRoutes);

// debug (dev only)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/users', async (req, res) => {
    try {
      const pool = require('./config/database');
      const users = await pool.query(
        'SELECT id, telegram_id, username, first_name, created_at FROM users ORDER BY created_at DESC LIMIT 10'
      );
      res.json({ success: true, count: users.rows.length, users: users.rows });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

// 404
app.use((req, res) => {
  console.log(`❌ 404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({ success: false, error: 'Route not found' });
});

// errors
app.use((err, req, res, next) => {
  console.error('💥 Server error:', err.stack);
  res.status(500).json({
    success: false,
    error: 'Something went wrong!',
    details: process.env.NODE_ENV !== 'production' ? err.message : undefined
  });
});

// старт сервера
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
});

// ====== Обработчики бота (без polling) ======
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '/start') {
    await bot.sendMessage(chatId, 'Добро пожаловать в Habit Tracker! 🎯\n\nИспользуйте кнопки ниже для навигации:', {
      reply_markup: {
        keyboard: [
          [{ text: '📊 Мои привычки' }],
          [{ text: 'ℹ️ Информация о боте' }],
          [{ text: '⚙️ Настройки' }]
        ],
        resize_keyboard: true
      }
    });

    await bot.sendMessage(chatId, 'Откройте приложение для управления привычками:', {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📱 Открыть Habit Tracker',
            web_app: { url: WEBAPP_URL }
          }]
        ]
      }
    });
  }

  if (text === '📊 Мои привычки') {
    await bot.sendMessage(chatId, 'Откройте приложение для просмотра ваших привычек:', {
      reply_markup: {
        inline_keyboard: [
          [{
            text: '📱 Открыть приложение',
            web_app: { url: WEBAPP_URL }
          }]
        ]
      }
    });
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
          inline_keyboard: [
            [{
              text: '⚙️ Открыть настройки',
              web_app: { url: `${WEBAPP_URL}#settings` }
            }]
          ]
        }
      }
    );
  }
});

bot.on('callback_query', async (callbackQuery) => {
  await bot.answerCallbackQuery(callbackQuery.id);
});

// graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
