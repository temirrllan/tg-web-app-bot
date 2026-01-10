// services/subscriptionService.js - ИСПРАВЛЕННАЯ ВЕРСИЯ (БЕЗ МАССОВОГО ОБНОВЛЕНИЯ)
const db = require('../config/database');
const TelegramStarsService = require('./telegramStarsService');
const HabitLockService = require('./habitLockService');

class SubscriptionService {
  static PLANS = {
    'month': {
      name: 'Premium for 1 Month',
      duration_months: 1,
      price_stars: 1,
      features: ['Unlimited habits', 'Unlimited friends', 'Advanced statistics', 'Priority support']
    },
    '6_months': {
      name: 'Premium for 6 Months',
      duration_months: 6,
      price_stars: 299,
      features: ['Unlimited habits', 'Unlimited friends', 'Advanced statistics', 'Priority support']
    },
    '1_year': {
      name: 'Premium for 1 Year',
      duration_months: 12,
      price_stars: 500,
      features: ['Unlimited habits', 'Unlimited friends', 'Advanced statistics', 'Priority support', 'Save 30%']
    }
  };

  /**
   * 🔥 ИСПРАВЛЕНО: Создание подписки БЕЗ массового обновления
   */
  static async createSubscription(userId, planType, transactionId = null) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      const plan = this.PLANS[planType];
      if (!plan) {
        throw new Error(`Invalid plan type: ${planType}`);
      }
      
      console.log(`📝 Creating subscription: User ${userId}, Plan ${planType}`);
      
      // 🔥 ШАГ 1: Проверяем существование пользователя
      const userCheck = await client.query(
        'SELECT id, telegram_id, first_name FROM users WHERE id = $1',
        [userId]
      );
      
      if (userCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`User ${userId} not found`);
      }
      
      console.log(`✅ User found: ${userCheck.rows[0].first_name} (ID: ${userId})`);
      
      // 🔥 ШАГ 2: Деактивируем ТОЛЬКО старые подписки ЭТОГО пользователя
      const oldSubs = await client.query(
        'SELECT id, plan_type FROM subscriptions WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      
      if (oldSubs.rows.length > 0) {
        console.log(`🗑️ Found ${oldSubs.rows.length} old subscription(s) for user ${userId}`);
        
        // ✅ КРИТИЧНО: WHERE user_id = $1
        await client.query(
          `UPDATE subscriptions 
           SET is_active = false, 
               cancelled_at = CURRENT_TIMESTAMP,
               expires_at = NULL
           WHERE user_id = $1 AND is_active = true`,
          [userId]
        );
        
        console.log(`✅ Old subscriptions deactivated ONLY for user ${userId}`);
      }
      
      // 🔥 ШАГ 3: Вычисляем даты
      let expiresAt = null;
      const startedAt = new Date();
      
      if (plan.duration_months) {
        expiresAt = new Date(startedAt);
        expiresAt.setMonth(expiresAt.getMonth() + plan.duration_months);
      }
      
      console.log(`📅 Period: ${startedAt.toISOString()} → ${expiresAt ? expiresAt.toISOString() : 'LIFETIME'}`);
      
      // 🔥 ШАГ 4: Создаём новую подписку
      const result = await client.query(
        `INSERT INTO subscriptions (
          user_id, plan_type, plan_name, price_stars, 
          started_at, expires_at, is_active, is_trial,
          transaction_id, payment_method
        ) VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9)
        RETURNING *`,
        [
          userId,
          planType,
          plan.name,
          plan.price_stars,
          startedAt,
          expiresAt,
          planType === 'test',
          transactionId,
          transactionId ? 'telegram_stars' : 'manual'
        ]
      );
      
      const subscription = result.rows[0];
      console.log(`✅ New subscription created: ID ${subscription.id} for user ${userId}`);
      
      // 🔥 ШАГ 5: Обновляем ТОЛЬКО ЭТОГО конкретного пользователя
      console.log(`🔄 Updating ONLY user ${userId} to premium...`);
      
      const updateResult = await client.query(
        `UPDATE users 
         SET 
           is_premium = true, 
           subscription_type = $2,
           subscription_expires_at = $3,
           subscription_start_date = $4,
           subscription_end_date = $5
         WHERE id = $1
         RETURNING id, telegram_id, first_name, is_premium, subscription_type`,
        [userId, planType, expiresAt, startedAt, expiresAt]
      );
      
      if (updateResult.rows.length === 0) {
        throw new Error(`Failed to update user ${userId} - user disappeared`);
      }
      
      console.log(`✅ User ${userId} updated to premium:`, {
        id: updateResult.rows[0].id,
        telegram_id: updateResult.rows[0].telegram_id,
        first_name: updateResult.rows[0].first_name,
        is_premium: updateResult.rows[0].is_premium,
        subscription_type: updateResult.rows[0].subscription_type
      });
      
      // 🔥 ШАГ 6: Разблокируем премиум привычки
      try {
        await HabitLockService.unlockPremiumHabits(userId);
        console.log(`✅ Premium habits unlocked for user ${userId}`);
      } catch (unlockError) {
        console.warn('⚠️ Failed to unlock habits (non-critical):', unlockError.message);
      }
      
      // 🔥 ШАГ 7: Добавляем в историю
      try {
        await client.query(
          `INSERT INTO subscription_history (
            user_id, subscription_id, plan_type, price_stars, action, created_at
          ) VALUES ($1, $2, $3, $4, 'created', CURRENT_TIMESTAMP)`,
          [userId, subscription.id, planType, plan.price_stars]
        );
        console.log(`✅ History record created for user ${userId}`);
      } catch (histError) {
        console.warn('⚠️ History insert failed (non-critical):', histError.message);
      }
      
      await client.query('COMMIT');
      
      // 🔥 ФИНАЛЬНАЯ ПРОВЕРКА: Подтверждаем что обновился ТОЛЬКО один пользователь
      const verifyResult = await client.query(
        `SELECT id, telegram_id, first_name, is_premium 
         FROM users 
         WHERE id = $1`,
        [userId]
      );
      
      console.log(`🔍 Final verification for user ${userId}:`, verifyResult.rows[0]);
      
      const totalPremiumCount = await client.query(
        'SELECT COUNT(*) as count FROM users WHERE is_premium = true'
      );
      console.log(`📊 Total premium users in database: ${totalPremiumCount.rows[0].count}`);
      
      console.log(`🎉 Subscription successfully activated for user ${userId} ONLY`);
      
      return {
        success: true,
        subscription,
        user: verifyResult.rows[0],
        message: `${plan.name} activated successfully!`
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error creating subscription:', error);
      console.error('Stack:', error.stack);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 🔥 ИСПРАВЛЕНО: Отмена подписки БЕЗ массового обновления
   */
  static async cancelSubscription(userId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      console.log(`🚫 Cancelling subscription for user ${userId}`);
      
      // 🔥 Проверяем пользователя
      const userCheck = await client.query(
        'SELECT id, telegram_id, first_name, is_premium FROM users WHERE id = $1',
        [userId]
      );
      
      if (userCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'User not found' };
      }
      
      console.log(`✅ User found: ${userCheck.rows[0].first_name} (ID: ${userId})`);
      
      if (!userCheck.rows[0].is_premium) {
        await client.query('ROLLBACK');
        return { success: false, error: 'No active subscription' };
      }
      
      // 🔥 ШАГ 1: Получаем активные подписки ТОЛЬКО ЭТОГО пользователя
      const activeSubs = await client.query(
        `SELECT id, plan_type, plan_name, price_stars 
         FROM subscriptions 
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      
      if (activeSubs.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'No active subscriptions found' };
      }
      
      console.log(`📊 Found ${activeSubs.rows.length} active subscription(s) for user ${userId}`);
      
      // 🔥 ШАГ 2: Деактивируем подписки ТОЛЬКО ЭТОГО пользователя
      // ✅ КРИТИЧНО: WHERE user_id = $1
      await client.query(
        `UPDATE subscriptions 
         SET is_active = false, 
             cancelled_at = CURRENT_TIMESTAMP,
             expires_at = NULL
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      
      console.log(`✅ Subscriptions deactivated ONLY for user ${userId}`);
      
      // 🔥 ШАГ 3: История
      for (const sub of activeSubs.rows) {
        try {
          const existingHistory = await client.query(
            `SELECT id FROM subscription_history 
             WHERE subscription_id = $1 AND action = 'cancelled'`,
            [sub.id]
          );
          
          if (existingHistory.rows.length === 0) {
            await client.query(
              `INSERT INTO subscription_history (
                user_id, subscription_id, plan_type, price_stars, action, created_at
              ) VALUES ($1, $2, $3, $4, 'cancelled', CURRENT_TIMESTAMP)`,
              [userId, sub.id, sub.plan_type, sub.price_stars || 0]
            );
          }
        } catch (histError) {
          console.warn(`⚠️ History insert failed:`, histError.message);
        }
      }
      
      // 🔥 ШАГ 4: Обновляем ТОЛЬКО ЭТОГО пользователя
      console.log(`🔄 Downgrading ONLY user ${userId} to free...`);
      
      // ✅ КРИТИЧНО: WHERE id = $1
      const updateResult = await client.query(
        `UPDATE users 
         SET is_premium = false,
             subscription_type = NULL,
             subscription_expires_at = NULL,
             subscription_end_date = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, telegram_id, first_name, is_premium`,
        [userId]
      );
      
      if (updateResult.rows.length === 0) {
        throw new Error(`User ${userId} not found during downgrade`);
      }
      
      console.log(`✅ User ${userId} downgraded:`, updateResult.rows[0]);
      
      // 🔥 ШАГ 5: Блокируем премиум привычки
      try {
        const habitCount = await client.query(
          'SELECT COUNT(*) as count FROM habits WHERE user_id = $1 AND is_active = true',
          [userId]
        );
        
        const count = parseInt(habitCount.rows[0].count);
        
        if (count > 3) {
          await HabitLockService.lockPremiumHabits(userId, 'subscription_cancelled');
          console.log(`✅ Premium habits locked for user ${userId}`);
        }
      } catch (lockError) {
        console.warn('⚠️ Failed to lock habits:', lockError.message);
      }
      
      await client.query('COMMIT');
      
      console.log(`✅ Subscription cancelled successfully for user ${userId} ONLY`);
      
      return {
        success: true,
        message: 'Subscription cancelled successfully',
        deactivatedCount: activeSubs.rows.length,
        user: updateResult.rows[0]
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Cancellation error:', error);
      console.error('Stack:', error.stack);
      
      return {
        success: false,
        error: error.message || 'Failed to cancel subscription'
      };
    } finally {
      client.release();
    }
  }

  /**
   * 🔥 ИСПРАВЛЕНО: Истечение подписки БЕЗ массового обновления
   */
  static async expireUserSubscription(userId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      console.log(`⏰ Expiring subscription for user ${userId}`);
      
      const activeSubs = await client.query(
        'SELECT id, plan_type, plan_name, price_stars FROM subscriptions WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      
      if (activeSubs.rows.length === 0) {
        await client.query('COMMIT');
        return { success: true, message: 'No active subscriptions' };
      }
      
      // ✅ КРИТИЧНО: WHERE user_id = $1
      await client.query(
        `UPDATE subscriptions 
         SET is_active = false, 
             cancelled_at = CURRENT_TIMESTAMP,
             expires_at = NULL
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      
      // История
      for (const sub of activeSubs.rows) {
        try {
          const existingHistory = await client.query(
            `SELECT id FROM subscription_history 
             WHERE subscription_id = $1 AND action = 'expired'`,
            [sub.id]
          );
          
          if (existingHistory.rows.length === 0) {
            await client.query(
              `INSERT INTO subscription_history (
                user_id, subscription_id, plan_type, price_stars, action, created_at
              ) VALUES ($1, $2, $3, $4, 'expired', CURRENT_TIMESTAMP)`,
              [userId, sub.id, sub.plan_type, sub.price_stars || 0]
            );
          }
        } catch (histError) {
          console.warn('History insert failed:', histError.message);
        }
      }
      
      // ✅ КРИТИЧНО: WHERE id = $1
      await client.query(
        `UPDATE users 
         SET is_premium = false,
             subscription_type = NULL,
             subscription_expires_at = NULL,
             subscription_end_date = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [userId]
      );
      
      // Блокируем привычки
      try {
        await HabitLockService.lockPremiumHabits(userId, 'subscription_expired');
      } catch (lockError) {
        console.warn('Failed to lock habits:', lockError.message);
      }
      
      await client.query('COMMIT');
      console.log(`✅ Subscription expired ONLY for user ${userId}`);
      
      return { success: true };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error expiring subscription:', error);
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }

  /**
   * Проверка статуса подписки
   */
  static async checkUserSubscription(userId) {
    try {
      const result = await db.query(
        `SELECT 
          u.id,
          u.is_premium,
          u.subscription_type,
          u.subscription_expires_at,
          u.subscription_start_date,
          (SELECT COUNT(*) FROM habits WHERE user_id = u.id AND is_active = true) as habit_count,
          (SELECT COUNT(DISTINCT hm.user_id) - 1 
           FROM habit_members hm 
           JOIN habits h ON hm.habit_id = h.id 
           WHERE h.user_id = u.id AND h.is_active = true AND hm.is_active = true) as friends_count
         FROM users u
         WHERE u.id = $1`,
        [userId]
      );
      
      if (result.rows.length === 0) {
        return {
          hasSubscription: false,
          isPremium: false,
          habitCount: 0,
          habitLimit: 3,
          friendsCount: 0,
          friendLimit: 1,
          canCreateMore: true,
          canAddFriends: true
        };
      }
      
      const userData = result.rows[0];
      const now = new Date();
      
      let isActive = false;
      let subscription = null;
      
      if (userData.is_premium && userData.subscription_type) {
        if (userData.subscription_expires_at) {
          const expiresAt = new Date(userData.subscription_expires_at);
          isActive = expiresAt > now;
          
          if (isActive) {
            const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
            const plan = TelegramStarsService.PLANS[userData.subscription_type];
            
            subscription = {
              isActive: true,
              planType: userData.subscription_type,
              planName: plan ? plan.display_name : 'Premium',
              fullPlanName: plan ? plan.name : 'Premium',
              expiresAt: userData.subscription_expires_at,
              startedAt: userData.subscription_start_date,
              daysLeft: daysLeft > 0 ? daysLeft : 0,
              isTrial: userData.subscription_type === 'test'
            };
          } else {
            // Автоматически истекаем
            await this.expireUserSubscription(userId);
          }
        } else {
          // Lifetime
          const plan = TelegramStarsService.PLANS[userData.subscription_type];
          subscription = {
            isActive: true,
            planType: userData.subscription_type,
            planName: plan ? plan.display_name : 'Lifetime',
            fullPlanName: plan ? plan.name : 'Lifetime Premium',
            expiresAt: null,
            daysLeft: null,
            isTrial: false
          };
        }
      }
      
      const habitCount = parseInt(userData.habit_count);
      const friendsCount = parseInt(userData.friends_count || 0);
      const habitLimit = isActive ? 999 : 3;
      const friendLimit = isActive ? 999 : 1;
      
      return {
        hasSubscription: isActive,
        subscription,
        isPremium: isActive,
        habitCount,
        friendsCount,
        habitLimit,
        friendLimit,
        canCreateMore: habitCount < habitLimit,
        canAddFriends: friendsCount < friendLimit
      };
      
    } catch (error) {
      console.error('❌ Error checking subscription:', error);
      return {
        hasSubscription: false,
        isPremium: false,
        habitCount: 0,
        habitLimit: 3,
        friendsCount: 0,
        friendLimit: 1,
        canCreateMore: true,
        canAddFriends: true,
        error: error.message
      };
    }
  }
}

module.exports = SubscriptionService;