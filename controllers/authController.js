// controllers/authController.js - ИСПРАВЛЕННАЯ ВЕРСИЯ

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

      console.log('User data received:', {
        id: user.id,
        username: user.username,
        language_code: user.language_code,
        first_name: user.first_name
      });

      // Проверяем, существует ли пользователь
      const checkUser = await pool.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [user.id.toString()]
      );

      let userData;
      let isNewUser = false; // ✅ По умолчанию false

      if (checkUser.rows.length === 0) {
        // 🆕 НОВЫЙ ПОЛЬЗОВАТЕЛЬ
        console.log('🆕 Creating NEW user');
        
        let initialLanguage = 'en';
        
        if (user.language_code) {
          const langCode = user.language_code.toLowerCase().trim();
          console.log(`🌍 Telegram language code received: "${langCode}"`);
          
          if (langCode === 'kk' || langCode === 'kz' || 
              langCode.startsWith('kk-') || langCode.startsWith('kk_') ||
              langCode.startsWith('kz-') || langCode.startsWith('kz_')) {
            initialLanguage = 'kk';
          }
          else if (langCode === 'ru' || langCode.startsWith('ru-') || langCode.startsWith('ru_')) {
            initialLanguage = 'ru';
          }
          else if (langCode === 'en' || langCode.startsWith('en-') || langCode.startsWith('en_')) {
            initialLanguage = 'en';
          }
          else {
            initialLanguage = 'en';
          }
        }
        
        // Создаем нового пользователя
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
            initialLanguage,
            false,
            user.photo_url || null
          ]
        );

        userData = insertUser.rows[0];
        isNewUser = true; // ✅ КРИТИЧНО: Это НОВЫЙ пользователь
        
        console.log(`✅ New user created:`, {
          id: userData.id,
          telegram_id: userData.telegram_id,
          language: userData.language,
          first_name: userData.first_name,
          isNewUser: true
        });
        
      } else {
        // 👤 СУЩЕСТВУЮЩИЙ ПОЛЬЗОВАТЕЛЬ
        console.log('👤 Existing user found');
        userData = checkUser.rows[0];
        isNewUser = false; // ✅ КРИТИЧНО: Это НЕ новый пользователь
        
        // Обновляем только базовые данные (НЕ язык!)
        const updateUser = await pool.query(
          `UPDATE users SET
             username = COALESCE($2, username),
             first_name = COALESCE($3, first_name),
             last_name = COALESCE($4, last_name),
             photo_url = COALESCE($5, photo_url),
             last_login = CURRENT_TIMESTAMP
           WHERE telegram_id = $1
           RETURNING *`,
          [
            user.id.toString(),
            user.username,
            user.first_name,
            user.last_name,
            user.photo_url
          ]
        );

        userData = updateUser.rows[0];
        
        console.log(`✅ Existing user logged in:`, {
          id: userData.id,
          telegram_id: userData.telegram_id,
          language: userData.language,
          isNewUser: false // ✅ Логируем что это НЕ новый
        });
      }

      // Проверяем корректность языка
      if (!userData.language || !['en', 'ru', 'kk'].includes(userData.language)) {
        console.error(`❌ Invalid language in DB: "${userData.language}", forcing English`);
        userData.language = 'en';
        
        await pool.query(
          'UPDATE users SET language = $1 WHERE id = $2',
          ['en', userData.id]
        );
      }

      // ✅ ВОЗВРАЩАЕМ ПРАВИЛЬНЫЙ ФЛАГ
      const responseData = {
        success: true,
        user: {
          id: userData.id,
          telegram_id: userData.telegram_id,
          username: userData.username,
          first_name: userData.first_name,
          last_name: userData.last_name,
          language: userData.language,
          is_premium: userData.is_premium,
          photo_url: userData.photo_url
        },
        isNewUser // ✅ true только для СОВСЕМ новых пользователей
      };
      
      console.log(`📤 Sending response:`, {
        userId: responseData.user.id,
        language: responseData.user.language,
        isNewUser: responseData.isNewUser
      });
      
      res.json(responseData);
      
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