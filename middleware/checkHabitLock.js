// middleware/checkHabitLock.js

const HabitLockService = require('../services/habitLockService');

/**
 * Middleware для проверки блокировки привычки
 * Используется перед операциями mark/unmark/update
 */
const checkHabitLock = async (req, res, next) => {
  try {
    const habitId = req.params.id;
    const userId = req.user.id;
    
    // Проверяем статус блокировки
    const lockStatus = await HabitLockService.isHabitLocked(habitId, userId);
    
    if (!lockStatus.exists) {
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }
    
    if (lockStatus.locked) {
      console.log(`🔒 Attempt to modify locked habit ${habitId} by user ${userId}`);
      
      return res.status(403).json({
        success: false,
        error: 'Habit is locked',
        locked: true,
        locked_reason: lockStatus.locked_reason,
        locked_at: lockStatus.locked_at,
        message: 'This habit requires an active Premium subscription. Please renew your subscription to continue tracking.',
        showUpgradePrompt: true
      });
    }
    
    // Привычка не заблокирована - продолжаем
    next();
    
  } catch (error) {
    console.error('❌ Error in checkHabitLock middleware:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check habit status'
    });
  }
};

module.exports = checkHabitLock;