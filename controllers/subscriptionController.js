// controllers/subscriptionController.js - ПОЛНАЯ ЗАМЕНА
const TelegramStarsService = require('../services/telegramStarsService');
const SubscriptionService = require('../services/subscriptionService');
const db = require('../config/database');

const subscriptionController = {
  /**
   * Создать инвойс для оплаты через Telegram Stars
   */
  async createInvoice(req, res) {
    try {
      const userId = req.user.id;
      const { planType, amount, description } = req.body;

      console.log('📝 Creating invoice:', { userId, planType, amount });

      // Валидация
      if (!planType || !amount) {
        return res.status(400).json({
          success: false,
          error: 'planType and amount are required'
        });
      }

      // Проверяем валидность плана
      const plan = SubscriptionService.PLANS[planType];
      if (!plan) {
        return res.status(400).json({
          success: false,
          error: `Invalid plan type: ${planType}`
        });
      }

      // Получаем данные пользователя
      const userResult = await db.query(
        'SELECT telegram_id, first_name FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const user = userResult.rows[0];

      // Создаем payload для отслеживания
      const payload = JSON.stringify({
        userId: userId,
        planType: planType,
        amount: amount,
        timestamp: Date.now()
      });

      // Сохраняем инвойс в БД
      const invoiceResult = await db.query(
        `INSERT INTO payment_invoices (
          user_id, plan_type, amount, status, payload
        ) VALUES ($1, $2, $3, 'pending', $4)
        RETURNING id`,
        [userId, planType, amount, payload]
      );

      const invoiceId = invoiceResult.rows[0].id;

      // Генерируем ссылку на инвойс
      // В реальном приложении здесь должен быть вызов Telegram Bot API
      // для создания инвойса и получения ссылки
      const bot = require('../server').bot;
      
      try {
        // Создаем инвойс через Telegram Bot API
        const invoice = await bot.sendInvoice(
          user.telegram_id,
          'Premium Subscription',
          description || `Habit Tracker Premium - ${plan.name}`,
          JSON.stringify({ invoiceId, userId, planType }),
          '', // provider_token - пустой для Stars
          'XTR', // currency для Stars
          [{
            label: plan.name,
            amount: amount
          }],
          {
            need_name: false,
            need_phone_number: false,
            need_email: false,
            need_shipping_address: false,
            is_flexible: false
          }
        );

        // Сохраняем message_id для отслеживания
        await db.query(
          'UPDATE payment_invoices SET invoice_link = $1 WHERE id = $2',
          [`tg://invoice/${invoice.message_id}`, invoiceId]
        );

        console.log('✅ Invoice created:', invoiceId);

        res.json({
          success: true,
          invoiceId: invoiceId,
          invoiceLink: `tg://invoice/${invoice.message_id}`,
          telegramUserId: user.telegram_id
        });
      } catch (botError) {
        console.error('❌ Failed to create Telegram invoice:', botError);
        
        // Помечаем инвойс как failed
        await db.query(
          'UPDATE payment_invoices SET status = $1 WHERE id = $2',
          ['failed', invoiceId]
        );
        
        throw botError;
      }
    } catch (error) {
      console.error('❌ Create invoice error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create invoice'
      });
    }
  },

  /**
   * Проверить статус платежа
   */
  async checkPaymentStatus(req, res) {
    try {
      const { invoiceId } = req.params;
      const userId = req.user.id;

      console.log('🔍 Checking payment status:', { invoiceId, userId });

      const result = await db.query(
        `SELECT 
          pi.*,
          s.is_active as subscription_active,
          s.plan_type as subscription_plan
         FROM payment_invoices pi
         LEFT JOIN subscriptions s ON s.transaction_id = pi.transaction_id
         WHERE pi.id = $1 AND pi.user_id = $2`,
        [invoiceId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found'
        });
      }

      const invoice = result.rows[0];

      res.json({
        success: true,
        status: invoice.status,
        isPaid: invoice.status === 'paid',
        subscriptionActive: invoice.subscription_active || false,
        data: invoice
      });
    } catch (error) {
      console.error('❌ Check payment status error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to check payment status'
      });
    }
  },

  /**
   * Применить промокод
   */
  async applyPromoCode(req, res) {
    try {
      const userId = req.user.id;
      const { promoCode } = req.body;

      console.log('🎟️ Applying promo code:', { userId, promoCode });

      if (!promoCode || !promoCode.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Promo code is required'
        });
      }

      const result = await db.query(
        `SELECT code, discount_percent 
         FROM promo_codes 
         WHERE code = $1 
         AND is_active = true 
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
        [promoCode.toUpperCase()]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Invalid or expired promo code'
        });
      }

      const promo = result.rows[0];

      // Проверяем использование
      const usageCheck = await db.query(
        `SELECT id FROM promo_code_usage 
         WHERE user_id = $1 AND promo_code = $2`,
        [userId, promo.code]
      );

      if (usageCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'You have already used this promo code'
        });
      }

      res.json({
        success: true,
        discount: {
          code: promo.code,
          discount_percent: promo.discount_percent
        }
      });
    } catch (error) {
      console.error('❌ Apply promo code error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to apply promo code'
      });
    }
  },

  /**
   * Отменить платеж
   */
  async cancelPayment(req, res) {
    try {
      const { invoiceId } = req.params;
      const userId = req.user.id;

      console.log('🚫 Cancelling payment:', { invoiceId, userId });

      const result = await db.query(
        `UPDATE payment_invoices 
         SET status = 'cancelled', 
             cancelled_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2 AND status = 'pending'
         RETURNING id`,
        [invoiceId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Invoice not found or cannot be cancelled'
        });
      }

      res.json({
        success: true,
        message: 'Payment cancelled successfully'
      });
    } catch (error) {
      console.error('❌ Cancel payment error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to cancel payment'
      });
    }
  },

  /**
   * Получить историю платежей пользователя
   */
  async getPaymentHistory(req, res) {
    try {
      const userId = req.user.id;

      console.log('📋 Getting payment history for user:', userId);

      const result = await db.query(
        `SELECT 
          id,
          plan_type,
          amount,
          status,
          created_at,
          paid_at,
          telegram_payment_id
         FROM payment_invoices
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [userId]
      );

      res.json({
        success: true,
        payments: result.rows
      });
    } catch (error) {
      console.error('❌ Get payment history error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get payment history'
      });
    }
  }
};

module.exports = subscriptionController;