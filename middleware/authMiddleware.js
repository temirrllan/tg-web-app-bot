// middleware/authMiddleware.js - ИСПРАВЛЕННАЯ ВЕРСИЯ

const db = require('../config/database');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_SECRET = process.env.BOT_SECRET;

/**
 * Проверка подписи Telegram WebApp initData
 */
function verifyTelegramWebAppData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    
    if (!hash) {
      console.warn('⚠️ No hash in initData');
      return false;
    }

    // Формируем data-check-string
    const dataCheckArray = [];
    params.forEach((value, key) => {
      if (key !== 'hash') {
        dataCheckArray.push(`${key}=${value}`);
      }
    });
    dataCheckArray.sort();
    const dataCheckString = dataCheckArray.join('\n');

    // Вычисляем секретный ключ
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    // Вычисляем hash
    const computedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return computedHash === hash;
  } catch (error) {
    console.error('❌ Error verifying initData:', error);
    return false;
  }
}

module.exports = async function authMiddleware(req, res, next) {
  try {
    const url = req.originalUrl || req.url;
    const path = req.path;

    // -------- 1) Пропуск Telegram Webhook --------
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

    // -------- 2) Пропускаем /auth/telegram - НЕ создаем пользователя здесь! --------
    if (path === '/api/auth/telegram') {
      console.log('⏭️ Skipping middleware for /auth/telegram - will be handled by authController');
      return next();
    }

    // -------- 3) Авторизация по userId (для остальных эндпоинтов) --------
    const userId = req.headers['x-user-id'];
    
    if (userId) {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
      if (result.rows.length > 0) {
        req.user = result.rows[0];
        console.log('✅ Auth by userId:', userId);
        return next();
      }
      return res.status(401).json({ success: false, error: 'Invalid user' });
    }

    // -------- 4) Обработка initData (для остальных эндпоинтов) --------
    const initData = req.headers['x-telegram-init-data'] || req.headers['telegram-init-data'];
    const isProduction = process.env.NODE_ENV === 'production';
    
    console.log('🔍 Auth check:', {
      hasInitData: !!initData,
      initDataLength: initData?.length || 0,
      isProduction,
      url: req.url
    });

    // 🔥 В production БЕЗ initData - блокируем
    if (!initData || initData === 'development') {
      if (isProduction) {
        console.error('❌ No initData in production mode');
        return res.status(401).json({
          success: false,
          error: 'Authentication required. Please open the app through Telegram bot.'
        });
      }
      
      // Development mode
      console.log('⚠️ Development mode: allowing without initData');
      return next();
    }

    // -------- 5) Проверка подписи (только в production) --------
    if (isProduction) {
      const isValid = verifyTelegramWebAppData(initData);
      
      if (!isValid) {
        console.error('❌ Invalid Telegram signature');
        return res.status(403).json({
          success: false,
          error: 'Invalid Telegram signature'
        });
      }
      
      console.log('✅ Telegram signature verified');
    }

    // -------- 6) Извлечение данных пользователя --------
    try {
      const decoded = decodeURIComponent(initData);
      console.log('📝 InitData decoded, length:', decoded.length);
      
      // Извлекаем user
      const userMatch = decoded.match(/user=([^&]+)/);
      
      if (!userMatch) {
        console.error('❌ No user data in initData');
        console.log('InitData content:', decoded.substring(0, 200));
        
        return res.status(401).json({
          success: false,
          error: 'No user data in authentication'
        });
      }
      
      const userJson = decodeURIComponent(userMatch[1]);
      const tgUser = JSON.parse(userJson);
      
      console.log('👤 Telegram user extracted:', {
        id: tgUser.id,
        first_name: tgUser.first_name,
        username: tgUser.username
      });
      
      // -------- 7) Поиск пользователя (НЕ создаем!) --------
      const existing = await db.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [String(tgUser.id)]
      );

      if (existing.rows.length > 0) {
        req.user = existing.rows[0];
        console.log('✅ Existing user found:', req.user.id);
        return next();
      }

      // ❌ Пользователь не найден - возвращаем ошибку
      // Пусть фронт отправит запрос на /auth/telegram для регистрации
      console.log('⚠️ User not found, needs registration');
      return res.status(401).json({
        success: false,
        error: 'User not found. Please authenticate first.',
        needsRegistration: true
      });
      
    } catch (parseError) {
      console.error('❌ Error parsing initData:', parseError);
      console.error('ParseError stack:', parseError.stack);
      
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication data format'
      });
    }

  } catch (err) {
    console.error('💥 Auth middleware error:', err);
    console.error('Error stack:', err.stack);
    
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
    });
  }
}