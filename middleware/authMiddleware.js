// middleware/authMiddleware.js

const db = require('../config/database');

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_SECRET = process.env.BOT_SECRET;

module.exports = async function authMiddleware(req, res, next) {
  try {
    const url = req.originalUrl || req.url;
    const path = req.path;

    // -------- 1) Пропуск Telegram Webhook по секрету --------
    const webhookPathFull = `/api/telegram/webhook/${BOT_TOKEN}`;
    const webhookPathTrim = `/telegram/webhook/${BOT_TOKEN}`;
    const isWebhookCall = url.startsWith(webhookPathFull) || path.startsWith(webhookPathTrim);

    if (isWebhookCall) {
      const secretHdr = req.get('x-telegram-bot-api-secret-token');
      if (!BOT_SECRET) {
        return res.status(401).json({ success: false, error: 'Webhook secret is not configured' });
      }
      if (secretHdr !== BOT_SECRET) {
        return res.status(401).json({ success: false, error: 'Unauthorized webhook' });
      }
      return next();
    }

    // -------- 2) Авторизация по userId (сессия/токен) --------
    const userId = req.headers['x-user-id'];
    
    if (userId) {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (result.rows.length > 0) {
        req.user = result.rows[0];
        return next();
      }
      return res.status(401).json({ success: false, error: 'Invalid user' });
    }

    // -------- 3) Обработка initData --------
    const initData = req.headers['x-telegram-init-data'] || req.headers['telegram-init-data'];
    
    if (!initData || initData === 'development') {
      // 🔥 КРИТИЧНО: В production без initData - блокируем
      const isProduction = process.env.NODE_ENV === 'production';
      
      if (isProduction) {
        console.error('❌ No initData in production mode');
        return res.status(401).json({
          success: false,
          error: 'Authentication required. Please open the app through Telegram.'
        });
      }
      
      // В development разрешаем без initData
      console.log('⚠️ Development mode: allowing request without initData');
      return next();
    }

    // -------- 4) Парсинг и обработка initData --------
    try {
      const decoded = decodeURIComponent(initData);
      console.log('🔍 Decoded initData:', decoded);
      
      // Извлекаем user данные
      const userMatch = decoded.match(/user=([^&]+)/);
      
      if (!userMatch) {
        console.error('❌ No user data in initData');
        return res.status(401).json({
          success: false,
          error: 'Invalid authentication data'
        });
      }
      
      const userJson = decodeURIComponent(userMatch[1]);
      const tgUser = JSON.parse(userJson);
      
      console.log('👤 Telegram user:', {
        id: tgUser.id,
        first_name: tgUser.first_name,
        username: tgUser.username
      });
      
      // -------- 5) Поиск или создание пользователя --------
      const existing = await db.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [String(tgUser.id)]
      );

      if (existing.rows.length > 0) {
        req.user = existing.rows[0];
        console.log('✅ Existing user found:', req.user.id);
        return next();
      }

      // 🆕 Создаём нового пользователя
      console.log('🆕 Creating new user from initData');
      
      // Определяем язык
      let language = 'en';
      if (tgUser.language_code) {
        const langCode = tgUser.language_code.toLowerCase();
        if (langCode === 'ru' || langCode.startsWith('ru-')) {
          language = 'ru';
        } else if (langCode === 'kk' || langCode === 'kz' || langCode.startsWith('kk-')) {
          language = 'kk';
        }
      }
      
      const insertResult = await db.query(
        `INSERT INTO users (
           telegram_id, username, first_name, last_name,
           language, is_premium, photo_url
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          String(tgUser.id),
          tgUser.username || null,
          tgUser.first_name || '',
          tgUser.last_name || '',
          language,
          Boolean(tgUser.is_premium),
          tgUser.photo_url || null,
        ]
      );
      
      req.user = insertResult.rows[0];
      console.log('✅ New user created:', req.user.id);
      return next();
      
    } catch (parseError) {
      console.error('❌ Error parsing initData:', parseError);
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication data format'
      });
    }

  } catch (err) {
    console.error('💥 Auth middleware error:', err);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
    });
  }
};