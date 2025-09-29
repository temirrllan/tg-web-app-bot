const pool = require('../config/database');

const authController = {
  async telegramAuth(req, res) {
    console.log('🎯 authController.telegramAuth called');
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));

    try {
      const { user, initData } = req.body;

      if (!user || !user.id) {
        return res.status(400).json({
          success: false,
          error: 'Invalid user data'
        });
      }

      console.log('👤 User data received:', {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        language_code: user.language_code,
        is_premium: user.is_premium
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
        let initialLanguage = 'en'; // По умолчанию ВСЕГДА английский
        
        console.log(`🔍 Detecting language from Telegram language_code: "${user.language_code}"`);
        
        if (user.language_code) {
          const langCode = String(user.language_code).toLowerCase().trim();
          console.log(`📝 Processing language code: "${langCode}"`);
          
          // ИСПРАВЛЕНИЕ: Более точное определение языка
          // Проверяем точное совпадение или начало строки
          if (langCode === 'ru' || langCode.startsWith('ru-') || langCode.startsWith('ru_')) {
            initialLanguage = 'ru';
            console.log('🇷🇺 Detected Russian');
          } else if (langCode === 'kk' || langCode === 'kz' || langCode.startsWith('kk-') || langCode.startsWith('kz-') || langCode.startsWith('kk_') || langCode.startsWith('kz_')) {
            initialLanguage = 'kk';
            console.log('🇰🇿 Detected Kazakh');
          } else if (langCode === 'en' || langCode.startsWith('en-') || langCode.startsWith('en_')) {
            // ВАЖНО: Явно проверяем английский
            initialLanguage = 'en';
            console.log('🇬🇧 Detected English explicitly');
          } else {
            // Для ЛЮБОГО другого языка используем английский как дефолт
            initialLanguage = 'en';
            console.log(`🌍 Language "${langCode}" not in supported list (ru, kk, en), using English as default`);
          }
        } else {
          // Если language_code вообще не передан - используем английский
          console.log('⚠️ No language_code provided, using English as default');
          initialLanguage = 'en';
        }
        
        console.log(`✅ Final language for new user: ${initialLanguage}`);
        
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
          username: userData.username,
          is_new_user: isNewUser
        });
      } else {
        // СУЩЕСТВУЮЩИЙ ПОЛЬЗОВАТЕЛЬ
        // НЕ меняем язык! Используем сохраненный в БД
        userData = checkUser.rows[0];
        
        console.log(`👤 Existing user found:`, {
          id: userData.id,
          telegram_id: userData.telegram_id,
          saved_language: userData.language,
          telegram_language: user.language_code,
          note: 'Using saved language from DB, NOT from Telegram'
        });
        
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
        
        console.log(`✅ User data updated (language unchanged): ${userData.language}`);
      }

      // Проверяем, что язык корректный
      if (!userData.language || !['en', 'ru', 'kk'].includes(userData.language)) {
        console.log(`⚠️ Invalid language in DB: "${userData.language}", setting to "en"`);
        
        // Исправляем некорректный язык на английский
        const fixLanguage = await pool.query(
          'UPDATE users SET language = $1 WHERE id = $2 RETURNING language',
          ['en', userData.id]
        );
        
        userData.language = 'en';
        console.log('✅ Language fixed to "en"');
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
          language: userData.language, // Язык из БД
          is_premium: userData.is_premium,
          photo_url: userData.photo_url
        },
        isNewUser
      };
      
      console.log(`📤 Sending response with language: "${responseData.user.language}" (isNewUser: ${isNewUser})`);
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