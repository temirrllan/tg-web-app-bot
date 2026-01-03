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
      
      // 🔥 КРИТИЧНО: Находим истёкшие подписки с user_id
      const expiredResult = await client.query(
        `SELECT 
          s.id as subscription_id,
          s.user_id,
          s.plan_type,
          s.plan_name,
          s.price_stars,
          s.expires_at,
          u.telegram_id,
          u.first_name
         FROM subscriptions s
         JOIN users u ON s.user_id = u.id
         WHERE s.is_active = true 
         AND s.expires_at IS NOT NULL 
         AND s.expires_at < CURRENT_TIMESTAMP`
      );
      
      console.log(`📊 Found ${expiredResult.rows.length} expired subscriptions`);
      
      // 🔥 КРИТИЧНО: Обрабатываем КАЖДУЮ подписку отдельно
      for (const sub of expiredResult.rows) {
        const userId = sub.user_id; // ✅ Используем конкретный user_id
        
        console.log(`⏰ Processing expired subscription for user ${userId} (${sub.first_name})`);
        
        // 🔥 ШАГ 1: Деактивируем подписку КОНКРЕТНОГО пользователя
        // ✅ КРИТИЧНО: WHERE id = $1
        await client.query(
          'UPDATE subscriptions SET is_active = false, cancelled_at = CURRENT_TIMESTAMP WHERE id = $1',
          [sub.subscription_id]
        );
        
        console.log(`✅ Subscription ${sub.subscription_id} deactivated`);
        
        // 🔥 ШАГ 2: Проверяем, есть ли у пользователя другие активные подписки
        const otherActiveSubs = await client.query(
          `SELECT COUNT(*) as count 
           FROM subscriptions 
           WHERE user_id = $1 
             AND is_active = true 
             AND id != $2`,
          [userId, sub.subscription_id]
        );
        
        const hasOtherActiveSubs = parseInt(otherActiveSubs.rows[0].count) > 0;
        
        if (hasOtherActiveSubs) {
          console.log(`ℹ️ User ${userId} has other active subscriptions, keeping premium status`);
          continue; // Пропускаем, у пользователя есть другие активные подписки
        }
        
        // 🔥 ШАГ 3: Обновляем статус КОНКРЕТНОГО пользователя
        // ✅ КРИТИЧНО: WHERE id = $1 - обновляет ТОЛЬКО этого пользователя
        console.log(`🔄 Removing premium status from user ${userId}`);
        
        const updateResult = await client.query(
          `UPDATE users 
           SET is_premium = false,
               subscription_type = NULL,
               subscription_expires_at = NULL
           WHERE id = $1
           RETURNING id, telegram_id, first_name, is_premium`,
          [userId]
        );
        
        if (updateResult.rows.length > 0) {
          console.log(`✅ User ${userId} (${updateResult.rows[0].first_name}) downgraded to free:`, {
            id: updateResult.rows[0].id,
            is_premium: updateResult.rows[0].is_premium
          });
        } else {
          console.error(`❌ Failed to update user ${userId} - user not found`);
        }
        
        // 🔥 ШАГ 4: Добавляем запись в историю
        try {
          // Проверяем, нет ли уже записи
          const existingHistory = await client.query(
            `SELECT id FROM subscription_history 
             WHERE subscription_id = $1 AND action = 'expired'`,
            [sub.subscription_id]
          );
          
          if (existingHistory.rows.length === 0) {
            await client.query(
              `INSERT INTO subscription_history (
                user_id, subscription_id, plan_type, price_stars, action, created_at
              ) VALUES ($1, $2, $3, $4, 'expired', CURRENT_TIMESTAMP)`,
              [userId, sub.subscription_id, sub.plan_type, sub.price_stars || 0]
            );
            console.log(`✅ History record created for user ${userId}`);
          } else {
            console.log(`ℹ️ History record already exists for subscription ${sub.subscription_id}`);
          }
        } catch (histError) {
          console.warn(`⚠️ Failed to create history record for user ${userId}:`, histError.message);
        }
        
        console.log(`✅ Subscription ${sub.subscription_id} expired for user ${userId} ONLY`);
        
        // 🔥 ШАГ 5: Отправляем уведомление пользователю
        try {
          const bot = require('../server').bot;
          
          const lang = await client.query(
            'SELECT language FROM users WHERE id = $1',
            [userId]
          );
          
          const language = lang.rows.length > 0 ? lang.rows[0].language : 'en';
          
          const messages = {
            ru: `⚠️ <b>Ваша подписка истекла</b>\n\nВаш премиум план "${sub.plan_name}" истёк.\nВы вернулись на бесплатный тариф с лимитом в 3 привычки.\n\nЧтобы продлить подписку, откройте приложение.`,
            en: `⚠️ <b>Your subscription has expired</b>\n\nYour premium plan "${sub.plan_name}" has expired.\nYou're now on the free plan with a limit of 3 habits.\n\nTo renew your subscription, open the app.`,
            kk: `⚠️ <b>Жазылымыңыз аяқталды</b>\n\nСіздің "${sub.plan_name}" жоспарыңыз аяқталды.\nСіз 3 әдет шегімен тегін жоспарға оралдыңыз.\n\nЖазылымды жаңарту үшін қосымшаны ашыңыз.`
          };
          
          const message = messages[language] || messages['en'];
          
          await bot.sendMessage(sub.telegram_id, message, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: language === 'ru' ? '📱 Открыть приложение' : 
                        language === 'kk' ? '📱 Қосымшаны ашу' : '📱 Open App',
                  web_app: { url: process.env.WEBAPP_URL || process.env.FRONTEND_URL }
                }
              ]]
            }
          });
          
          console.log(`✅ Expiration notification sent to user ${userId}`);
        } catch (notifyError) {
          console.warn(`⚠️ Failed to send notification to user ${userId}:`, notifyError.message);
        }
      }
      
      await client.query('COMMIT');
      
      // 🔥 ФИНАЛЬНАЯ ПРОВЕРКА
      const premiumCount = await client.query(
        'SELECT COUNT(*) as count FROM users WHERE is_premium = true'
      );
      console.log(`📊 Total premium users after expiration check: ${premiumCount.rows[0].count}`);
      
      return expiredResult.rows.length;
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error in checkAndExpireSubscriptions:', error);
      console.error('Stack:', error.stack);
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