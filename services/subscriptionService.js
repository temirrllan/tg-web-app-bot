const db = require('../config/database');

class SubscriptionService {
  // Конфигурация планов подписки
  static PLANS = {
    '6_months': {
      name: 'Premium for 6 Months',
      duration_months: 6,
      price_stars: 600,
      features: ['Unlimited habits', 'Advanced statistics', 'Priority support']
    },
    '1_year': {
      name: 'Premium for 1 Year',
      duration_months: 12,
      price_stars: 350,
      features: ['Unlimited habits', 'Advanced statistics', 'Priority support', 'Save 42%']
    },
    'lifetime': {
      name: 'Lifetime Premium',
      duration_months: null, // бессрочная
      price_stars: 1500,
      features: ['Unlimited habits', 'Advanced statistics', 'Priority support', 'One-time payment', 'Forever access']
    },
    'trial_7_days': {
      name: 'Free Trial (7 days)',
      duration_days: 7,
      price_stars: 0,
      features: ['Unlimited habits for 7 days', 'Try all premium features']
    }
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
      
      // Деактивируем старые подписки
      await client.query(
        'UPDATE subscriptions SET is_active = false WHERE user_id = $1 AND is_active = true',
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
          plan.price_stars,
          startedAt,
          expiresAt,
          true,
          planType.includes('trial'),
          transactionId,
          transactionId ? 'telegram_stars' : 'simulated'
        ]
      );
      
      const subscription = result.rows[0];
      
      // Обновляем статус пользователя
      await client.query(
        `UPDATE users 
         SET is_premium = true, 
             subscription_type = $2,
             subscription_expires_at = $3
         WHERE id = $1`,
        [userId, planType, expiresAt]
      );
      
      // Записываем в историю
      await client.query(
        `INSERT INTO subscription_history (
          subscription_id, user_id, action, plan_type, price_stars
        ) VALUES ($1, $2, 'created', $3, $4)`,
        [subscription.id, userId, planType, plan.price_stars]
      );
      
      await client.query('COMMIT');
      
      console.log(`✅ Subscription created: User ${userId}, Plan ${planType}, Expires: ${expiresAt || 'Never'}`);
      
      return {
        success: true,
        subscription,
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
      const result = await db.query(
        `SELECT 
          s.*,
          u.is_premium,
          (SELECT COUNT(*) FROM habits WHERE user_id = $1 AND is_active = true) as habit_count
         FROM users u
         LEFT JOIN subscriptions s ON s.user_id = u.id AND s.is_active = true
         WHERE u.id = $1`,
        [userId]
      );
      
      if (result.rows.length === 0) {
        return {
          hasSubscription: false,
          isPremium: false,
          habitCount: 0,
          limit: 3,
          canCreateMore: true
        };
      }
      
      const data = result.rows[0];
      const now = new Date();
      
      // Проверяем, не истекла ли подписка
      let isValid = false;
      if (data.expires_at === null) {
        // Lifetime подписка
        isValid = true;
      } else if (data.expires_at) {
        isValid = new Date(data.expires_at) > now;
      }
      
      // Если подписка истекла, деактивируем её
      if (!isValid && data.is_active) {
        await this.expireSubscription(userId, data.id);
        data.is_premium = false;
        data.is_active = false;
      }
      
      const isPremium = data.is_premium && isValid;
      const limit = isPremium ? 999 : 3;
      const habitCount = parseInt(data.habit_count);
      
      return {
        hasSubscription: data.id ? true : false,
        subscription: data.id ? {
          id: data.id,
          planType: data.plan_type,
          planName: data.plan_name,
          startsAt: data.started_at,
          expiresAt: data.expires_at,
          isActive: data.is_active && isValid,
          isTrial: data.is_trial,
          daysLeft: data.expires_at ? Math.ceil((new Date(data.expires_at) - now) / (1000 * 60 * 60 * 24)) : null
        } : null,
        isPremium,
        habitCount,
        limit,
        canCreateMore: habitCount < limit
      };
    } catch (error) {
      console.error('❌ Error checking subscription:', error);
      throw error;
    }
  }
  
  // Деактивировать истекшую подписку
  static async expireSubscription(userId, subscriptionId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Деактивируем подписку
      await client.query(
        'UPDATE subscriptions SET is_active = false WHERE id = $1',
        [subscriptionId]
      );
      
      // Обновляем статус пользователя
      await client.query(
        `UPDATE users 
         SET is_premium = false, 
             subscription_type = NULL,
             subscription_expires_at = NULL
         WHERE id = $1`,
        [userId]
      );
      
      // Записываем в историю
      await client.query(
        `INSERT INTO subscription_history (
          subscription_id, user_id, action
        ) VALUES ($1, $2, 'expired')`,
        [subscriptionId, userId]
      );
      
      await client.query('COMMIT');
      
      console.log(`⏰ Subscription expired for user ${userId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error expiring subscription:', error);
    } finally {
      client.release();
    }
  }
  
  // Отменить подписку
  static async cancelSubscription(userId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Находим активную подписку
      const subResult = await client.query(
        'SELECT id, plan_type FROM subscriptions WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      
      if (subResult.rows.length === 0) {
        throw new Error('No active subscription found');
      }
      
      const subscription = subResult.rows[0];
      
      // Отменяем подписку
      await client.query(
        `UPDATE subscriptions 
         SET is_active = false, 
             auto_renew = false,
             cancelled_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [subscription.id]
      );
      
      // Обновляем статус пользователя
      await client.query(
        `UPDATE users 
         SET is_premium = false,
             subscription_type = NULL,
             subscription_expires_at = NULL
         WHERE id = $1`,
        [userId]
      );
      
      // Записываем в историю
      await client.query(
        `INSERT INTO subscription_history (
          subscription_id, user_id, action, plan_type
        ) VALUES ($1, $2, 'cancelled', $3)`,
        [subscription.id, userId, subscription.plan_type]
      );
      
      await client.query('COMMIT');
      
      console.log(`❌ Subscription cancelled for user ${userId}`);
      
      return {
        success: true,
        message: 'Subscription cancelled successfully'
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error cancelling subscription:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  // Проверить и деактивировать истекшие подписки (запускать по крону)
  static async checkExpiredSubscriptions() {
    try {
      const result = await db.query(
        `SELECT id, user_id 
         FROM subscriptions 
         WHERE is_active = true 
         AND expires_at IS NOT NULL 
         AND expires_at < CURRENT_TIMESTAMP`
      );
      
      console.log(`🔍 Found ${result.rows.length} expired subscriptions`);
      
      for (const sub of result.rows) {
        await this.expireSubscription(sub.user_id, sub.id);
      }
      
      return result.rows.length;
    } catch (error) {
      console.error('❌ Error checking expired subscriptions:', error);
      return 0;
    }
  }
}

module.exports = SubscriptionService;