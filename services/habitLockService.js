// services/habitLockService.js
const db = require('../config/database');

class HabitLockService {
  /**
   * Блокировать премиум привычки пользователя
   * @param {number} userId - ID пользователя
   * @param {string} reason - Причина блокировки ('subscription_expired' или 'subscription_cancelled')
   */
  static async lockPremiumHabits(userId, reason = 'subscription_expired') {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      console.log(`🔒 Locking premium habits for user ${userId}, reason: ${reason}`);
      
      // Получаем список премиум привычек пользователя
      const premiumHabits = await client.query(
        `SELECT id, title 
         FROM habits 
         WHERE user_id = $1 
         AND is_premium_habit = true 
         AND is_active = true
         AND locked_at IS NULL`,
        [userId]
      );
      
      if (premiumHabits.rows.length === 0) {
        console.log(`ℹ️ No premium habits to lock for user ${userId}`);
        await client.query('COMMIT');
        return { success: true, locked_count: 0 };
      }
      
      // Блокируем привычки
      const lockResult = await client.query(
        `UPDATE habits 
         SET 
           locked_at = CURRENT_TIMESTAMP,
           locked_reason = $2
         WHERE user_id = $1 
         AND is_premium_habit = true 
         AND is_active = true
         AND locked_at IS NULL
         RETURNING id, title`,
        [userId, reason]
      );
      
      console.log(`✅ Locked ${lockResult.rows.length} premium habits for user ${userId}`);
      lockResult.rows.forEach(h => {
        console.log(`  - "${h.title}" (ID: ${h.id})`);
      });
      
      await client.query('COMMIT');
      
      return {
        success: true,
        locked_count: lockResult.rows.length,
        locked_habits: lockResult.rows
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error locking premium habits:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Разблокировать премиум привычки пользователя
   * @param {number} userId - ID пользователя
   */
  static async unlockPremiumHabits(userId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      console.log(`🔓 Unlocking premium habits for user ${userId}`);
      
      // Разблокируем все заблокированные привычки
      const unlockResult = await client.query(
        `UPDATE habits 
         SET 
           locked_at = NULL,
           locked_reason = NULL
         WHERE user_id = $1 
         AND locked_at IS NOT NULL
         RETURNING id, title`,
        [userId]
      );
      
      console.log(`✅ Unlocked ${unlockResult.rows.length} habits for user ${userId}`);
      unlockResult.rows.forEach(h => {
        console.log(`  - "${h.title}" (ID: ${h.id})`);
      });
      
      await client.query('COMMIT');
      
      return {
        success: true,
        unlocked_count: unlockResult.rows.length,
        unlocked_habits: unlockResult.rows
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error unlocking premium habits:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Помечает новую привычку как премиум если она создана сверх лимита
   * @param {number} userId - ID пользователя
   * @param {number} habitId - ID созданной привычки
   */
  static async markHabitAsPremiumIfNeeded(userId, habitId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Проверяем статус пользователя
      const userCheck = await client.query(
        'SELECT is_premium FROM users WHERE id = $1',
        [userId]
      );
      
      if (userCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'User not found' };
      }
      
      const isPremium = userCheck.rows[0].is_premium;
      
      // Считаем количество активных привычек
      const habitCount = await client.query(
        `SELECT COUNT(*) as count 
         FROM habits 
         WHERE user_id = $1 
         AND is_active = true`,
        [userId]
      );
      
      const currentCount = parseInt(habitCount.rows[0].count);
      const freeLimit = 3;
      
      console.log(`📊 User ${userId}: ${currentCount} habits, premium: ${isPremium}`);
      
      // Если это привычка сверх лимита И пользователь сейчас в премиум
      if (currentCount > freeLimit && isPremium) {
        await client.query(
          'UPDATE habits SET is_premium_habit = true WHERE id = $1',
          [habitId]
        );
        
        console.log(`✅ Habit ${habitId} marked as premium (count: ${currentCount} > limit: ${freeLimit})`);
        
        await client.query('COMMIT');
        return { success: true, is_premium_habit: true };
      }
      
      await client.query('COMMIT');
      return { success: true, is_premium_habit: false };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error marking habit as premium:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Проверить, заблокирована ли привычка
   * @param {number} habitId - ID привычки
   * @param {number} userId - ID пользователя
   */
  static async isHabitLocked(habitId, userId) {
    try {
      const result = await db.query(
        `SELECT 
           locked_at, 
           locked_reason,
           is_premium_habit
         FROM habits 
         WHERE id = $1 
         AND user_id = $2`,
        [habitId, userId]
      );
      
      if (result.rows.length === 0) {
        return { exists: false, locked: false };
      }
      
      const habit = result.rows[0];
      
      return {
        exists: true,
        locked: habit.locked_at !== null,
        locked_at: habit.locked_at,
        locked_reason: habit.locked_reason,
        is_premium_habit: habit.is_premium_habit
      };
      
    } catch (error) {
      console.error('❌ Error checking habit lock status:', error);
      throw error;
    }
  }
}

module.exports = HabitLockService;