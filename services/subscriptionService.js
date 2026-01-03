// services/subscriptionService.js - ИСПРАВЛЕННАЯ ВЕРСИЯ
const db = require('../config/database');
const TelegramStarsService = require('./telegramStarsService');
const HabitLockService = require('./habitLockService');

class SubscriptionService {
  static PLANS = {
    'test': {
      name: 'Test Plan (1 Star)',
      duration_months: 1,
      price_stars: 1,
      features: ['Testing purposes only']
    },
    'month': {
      name: 'Premium for 1 Month',
      duration_months: 1,
      price_stars: 59,
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

  static async createSubscription(userId, planType, transactionId = null) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      const plan = this.PLANS[planType];
      if (!plan) {
        throw new Error(`Invalid plan type: ${planType}`);
      }
      
      console.log(`📝 Creating subscription: User ${userId}, Plan ${planType}`);
      
      // 🔥 ШАГ 1: ПОЛНАЯ ДЕАКТИВАЦИЯ ВСЕХ СТАРЫХ ПОДПИСОК
      const oldSubs = await client.query(
        'SELECT id, plan_type FROM subscriptions WHERE user_id = $1',
        [userId]
      );
      
      if (oldSubs.rows.length > 0) {
        console.log(`🗑️ Found ${oldSubs.rows.length} old subscription(s) for user ${userId}`);
        
        await client.query(
          `UPDATE subscriptions 
           SET is_active = false, 
               cancelled_at = CURRENT_TIMESTAMP,
               expires_at = NULL
           WHERE user_id = $1`,
          [userId]
        );
        
        console.log(`✅ Deactivated ${oldSubs.rows.length} old subscription(s)`);
      }
      
      // 🔥 ШАГ 2: Вычисляем даты
      let expiresAt = null;
      const startedAt = new Date();
      
      if (plan.duration_months) {
        expiresAt = new Date(startedAt);
        expiresAt.setMonth(expiresAt.getMonth() + plan.duration_months);
      }
      
      console.log(`📅 Period: ${startedAt.toISOString()} → ${expiresAt ? expiresAt.toISOString() : 'LIFETIME'}`);
      
      // 🔥 ШАГ 3: Создаём НОВУЮ подписку
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
      
      // 🔥 ШАГ 4: КРИТИЧНО ИСПРАВЛЕНО - Обновляем ТОЛЬКО этого пользователя
      const updateResult = await client.query(
        `UPDATE users 
         SET 
           is_premium = true, 
           subscription_type = $1,
           subscription_expires_at = $2,
           subscription_start_date = $3,
           subscription_end_date = $4
         WHERE id = $5
         RETURNING id, telegram_id, is_premium, subscription_type`,
        [planType, expiresAt, startedAt, expiresAt, userId] // 🔥 userId в конце!
      );
      
      if (updateResult.rows.length === 0) {
        throw new Error(`User ${userId} not found`);
      }
      
      console.log(`✅ User ${userId} upgraded:`, updateResult.rows[0]);
      
      // 🔥 ШАГ 5: Разблокируем премиум привычки
      try {
        await HabitLockService.unlockPremiumHabits(userId);
        console.log(`✅ Premium habits unlocked for user ${userId}`);
      } catch (unlockError) {
        console.warn('⚠️ Failed to unlock habits (non-critical):', unlockError.message);
      }
      
      // 🔥 ШАГ 6: История
      try {
        await client.query(
          `INSERT INTO subscription_history (
            user_id, subscription_id, plan_type, plan_name, 
            price_stars, action, status, payment_method,
            started_at, expires_at, created_at
          ) VALUES ($1, $2, $3, $4, $5, 'created', 'completed', $6, $7, $8, CURRENT_TIMESTAMP)`,
          [
            userId, 
            subscription.id, 
            planType, 
            plan.name, 
            plan.price_stars,
            transactionId ? 'telegram_stars' : 'manual',
            startedAt,
            expiresAt
          ]
        );
        console.log(`✅ History record created for user ${userId}`);
      } catch (histError) {
        console.warn('⚠️ History insert failed (non-critical):', histError.message);
      }
      
      await client.query('COMMIT');
      
      console.log(`🎉 Subscription fully activated for user ${userId}`);
      
      // 🔥 ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА
      const verifyUser = await client.query(
        'SELECT id, is_premium FROM users WHERE id = $1',
        [userId]
      );
      console.log(`🔍 Verification - User ${userId}:`, verifyUser.rows[0]);
      
      return {
        success: true,
        subscription,
        user: updateResult.rows[0],
        message: `${plan.name} activated successfully!`
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`❌ Error creating subscription for user ${userId}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Остальные методы без изменений...
  static async cancelSubscription(userId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      console.log(`🚫 Cancelling subscription for user ${userId}`);
      
      const userCheck = await client.query(
        'SELECT id, is_premium FROM users WHERE id = $1',
        [userId]
      );
      
      if (userCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'User not found' };
      }
      
      if (!userCheck.rows[0].is_premium) {
        await client.query('ROLLBACK');
        return { success: false, error: 'No active subscription' };
      }
      
      const activeSubs = await client.query(
        `SELECT id, plan_type FROM subscriptions 
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      
      if (activeSubs.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'No active subscriptions found' };
      }
      
      await client.query(
        `UPDATE subscriptions 
         SET is_active = false, 
             cancelled_at = CURRENT_TIMESTAMP,
             expires_at = NULL
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      
      // 🔥 КРИТИЧНО: userId в конце WHERE
      await client.query(
        `UPDATE users 
         SET is_premium = false,
             subscription_type = NULL,
             subscription_expires_at = NULL,
             subscription_end_date = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [userId]
      );
      
      try {
        await HabitLockService.lockPremiumHabits(userId, 'subscription_cancelled');
      } catch (lockError) {
        console.warn('⚠️ Failed to lock habits:', lockError.message);
      }
      
      await client.query('COMMIT');
      
      console.log(`✅ Subscription cancelled for user ${userId}`);
      
      return {
        success: true,
        message: 'Subscription cancelled successfully',
        deactivatedCount: activeSubs.rows.length
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`❌ Cancellation error for user ${userId}:`, error);
      
      return {
        success: false,
        error: error.message || 'Failed to cancel subscription'
      };
    } finally {
      client.release();
    }
  }

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
            await this.expireUserSubscription(userId);
          }
        } else {
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

  static async expireUserSubscription(userId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      await client.query(
        `UPDATE subscriptions 
         SET is_active = false, 
             cancelled_at = CURRENT_TIMESTAMP,
             expires_at = NULL
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      
      // 🔥 КРИТИЧНО: userId в WHERE
      await client.query(
        `UPDATE users 
         SET is_premium = false,
             subscription_type = NULL,
             subscription_expires_at = NULL,
             subscription_end_date = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [userId]
      );
      
      try {
        await HabitLockService.lockPremiumHabits(userId, 'subscription_expired');
      } catch (lockError) {
        console.warn('Failed to lock habits:', lockError.message);
      }
      
      await client.query('COMMIT');
      console.log(`✅ Subscription expired for user ${userId}`);
      
      return { success: true };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error expiring subscription:', error);
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }
}

module.exports = SubscriptionService;