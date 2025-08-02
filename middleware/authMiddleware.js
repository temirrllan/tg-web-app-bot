
const db = require('../config/database');

const authMiddleware = async (req, res, next) => {
  console.log('🔐 Auth middleware called for:', req.path);
  
  try {
    // Пропускаем для эндпоинта категорий (временно для отладки)
    if (req.path === '/categories' && req.method === 'GET') {
      console.log('⚡ Skipping auth for categories endpoint');
      return next();
    }

    const initData = req.headers['x-telegram-init-data'];
    const userId = req.headers['x-user-id'];
    
    console.log('Auth headers:', { 
      hasInitData: !!initData, 
      userId,
      origin: req.headers.origin 
    });
    
    // Проверяем, есть ли user_id в заголовках
    if (userId) {
      const result = await db.query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
      
      if (result.rows.length > 0) {
        req.user = result.rows[0];
        console.log('✅ User authenticated by ID:', req.user.id, req.user.username);
        return next();
      }
    }
    
    // Для разработки: парсим initData чтобы получить данные пользователя
    if (initData && process.env.NODE_ENV !== 'production') {
      try {
        // Декодируем initData
        const decodedData = decodeURIComponent(initData);
        console.log('Decoded initData:', decodedData);
        
        // Извлекаем user из initData
        const userMatch = decodedData.match(/user=([^&]+)/);
        if (userMatch) {
          const userJson = decodeURIComponent(userMatch[1]);
          const userData = JSON.parse(userJson);
          
          console.log('Extracted user data:', userData);
          
          // Проверяем, есть ли пользователь в БД по telegram_id
          const existingUser = await db.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [userData.id.toString()]
          );
          
          if (existingUser.rows.length > 0) {
            req.user = existingUser.rows[0];
            console.log('✅ Existing user found:', req.user.id);
          } else {
            console.log('📝 Creating new user from Telegram data');
            
            // Создаем нового пользователя
            const newUser = await db.query(
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
                userData.id.toString(),
                userData.username || null,
                userData.first_name || '',
                userData.last_name || '',
                userData.language_code || 'en',
                userData.is_premium || false,
                userData.photo_url || null
              ]
            );
            
            req.user = newUser.rows[0];
            console.log('✅ New user created:', req.user.id);
          }
          
          return next();
        }
      } catch (error) {
        console.error('Error parsing initData:', error);
      }
    }
    
    console.log('❌ Authentication failed - no valid user data');
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required. Please open the app through Telegram.' 
    });
    
  } catch (error) {
    console.error('💥 Auth middleware error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication failed',
      details: error.message
    });
  }
};

module.exports = authMiddleware;