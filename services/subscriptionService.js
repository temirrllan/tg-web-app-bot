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
  // Проверить статус подписки пользователя
static async checkUserSubscription(userId) {
  try {
    console.log(`🔍 Checking subscription for user ${userId}`);
    
    // Получаем актуальные данные из таблицы users
    const result = await db.query(
      `SELECT 
        u.id,
        u.is_premium,
        u.subscription_type,
        u.subscription_expires_at,
        (SELECT COUNT(*) FROM habits WHERE user_id = u.id AND is_active = true) as habit_count
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
        limit: 3,
        canCreateMore: true
      };
    }
    
    const userData = result.rows[0];
    const now = new Date();
    
    console.log(`📊 User ${userId} subscription data:`, {
      is_premium: userData.is_premium,
      subscription_type: userData.subscription_type,
      subscription_expires_at: userData.subscription_expires_at
    });
    
    // Проверяем актуальность подписки
    let isActive = false;
    let subscription = null;
    
    if (userData.is_premium && userData.subscription_type) {
      // Проверяем срок действия
      if (userData.subscription_expires_at) {
        const expiresAt = new Date(userData.subscription_expires_at);
        isActive = expiresAt > now;
        
        if (isActive) {
          const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
          
          subscription = {
            isActive: true,
            planType: userData.subscription_type,
            planName: this.PLANS[userData.subscription_type]?.name || 'Premium',
            expiresAt: userData.subscription_expires_at,
            daysLeft: daysLeft > 0 ? daysLeft : 0,
            isTrial: userData.subscription_type === 'trial_7_days'
          };
        } else {
          // Подписка истекла - деактивируем
          console.log(`⏰ Subscription expired for user ${userId}`);
          await db.query(
            `UPDATE users 
             SET is_premium = false, 
                 subscription_type = NULL,
                 subscription_expires_at = NULL
             WHERE id = $1`,
            [userId]
          );
        }
      } else {
        // Lifetime подписка
        isActive = true;
        subscription = {
          isActive: true,
          planType: userData.subscription_type,
          planName: this.PLANS[userData.subscription_type]?.name || 'Lifetime Premium',
          expiresAt: null,
          daysLeft: null,
          isTrial: false
        };
      }
    }
    
    const habitCount = parseInt(userData.habit_count);
    const limit = isActive ? 999 : 3;
    
    console.log(`✅ User ${userId} status: Premium=${isActive}, Habits=${habitCount}/${limit}`);
    
    return {
      hasSubscription: isActive,
      subscription: subscription,
      isPremium: isActive,
      habitCount,
      limit,
      canCreateMore: habitCount < limit
    };
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
  // В файле services/subscriptionService.js

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
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'No active subscription found'
      };
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