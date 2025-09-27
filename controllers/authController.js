// Обновите controllers/authController.js
const pool = require('../config/database');

const authController = {
  async telegramAuth(req, res) {
    console.log('🎯 authController.telegramAuth called');

    try {
      const { user, initData } = req.body;

      if (!user || !user.id) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user data'
        });
      }

      // Проверяем, существует ли пользователь
      const checkUser = await pool.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [user.id.toString()]
      );

      let userData;
      let isNewUser = false;

      if (checkUser.rows.length === 0) {
        // Определяем начальный язык для нового пользователя
        let initialLanguage = 'en';
        if (user.language_code) {
          if (user.language_code === 'ru') {
            initialLanguage = 'ru';
          } else if (user.language_code === 'kk' || user.language_code === 'kz') {
            initialLanguage = 'kk';
          }
        }
        
        console.log(`Creating new user with language: ${initialLanguage}`);
        
        // Создаем нового пользователя с языком
        const insertUser = await pool.query(
          `INSERT INTO users (
             telegram_id, username, first_name, last_name, language, is_premium, photo_url
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            user.id.toString(),
            user.username || null,
            user.first_name || '',
            user.last_name || '',
            initialLanguage, // Устанавливаем язык на основе Telegram
            false,
            user.photo_url || null
          ]
        );

        userData = insertUser.rows[0];
        isNewUser = true;
        
        console.log(`✅ New user created with language: ${userData.language}`);
      } else {
        // Для существующего пользователя обновляем данные, НО НЕ ЯЗЫК
        // Язык меняется только явно через настройки
        const updateUser = await pool.query(
          `UPDATE users SET
             username = $2,
             first_name = $3,
             last_name = $4,
             photo_url = $5
           WHERE telegram_id = $1
           RETURNING *`,
          [
            user.id.toString(),
            user.username || checkUser.rows[0].username,
            user.first_name || checkUser.rows[0].first_name,
            user.last_name || checkUser.rows[0].last_name,
            user.photo_url || checkUser.rows[0].photo_url
          ]
        );

        userData = updateUser.rows[0];
        
        console.log(`✅ User logged in with language: ${userData.language}`);
      }

      // ВАЖНО: Всегда возвращаем язык пользователя
      res.json({
        success: true,
        user: {
          ...userData,
          language: userData.language || 'en' // Гарантируем наличие языка
        },
        isNewUser
      });
    } catch (error) {
      console.error('💥 Auth error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined
      });
    }
  }
};

module.exports = authController;