const SubscriptionService = require('../services/subscriptionService');
const PromoCodeService = require('../services/promoCodeService');
const TelegramStarsService = require('../services/telegramStarsService');

const paymentController = {
  /**
   * Валидация промокода
   */
  async validatePromoCode(req, res) {
    try {
      const { code, planType } = req.body;
      const userId = req.user.id;
      
      if (!code || !planType) {
        return res.status(400).json({
          success: false,
          error: 'Code and plan type are required'
        });
      }
      
      const validation = await PromoCodeService.validatePromoCode(code, userId, planType);
      
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error
        });
      }
      
      // Получаем цену плана
      const plan = SubscriptionService.PLANS[planType];
      if (!plan) {
        return res.status(400).json({
          success: false,
          error: 'Invalid plan type'
        });
      }
      
      // Рассчитываем скидку
      const pricing = PromoCodeService.calculateDiscountedPrice(
        plan.price_stars,
        validation.discountPercent,
        validation.discountStars
      );
      
      res.json({
        success: true,
        valid: true,
        promoId: validation.promoId,
        pricing: {
          originalPrice: pricing.originalPrice,
          finalPrice: pricing.finalPrice,
          discount: pricing.discount,
          discountPercent: validation.discountPercent
        },
        bonusDays: validation.bonusDays
      });
    } catch (error) {
      console.error('Validate promo error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to validate promo code'
      });
    }
  },

  /**
   * Создание платежа
   */
  async createPayment(req, res) {
    try {
      const { planType, promoCode } = req.body;
      const userId = req.user.id;
      const telegramId = req.user.telegram_id;
      
      console.log(`💳 Creating payment for user ${userId}, plan ${planType}`);
      
      // Получаем план
      const plan = SubscriptionService.PLANS[planType];
      if (!plan) {
        return res.status(400).json({
          success: false,
          error: 'Invalid plan type'
        });
      }
      
      let finalPrice = plan.price_stars;
      let promoId = null;
      let bonusDays = null;
      
      // Применяем промокод если указан
      if (promoCode) {
        const validation = await PromoCodeService.validatePromoCode(promoCode, userId, planType);
        
        if (validation.valid) {
          const pricing = PromoCodeService.calculateDiscountedPrice(
            plan.price_stars,
            validation.discountPercent,
            validation.discountStars
          );
          
          finalPrice = pricing.finalPrice;
          promoId = validation.promoId;
          bonusDays = validation.bonusDays;
          
          console.log(`🎫 Promo code applied: ${finalPrice} stars (was ${plan.price_stars})`);
        }
      }
      
      // Создаем инвойс через Telegram
      const invoice = await TelegramStarsService.createInvoice(
        telegramId,
        planType,
        finalPrice,
        plan.name
      );
      
      if (!invoice.success) {
        throw new Error('Failed to create invoice');
      }
      
      // Сохраняем информацию о pending платеже
      // (можно создать отдельную таблицу pending_payments)
      
      res.json({
        success: true,
        invoice: invoice.invoiceUrl,
        amount: finalPrice,
        planType,
        promoApplied: !!promoId
      });
    } catch (error) {
      console.error('Create payment error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create payment'
      });
    }
  },

  /**
   * Webhook для обработки успешного платежа от Telegram
   */
  async handlePaymentWebhook(req, res) {
    try {
      const { successful_payment } = req.body.message || {};
      
      if (!successful_payment) {
        return res.sendStatus(400);
      }
      
      console.log('💰 Received payment webhook:', successful_payment);
      
      // Обрабатываем платеж
      const payment = await TelegramStarsService.handleSuccessfulPayment(successful_payment);
      
      if (!payment.success) {
        throw new Error('Payment processing failed');
      }
      
      const { userId, planType, amount, transactionId } = payment;
      
      // Активируем подписку
      const subscription = await SubscriptionService.createSubscription(
        userId,
        planType,
        transactionId
      );
      
      if (!subscription.success) {
        throw new Error('Failed to activate subscription');
      }
      
      // Получаем пользователя для отправки уведомления
      const db = require('../config/database');
      const userResult = await db.query(
        'SELECT telegram_id FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length > 0) {
        const telegramId = userResult.rows[0].telegram_id;
        await TelegramStarsService.sendSubscriptionConfirmation(
          telegramId,
          planType,
          subscription.subscription.expires_at
        );
      }
      
      res.sendStatus(200);
    } catch (error) {
      console.error('Payment webhook error:', error);
      res.sendStatus(500);
    }
  },

  /**
   * Получить ссылку для покупки Stars
   */
  async getBuyStarsLink(req, res) {
    try {
      const link = TelegramStarsService.getBuyStarsLink();
      
      res.json({
        success: true,
        link
      });
    } catch (error) {
      console.error('Get buy stars link error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get link'
      });
    }
  }
};

module.exports = paymentController;