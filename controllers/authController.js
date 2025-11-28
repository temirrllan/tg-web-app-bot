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
      let isNewUser = false; // ✅ ВАЖНО: Инициализируем здесь явно

      if (checkUser.rows.length === 0) {
        // НОВЫЙ ПОЛЬЗОВАТЕЛЬ - определяем язык по Telegram
        let initialLanguage = 'en'; // По умолчанию английский
        
        if (user.language_code) {
          const langCode = user.language_code.toLowerCase().trim();
          console.log(`🌍 Telegram language code received: "${langCode}"`);
          
          // Проверка на казахский
          if (langCode === 'kk' || langCode === 'kz' || 
              langCode.startsWith('kk-') || langCode.startsWith('kk_') ||
              langCode.startsWith('kz-') || langCode.startsWith('kz_')) {
            initialLanguage = 'kk';
            console.log('✅ Detected Kazakh language');
          }
          // Проверка на русский
          else if (langCode === 'ru' || 
                   langCode.startsWith('ru-') || langCode.startsWith('ru_')) {
            initialLanguage = 'ru';
            console.log('✅ Detected Russian language');
          }
          // Проверка на английский
          else if (langCode === 'en' || 
                   langCode.startsWith('en-') || langCode.startsWith('en_')) {
            initialLanguage = 'en';
            console.log('✅ Detected English language');
          }
          // Любой другой язык - английский по умолчанию
          else {
            initialLanguage = 'en';
            console.log(`⚠️ Unknown language code "${langCode}", defaulting to English`);
          }
          
          console.log(`📌 Final decision: language_code="${langCode}" → language="${initialLanguage}"`);
        } else {
          console.log('⚠️ No language_code provided, defaulting to English');
          initialLanguage = 'en';
        }
        
        // Дополнительная проверка перед сохранением
        if (!['en', 'ru', 'kk'].includes(initialLanguage)) {
          console.error(`❌ Invalid language "${initialLanguage}" detected, forcing English`);
          initialLanguage = 'en';
        }
        
        console.log(`✅ Creating new user with language: ${initialLanguage}`);
        
        // Создаем нового пользователя с определенным языком
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
        isNewUser = true; // ✅ Это новый пользователь
        
        console.log(`✅ New user created:`, {
          id: userData.id,
          telegram_id: userData.telegram_id,
          language: userData.language,
          first_name: userData.first_name,
          isNewUser: true // ✅ Логируем
        });
        
      } else {
        // СУЩЕСТВУЮЩИЙ ПОЛЬЗОВАТЕЛЬ
        userData = checkUser.rows[0];
        isNewUser = false; // ✅ ВАЖНО: Явно указываем false
        
        // Обновляем только базовые данные (НЕ язык!)
        const updateUser = await pool.query(
          `UPDATE users SET
             username = COALESCE($2, username),
             first_name = COALESCE($3, first_name),
             last_name = COALESCE($4, last_name),
             photo_url = COALESCE($5, photo_url)
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
          saved_language: userData.language,
          telegram_language: user.language_code,
          isNewUser: false // ✅ Логируем
        });
      }

      // ВАЖНО: Проверяем корректность языка перед отправкой
      if (!userData.language || !['en', 'ru', 'kk'].includes(userData.language)) {
        console.error(`❌ Invalid language in DB: "${userData.language}", forcing English`);
        userData.language = 'en';
        
        await pool.query(
          'UPDATE users SET language = $1 WHERE id = $2',
          ['en', userData.id]
        );
      }

      // ВАЖНО: Всегда возвращаем язык пользователя из БД И флаг isNewUser
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
        isNewUser // ✅ КРИТИЧЕСКИ ВАЖНО: Возвращаем флаг
      };
      
      console.log(`📤 Sending response:`, {
        userId: responseData.user.id,
        language: responseData.user.language,
        isNewUser: responseData.isNewUser // ✅ Логируем
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