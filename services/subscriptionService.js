const db = require('../config/database');
const TelegramStarsService = require('./telegramStarsService');

class SubscriptionService {
  // Конфигурация планов подписки
  static PLANS = {
    'month': {
    name: 'Premium for 1 Month',
    duration_months: 1,
    price_stars: 59,   // или 50/100 — поставь вашу правильную цену
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
      features: ['Unlimited habits', 'Unlimited friends', 'Advanced statistics', 'Priority support', 'Save 42%']
    },
    // '3_months': {
    //   name: 'Premium for 3 Months',
    //   duration_months: 3,
    //   price_stars: 350,
    //   features: ['Unlimited habits', 'Unlimited friends', 'Advanced statistics', 'Priority support']
    // },
    // 'lifetime': {
    //   name: 'Lifetime Premium',
    //   duration_months: null, // бессрочная
    //   price_stars: 1500,
    //   features: ['Unlimited habits', 'Unlimited friends', 'Advanced statistics', 'Priority support', 'One-time payment', 'Forever access']
    // },
    // 'trial_7_days': {
    //   name: 'Free Trial (7 days)',
    //   duration_days: 7,
    //   price_stars: 0,
    //   features: ['Unlimited habits for 7 days', 'Try all premium features']
    // }
  };

  // Создать новую подписку
  static async createSubscription(userId, planType, transactionId = null) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Проверяем, существует ли план
      const plan = this.PLANS[planType];
      if (!plan) {
        throw new Error(`Invalid plan type: ${planType}`);
      }
      
      console.log(`📝 Creating subscription: User ${userId}, Plan ${planType}`);
      
      // Деактивируем старые подписки
      await client.query(
        'UPDATE subscriptions SET is_active = false, cancelled_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      
      // Вычисляем дату окончания
      let expiresAt = null;
      const startedAt = new Date();
      
      if (plan.duration_months) {
        expiresAt = new Date(startedAt);
        expiresAt.setMonth(expiresAt.getMonth() + plan.duration_months);
      } else if (plan.duration_days) {
        expiresAt = new Date(startedAt);
        expiresAt.setDate(expiresAt.getDate() + plan.duration_days);
      }
      // Если ни то, ни другое не указано - это lifetime подписка
      
      console.log(`📅 Subscription period: ${startedAt.toISOString()} to ${expiresAt ? expiresAt.toISOString() : 'LIFETIME'}`);
      
      // Создаем новую подписку
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
          plan.price_stars || 0,
          startedAt,
          expiresAt,
          true,
          planType.includes('trial'),
          transactionId,
          transactionId ? 'telegram_stars' : 'manual'
        ]
      );
      
      const subscription = result.rows[0];
      console.log(`✅ Subscription created with ID: ${subscription.id}`);
      
      // Обновляем ВСЕ необходимые поля в таблице users
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
      
      console.log(`✅ User ${userId} updated:`, {
        is_premium: updateUserResult.rows[0].is_premium,
        subscription_type: updateUserResult.rows[0].subscription_type,
        subscription_expires_at: updateUserResult.rows[0].subscription_expires_at
      });
      
      // Записываем в историю
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
          plan.price_stars || 0,
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
  
  // Проверить статус подписки пользователя
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
      
      console.log(`📊 User ${userId} data:`, {
        is_premium: userData.is_premium,
        subscription_type: userData.subscription_type,
        subscription_expires_at: userData.subscription_expires_at,
        habit_count: userData.habit_count,
        friends_count: userData.friends_count
      });
      
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
              isTrial: false
            };
          } else {
            // Подписка истекла - автоматически деактивируем
            console.log(`⏰ Subscription expired for user ${userId}, deactivating...`);
            await db.query(
              `UPDATE users 
               SET is_premium = false, 
                   subscription_type = NULL,
                   subscription_expires_at = NULL,
                   subscription_end_date = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [userId]
            );
            
            await db.query(
              'UPDATE subscriptions SET is_active = false, cancelled_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND is_active = true',
              [userId]
            );
            
            // Записываем в историю
            await db.query(
              `INSERT INTO subscriptions_history (
                user_id, plan_type, plan_name, price_stars, 
                action, status, created_at
              ) VALUES ($1, $2, 'Expired Subscription', 0, 'expired', 'completed', CURRENT_TIMESTAMP)`,
              [userId, userData.subscription_type]
            );
          }
        } else {
          // Lifetime подписка
          isActive = true;
          const plan = TelegramStarsService.PLANS[userData.subscription_type];
          subscription = {
            isActive: true,
            planType: userData.subscription_type,
            planName: plan ? plan.display_name : 'Lifetime Premium',
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
      
      console.log(`✅ User ${userId} status: Premium=${isActive}, Habits=${habitCount}/${habitLimit}, Friends=${friendsCount}/${friendLimit}`);
      
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
  
  // Отменить подписку
  static async cancelSubscription(userId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      console.log(`🚫 Cancelling subscription for user ${userId}`);
      
      // Проверяем текущий статус пользователя
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
      
      if (!user.is_premium) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'No active subscription found'
        };
      }
      
      // Получаем информацию о текущей подписке для истории
      const subResult = await client.query(
        'SELECT id, plan_type, plan_name FROM subscriptions WHERE user_id = $1 AND is_active = true LIMIT 1',
        [userId]
      );
      
      // Деактивируем все активные подписки
      const deactivateResult = await client.query(
        `UPDATE subscriptions 
         SET is_active = false, 
             cancelled_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND is_active = true
         RETURNING id`,
        [userId]
      );
      
      console.log(`Deactivated ${deactivateResult.rowCount} subscriptions`);
      
      // Сбрасываем премиум статус у пользователя
      const updateUserResult = await client.query(
        `UPDATE users 
         SET is_premium = false,
             subscription_type = NULL,
             subscription_expires_at = NULL,
             subscription_end_date = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id, is_premium`,
        [userId]
      );
      
      if (updateUserResult.rowCount === 0) {
        throw new Error('Failed to update user premium status');
      }
      
      console.log(`Updated user premium status:`, updateUserResult.rows[0]);
      
      // Добавляем в историю
      if (subResult.rows.length > 0) {
        const sub = subResult.rows[0];
        await client.query(
          `INSERT INTO subscriptions_history (
            user_id, subscription_id, plan_type, plan_name, 
            price_stars, action, status, cancelled_at, created_at
          ) VALUES ($1, $2, $3, $4, 0, 'cancelled', 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [userId, sub.id, sub.plan_type, sub.plan_name]
        );
      }
      
      await client.query('COMMIT');
      
      console.log(`✅ Subscription cancelled for user ${userId}`);
      
      return {
        success: true,
        message: 'Subscription cancelled successfully'
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error cancelling subscription:', error);
      return {
        success: false,
        error: error.message || 'Failed to cancel subscription'
      };
    } finally {
      client.release();
    }
  }
  
  // Проверить и деактивировать истекшие подписки (запускать по крону)
  static async checkExpiredSubscriptions() {
    try {
      console.log('🔍 Checking for expired subscriptions...');
      
      const result = await db.query(
        `SELECT 
          s.id, 
          s.user_id,
          s.plan_type,
          s.plan_name,
          s.expires_at
         FROM subscriptions s
         WHERE s.is_active = true 
         AND s.expires_at IS NOT NULL 
         AND s.expires_at < CURRENT_TIMESTAMP`
      );
      
      console.log(`📊 Found ${result.rows.length} expired subscriptions`);
      
      for (const sub of result.rows) {
        console.log(`Processing expired subscription for user ${sub.user_id}`);
        await this.expireSubscription(sub.user_id, sub.id, sub.plan_type, sub.plan_name);
      }
      
      return result.rows.length;
    } catch (error) {
      console.error('❌ Error checking expired subscriptions:', error);
      return 0;
    }
  }
  
  // Деактивировать истекшую подписку
  static async expireSubscription(userId, subscriptionId, planType, planName) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      console.log(`⏰ Expiring subscription ${subscriptionId} for user ${userId}`);
      
      // Деактивируем подписку
      await client.query(
        'UPDATE subscriptions SET is_active = false, cancelled_at = CURRENT_TIMESTAMP WHERE id = $1',
        [subscriptionId]
      );
      
      // Сбрасываем все поля подписки у пользователя
      await client.query(
        `UPDATE users 
         SET is_premium = false, 
             subscription_type = NULL,
             subscription_expires_at = NULL,
             subscription_end_date = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [userId]
      );
      
      // Записываем в историю
      await client.query(
        `INSERT INTO subscriptions_history (
          user_id, subscription_id, plan_type, plan_name, 
          price_stars, action, status, created_at
        ) VALUES ($1, $2, $3, $4, 0, 'expired', 'completed', CURRENT_TIMESTAMP)`,
        [userId, subscriptionId, planType, planName]
      );
      
      await client.query('COMMIT');
      
      console.log(`✅ Subscription expired for user ${userId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error expiring subscription:', error);
    } finally {
      client.release();
    }
  }
}

module.exports = SubscriptionService;