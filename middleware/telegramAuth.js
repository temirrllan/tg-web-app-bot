const crypto = require('crypto');

function isValidTelegramInitData(initData, botToken) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

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
  const { initData } = req.body;

  if (!initData) {
    return res.status(400).json({ success: false, error: 'No init data provided' });
  }

  if (process.env.NODE_ENV === 'production') {
    const ok = isValidTelegramInitData(initData, process.env.BOT_TOKEN);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Invalid Telegram signature' });
    }
  }

  next();
}

module.exports = { validateTelegramWebAppData };
