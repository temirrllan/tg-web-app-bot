const cron = require('node-cron');
const SubscriptionService = require('./subscriptionService');
const db = require('../config/database');

class SubscriptionCronService {
  constructor() {
    this.task = null;
  }
  
  start() {
    // Проверяем истекшие подписки каждый день в 00:05
    this.task = cron.schedule('5 0 * * *', async () => {
      console.log('🔍 Checking for expired subscriptions...');
      
      try {
        const expiredCount = await this.checkAndExpireSubscriptions();
        console.log(`✅ Processed ${expiredCount} expired subscriptions`);
      } catch (error) {
        console.error('❌ Error in subscription cron job:', error);
      }
    }, {
      scheduled: true,
      timezone: process.env.TZ || "UTC"
    });
    
    console.log('⏰ Subscription cron service started');
    
    // Проверяем сразу при запуске
    setTimeout(() => {
      this.checkAndExpireSubscriptions();
    }, 5000);
  }
  
  async checkAndExpireSubscriptions() {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Находим истёкшие подписки
      const expiredResult = await client.query(
        `SELECT 
          s.id as subscription_id,
          s.user_id,
          s.plan_type,
          s.plan_name,
          s.expires_at
         FROM subscriptions s
         WHERE s.is_active = true 
         AND s.expires_at IS NOT NULL 
         AND s.expires_at < CURRENT_TIMESTAMP`
      );
      
      console.log(`📊 Found ${expiredResult.rows.length} expired subscriptions`);
      
      for (const sub of expiredResult.rows) {
        console.log(`Processing expired subscription for user ${sub.user_id}`);
        
       // Деактивируем подписку
        await client.query(
          'UPDATE subscriptions SET is_active = false WHERE id = $1',
          [sub.subscription_id]
        );
        
        // Обновляем статус пользователя
        await client.query(
          `UPDATE users 
           SET is_premium = false,
               subscription_type = NULL,
               subscription_expires_at = NULL
           WHERE id = $1`,
          [sub.user_id]
        );
        
        // Добавляем запись в историю
        await client.query(
          `INSERT INTO subscriptions_history (
            user_id, subscription_id, plan_type, plan_name, 
            price_stars, action, status, created_at
          ) VALUES ($1, $2, $3, $4, 0, 'expired', 'completed', CURRENT_TIMESTAMP)`,
          [sub.user_id, sub.subscription_id, sub.plan_type, sub.plan_name]
        );
        
        console.log(`✅ Subscription ${sub.subscription_id} expired for user ${sub.user_id}`);
        
        // Отправляем уведомление пользователю
        try {
          const bot = require('../server').bot;
          const userResult = await client.query(
            'SELECT telegram_id, language FROM users WHERE id = $1',
            [sub.user_id]
          );
          
          if (userResult.rows.length > 0) {
            const { telegram_id, language } = userResult.rows[0];
            const lang = language || 'en';
            
            const message = lang === 'ru'
              ? `⚠️ <b>Ваша подписка истекла</b>\n\nВаш премиум план "${sub.plan_name}" истёк.\nВы вернулись на бесплатный тариф с лимитом в 3 привычки.\n\nЧтобы продлить подписку, откройте приложение.`
              : `⚠️ <b>Your subscription has expired</b>\n\nYour premium plan "${sub.plan_name}" has expired.\nYou're now on the free plan with a limit of 3 habits.\n\nTo renew your subscription, open the app.`;
            
            await bot.sendMessage(telegram_id, message, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: lang === 'ru' ? '📱 Открыть приложение' : '📱 Open App',
                    web_app: { url: process.env.WEBAPP_URL || process.env.FRONTEND_URL }
                  }
                ]]
              }
            });
          }
        } catch (notifyError) {
          console.error('Failed to send expiration notification:', notifyError.message);
        }
      }
      
      await client.query('COMMIT');
      return expiredResult.rows.length;
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error in checkAndExpireSubscriptions:', error);
      return 0;
    } finally {
      client.release();
    }
  }
  
  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('⏰ Subscription cron service stopped');
    }
  }
}

module.exports = new SubscriptionCronService();