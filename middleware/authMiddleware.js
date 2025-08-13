// middleware/authMiddleware.js
const db = require('../config/database');

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_SECRET = process.env.BOT_SECRET;

module.exports = async function authMiddleware(req, res, next) {
  try {
    const url = req.originalUrl || req.url; // полный путь (включая /api)
    const path = req.path;                  // путь без префикса родительского роутера

    // -------- 1) Пропуск Telegram Webhook по секрету --------
    // Поддерживаем оба варианта (с /api и без) из-за mounted router'ов
    const webhookPathFull = `/api/telegram/webhook/${BOT_TOKEN}`;
    const webhookPathTrim = `/telegram/webhook/${BOT_TOKEN}`;
    const isWebhookCall = url.startsWith(webhookPathFull) || path.startsWith(webhookPathTrim);

    if (isWebhookCall) {
      const secretHdr = req.get('x-telegram-bot-api-secret-token');
      if (!BOT_SECRET) {
        // Если по ошибке не задан секрет — лучше явно не пускать
        return res.status(401).json({ success: false, error: 'Webhook secret is not configured' });
      }
      if (secretHdr !== BOT_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized webhook' });
      }
      return next(); // секрет верный — пропускаем обновление к боту
    }

    // -------- 2) Остальные запросы: строгая аутентификация --------
    // В проде никаких обходов: нужен либо валидный userId (наш jwt/сессия/…),
    // либо валидные заголовки от Telegram WebApp (которые вы проверяете в других местах).
    const initData = req.headers['x-telegram-init-data'] || req.headers['telegram-init-data'];
    const userId   = req.headers['x-user-id'];

    // Быстрый путь: авторизация по userId (серверная доверенная сессия/токен вашего приложения)
    if (userId) {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (result.rows.length > 0) {
        req.user = result.rows[0];
        return next();
      }
      return res.status(401).json({ success: false, error: 'Invalid user' });
    }

    // В DEV/QA можно принять initData и создать/найти пользователя по telegram_id
    if (initData && process.env.NODE_ENV !== 'production') {
      try {
        const decoded = decodeURIComponent(initData);
        const m = decoded.match(/user=([^&]+)/);
        if (m) {
          const userJson = decodeURIComponent(m[1]);
          const tgUser = JSON.parse(userJson);

          // Ищем по telegram_id
          const existing = await db.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [String(tgUser.id)]
          );

          if (existing.rows.length > 0) {
            req.user = existing.rows[0];
            return next();
          }

          // Создаём пользователя на лету в деве
          const ins = await db.query(
            `INSERT INTO users (
               telegram_id, username, first_name, last_name,
               language, is_premium, photo_url
             ) VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [
              String(tgUser.id),
              tgUser.username || null,
              tgUser.first_name || '',
              tgUser.last_name || '',
              tgUser.language_code || 'en',
              Boolean(tgUser.is_premium),
              tgUser.photo_url || null,
            ]
          );
          req.user = ins.rows[0];
          return next();
        }
      } catch (e) {
        // Не палим детали в ответ — только логируем на сервере
        console.error('initData parse error:', e.message);
      }
    }

    // Прод: без валидной сессии — запрет
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please open the app through Telegram.',
    });
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
    });
  }
};