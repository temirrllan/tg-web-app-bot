const Habit = require('../models/Habit');

const checkSubscriptionLimit = async (req, res, next) => {
  console.log('💎 Checking subscription limits');

  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const userId = req.user.id;
    const isPremium = req.user.is_premium || false;
    
    // Если пользователь премиум - пропускаем проверку
    if (isPremium) {
      console.log(`User ${userId} has premium subscription`);
      return next();
    }
    
    // Проверяем количество активных привычек
    const pool = require('../config/database');
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM habits WHERE user_id = $1 AND is_active = true AND (is_special = false OR is_special IS NULL)',
      [userId]
    );
    
    const habitCount = parseInt(result.rows[0].count);
    const limit = 3;
    
    console.log(`User ${userId} subscription: free, habits: ${habitCount}/${limit}`);

    if (habitCount >= limit) {
      return res.status(403).json({
        success: false,
        error: 'Habit limit reached',
        showPremium: true,
        limit,
        current: habitCount,
        message: 'Upgrade to premium to create unlimited habits'
      });
    }

    next();
  } catch (error) {
    console.error('💥 Subscription check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check subscription'
    });
  }
};

module.exports = { checkSubscriptionLimit };