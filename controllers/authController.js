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
      let isNewUser = false;

      if (checkUser.rows.length === 0) {
        // НОВЫЙ ПОЛЬЗОВАТЕЛЬ - определяем язык по Telegram
        let initialLanguage = 'en'; // По умолчанию английский
        
        if (user.language_code) {
          const langCode = user.language_code.toLowerCase();
          console.log(`🌍 Telegram language code received: "${langCode}"`);
          
          // ИСПРАВЛЕННАЯ ЛОГИКА ОПРЕДЕЛЕНИЯ ЯЗЫКА
          if (langCode === 'kk' || langCode.startsWith('kk-') || langCode.startsWith('kk_') || 
              langCode === 'kz' || langCode.startsWith('kz-') || langCode.startsWith('kz_')) {
            // Казахский язык - сохраняем как 'kk'
            initialLanguage = 'kk';
            console.log('✅ Detected Kazakh language');
          } else if (langCode === 'ru' || langCode.startsWith('ru-') || langCode.startsWith('ru_')) {
            // Русский язык
            initialLanguage = 'ru';
            console.log('✅ Detected Russian language');
          } else if (langCode === 'en' || langCode.startsWith('en-') || langCode.startsWith('en_')) {
            // Английский язык
            initialLanguage = 'en';
            console.log('✅ Detected English language');
          } else {
            // Любой другой язык - используем английский по умолчанию
            initialLanguage = 'en';
            console.log(`🌍 Unknown language code "${langCode}", defaulting to English`);
          }
        } else {
          // Если language_code не передан - используем английский
          console.log('⚠️ No language_code provided, defaulting to English');
          initialLanguage = 'en';
        }
        
        console.log(`✅ Creating new user with language: ${initialLanguage} (from Telegram: ${user.language_code || 'not provided'})`);
        
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
            initialLanguage, // Устанавливаем определенный язык
            false,
            user.photo_url || null
          ]
        );

        userData = insertUser.rows[0];
        isNewUser = true;
        
        console.log(`✅ New user created:`, {
          id: userData.id,
          telegram_id: userData.telegram_id,
          language: userData.language,
          first_name: userData.first_name,
          telegram_language_code: user.language_code
        });
      } else {
        // СУЩЕСТВУЮЩИЙ ПОЛЬЗОВАТЕЛЬ
        // НЕ меняем язык! Используем сохраненный в БД
        userData = checkUser.rows[0];
        
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
          telegram_language: user.language_code
        });
      }

      // ВАЖНО: Всегда возвращаем язык пользователя из БД
      const responseData = {
        success: true,
        user: {
          id: userData.id,
          telegram_id: userData.telegram_id,
          username: userData.username,
          first_name: userData.first_name,
          last_name: userData.last_name,
          language: userData.language || 'en', // Гарантируем наличие языка
          is_premium: userData.is_premium,
          photo_url: userData.photo_url
        },
        isNewUser
      };
      
      console.log(`📤 Sending response with language: ${responseData.user.language}`);
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