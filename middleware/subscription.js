const Habit = require('../models/Habit');

const checkSubscriptionLimit = async (req, res, next) => {
  console.log('💎 Checking subscription limits');
  
  try {
    if (!req.user) {
      console.error('❌ No user in request for subscription check');
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const userId = req.user.id;
    console.log('Checking limits for user:', userId);
    
    // Получаем количество активных привычек
    const habitCount = await Habit.countActive(userId);
    console.log('Current habit count:', habitCount);
    
    // Проверяем подписку
    let subscriptionType = 'free';
    
    try {
      const pool = require('../config/database');
      const result = await pool.query(
        'SELECT type FROM subscriptions WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      
      if (result.rows.length > 0) {
        subscriptionType = result.rows[0].type;
      }
    } catch (error) {
      console.log('No subscription found, using free tier');
    }
    
    const limit = subscriptionType === 'premium' ? 999 : 3;
    console.log(`User subscription: ${subscriptionType}, limit: ${limit}`);
    
    if (habitCount >= limit) {
      console.log('❌ Habit limit reached');
      return res.status(403).json({
        success: false,
        error: 'Habit limit reached',
        showPremium: true,
        limit,
        current: habitCount
      });
    }
    
    console.log('✅ Subscription check passed');
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