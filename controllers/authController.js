const pool = require('../config/database');

const authController = {
  async telegramAuth(req, res) {
    console.log('🎯 authController.telegramAuth called');
    
    try {
      const { user, initData } = req.body;
      
      console.log('Auth request:', {
        hasUser: !!user,
        hasInitData: !!initData,
        userData: user
      });
      
      if (!user || !user.id) {
        console.error('❌ No user data provided');
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

      console.log('Existing user check:', {
        telegramId: user.id.toString(),
        found: checkUser.rows.length > 0
      });

      let userData;
      let isNewUser = false;

      if (checkUser.rows.length === 0) {
        // Создаем нового пользователя
        console.log('📝 Creating new user');
        
        const insertUser = await pool.query(
          `INSERT INTO users (
            telegram_id, 
            username, 
            first_name, 
            last_name, 
            language, 
            is_premium,
            photo_url
          ) VALUES ($1, $2, $3, $4, $5, $6, $7) 
          RETURNING *`,
          [
            user.id.toString(),
            user.username || null,
            user.first_name || '',
            user.last_name || '',
            user.language_code || 'en',
            user.is_premium || false,
            user.photo_url || null
          ]
        );
        
        userData = insertUser.rows[0];
        isNewUser = true;
        console.log('✅ New user created:', userData.id);
      } else {
        // Обновляем существующего пользователя
        console.log('📝 Updating existing user');
        
        const updateUser = await pool.query(
          `UPDATE users SET 
            username = $2,
            first_name = $3,
            last_name = $4,
            language = $5,
            is_premium = $6,
            photo_url = $7
          WHERE telegram_id = $1
          RETURNING *`,
          [
            user.id.toString(),
            user.username || checkUser.rows[0].username,
            user.first_name || checkUser.rows[0].first_name,
            user.last_name || checkUser.rows[0].last_name,
            user.language_code || checkUser.rows[0].language || 'en',
            user.is_premium !== undefined ? user.is_premium : checkUser.rows[0].is_premium,
            user.photo_url || checkUser.rows[0].photo_url
          ]
        );
        
        userData = updateUser.rows[0];
        console.log('✅ User updated:', userData.id);
      }

      res.json({
        success: true,
        user: userData,
        isNewUser: isNewUser
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