// services/subscriptionService.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С ФИКСОМ ОТМЕНЫ

const db = require('../config/database');
const TelegramStarsService = require('./telegramStarsService');

class SubscriptionService {
  // 🔥 СИНХРОНИЗИРОВАННЫЕ С FRONTEND ПЛАНЫ
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
        throw new Error(`Invalid plan type: ${planType}. Valid plans: ${Object.keys(this.PLANS).join(', ')}`);
      }
      
      console.log(`📝 Creating subscription: User ${userId}, Plan ${planType}`);
      
      // 🔥 КРИТИЧНО: Полностью деактивируем ВСЕ старые подписки
      const oldSubscriptions = await client.query(
        'SELECT id, expires_at, is_active FROM subscriptions WHERE user_id = $1',
        [userId]
      );
      
      if (oldSubscriptions.rows.length > 0) {
        console.log(`🔄 Found ${oldSubscriptions.rows.length} old subscription(s), deactivating ALL...`);
        
        // 🔥 ВАЖНО: Деактивируем ВСЕ подписки (и активные, и неактивные)
        await client.query(
          `UPDATE subscriptions 
           SET is_active = false, 
               cancelled_at = CURRENT_TIMESTAMP,
               expires_at = NULL
           WHERE user_id = $1`,
          [userId]
        );
        
        console.log(`✅ ALL subscriptions for user ${userId} deactivated`);
        
        // Добавляем записи в историю о деактивации
        for (const oldSub of oldSubscriptions.rows) {
          await client.query(
            `INSERT INTO subscriptions_history (
              user_id, subscription_id, plan_type, plan_name, 
              price_stars, action, status, created_at
            ) SELECT user_id, id, plan_type, plan_name, price_stars, 
              'deactivated', 'completed', CURRENT_TIMESTAMP
            FROM subscriptions WHERE id = $1`,
            [oldSub.id]
          );
          
          console.log(`✅ History record created for subscription ${oldSub.id}`);
        }
      }
      
      // Вычисляем даты
      let expiresAt = null;
      const startedAt = new Date();
      
      if (plan.duration_months) {
        expiresAt = new Date(startedAt);
        expiresAt.setMonth(expiresAt.getMonth() + plan.duration_months);
      }
      
      console.log(`📅 Subscription period: ${startedAt.toISOString()} to ${expiresAt ? expiresAt.toISOString() : 'LIFETIME'}`);
      
      // Создаем подписку с правильной ценой
      const result = await client.query(
        `INSERT INTO subscriptions (
          user_id, plan_type, plan_name, price_stars, 
          started_at, expires_at, is_active, is_trial,
          transaction_id, payment_method
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [
          userId,
          planType,
          plan.name,
          plan.price_stars,
          startedAt,
          expiresAt,
          true,
          planType === 'test',
          transactionId,
          transactionId ? 'telegram_stars' : 'manual'
        ]
      );
      
      const subscription = result.rows[0];
      console.log(`✅ Subscription created with ID: ${subscription.id}, Price: ${plan.price_stars} XTR`);
      
      // Обновляем пользователя
      const updateUserResult = await client.query(
        `UPDATE users 
         SET 
           is_premium = true, 
           subscription_type = $2,
           subscription_expires_at = $3,
           subscription_start_date = $4,
           subscription_end_date = $5
         WHERE id = $1
         RETURNING id, is_premium, subscription_type, subscription_expires_at`,
        [userId, planType, expiresAt, startedAt, expiresAt]
      );
      
      if (updateUserResult.rows.length === 0) {
        throw new Error('Failed to update user premium status');
      }
      
      console.log(`✅ User ${userId} updated to premium`);
      
      // История - сохраняем реальную цену из плана
      await client.query(
        `INSERT INTO subscriptions_history (
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
      
      await client.query('COMMIT');
      
      console.log(`✅ Subscription fully activated for user ${userId}`);
      
      return {
        success: true,
        subscription,
        user: updateUserResult.rows[0],
        message: `${plan.name} activated successfully!`
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error creating subscription:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  static async checkUserSubscription(userId) {
    try {
      console.log(`🔍 Checking subscription for user ${userId}`);
      
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
        console.log(`❌ User ${userId} not found`);
        return {
          hasSubscription: false,
          isPremium: false,
          habitCount: 0,
          friendsCount: 0,
          habitLimit: 3,
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
            // Автоматически деактивируем истекшую подписку
            console.log(`⏰ Subscription expired for user ${userId}`);
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
            startedAt: userData.subscription_start_date,
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
        subscription: subscription,
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
        friendsCount: 0,
        habitLimit: 3,
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
      
      const activeSubscriptions = await client.query(
        'SELECT id, plan_type, plan_name, price_stars FROM subscriptions WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      
      // 🔥 Деактивируем и обнуляем expires_at
      await client.query(
        `UPDATE subscriptions 
         SET is_active = false, 
             cancelled_at = CURRENT_TIMESTAMP,
             expires_at = NULL
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      
      // Добавляем записи в историю
      for (const sub of activeSubscriptions.rows) {
        await client.query(
          `INSERT INTO subscriptions_history (
            user_id, subscription_id, plan_type, plan_name, 
            price_stars, action, status, created_at
          ) VALUES ($1, $2, $3, $4, $5, 'expired', 'completed', CURRENT_TIMESTAMP)`,
          [userId, sub.id, sub.plan_type, sub.plan_name, sub.price_stars || 0]
        );
      }
      
      // Обновляем статус пользователя
      await client.query(
        `UPDATE users 
         SET is_premium = false,
             subscription_type = NULL,
             subscription_expires_at = NULL,
             subscription_end_date = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [userId]
      );
      
      await client.query('COMMIT');
      console.log(`✅ Expired subscription for user ${userId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error expiring subscription:', error);
    } finally {
      client.release();
    }
  }
  
  // 🔥 ИСПРАВЛЕННЫЙ МЕТОД cancelSubscription
  static async cancelSubscription(userId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      console.log(`🚫 Cancelling subscription for user ${userId}`);
      
      const userResult = await client.query(
        'SELECT id, is_premium, subscription_type FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'User not found'
        };
      }
      
      const user = userResult.rows[0];
      
      // 🔥 КРИТИЧНО: Получаем ВСЕ подписки пользователя (не только активные)
      const allSubscriptions = await client.query(
        'SELECT id, plan_type, plan_name, price_stars, is_active FROM subscriptions WHERE user_id = $1',
        [userId]
      );
      
      console.log(`📊 Found ${allSubscriptions.rows.length} total subscriptions for user ${userId}:`);
      allSubscriptions.rows.forEach(sub => {
        console.log(`  - ID: ${sub.id}, Active: ${sub.is_active}, Plan: ${sub.plan_type}`);
      });
      
      if (allSubscriptions.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'No subscriptions found for this user'
        };
      }
      
      // 🔥 ВАЖНО: Деактивируем ВСЕ подписки (не только активные)
      const updateResult = await client.query(
        `UPDATE subscriptions 
         SET is_active = false, 
             cancelled_at = CURRENT_TIMESTAMP,
             expires_at = NULL
         WHERE user_id = $1
         RETURNING id, plan_type`,
        [userId]
      );
      
      console.log(`✅ Deactivated ${updateResult.rows.length} subscription(s)`);
      
      // Добавляем записи в историю для ВСЕХ подписок
      for (const sub of allSubscriptions.rows) {
        try {
          await client.query(
            `INSERT INTO subscriptions_history (
              user_id, subscription_id, plan_type, plan_name, 
              price_stars, action, status, cancelled_at, created_at
            ) VALUES ($1, $2, $3, $4, $5, 'cancelled', 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [userId, sub.id, sub.plan_type, sub.plan_name, sub.price_stars || 0]
          );
          
          console.log(`✅ History record created for subscription ${sub.id}`);
        } catch (histError) {
          console.error(`⚠️ Failed to create history record for subscription ${sub.id}:`, histError.message);
          // Не прерываем транзакцию, продолжаем
        }
      }
      
      // Обновляем статус пользователя
      await client.query(
        `UPDATE users 
         SET is_premium = false,
             subscription_type = NULL,
             subscription_expires_at = NULL,
             subscription_end_date = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [userId]
      );
      
      await client.query('COMMIT');
      
      console.log(`✅ Subscription cancelled successfully for user ${userId}`);
      console.log(`📝 Total subscriptions deactivated: ${updateResult.rows.length}`);
      
      return {
        success: true,
        message: 'Subscription cancelled successfully',
        deactivatedCount: updateResult.rows.length
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error cancelling subscription:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint
      });
      
      return {
        success: false,
        error: error.message || 'Failed to cancel subscription'
      };
    } finally {
      client.release();
    }
  }
}

module.exports = SubscriptionService;