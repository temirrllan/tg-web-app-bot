require('dotenv').config();
const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const logger = require('./middleware/logger');
const authRoutes = require('./routes/authRoutes');
const habitRoutes = require('./routes/habitRoutes');
const { generalLimiter } = require('./middleware/rateLimit');

// ========== КОНФИГУРАЦИЯ ==========
const app = express();
const PORT = process.env.PORT || 3001;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

// Проверка наличия токена
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не найден в переменных окружения!');
  process.exit(1);
}

// ========== API СЕРВЕР ==========
// Middleware
app.use(cors({
  origin: [
    'https://lighthearted-phoenix-e42a4f.netlify.app',
    'http://localhost:5173',
    'http://localhost:5174',
    'https://web.telegram.org'
  ],
  credentials: true
}));

app.use(express.json());
app.use(logger);
app.use(generalLimiter);

// Health check endpoint
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

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', habitRoutes);

// Debug endpoint (только для разработки)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/users', async (req, res) => {
    try {
      const pool = require('./config/database');
      const users = await pool.query(
        'SELECT id, telegram_id, username, first_name, created_at FROM users ORDER BY created_at DESC LIMIT 10'
      );
      
      res.json({
        success: true,
        count: users.rows.length,
        users: users.rows
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });
}

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('💥 Server error:', err.stack);
  res.status(500).json({
    success: false,
    error: 'Something went wrong!',
    details: process.env.NODE_ENV !== 'production' ? err.message : undefined
  });
});

// Запуск API сервера
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);
});

// ========== TELEGRAM БОТ ==========
console.log('\n🤖 Запуск Telegram бота...');

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Обработчики команд бота
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
            web_app: { url: WEBAPP_URL || 'https://lighthearted-phoenix-e42a4f.netlify.app' } 
          }]
        ]
      }
    });
  }

  // Обработка кнопок
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
    await bot.sendMessage(chatId, 
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
    await bot.sendMessage(chatId, 
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

// Обработка callback запросов (для будущих функций)
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  // Подтверждаем получение callback
  await bot.answerCallbackQuery(callbackQuery.id);

  // Здесь можно добавить обработку inline кнопок
});

console.log('✅ Telegram бот успешно запущен!');
console.log('\n-------------------------------------------\n');

// ========== GRACEFUL SHUTDOWN ==========
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    bot.stopPolling();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    bot.stopPolling();
    process.exit(0);
  });
});