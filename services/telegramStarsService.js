// services/telegramStarsService.js - ИСПРАВЛЕННАЯ ВЕРСИЯ (БЕЗ МАССОВОГО ОБНОВЛЕНИЯ)

const db = require('../config/database');
const crypto = require('crypto');

class TelegramStarsService {
  static PLANS = {
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

  /**
   * 🔥 ИСПРАВЛЕНО: Обработка платежа БЕЗ массового обновления
   */
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

      // Проверка на дубликат
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

      // 🔥 Получаем пользователя
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
      const internalUserId = user.id;

      console.log(`👤 Processing payment for user:`, {
        telegram_id: from_user_id,
        internal_user_id: internalUserId,
        first_name: user.first_name
      });

      // Парсим payload
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

      const actualPrice = total_amount;

      if (actualPrice !== plan.price_stars) {
        console.warn(`⚠️ Amount mismatch! Expected ${plan.price_stars}, got ${actualPrice}`);
      }

      // Сохраняем платеж
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
          internalUserId,
          telegram_payment_charge_id,
          provider_payment_charge_id,
          invoice_payload,
          actualPrice,
          planType
        ]
      );
      console.log(`✅ Payment record saved for user ${internalUserId}`);

      // Вычисляем даты подписки
      let expiresAt = null;
      const startedAt = new Date();
      
      if (plan.duration_months) {
        expiresAt = new Date(startedAt);
        expiresAt.setMonth(expiresAt.getMonth() + plan.duration_months);
      }

      console.log(`📅 Subscription: ${startedAt.toISOString()} → ${expiresAt ? expiresAt.toISOString() : 'LIFETIME'}`);

      // 🔥 КРИТИЧНО: Деактивируем ТОЛЬКО старые подписки ЭТОГО пользователя
      const oldSubscriptions = await client.query(
        'SELECT id FROM subscriptions WHERE user_id = $1 AND is_active = true',
        [internalUserId]
      );

      if (oldSubscriptions.rows.length > 0) {
        console.log(`🔄 Deactivating ${oldSubscriptions.rows.length} old subscription(s) for user ${internalUserId}...`);
        
        // ✅ КРИТИЧНО: WHERE user_id = $1
        await client.query(
          `UPDATE subscriptions 
           SET is_active = false, 
               cancelled_at = CURRENT_TIMESTAMP,
               expires_at = NULL
           WHERE user_id = $1 AND is_active = true`,
          [internalUserId]
        );
        
        console.log(`✅ Old subscriptions deactivated ONLY for user ${internalUserId}`);
      }

      // Создаём новую подписку
      const subscriptionResult = await client.query(
        `INSERT INTO subscriptions (
          user_id, plan_type, plan_name, price_stars, 
          started_at, expires_at, is_active, is_trial,
          payment_method, telegram_payment_charge_id
        ) VALUES ($1, $2, $3, $4, $5, $6, true, false, 'telegram_stars', $7)
        RETURNING id`,
        [
          internalUserId,
          planType,
          plan.name,
          actualPrice,
          startedAt,
          expiresAt,
          telegram_payment_charge_id
        ]
      );
      console.log(`✅ Subscription created for user ${internalUserId}, ID: ${subscriptionResult.rows[0].id}`);

      // 🔥 КРИТИЧНО: Обновляем ТОЛЬКО ЭТОГО конкретного пользователя
      console.log(`🔄 Updating ONLY user ${internalUserId} (telegram_id: ${from_user_id}) to premium...`);
      console.log('🔍 BEFORE UPDATE - checking all users premium status...');
      
      const beforeUpdate = await client.query('SELECT COUNT(*) as count FROM users WHERE is_premium = true');
const beforeCount = parseInt(beforeUpdate.rows[0].count);
      console.log(`📊 Premium users BEFORE update: ${beforeCount}`);
      
      // ✅ КРИТИЧНО: WHERE id = $1 - обновляет ТОЛЬКО этого пользователя
      console.log(`📝 Executing UPDATE for user_id=${internalUserId} with params:`, {
        internalUserId,
        planType,
        expiresAt,
        startedAt
      });
      
      const updateResult = await client.query(
        `UPDATE users 
         SET is_premium = true,
             subscription_type = $2,
             subscription_expires_at = $3,
             subscription_start_date = $4
         WHERE id = $1
         RETURNING id, telegram_id, first_name, is_premium, subscription_type`,
        [internalUserId, planType, expiresAt, startedAt]
      );
      
      console.log('🔍 AFTER UPDATE - checking all users premium status...');
const afterUpdate = await client.query('SELECT COUNT(*) as count FROM users WHERE is_premium = true');
const afterCount = parseInt(afterUpdate.rows[0].count);  // ✅ ПРЕОБРАЗУЕМ В ЧИСЛО
console.log(`📊 Premium users AFTER update: ${afterCount}`);

// ✅ КРИТИЧНО: Сравниваем ЧИСЛА, а не строки
const expectedCount = beforeCount + 1;

console.log(`🔍 Comparison: ${afterCount} > ${expectedCount} = ${afterCount > expectedCount}`);

if (afterCount > expectedCount) {
  console.error('🚨🚨🚨 MASS UPDATE DETECTED! More than 1 user got premium! 🚨🚨🚨');
  console.error(`Before: ${beforeCount}, After: ${afterCount}, Expected: ${expectedCount}`);
  await client.query('ROLLBACK');
  throw new Error('MASS UPDATE DETECTED - Transaction rolled back!');
}
      if (updateResult.rows.length === 0) {
        throw new Error(`Failed to update user ${internalUserId}`);
      }

      console.log(`✅ User ${internalUserId} updated to premium:`, {
        id: updateResult.rows[0].id,
        telegram_id: updateResult.rows[0].telegram_id,
        first_name: updateResult.rows[0].first_name,
        is_premium: updateResult.rows[0].is_premium,
        subscription_type: updateResult.rows[0].subscription_type
      });

      // 🔥 ФИНАЛЬНАЯ ПРОВЕРКА
      const verifyUser = await client.query(
        'SELECT id, telegram_id, first_name, is_premium FROM users WHERE id = $1',
        [internalUserId]
      );
      console.log(`🔍 Verification - updated user:`, verifyUser.rows[0]);

      const premiumCount = await client.query(
        'SELECT COUNT(*) as count FROM users WHERE is_premium = true'
      );
      console.log(`📊 Total premium users in database: ${premiumCount.rows[0].count}`);

      // История
      try {
        await client.query(
          `INSERT INTO subscription_history (
            user_id, subscription_id, plan_type, price_stars, action, created_at
          ) VALUES ($1, $2, $3, $4, 'purchased', CURRENT_TIMESTAMP)`,
          [internalUserId, subscriptionResult.rows[0].id, planType, actualPrice]
        );
        console.log(`✅ History record created for user ${internalUserId}`);
      } catch (histError) {
        console.warn('⚠️ History insert failed (non-critical):', histError.message);
      }

      await client.query('COMMIT');

      console.log(`🎉 ========== PAYMENT PROCESSED SUCCESSFULLY ==========`);
      console.log(`User: ${user.first_name} (Internal ID: ${internalUserId}, Telegram ID: ${from_user_id})`);
      console.log(`Plan: ${plan.name} (${planType})`);
      console.log(`Amount: ${actualPrice} XTR`);
      console.log(`Valid until: ${expiresAt || 'LIFETIME'}`);
      console.log(`Updated ONLY this user, not all users`);

      return {
        success: true,
        user_id: internalUserId,
        subscription_id: subscriptionResult.rows[0].id,
        plan_type: planType,
        expires_at: expiresAt
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error processing payment:', error);
      console.error('Stack:', error.stack);
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
  // Добавляем в класс TelegramStarsService

static async createPackInvoice(userId, packId, amountStars) {
  const bot = require('../server').bot;
  
  // Получаем данные пака
  const packResult = await db.query(
    'SELECT title, short_description FROM store_packs WHERE id = $1',
    [packId]
  );
  
  if (packResult.rows.length === 0) {
    throw new Error('Pack not found');
  }
  
  const pack = packResult.rows[0];
  
  // Генерируем payload для отслеживания платежа
  const payload = `pack_${packId}_${userId}_${Date.now()}`;
  
  // Создаём invoice
  const invoice = await bot.createInvoiceLink(
    pack.title,
    pack.short_description || 'Habit pack',
    payload,
    '', // provider_token (пустая строка для Telegram Stars)
    'XTR', // currency (Telegram Stars)
    [{ label: pack.title, amount: amountStars }],
    {
      need_name: false,
      need_phone_number: false,
      need_email: false,
      need_shipping_address: false
    }
  );
  
  // Сохраняем в БД для отслеживания
  await db.query(
    `UPDATE pack_orders 
     SET provider_invoice_id = $1, status = 'PENDING'
     WHERE user_id = $2 
     AND pack_id = $3 
     AND status = 'CREATED'`,
    [payload, userId, packId]
  );
  
  return { link: invoice };
}

static async processPackPayment(paymentData) {
  const {
    telegram_payment_charge_id,
    invoice_payload,
    total_amount,
    from_user_id
  } = paymentData;
  
  console.log('💰 Processing pack payment:', {
    telegram_payment_charge_id,
    invoice_payload,
    total_amount
  });
  
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    // Парсим payload
    const parts = invoice_payload.split('_');
    if (parts[0] !== 'pack') {
      throw new Error('Not a pack payment');
    }
    
    const packId = parseInt(parts[1]);
    const userId = parseInt(parts[2]);
    
    // Обновляем заказ
    await client.query(
      `UPDATE pack_orders 
       SET status = 'PAID', 
           provider_payment_id = $1,
           paid_at = CURRENT_TIMESTAMP
       WHERE provider_invoice_id = $2`,
      [telegram_payment_charge_id, invoice_payload]
    );
    
    // Создаём запись владения
    const purchaseResult = await client.query(
      `INSERT INTO pack_purchases (user_id, pack_id, order_id, source, status)
       SELECT $1, $2, id, 'paid', 'ACTIVE'
       FROM pack_orders
       WHERE provider_invoice_id = $3
       RETURNING id`,
      [userId, packId, invoice_payload]
    );
    
    const purchaseId = purchaseResult.rows[0].id;
    
    await client.query('COMMIT');
    
    // Устанавливаем привычки (асинхронно, вне транзакции)
    const packService = require('./packService');
    await packService.installPackHabits(purchaseId);
    
    return {
      success: true,
      purchase_id: purchaseId,
      pack_id: packId
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Pack payment processing error:', error);
    throw error;
  } finally {
    client.release();
  }
}
}

module.exports = TelegramStarsService;