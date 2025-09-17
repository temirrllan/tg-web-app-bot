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
    const habitCount = await Habit.countActive(userId);

    // Проверяем премиум-статус из данных пользователя
    const isPremium = req.user.is_premium === true || req.user.is_premium === 1;
    
    console.log(`User subscription check:`, {
      userId: userId,
      isPremium: isPremium,
      currentHabits: habitCount,
      userObject: req.user
    });

    // Бесплатный тариф - максимум 3 привычки
    const limit = isPremium ? 999 : 3;

    if (habitCount >= limit) {
      return res.status(403).json({
        success: false,
        error: 'Habit limit reached',
        showPremium: true,
        limit,
        current: habitCount,
        isPremium: isPremium
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