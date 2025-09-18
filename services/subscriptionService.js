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
          transactionId ? 'telegram_stars' : 'simulated'
        ]
      );
      
      const subscription = result.rows[0];
      console.log(`✅ Subscription created with ID: ${subscription.id}`);
      
      // ВАЖНО: Обновляем ВСЕ необходимые поля в таблице users
      const updateUserResult = await client.query(
        `UPDATE users 
         SET 
           is_premium = true, 
           subscription_type = $2,
           subscription_expires_at = $3
         WHERE id = $1
         RETURNING id, is_premium, subscription_type, subscription_expires_at`,
        [userId, planType, expiresAt]
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
        `INSERT INTO subscription_history (
          subscription_id, user_id, action, plan_type, price_stars
        ) VALUES ($1, $2, 'created', $3, $4)`,
        [subscription.id, userId, planType, plan.price_stars || 0]
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
      
      // Получаем данные пользователя и подписки одним запросом
      const result = await db.query(
        `SELECT 
          u.id,
          u.is_premium,
          u.subscription_type,
          u.subscription_expires_at,
          s.id as subscription_id,
          s.plan_type,
          s.plan_name,
          s.started_at,
          s.expires_at,
          s.is_active as subscription_active,
          s.is_trial,
          (SELECT COUNT(*) FROM habits WHERE user_id = $1 AND is_active = true) as habit_count
         FROM users u
         LEFT JOIN subscriptions s ON s.user_id = u.id AND s.is_active = true
         WHERE u.id = $1`,
        [userId]
      );
      
      if (result.rows.length === 0) {
        console.log(`❌ User ${userId} not found`);
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
      
      console.log(`📊 User ${userId} subscription data:`, {
        is_premium: data.is_premium,
        subscription_type: data.subscription_type,
        subscription_expires_at: data.subscription_expires_at,
        has_active_subscription: !!data.subscription_id
      });
      
      // Проверяем, не истекла ли подписка
      let isValid = false;
      let needsUpdate = false;
      
      // Приоритет отдаем данным из таблицы subscriptions если они есть
      if (data.subscription_id) {
        if (data.expires_at === null) {
          // Lifetime подписка
          isValid = true;
        } else if (data.expires_at) {
          isValid = new Date(data.expires_at) > now;
          if (!isValid) {
            needsUpdate = true;
          }
        }
        
        // Синхронизируем данные если они не совпадают
        if (isValid && (!data.is_premium || data.subscription_type !== data.plan_type)) {
          console.log(`⚠️ Syncing user data with active subscription`);
          await db.query(
            `UPDATE users 
             SET is_premium = true, 
                 subscription_type = $2,
                 subscription_expires_at = $3
             WHERE id = $1`,
            [userId, data.plan_type, data.expires_at]
          );
          data.is_premium = true;
          data.subscription_type = data.plan_type;
          data.subscription_expires_at = data.expires_at;
        }
      } else if (data.is_premium && data.subscription_expires_at) {
        // Проверяем по данным из users таблицы
        if (data.subscription_expires_at === null) {
          isValid = true;
        } else {
          isValid = new Date(data.subscription_expires_at) > now;
          if (!isValid) {
            needsUpdate = true;
          }
        }
      }
      
      // Если подписка истекла, деактивируем её
      if (needsUpdate) {
        console.log(`⏰ Subscription expired for user ${userId}, deactivating...`);
        if (data.subscription_id) {
          await this.expireSubscription(userId, data.subscription_id);
        } else {
          // Просто сбрасываем премиум статус
          await db.query(
            `UPDATE users 
             SET is_premium = false, 
                 subscription_type = NULL,
                 subscription_expires_at = NULL
             WHERE id = $1`,
            [userId]
          );
        }
        data.is_premium = false;
        data.subscription_type = null;
        data.subscription_expires_at = null;
        isValid = false;
      }
      
      const isPremium = data.is_premium && isValid;
      const limit = isPremium ? 999 : 3;
      const habitCount = parseInt(data.habit_count);
      
      console.log(`✅ User ${userId} status: Premium=${isPremium}, Habits=${habitCount}/${limit}`);
      
      // Формируем ответ с правильными данными
      const subscriptionData = {
        hasSubscription: !!data.subscription_id || (data.is_premium && data.subscription_type),
        subscription: null,
        isPremium,
        habitCount,
        limit,
        canCreateMore: habitCount < limit
      };
      
      // Добавляем детали подписки если она есть
      if ((data.subscription_id || data.subscription_type) && isValid) {
        subscriptionData.subscription = {
          id: data.subscription_id,
          planType: data.plan_type || data.subscription_type,
          planName: data.plan_name || this.PLANS[data.subscription_type]?.name,
          startsAt: data.started_at,
          expiresAt: data.expires_at || data.subscription_expires_at,
          isActive: isValid,
          isTrial: data.is_trial || false,
          daysLeft: (data.expires_at || data.subscription_expires_at) ? 
            Math.ceil(((new Date(data.expires_at || data.subscription_expires_at)) - now) / (1000 * 60 * 60 * 24)) : null
        };
      }
      
      return subscriptionData;
    } catch (error) {
      console.error('❌ Error checking subscription:', error);
      return {
        hasSubscription: false,
        isPremium: false,
        habitCount: 0,
        limit: 3,
        canCreateMore: true,
        error: error.message
      };
    }
  }
  
  // Деактивировать истекшую подписку
  static async expireSubscription(userId, subscriptionId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      console.log(`⏰ Expiring subscription ${subscriptionId} for user ${userId}`);
      
      // Деактивируем подписку
      await client.query(
        'UPDATE subscriptions SET is_active = false, cancelled_at = CURRENT_TIMESTAMP WHERE id = $1',
        [subscriptionId]
      );
      
      // ВАЖНО: Сбрасываем все поля подписки у пользователя
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
      
      console.log(`✅ Subscription expired for user ${userId}`);
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
      
      console.log(`🚫 Cancelling subscription for user ${userId}`);
      
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
      
      // ВАЖНО: Сбрасываем все поля подписки у пользователя
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
      
      console.log(`✅ Subscription cancelled for user ${userId}`);
      
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
      console.log('🔍 Checking for expired subscriptions...');
      
      const result = await db.query(
        `SELECT 
          s.id, 
          s.user_id,
          s.plan_type,
          s.expires_at
         FROM subscriptions s
         WHERE s.is_active = true 
         AND s.expires_at IS NOT NULL 
         AND s.expires_at < CURRENT_TIMESTAMP`
      );
      
      console.log(`📊 Found ${result.rows.length} expired subscriptions`);
      
      for (const sub of result.rows) {
        console.log(`Processing expired subscription for user ${sub.user_id}`);
        await this.expireSubscription(sub.user_id, sub.id);
      }
      
      // Также синхронизируем пользователей где данные не совпадают
      const syncResult = await db.query(
        `SELECT u.id, u.subscription_type, s.plan_type, s.expires_at
         FROM users u
         LEFT JOIN subscriptions s ON s.user_id = u.id AND s.is_active = true
         WHERE u.is_premium = true
         AND (
           (s.id IS NULL AND u.subscription_type IS NULL) OR
           (s.id IS NOT NULL AND u.subscription_type != s.plan_type)
         )`
      );
      
      if (syncResult.rows.length > 0) {
        console.log(`📊 Found ${syncResult.rows.length} users needing sync`);
        
        for (const user of syncResult.rows) {
          if (user.plan_type) {
            // Есть активная подписка - синхронизируем
            await db.query(
              `UPDATE users 
               SET subscription_type = $2,
                   subscription_expires_at = $3
               WHERE id = $1`,
              [user.id, user.plan_type, user.expires_at]
            );
            console.log(`✅ Synced user ${user.id} with subscription ${user.plan_type}`);
          } else {
            // Нет активной подписки - сбрасываем премиум
            await db.query(
              `UPDATE users 
               SET is_premium = false,
                   subscription_type = NULL,
                   subscription_expires_at = NULL
               WHERE id = $1`,
              [user.id]
            );
            console.log(`✅ Reset premium for user ${user.id} (no active subscription)`);
          }
        }
      }
      
      return result.rows.length + syncResult.rows.length;
    } catch (error) {
      console.error('❌ Error checking expired subscriptions:', error);
      return 0;
    }
  }
}

module.exports = SubscriptionService;