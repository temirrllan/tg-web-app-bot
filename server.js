require('dotenv').config();

const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const logger = require('./middleware/logger');
const authRoutes = require('./routes/authRoutes');
const habitRoutes = require('./routes/habitRoutes');
const { generalLimiter } = require('./middleware/rateLimit');

const app = express();

const PORT = Number(process.env.PORT || 3001);
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://eventmate.asia';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не найден в переменных окружения!');
  process.exit(1);
}

/** ВАЖНО: чтобы rate-limit и IP работали за nginx */
app.set('trust proxy', 1);

app.use(cors({
  origin: [
    'https://eventmate.asia',
    'https://web.telegram.org',
    'http://localhost:5173',
    'http://localhost:5174'
  ],
  credentials: true
}));

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

/** единый путь webhook — включаем токен в путь, чтобы никто не угадал его случайно */
const WEBHOOK_PATH = `/api/telegram/webhook/${BOT_TOKEN}`;
/** публичный URL (за nginx) */
const PUBLIC_BASE = 'https://eventmate.asia';
const WEBHOOK_URL = `${PUBLIC_BASE}${WEBHOOK_PATH}`;

/** endpoint, который будет вызываться Telegram */
app.post(WEBHOOK_PATH, (req, res) => {
  try {
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
        inline_keyboard: [
          [{
            text: '📱 Открыть Habit Tracker',
            web_app: { url: WEBAPP_URL }
          }]
        ]
      }
    });
    return;
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

/** ---------- Запуск HTTP и установка webhook ---------- */
const server = app.listen(PORT, async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API URL: http://localhost:${PORT}/api`);

  try {
    // сбрасываем старый polling/hook (на всякий)
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
    // ставим новый webhook
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: WEBHOOK_URL, drop_pending_updates: true })
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`✅ Webhook установлен: ${WEBHOOK_URL}`);
    } else {
      console.error('❌ Не удалось установить webhook:', data);
    }
  } catch (e) {
    console.error('❌ Ошибка установки webhook:', e);
  }
});

/** Грейсфул шатдаун */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => process.exit(0));
});
