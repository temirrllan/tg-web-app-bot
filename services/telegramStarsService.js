// services/telegramStarsService.js - ИСПРАВЛЕННАЯ ВЕРСИЯ

const db = require('../config/database');
const crypto = require('crypto');

class TelegramStarsService {
  // 🔥 ПРАВИЛЬНЫЕ ТАРИФЫ - все 4 плана с правильными ценами
  static PLANS = {
    'test': {
      name: 'Test Plan (1 Star)',
      display_name: 'Test Only',
      duration_months: 1,
      price_stars: 1, // Тестовая цена
      features: ['Testing purposes only', 'Will be 59+ Stars in production']
    },
    'month': {
      name: 'Premium for 1 Month',
      display_name: 'For 1 Month',
      duration_months: 1,
      price_stars: 59,
      features: ['Unlimited habits', 'Unlimited friends', 'Advanced statistics', 'Priority support']
    },
    '6_months': {
      name: 'Premium for 6 Months',
      display_name: 'For 6 Months',
      duration_months: 6,
      price_stars: 299,
      features: ['Unlimited habits', 'Unlimited friends', 'Advanced statistics', 'Priority support']
    },
    '1_year': {
      name: 'Premium for 1 Year',
      display_name: 'For 1 Year',
      duration_months: 12,
      price_stars: 500,
      features: ['Unlimited habits', 'Unlimited friends', 'Advanced statistics', 'Priority support', 'Save 30%']
    }
  };

  static getPlanPrice(planType) {
    const plan = this.PLANS[planType];
    if (!plan) {
      console.error(`❌ Invalid plan type: ${planType}`);
      console.log('Available plans:', Object.keys(this.PLANS));
      return null;
    }
    
    console.log(`💰 Price for ${planType}: ${plan.price_stars} XTR`);
    return plan.price_stars;
  }

  static normalizePlanType(planType) {
    if (!this.PLANS[planType]) {
      console.error(`❌ Unknown plan type: ${planType}`);
      console.log('Valid plans:', Object.keys(this.PLANS));
      return null;
    }
    
    console.log(`✅ Plan type validated: ${planType}`);
    return planType;
  }

  static generateInvoicePayload(userId, planType) {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    
    if (!this.PLANS[planType]) {
      console.error(`❌ Cannot generate payload for unknown plan: ${planType}`);
      throw new Error(`Invalid plan type: ${planType}`);
    }
    
    const payload = `${userId}|${planType}|${timestamp}|${randomString}`;
    console.log(`🔑 Generated payload: ${payload} (plan: ${planType}, price: ${this.PLANS[planType].price_stars} XTR)`);
    return payload;
  }

  static parseInvoicePayload(payload) {
    try {
      const parts = payload.split('|');
      
      if (parts.length < 2) {
        throw new Error('Invalid payload format');
      }
      
      const planType = parts[1];
      
      if (!this.PLANS[planType]) {
        console.error(`❌ Unknown plan type in payload: ${planType}`);
        console.log('Available plans:', Object.keys(this.PLANS));
        throw new Error(`Invalid plan type: ${planType}`);
      }
      
      console.log(`✅ Parsed payload: userId=${parts[0]}, planType=${planType}, price=${this.PLANS[planType].price_stars} XTR`);
      
      return {
        userId: parts[0],
        planType: planType,
        timestamp: parts[2],
        randomString: parts[3]
      };
    } catch (error) {
      console.error('❌ Error parsing payload:', error);
      throw error;
    }
  }

  static async createPaymentRecord(userId, planType, invoicePayload, amount) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      if (!this.PLANS[planType]) {
        throw new Error(`Invalid plan type: ${planType}`);
      }
      
      const existingPayment = await client.query(
        'SELECT id FROM telegram_payments WHERE invoice_payload = $1',
        [invoicePayload]
      );
      
      if (existingPayment.rows.length > 0) {
        console.log(`⚠️ Payment with payload ${invoicePayload} already exists`);
        await client.query('COMMIT');
        return existingPayment.rows[0].id;
      }
      
      const result = await client.query(
        `INSERT INTO telegram_payments (
          user_id, invoice_payload, currency, total_amount, plan_type, status, created_at
        ) VALUES ($1, $2, 'XTR', $3, $4, 'pending', CURRENT_TIMESTAMP)
        RETURNING id`,
        [userId, invoicePayload, amount, planType]
      );
      
      await client.query('COMMIT');
      
      console.log(`✅ Payment record created: ID ${result.rows[0].id}, Plan: ${planType}, Amount: ${amount} XTR`);
      return result.rows[0].id;
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error creating payment record:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  static async processSuccessfulPayment(paymentData) {
    const {
      telegram_payment_charge_id,
      provider_payment_charge_id,
      invoice_payload,
      total_amount,
      from_user_id
    } = paymentData;

    console.log('💰 ========== PROCESSING SUCCESSFUL PAYMENT ==========');
    console.log('Payment data:', {
      telegram_payment_charge_id,
      invoice_payload,
      total_amount,
      from_user_id
    });

    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      const existingPayment = await client.query(
        'SELECT id, status FROM telegram_payments WHERE telegram_payment_charge_id = $1',
        [telegram_payment_charge_id]
      );

      if (existingPayment.rows.length > 0 && existingPayment.rows[0].status === 'completed') {
        console.log(`⚠️ Payment ${telegram_payment_charge_id} already processed (duplicate webhook)`);
        await client.query('COMMIT');
        return {
          success: true,
          duplicate: true,
          message: 'Payment already processed'
        };
      }

      const userResult = await client.query(
        'SELECT id, telegram_id, first_name FROM users WHERE telegram_id = $1',
        [from_user_id.toString()]
      );

      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        console.error(`❌ User not found: telegram_id ${from_user_id}`);
        return {
          success: false,
          error: 'User not found'
        };
      }

      const user = userResult.rows[0];
      console.log(`👤 Processing payment for user: ${user.first_name} (ID: ${user.id})`);

      let parsed;
      try {
        parsed = this.parseInvoicePayload(invoice_payload);
      } catch (parseError) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed to parse invoice payload: ${invoice_payload}`, parseError);
        return {
          success: false,
          error: 'Invalid invoice payload format'
        };
      }
      
      const planType = parsed.planType;

      if (!this.PLANS[planType]) {
        await client.query('ROLLBACK');
        console.error(`❌ Invalid plan type: ${planType}`);
        return {
          success: false,
          error: `Invalid subscription plan: ${planType}`
        };
      }

      const plan = this.PLANS[planType];
      console.log(`📦 Plan: ${plan.name} (${planType}), Expected: ${plan.price_stars} XTR, Received: ${total_amount} XTR`);

      // 🔥 КРИТИЧНО: Сохраняем РЕАЛЬНУЮ цену из платежа
      const actualPrice = total_amount;

      if (actualPrice !== plan.price_stars) {
        console.warn(`⚠️ Amount mismatch! Expected ${plan.price_stars}, got ${actualPrice}`);
      }

      // Сохраняем платеж с РЕАЛЬНОЙ ценой
      await client.query(
        `INSERT INTO telegram_payments (
          user_id, telegram_payment_charge_id, provider_payment_charge_id,
          invoice_payload, currency, total_amount, plan_type, status, processed_at
        ) VALUES ($1, $2, $3, $4, 'XTR', $5, $6, 'completed', CURRENT_TIMESTAMP)
        ON CONFLICT (telegram_payment_charge_id) 
        DO UPDATE SET 
          status = 'completed',
          processed_at = CURRENT_TIMESTAMP,
          total_amount = EXCLUDED.total_amount,
          provider_payment_charge_id = EXCLUDED.provider_payment_charge_id`,
        [
          user.id,
          telegram_payment_charge_id,
          provider_payment_charge_id,
          invoice_payload,
          actualPrice, // 🔥 Реальная цена
          planType
        ]
      );
      console.log(`✅ Payment record saved with actual price: ${actualPrice} XTR`);

      // Вычисляем даты подписки
      let expiresAt = null;
      const startedAt = new Date();
      
      if (plan.duration_months) {
        expiresAt = new Date(startedAt);
        expiresAt.setMonth(expiresAt.getMonth() + plan.duration_months);
      }

      console.log(`📅 Subscription: ${startedAt.toISOString()} → ${expiresAt ? expiresAt.toISOString() : 'LIFETIME'}`);

      // 🔥 КРИТИЧНО: Деактивируем старые подписки И обновляем их expires_at
      const oldSubscriptions = await client.query(
        'SELECT id FROM subscriptions WHERE user_id = $1 AND is_active = true',
        [user.id]
      );

      if (oldSubscriptions.rows.length > 0) {
        console.log(`🔄 Deactivating ${oldSubscriptions.rows.length} old subscription(s)`);
        
        // Деактивируем и обнуляем expires_at
        await client.query(
          `UPDATE subscriptions 
           SET is_active = false, 
               cancelled_at = CURRENT_TIMESTAMP,
               expires_at = NULL
           WHERE user_id = $1 AND is_active = true`,
          [user.id]
        );
        
        console.log('✅ Old subscriptions deactivated and expires_at cleared');
      }

      // Создаём новую подписку с РЕАЛЬНОЙ ценой
      const subscriptionResult = await client.query(
        `INSERT INTO subscriptions (
          user_id, plan_type, plan_name, price_stars, 
          started_at, expires_at, is_active, is_trial,
          payment_method, telegram_payment_charge_id
        ) VALUES ($1, $2, $3, $4, $5, $6, true, false, 'telegram_stars', $7)
        RETURNING id`,
        [
          user.id,
          planType,
          plan.name,
          actualPrice, // 🔥 Реальная цена
          startedAt,
          expiresAt,
          telegram_payment_charge_id
        ]
      );
      console.log(`✅ Subscription created with actual price: ${actualPrice} XTR`);

      // Обновляем пользователя
      await client.query(
        `UPDATE users 
         SET is_premium = true,
             subscription_type = $2,
             subscription_expires_at = $3,
             subscription_start_date = $4
         WHERE id = $1`,
        [user.id, planType, expiresAt, startedAt]
      );
      console.log(`✅ User premium status updated`);

      // История с РЕАЛЬНОЙ ценой
      await client.query(
        `INSERT INTO subscriptions_history (
          user_id, subscription_id, plan_type, plan_name, price_stars, 
          action, status, payment_method, started_at, expires_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, 'purchased', 'completed', 'telegram_stars', $6, $7, CURRENT_TIMESTAMP)`,
        [user.id, subscriptionResult.rows[0].id, planType, plan.name, actualPrice, startedAt, expiresAt]
      );

      await client.query('COMMIT');

      console.log(`🎉 ========== PAYMENT PROCESSED SUCCESSFULLY ==========`);
      console.log(`User: ${user.first_name} (${user.id})`);
      console.log(`Plan: ${plan.name} (${planType})`);
      console.log(`Amount: ${actualPrice} XTR`);
      console.log(`Valid until: ${expiresAt || 'LIFETIME'}`);

      return {
        success: true,
        user_id: user.id,
        subscription_id: subscriptionResult.rows[0].id,
        plan_type: planType,
        expires_at: expiresAt
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error processing payment:', error);
      return {
        success: false,
        error: error.message
      };
    } finally {
      client.release();
    }
  }

  static async checkPaymentStatus(telegram_payment_charge_id) {
    try {
      const result = await db.query(
        `SELECT 
          tp.*,
          u.telegram_id,
          s.is_active as subscription_active
         FROM telegram_payments tp
         JOIN users u ON tp.user_id = u.id
         LEFT JOIN subscriptions s ON s.telegram_payment_charge_id = tp.telegram_payment_charge_id
         WHERE tp.telegram_payment_charge_id = $1`,
        [telegram_payment_charge_id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      console.error('Error checking payment status:', error);
      return null;
    }
  }
}

module.exports = TelegramStarsService;