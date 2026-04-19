const crypto = require('crypto');

const MAX_AUTH_AGE_SECONDS = 86400; // 24 часа

function isValidTelegramInitData(initData, botToken) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

    // Проверяем свежесть auth_date
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (!authDate || Math.floor(Date.now() / 1000) - authDate > MAX_AUTH_AGE_SECONDS) {
      console.warn('initData validation error: auth_date expired or missing');
      return false;
    }

    // Формируем data-check-string
    const entries = [];
    params.forEach((value, key) => {
      if (key !== 'hash') entries.push(`${key}=${value}`);
    });
    entries.sort();
    const dataCheckString = entries.join('\n');

    const secret = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const computedHash = crypto
      .createHmac('sha256', secret)
      .update(dataCheckString)
      .digest('hex');

    return computedHash === hash;
  } catch (e) {
    console.error('initData validation error:', e.message);
    return false;
  }
}

function validateTelegramWebAppData(req, res, next) {
  // Accept initData from body (auth) or header (other endpoints)
  const initData = req.body?.initData || req.headers['x-telegram-init-data'];

  if (!initData) {
    return res.status(400).json({ success: false, error: 'No init data provided' });
  }

  if (process.env.NODE_ENV === 'production') {
    const ok = isValidTelegramInitData(initData, process.env.BOT_TOKEN);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Invalid Telegram signature' });
    }
  }

  // Извлекаем user из (уже верифицированного в production) initData и устанавливаем req.user.
  // Это единственный доверенный источник telegram_id — body клиента доверять нельзя.
  let parsedUser = null;
  try {
    const params = new URLSearchParams(initData);
    const userParam = params.get('user');
    if (userParam) {
      const tgUser = JSON.parse(decodeURIComponent(userParam));
      if (tgUser && tgUser.id) {
        parsedUser = { telegram_id: String(tgUser.id), ...tgUser };
        req.user = parsedUser;
      }
    }
  } catch (e) {
    console.error('telegramAuth: failed to parse user from initData:', e.message);
  }

  // В production требуем верифицированного пользователя из initData.
  // Без этого нельзя продолжать — иначе контроллер откатится на body.user (auth bypass).
  if (process.env.NODE_ENV === 'production' && !parsedUser) {
    return res.status(401).json({ success: false, error: 'No verified Telegram user in initData' });
  }

  next();
}

module.exports = { validateTelegramWebAppData };