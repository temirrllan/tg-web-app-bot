const db = require('../config/database');
const crypto = require('crypto');

class TelegramStarsService {
  // Тарифные планы с минимальными ценами для теста
  static PLANS = {
    '6_months': {
      name: 'Premium for 6 Months',
      duration_months: 6,
      price_stars: 1,
      features: ['Unlimited habits', 'Advanced statistics', 'Priority support']
    },
    '1_year': {
      name: 'Premium for 1 Year',
      duration_months: 12,
      price_stars: 1,
      features: ['Unlimited habits', 'Advanced statistics', 'Priority support', 'Save 40%']
    }
  };

  // Получить цену плана
  static getPlanPrice(planType) {
    const plan = this.PLANS[planType];
    if (!plan) {
      console.error(`❌ Invalid plan type: ${planType}`);
      return null;
    }
    
    console.log(`💰 Price for ${planType}: ${plan.price_stars} XTR`);
    return plan.price_stars;
  }

  // ИСПРАВЛЕННАЯ функция генерации payload - используем разделитель который не конфликтует
  static generateInvoicePayload(userId, planType) {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    // Используем | как разделитель вместо _
    const payload = `${userId}|${planType}|${timestamp}|${randomString}`;
    console.log(`🔑 Generated payload: ${payload}`);
    return payload;
  }

  // ИСПРАВЛЕННАЯ функция парсинга payload
  static parseInvoicePayload(payload) {
    try {
      // Парсим по |
      const parts = payload.split('|');
      
      if (parts.length < 2) {
        throw new Error('Invalid payload format');
      }
      
      return {
        userId: parts[0],
        planType: parts[1],
        timestamp: parts[2],
        randomString: parts[3]
      };
    } catch (error) {
      console.error('Error parsing payload:', error);
      throw error;
    }
  }

  // Создать запись о платеже
  static async createPaymentRecord(userId, planType, invoicePayload, amount) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Проверяем, нет ли уже pending платежа с таким payload
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
      
      console.log(`✅ Payment record created: ID ${result.rows[0].id}, Amount: ${amount} XTR`);
      return result.rows[0].id;
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error creating payment record:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Обработать успешный платеж
  static async processSuccessfulPayment(paymentData) {
    const {
      telegram_payment_charge_id,
      provider_payment_charge_id,
      invoice_payload,
      total_amount,
      from_user_id
    } = paymentData;

    console.log('💰 Processing successful payment:', {
      telegram_payment_charge_id,
      invoice_payload,
      total_amount,
      from_user_id
    });

    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // 1. Проверяем, не обработали ли уже этот платеж (защита от дублей)
      const existingPayment = await client.query(
        'SELECT id, status FROM telegram_payments WHERE telegram_payment_charge_id = $1',
        [telegram_payment_charge_id]
      );

      if (existingPayment.rows.length > 0) {
        const status = existingPayment.rows[0].status;
        
        if (status === 'completed') {
          console.log(`⚠️ Payment ${telegram_payment_charge_id} already processed (duplicate webhook)`);
          await client.query('COMMIT');
          return {
            success: true,
            duplicate: true,
            message: 'Payment already processed'
          };
        }
      }

      // 2. Находим пользователя по telegram_id
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

      // 3. ИСПРАВЛЕННЫЙ парсинг invoice_payload
      const parsed = this.parseInvoicePayload(invoice_payload);
      const planType = parsed.planType;

      if (!this.PLANS[planType]) {
        await client.query('ROLLBACK');
        console.error(`❌ Invalid plan type: ${planType}`);
        return {
          success: false,
          error: 'Invalid plan type'
        };
      }

      const plan = this.PLANS[planType];
      console.log(`📦 Plan: ${plan.name}`);

      // 4. Обновляем/создаем запись платежа
      await client.query(
        `INSERT INTO telegram_payments (
          user_id, telegram_payment_charge_id, provider_payment_charge_id,
          invoice_payload, currency, total_amount, plan_type, status, processed_at
        ) VALUES ($1, $2, $3, $4, 'XTR', $5, $6, 'completed', CURRENT_TIMESTAMP)
        ON CONFLICT (telegram_payment_charge_id) 
        DO UPDATE SET 
          status = 'completed',
          processed_at = CURRENT_TIMESTAMP,
          provider_payment_charge_id = EXCLUDED.provider_payment_charge_id`,
        [
          user.id,
          telegram_payment_charge_id,
          provider_payment_charge_id,
          invoice_payload,
          total_amount,
          planType
        ]
      );
      console.log(`✅ Payment record updated to completed`);

      // 5. Вычисляем дату окончания подписки
      let expiresAt = null;
      const startedAt = new Date();
      
      if (plan.duration_months) {
        expiresAt = new Date(startedAt);
        expiresAt.setMonth(expiresAt.getMonth() + plan.duration_months);
      }

      console.log(`📅 Subscription period: ${startedAt.toISOString()} to ${expiresAt ? expiresAt.toISOString() : 'LIFETIME'}`);

      // 6. Деактивируем старые подписки
      await client.query(
        'UPDATE subscriptions SET is_active = false WHERE user_id = $1 AND is_active = true',
        [user.id]
      );

      // 7. Создаем новую подписку
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
          total_amount,
          startedAt,
          expiresAt,
          telegram_payment_charge_id
        ]
      );
      console.log(`✅ Subscription created: ID ${subscriptionResult.rows[0].id}`);

      // 8. Обновляем статус пользователя
      await client.query(
        `UPDATE users 
         SET is_premium = true,
             subscription_type = $2,
             subscription_expires_at = $3
         WHERE id = $1`,
        [user.id, planType, expiresAt]
      );
      console.log(`✅ User premium status updated`);

      // 9. Записываем в историю
      await client.query(
        `INSERT INTO subscription_history (
          subscription_id, user_id, action, plan_type, price_stars, created_at
        ) VALUES ($1, $2, 'purchased', $3, $4, CURRENT_TIMESTAMP)`,
        [subscriptionResult.rows[0].id, user.id, planType, total_amount]
      );

      await client.query('COMMIT');

      console.log(`🎉 Payment processed successfully for user ${user.id}`);

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

  // Проверить статус платежа
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