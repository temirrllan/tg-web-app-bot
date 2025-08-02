const crypto = require('crypto');

function validateTelegramWebAppData(req, res, next) {
  const { initData } = req.body;
  
  if (!initData) {
    return res.status(400).json({ error: 'No init data provided' });
  }

  // В продакшене обязательно проверяйте подпись!
  // Для разработки можно временно пропустить
  
  // TODO: Implement proper validation
  // const BOT_TOKEN = process.env.BOT_TOKEN;
  // const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  // const hash = crypto.createHmac('sha256', secret).update(initData).digest('hex');
  
  next();
}

module.exports = { validateTelegramWebAppData };