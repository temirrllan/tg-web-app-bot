const cron = require('node-cron');
const SubscriptionService = require('./subscriptionService');

class SubscriptionCronService {
  constructor() {
    this.task = null;
  }
  
  start() {
    // Проверяем истекшие подписки каждый день в 00:05
    this.task = cron.schedule('5 0 * * *', async () => {
      console.log('🔍 Checking for expired subscriptions...');
      
      try {
        const expiredCount = await SubscriptionService.checkExpiredSubscriptions();
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
      SubscriptionService.checkExpiredSubscriptions();
    }, 5000);
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