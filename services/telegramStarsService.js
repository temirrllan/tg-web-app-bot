// services/telegramStarsService.js - КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ

const db = require('../config/database');
const crypto = require('crypto');

class TelegramStarsService {
  static PLANS = {
    // 'test': {
    //   name: 'Test Plan (1 Star)',
    //   display_name: 'Test Only',
    //   duration_months: 1,
    //   price_stars: 1,
    //   features: ['Testing purposes only']
    // },
    'month': {
      name: 'Premium for 1 Month',
      display_name: 'For 1 Month',
      duration_months: 1,
      price_stars: 1, // тута 59
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
      return null;
    }
    console.log(`💰 Price for ${planType}: ${plan.price_stars} XTR`);
    return plan.price_stars;
  }

  static normalizePlanType(planType) {
    if (!this.PLANS[planType]) {
      console.error(`❌ Unknown plan type: ${planType}`);
      return null;
    }
    return planType;
  }

  static generateInvoicePayload(userId, planType) {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    
    if (!this.PLANS[planType]) {
      throw new Error(`Invalid plan type: ${planType}`);
    }
    
    const payload = `${userId}|${planType}|${timestamp}|${randomString}`;
    console.log(`🔑 Generated payload: ${payload}`);
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
        throw new Error(`Invalid plan type: ${planType}`);
      }
      
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
      
      console.log(`📝 Creating payment record for user ${userId}`);
      
      const existingPayment = await client.query(
        'SELECT id, user_id FROM telegram_payments WHERE invoice_payload = $1',
        [invoicePayload]
      );
      
      if (existingPayment.rows.length > 0) {
        const existingUserId = existingPayment.rows[0].user_id;
        console.log(`⚠️ Payment exists: ID ${existingPayment.rows[0].id}, User: ${existingUserId}`);
        
        // 🔥 ПРОВЕРКА: Если user_id не совпадает - это баг!
        if (existingUserId !== userId) {
          console.error(`❌ BUG DETECTED! Payment user_id ${existingUserId} != expected ${userId}`);
          throw new Error('Payment user_id mismatch');
        }
        
        await client.query('COMMIT');
        return existingPayment.rows[0].id;
      }
      
      const result = await client.query(
        `INSERT INTO telegram_payments (
          user_id, invoice_payload, currency, total_amount, plan_type, status, created_at
        ) VALUES ($1, $2, 'XTR', $3, $4, 'pending', CURRENT_TIMESTAMP)
        RETURNING id, user_id`,
        [userId, invoicePayload, amount, planType]
      );
      
      const insertedUserId = result.rows[0].user_id;
      console.log(`✅ Payment created: ID ${result.rows[0].id}, User: ${insertedUserId}`);
      
      // 🔥 ПРОВЕРКА: Сразу после вставки
      if (insertedUserId !== userId) {
        console.error(`❌ INSERT BUG! Inserted user_id ${insertedUserId} != expected ${userId}`);
        await client.query('ROLLBACK');
        throw new Error('Payment insert user_id mismatch');
      }
      
      await client.query('COMMIT');
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

    console.log('💰 ========== PROCESSING PAYMENT ==========');
    console.log('Payment data:', {
      telegram_payment_charge_id,
      invoice_payload,
      total_amount,
      from_user_id
    });

    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // 🔥 ПРОВЕРКА: Дубликат платежа
      const existingPayment = await client.query(
        'SELECT id, status, user_id FROM telegram_payments WHERE telegram_payment_charge_id = $1',
        [telegram_payment_charge_id]
      );

      if (existingPayment.rows.length > 0) {
        const existing = existingPayment.rows[0];
        console.log(`⚠️ Payment already exists: ID ${existing.id}, User ${existing.user_id}, Status: ${existing.status}`);
        
        if (existing.status === 'completed') {
          await client.query('COMMIT');
          return {
            success: true,
            duplicate: true,
            message: 'Payment already processed',
            user_id: existing.user_id
          };
        }
      }

      // 🔥 КРИТИЧНО: Получаем ПРАВИЛЬНОГО пользователя по telegram_id
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
      const internalUserId = user.id; // 🔥 Это ID из таблицы users

      console.log(`👤 Found user:`, {
        telegram_id: from_user_id,
        internal_user_id: internalUserId,
        first_name: user.first_name
      });

      // 🔥 ПАРСИМ payload
      let parsed;
      try {
        parsed = this.parseInvoicePayload(invoice_payload);
      } catch (parseError) {
        await client.query('ROLLBACK');
        console.error(`❌ Invalid payload: ${invoice_payload}`, parseError);
        return {
          success: false,
          error: 'Invalid invoice payload'
        };
      }
      
      const planType = parsed.planType;
      const payloadUserId = parseInt(parsed.userId); // ID из payload

      console.log(`📋 Parsed payload:`, {
        payloadUserId,
        internalUserId,
        planType,
        match: payloadUserId === internalUserId
      });

      // 🔥 КРИТИЧЕСКАЯ ПРОВЕРКА: ID должны совпадать!
      if (payloadUserId !== internalUserId) {
        console.error(`❌ USER ID MISMATCH!`);
        console.error(`Payload userId: ${payloadUserId}`);
        console.error(`Actual userId: ${internalUserId}`);
        await client.query('ROLLBACK');
        return {
          success: false,
          error: 'User ID mismatch - security check failed'
        };
      }

      const plan = this.PLANS[planType];
      if (!plan) {
        await client.query('ROLLBACK');
        console.error(`❌ Invalid plan: ${planType}`);
        return {
          success: false,
          error: `Invalid plan: ${planType}`
        };
      }

      console.log(`📦 Plan: ${plan.name}, Price: ${total_amount} XTR`);

      // 🔥 Сохраняем платёж с ПРАВИЛЬНЫМ user_id
      await client.query(
        `INSERT INTO telegram_payments (
          user_id, telegram_payment_charge_id, provider_payment_charge_id,
          invoice_payload, currency, total_amount, plan_type, status, processed_at
        ) VALUES ($1, $2, $3, $4, 'XTR', $5, $6, 'completed', CURRENT_TIMESTAMP)
        ON CONFLICT (telegram_payment_charge_id) 
        DO UPDATE SET 
          status = 'completed',
          processed_at = CURRENT_TIMESTAMP,
          total_amount = EXCLUDED.total_amount`,
        [
          internalUserId, // 🔥 ПРАВИЛЬНЫЙ ID
          telegram_payment_charge_id,
          provider_payment_charge_id,
          invoice_payload,
          total_amount,
          planType
        ]
      );

      console.log(`✅ Payment saved for user ${internalUserId}`);

      // 🔥 Вычисляем даты
      let expiresAt = null;
      const startedAt = new Date();
      
      if (plan.duration_months) {
        expiresAt = new Date(startedAt);
        expiresAt.setMonth(expiresAt.getMonth() + plan.duration_months);
      }

      // 🔥 Деактивируем старые подписки ТОЛЬКО этого пользователя
      await client.query(
        `UPDATE subscriptions 
         SET is_active = false, 
             cancelled_at = CURRENT_TIMESTAMP,
             expires_at = NULL
         WHERE user_id = $1`,
        [internalUserId] // 🔥 ТОЛЬКО этого пользователя!
      );

      console.log(`✅ Old subscriptions deactivated for user ${internalUserId}`);

      // 🔥 Создаём подписку для ПРАВИЛЬНОГО пользователя
      const subscriptionResult = await client.query(
        `INSERT INTO subscriptions (
          user_id, plan_type, plan_name, price_stars, 
          started_at, expires_at, is_active, is_trial,
          payment_method, telegram_payment_charge_id
        ) VALUES ($1, $2, $3, $4, $5, $6, true, false, 'telegram_stars', $7)
        RETURNING id, user_id`,
        [
          internalUserId, // 🔥 ПРАВИЛЬНЫЙ ID
          planType,
          plan.name,
          total_amount,
          startedAt,
          expiresAt,
          telegram_payment_charge_id
        ]
      );

      const subUserId = subscriptionResult.rows[0].user_id;
      console.log(`✅ Subscription created: ID ${subscriptionResult.rows[0].id}, User: ${subUserId}`);

      // 🔥 ПРОВЕРКА: user_id должен совпадать
      if (subUserId !== internalUserId) {
        console.error(`❌ SUBSCRIPTION USER_ID MISMATCH! ${subUserId} != ${internalUserId}`);
        await client.query('ROLLBACK');
        throw new Error('Subscription user_id mismatch');
      }

      // 🔥 КРИТИЧНО: Обновляем ТОЛЬКО этого пользователя
      const updateResult = await client.query(
        `UPDATE users 
         SET is_premium = true,
             subscription_type = $1,
             subscription_expires_at = $2,
             subscription_start_date = $3
         WHERE id = $4
         RETURNING id, telegram_id, is_premium, subscription_type`,
        [planType, expiresAt, startedAt, internalUserId] // 🔥 ID в конце WHERE!
      );

      if (updateResult.rows.length === 0) {
        console.error(`❌ User ${internalUserId} not found for update`);
        await client.query('ROLLBACK');
        throw new Error('User not found');
      }

      const updatedUser = updateResult.rows[0];
      console.log(`✅ User updated:`, updatedUser);

      // 🔥 ФИНАЛЬНАЯ ПРОВЕРКА
      if (updatedUser.id !== internalUserId) {
        console.error(`❌ UPDATED WRONG USER! ${updatedUser.id} != ${internalUserId}`);
        await client.query('ROLLBACK');
        throw new Error('Updated wrong user');
      }

      // История
      await client.query(
        `INSERT INTO subscription_history (
          user_id, subscription_id, plan_type, plan_name, price_stars, 
          action, status, payment_method, started_at, expires_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, 'purchased', 'completed', 'telegram_stars', $6, $7, CURRENT_TIMESTAMP)`,
        [internalUserId, subscriptionResult.rows[0].id, planType, plan.name, total_amount, startedAt, expiresAt]
      );

      await client.query('COMMIT');

      console.log(`🎉 ========== PAYMENT COMPLETED ==========`);
      console.log(`User: ${user.first_name} (ID: ${internalUserId})`);
      console.log(`Plan: ${plan.name}`);

      return {
        success: true,
        user_id: internalUserId,
        subscription_id: subscriptionResult.rows[0].id,
        plan_type: planType,
        expires_at: expiresAt
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Payment processing error:', error);
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

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      console.error('Error checking payment status:', error);
      return null;
    }
  }
}

module.exports = TelegramStarsService;