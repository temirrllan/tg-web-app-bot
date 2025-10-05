const TelegramStarsService = require('../services/telegramStarsService');
const SubscriptionService = require('../services/subscriptionService');

const subscriptionController = {
  /**
   * Создать invoice для оплаты через Telegram Stars
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

      // Создаем invoice
      const invoiceData = await TelegramStarsService.createInvoice({
        userId,
        planType,
        amount,
        description: description || `Premium Subscription - ${plan.name}`
      });

      console.log('✅ Invoice created:', invoiceData.invoiceId);

      res.json({
        success: true,
        ...invoiceData
      });
    } catch (error) {
      console.error('❌ Create invoice error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create invoice'
      });
    }
  },

  /**
   * Webhook для обработки платежей от Telegram
   */
  async handlePaymentWebhook(req, res) {
    try {
      const { invoice_payload, telegram_payment_charge_id } = req.body;

      console.log('💳 Payment webhook received:', {
        invoice_payload,
        telegram_payment_charge_id
      });

      if (!invoice_payload || !telegram_payment_charge_id) {
        return res.status(400).json({
          success: false,
          error: 'Invalid webhook data'
        });
      }

      // Парсим payload
      const payload = JSON.parse(invoice_payload);
      const { invoiceId, userId, planType } = payload;

      // Обрабатываем платеж
      const result = await TelegramStarsService.processSuccessfulPayment({
        invoiceId,
        transactionId: telegram_payment_charge_id,
        telegramPaymentId: telegram_payment_charge_id
      });

      if (result.success) {
        console.log('✅ Payment processed successfully');
        res.json({ success: true });
      } else {
        console.log('⚠️ Payment processing failed:', result.message);
        res.status(400).json({
          success: false,
          error: result.message
        });
      }
    } catch (error) {
      console.error('❌ Payment webhook error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Webhook processing failed'
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

      const result = await TelegramStarsService.checkPaymentStatus(invoiceId);

      res.json(result);
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

      // Проверяем промокод в базе данных
      const db = require('../config/database');
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

      // Проверяем, не использовал ли пользователь этот промокод раньше
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

      console.log('✅ Promo code valid:', promo);

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

      const result = await TelegramStarsService.cancelPayment(invoiceId);

      res.json(result);
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

      const result = await TelegramStarsService.getUserPayments(userId);

      res.json(result);
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