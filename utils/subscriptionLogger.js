// utils/subscriptionLogger.js - Добавьте этот файл для детального логирования

const db = require('../config/database');

class SubscriptionLogger {
  /**
   * Логирует изменение премиум статуса с детальной информацией
   */
  static async logPremiumChange(operation, userId, details = {}) {
    const timestamp = new Date().toISOString();
    
    console.log('\n' + '='.repeat(80));
    console.log(`🔍 PREMIUM STATUS CHANGE - ${timestamp}`);
    console.log(`Operation: ${operation}`);
    console.log(`User ID: ${userId}`);
    console.log('='.repeat(80));
    
    try {
      // Получаем состояние ДО изменения
      const beforeState = await db.query(
        `SELECT 
          id, 
          telegram_id, 
          first_name, 
          is_premium, 
          subscription_type,
          subscription_expires_at
         FROM users 
         WHERE id = $1`,
        [userId]
      );
      
      console.log('📊 State BEFORE:', beforeState.rows[0] || 'User not found');
      
      if (details) {
        console.log('📝 Operation details:', JSON.stringify(details, null, 2));
      }
      
      // Проверяем все премиум пользователи в БД
      const allPremium = await db.query(
        'SELECT COUNT(*) as count FROM users WHERE is_premium = true'
      );
      
      console.log(`👥 Total premium users in DB: ${allPremium.rows[0].count}`);
      
      // Проверяем активные подписки
      const activeSubs = await db.query(
        `SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN user_id = $1 THEN 1 END) as for_this_user
         FROM subscriptions 
         WHERE is_active = true`,
        [userId]
      );
      
      console.log(`📋 Active subscriptions: ${activeSubs.rows[0].total} total, ${activeSubs.rows[0].for_this_user} for user ${userId}`);
      
      console.log('='.repeat(80) + '\n');
      
      return beforeState.rows[0];
      
    } catch (error) {
      console.error('❌ Error in logPremiumChange:', error);
      return null;
    }
  }
  
  /**
   * Логирует состояние ПОСЛЕ изменения
   */
  static async logAfterChange(operation, userId, beforeState) {
    const timestamp = new Date().toISOString();
    
    try {
      // Получаем состояние ПОСЛЕ изменения
      const afterState = await db.query(
        `SELECT 
          id, 
          telegram_id, 
          first_name, 
          is_premium, 
          subscription_type,
          subscription_expires_at
         FROM users 
         WHERE id = $1`,
        [userId]
      );
      
      console.log('\n' + '='.repeat(80));
      console.log(`✅ PREMIUM STATUS CHANGE COMPLETED - ${timestamp}`);
      console.log(`Operation: ${operation}`);
      console.log(`User ID: ${userId}`);
      console.log('='.repeat(80));
      console.log('📊 State AFTER:', afterState.rows[0] || 'User not found');
      
      // Сравниваем изменения
      if (beforeState && afterState.rows[0]) {
        const before = beforeState;
        const after = afterState.rows[0];
        
        console.log('\n🔄 CHANGES:');
        
        if (before.is_premium !== after.is_premium) {
          console.log(`  is_premium: ${before.is_premium} → ${after.is_premium}`);
        }
        
        if (before.subscription_type !== after.subscription_type) {
          console.log(`  subscription_type: ${before.subscription_type} → ${after.subscription_type}`);
        }
        
        if (before.subscription_expires_at !== after.subscription_expires_at) {
          console.log(`  expires_at: ${before.subscription_expires_at} → ${after.subscription_expires_at}`);
        }
      }
      
      // Проверяем все премиум пользователи в БД
      const allPremium = await db.query(
        'SELECT COUNT(*) as count FROM users WHERE is_premium = true'
      );
      
      console.log(`👥 Total premium users in DB NOW: ${allPremium.rows[0].count}`);
      
      // ⚠️ КРИТИЧЕСКАЯ ПРОВЕРКА: Не изменились ли другие пользователи?
      const otherUsersChanged = await db.query(
        `SELECT id, telegram_id, first_name, is_premium 
         FROM users 
         WHERE id != $1 
           AND is_premium = true 
         LIMIT 5`,
        [userId]
      );
      
      if (otherUsersChanged.rows.length > 0) {
        console.log('\n⚠️ WARNING: Other premium users exist:');
        otherUsersChanged.rows.forEach(user => {
          console.log(`  - User ${user.id} (${user.first_name}): is_premium = ${user.is_premium}`);
        });
      }
      
      console.log('='.repeat(80) + '\n');
      
    } catch (error) {
      console.error('❌ Error in logAfterChange:', error);
    }
  }
  
  /**
   * Проверяет, не произошло ли массового обновления
   */
  static async detectMassUpdate() {
    try {
      const result = await db.query(
        `SELECT 
          COUNT(*) as total_premium,
          COUNT(DISTINCT s.user_id) as with_subscription
         FROM users u
         LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
         WHERE u.is_premium = true`
      );
      
      const totalPremium = parseInt(result.rows[0].total_premium);
      const withSubscription = parseInt(result.rows[0].with_subscription);
      
      if (totalPremium > withSubscription) {
        console.error('\n' + '🚨'.repeat(40));
        console.error('🚨 MASS UPDATE DETECTED!');
        console.error(`🚨 ${totalPremium} premium users but only ${withSubscription} with subscriptions`);
        console.error('🚨 This means ${totalPremium - withSubscription} users have premium WITHOUT subscription!');
        console.error('🚨'.repeat(40) + '\n');
        
        // Показываем кто это
        const wrongUsers = await db.query(
          `SELECT u.id, u.telegram_id, u.first_name, u.is_premium
           FROM users u
           LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
           WHERE u.is_premium = true AND s.id IS NULL`
        );
        
        console.error('❌ Users with premium but no subscription:');
        wrongUsers.rows.forEach(user => {
          console.error(`  - User ${user.id} (${user.telegram_id}): ${user.first_name}`);
        });
        
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('❌ Error in detectMassUpdate:', error);
      return false;
    }
  }
}

module.exports = SubscriptionLogger;