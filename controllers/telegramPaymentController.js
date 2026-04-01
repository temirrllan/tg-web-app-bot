const TelegramStarsService = require('../services/telegramStarsService');
const PromoCodeService = require('../services/promoCodeService');
const SubscriptionService = require('../services/subscriptionService');
const db = require('../config/database');

const telegramPaymentController = {
  // Обработка webhook от Telegram
  async handleWebhook(req, res) {
    try {
      // Проверяем секретный токен Telegram
      const BOT_SECRET = process.env.BOT_SECRET;
      const secretHeader = req.get('x-telegram-bot-api-secret-token');
      if (!BOT_SECRET || secretHeader !== BOT_SECRET) {
        console.error('❌ Payment webhook: unauthorized request');
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      console.log('📥 ========== TELEGRAM PAYMENT WEBHOOK ==========');
      console.log('Body:', JSON.stringify(req.body, null, 2));

      const update = req.body;

      let payment = null;
      let from_user_id = null;

      // ВАЖНО: Проверяем successful_payment в разных местах
      if (update.message?.successful_payment) {
        payment = update.message.successful_payment;
        from_user_id = update.message.from.id;
        console.log('✅ Found successful_payment in message');
      } else if (update.callback_query?.message?.successful_payment) {
        payment = update.callback_query.message.successful_payment;
        from_user_id = update.callback_query.from.id;
        console.log('✅ Found successful_payment in callback_query');
      } else if (update.pre_checkout_query) {
        console.log('📋 Received pre_checkout_query - handling in bot.on handler');
        // Pre-checkout обрабатывается в server.js через bot.on('pre_checkout_query')
        return res.status(200).json({ success: true, message: 'Pre-checkout handled by bot' });
      }

      if (payment) {
        const paymentData = {
          telegram_payment_charge_id: payment.telegram_payment_charge_id,
          provider_payment_charge_id: payment.provider_payment_charge_id,
          invoice_payload: payment.invoice_payload,
          total_amount: payment.total_amount,
          currency: payment.currency,
          from_user_id: from_user_id
        };

        console.log('💳 Processing successful payment:', paymentData);

        // КРИТИЧЕСКИ ВАЖНО: Обрабатываем платёж
        const result = await TelegramStarsService.processSuccessfulPayment(paymentData);

        if (result.success) {
          console.log('✅ Payment processed successfully');
          console.log('✅ User ID:', result.user_id);
          console.log('✅ Subscription ID:', result.subscription_id);
          console.log('✅ Plan type:', result.plan_type);
          console.log('✅ Expires at:', result.expires_at);
          
          // ВАЖНО: Проверяем что данные действительно обновились
          const verificationResult = await db.query(
            'SELECT id, is_premium, subscription_type, subscription_expires_at FROM users WHERE id = $1',
            [result.user_id]
          );
          
          console.log('🔍 Verification after payment:', verificationResult.rows[0]);
          
          // Отправляем уведомление пользователю
          try {
            const bot = require('../server').bot;
            
            const userResult = await db.query(
              'SELECT language FROM users WHERE telegram_id = $1',
              [from_user_id.toString()]
            );
            
            const lang = userResult.rows.length > 0 ? userResult.rows[0].language : 'en';
            
            const messages = {
              ru: '🎉 <b>Оплата прошла успешно!</b>\n\nВаша Premium подписка активирована!\n\n✅ Безлимитные привычки\n✅ Расширенная статистика\n✅ Приоритетная поддержка\n\nОткройте приложение и наслаждайтесь! 💪',
              en: '🎉 <b>Payment successful!</b>\n\nYour Premium subscription is now active!\n\n✅ Unlimited habits\n✅ Advanced statistics\n✅ Priority support\n\nOpen the app and enjoy! 💪',
              kk: '🎉 <b>Төлем сәтті өтті!</b>\n\nСіздің Premium жазылымыңыз белсендірілді!\n\n✅ Шексіз әдеттер\n✅ Кеңейтілген статистика\n✅ Басым қолдау\n\nҚосымшаны ашып, ләззат алыңыз! 💪'
            };
            
            const message = messages[lang] || messages['en'];
            
            await bot.sendMessage(from_user_id, message, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: lang === 'ru' ? '📱 Открыть приложение' : lang === 'kk' ? '📱 Қосымшаны ашу' : '📱 Open App',
                    web_app: { 
                      url: process.env.WEBAPP_URL || process.env.FRONTEND_URL 
                    }
                  }
                ]]
              }
            });
            
            console.log('✅ Confirmation message sent to user');
          } catch (botError) {
            console.error('⚠️ Failed to send confirmation (non-critical):', botError.message);
          }

          return res.status(200).json({ 
            success: true,
            user_id: result.user_id,
            subscription_id: result.subscription_id
          });
        } else {
          console.error('❌ Payment processing failed:', result.error);
          return res.status(200).json({ success: false, error: result.error });
        }
      }

      console.log('ℹ️ Not a payment update, acknowledging');
      res.status(200).json({ success: true, message: 'Update received' });

    } catch (error) {
      console.error('💥 Webhook error:', error);
      console.error('Stack:', error.stack);
      res.status(200).json({ success: false, error: error.message });
    }
  },

  // Создать invoice и получить invoice URL
  async createInvoice(req, res) {
    try {
      const { planType, promoCode } = req.body;
      const userId = req.user.id;

      console.log(`📨 Creating Telegram Stars invoice for user ${userId}, plan: ${planType}, promo: ${promoCode || 'none'}`);

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

      const { telegram_id, first_name } = userResult.rows[0];

      const normalizedPlan = TelegramStarsService.normalizePlanType(planType);
      console.log(`🔄 Plan mapping: ${planType} -> ${normalizedPlan}`);

      const originalPrice = TelegramStarsService.getPlanPrice(normalizedPlan);
      const plan = TelegramStarsService.PLANS[normalizedPlan];

      if (!originalPrice || !plan) {
        console.error(`❌ Invalid plan: ${planType} (normalized: ${normalizedPlan})`);
        return res.status(400).json({
          success: false,
          error: `Invalid plan: ${planType}`
        });
      }

      // Валидация и применение промокода
      let promoData = null;
      let finalPrice = originalPrice;

      if (promoCode) {
        const validation = await PromoCodeService.validatePromoCode(promoCode, userId);
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            error: `promo_${validation.error}`,
            promoError: validation.error
          });
        }
        promoData = validation;
        finalPrice = PromoCodeService.calculateDiscountedPrice(originalPrice, validation.discountStars);
        console.log(`🏷️ Promo applied: -${validation.discountStars} stars, final price: ${finalPrice} XTR`);
      }

      const price = finalPrice;
      console.log(`💰 Plan: ${plan.name}, Price: ${price} XTR (Telegram Stars)`);

      // Генерируем payload с promoCodeId если есть
      const promoCodeId = promoData ? promoData.promo.id : null;
      const invoicePayload = TelegramStarsService.generateInvoicePayload(userId, planType, promoCodeId);

      await TelegramStarsService.createPaymentRecord(userId, planType, invoicePayload, price, promoCodeId);

      const bot = require('../server').bot;
      
      console.log('📤 Creating Telegram Stars invoice link...');
      console.log('Invoice params:', {
        title: plan.name,
        description: plan.features.join('\n'),
        payload: invoicePayload,
        currency: 'XTR',
        prices: [{ label: plan.name, amount: price }]
      });

      try {
        // КРИТИЧЕСКИ ВАЖНО: Для Telegram Stars provider_token должен быть ПУСТОЙ строкой
        const invoiceLink = await bot.createInvoiceLink(
          plan.name,                           // title
          plan.features.join('\n'),            // description  
          invoicePayload,                      // payload
          '',                                  // provider_token - ПУСТАЯ строка для Stars
          'XTR',                               // currency - ОБЯЗАТЕЛЬНО XTR
          [{ label: plan.name, amount: price }] // prices
          // Telegram Stars НЕ поддерживает дополнительные параметры
        );

        console.log('✅ Telegram Stars invoice link created:', invoiceLink);

        res.json({
          success: true,
          invoiceUrl: invoiceLink,
          invoicePayload: invoicePayload,
          price: price,
          originalPrice: originalPrice,
          planName: plan.name,
          currency: 'XTR',
          promoApplied: !!promoData,
          promoDiscount: promoData ? promoData.discountStars : 0,
          promoBonusDays: promoData ? promoData.bonusDays : 0
        });

      } catch (botError) {
        console.error('❌ Failed to create invoice link:', botError);
        console.error('Bot error details:', {
          message: botError.message,
          response: botError.response?.body,
          statusCode: botError.response?.statusCode,
          description: botError.response?.description
        });
        
        // Специфичные ошибки Telegram Stars
        if (botError.message.includes('CURRENCY_TOTAL_AMOUNT_INVALID')) {
          return res.status(400).json({
            success: false,
            error: 'Invalid amount for Telegram Stars. Minimum is 1 XTR.',
            code: 'invalid_amount'
          });
        }
        
        if (botError.response?.statusCode === 403) {
          return res.status(403).json({
            success: false,
            error: 'User has blocked the bot',
            code: 'bot_blocked'
          });
        }

        if (botError.message.includes('PAYMENT_PROVIDER_INVALID')) {
          return res.status(400).json({
            success: false,
            error: 'Telegram Stars payment is not properly configured. Please ensure your bot supports Star payments.',
            code: 'payment_provider_invalid'
          });
        }

        return res.status(500).json({
          success: false,
          error: `Failed to create invoice: ${botError.message}`,
          code: 'invoice_creation_failed'
        });
      }

    } catch (error) {
      console.error('💥 Create invoice error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create invoice',
        details: error.message
      });
    }
  },

  // Старый метод для отправки invoice кнопки (оставляем для обратной совместимости)
  async requestInvoiceButton(req, res) {
    try {
      const { planType } = req.body;
      const userId = req.user.id;

      console.log(`📨 Sending invoice button to user ${userId}, plan: ${planType}`);

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

      const { telegram_id, first_name } = userResult.rows[0];

      const normalizedPlan = TelegramStarsService.normalizePlanType(planType);
      const price = TelegramStarsService.getPlanPrice(normalizedPlan);
      const plan = TelegramStarsService.PLANS[normalizedPlan];

      if (!price || !plan) {
        return res.status(400).json({
          success: false,
          error: 'Invalid plan'
        });
      }

      console.log(`💰 Plan: ${plan.name}, Price: ${price} XTR`);

      const invoicePayload = TelegramStarsService.generateInvoicePayload(userId, planType);

      await TelegramStarsService.createPaymentRecord(userId, planType, invoicePayload, price);

      const bot = require('../server').bot;

      try {
        await bot.sendInvoice(
          telegram_id,
          plan.name,
          plan.features.join('\n'),
          invoicePayload,
          '',
          'XTR',
          [{ label: plan.name, amount: price }]
        );

        console.log('✅ Invoice sent successfully');

        res.json({
          success: true,
          message: 'Invoice sent to user',
          invoicePayload: invoicePayload
        });

      } catch (botError) {
        console.error('❌ Failed to send invoice:', botError);
        
        if (botError.response?.statusCode === 403) {
          return res.status(403).json({
            success: false,
            error: 'User has blocked the bot',
            code: 'bot_blocked'
          });
        }

        throw botError;
      }

    } catch (error) {
      console.error('💥 Send invoice error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send invoice'
      });
    }
  },

  // Валидация промокода
  async validatePromo(req, res) {
    try {
      const { code, planType } = req.body;
      const userId = req.user.id;

      if (!code) {
        return res.status(400).json({ success: false, error: 'Code required' });
      }

      const validation = await PromoCodeService.validatePromoCode(code, userId);

      if (!validation.valid) {
        return res.json({
          success: true,
          valid: false,
          error: validation.error
        });
      }

      // Рассчитываем цену со скидкой для указанного плана
      const normalizedPlan = TelegramStarsService.normalizePlanType(planType);
      const originalPrice = normalizedPlan ? TelegramStarsService.getPlanPrice(normalizedPlan) : null;
      const finalPrice = originalPrice !== null
        ? PromoCodeService.calculateDiscountedPrice(originalPrice, validation.discountStars)
        : null;

      return res.json({
        success: true,
        valid: true,
        discount_stars: validation.discountStars,
        bonus_days: validation.bonusDays,
        original_price: originalPrice,
        final_price: finalPrice,
        promo_id: validation.promo.id,
        promo_description: validation.promo.description
      });
    } catch (error) {
      console.error('❌ Validate promo error:', error);
      res.status(500).json({ success: false, error: 'Failed to validate promo code' });
    }
  },

  // Активация подписки с промокодом (бесплатная — 100% скидка)
  async activateWithPromo(req, res) {
    try {
      const { planType, promoCode } = req.body;
      const userId = req.user.id;

      if (!promoCode || !planType) {
        return res.status(400).json({ success: false, error: 'planType and promoCode required' });
      }

      const normalizedPlan = TelegramStarsService.normalizePlanType(planType);
      const plan = TelegramStarsService.PLANS[normalizedPlan];
      if (!plan) {
        return res.status(400).json({ success: false, error: `Invalid plan: ${planType}` });
      }

      // Валидация промокода
      const validation = await PromoCodeService.validatePromoCode(promoCode, userId);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: `promo_${validation.error}`,
          promoError: validation.error
        });
      }

      const originalPrice = plan.price_stars;
      const finalPrice = PromoCodeService.calculateDiscountedPrice(originalPrice, validation.discountStars);

      if (finalPrice > 0) {
        return res.status(400).json({
          success: false,
          error: 'not_free',
          message: 'This promo code does not cover 100% of the price. Use create-invoice instead.',
          final_price: finalPrice
        });
      }

      console.log(`🎁 Free activation with promo for user ${userId}, plan: ${planType}`);

      // Активация в транзакции
      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        // Применяем промокод (с блокировкой)
        await PromoCodeService.applyPromoCode(client, validation.promo.id, userId);

        // Деактивируем старые подписки ТОЛЬКО этого пользователя
        await client.query(
          `UPDATE subscriptions
           SET is_active = false, cancelled_at = CURRENT_TIMESTAMP, expires_at = NULL
           WHERE user_id = $1 AND is_active = true`,
          [userId]
        );

        // Рассчитываем даты
        const startedAt = new Date();
        let expiresAt = new Date(startedAt);
        expiresAt.setMonth(expiresAt.getMonth() + plan.duration_months);

        // Добавляем бонусные дни
        if (validation.bonusDays > 0) {
          expiresAt.setDate(expiresAt.getDate() + validation.bonusDays);
        }

        // Создаём подписку
        const subResult = await client.query(
          `INSERT INTO subscriptions (
            user_id, plan_type, plan_name, price_stars,
            started_at, expires_at, is_active, is_trial,
            payment_method, promo_code_id, promo_discount_stars, bonus_days
          ) VALUES ($1, $2, $3, 0, $4, $5, true, false, 'promo_code', $6, $7, $8)
          RETURNING id`,
          [userId, planType, plan.name, startedAt, expiresAt,
           validation.promo.id, validation.discountStars, validation.bonusDays]
        );

        // Обновляем пользователя
        await client.query(
          `UPDATE users
           SET is_premium = true, subscription_type = $2,
               subscription_expires_at = $3, subscription_start_date = $4
           WHERE id = $1`,
          [userId, planType, expiresAt, startedAt]
        );

        // История
        await client.query(
          `INSERT INTO subscription_history (
            user_id, subscription_id, plan_type, price_stars, action, created_at
          ) VALUES ($1, $2, $3, 0, 'purchased', CURRENT_TIMESTAMP)`,
          [userId, subResult.rows[0].id, planType]
        );

        // Запись в telegram_payments для учёта
        await client.query(
          `INSERT INTO telegram_payments (
            user_id, invoice_payload, currency, total_amount, plan_type,
            status, processed_at, promo_code_id, promo_discount_stars
          ) VALUES ($1, $2, 'XTR', 0, $3, 'completed', CURRENT_TIMESTAMP, $4, $5)`,
          [userId, `promo_${userId}_${planType}_${Date.now()}`, planType,
           validation.promo.id, validation.discountStars]
        );

        await client.query('COMMIT');

        console.log(`🎉 Free subscription activated for user ${userId} via promo code`);

        // Уведомление через бот
        try {
          const bot = require('../server').bot;
          const userResult = await db.query(
            'SELECT telegram_id, language FROM users WHERE id = $1',
            [userId]
          );
          if (userResult.rows.length > 0) {
            const { telegram_id, language } = userResult.rows[0];
            const messages = {
              ru: '🎉 <b>Промокод активирован!</b>\n\nВаша Premium подписка активирована бесплатно!\n\n✅ Безлимитные привычки\n✅ Расширенная статистика\n✅ Приоритетная поддержка\n\nОткройте приложение и наслаждайтесь! 💪',
              en: '🎉 <b>Promo code activated!</b>\n\nYour Premium subscription is now active for free!\n\n✅ Unlimited habits\n✅ Advanced statistics\n✅ Priority support\n\nOpen the app and enjoy! 💪',
              kk: '🎉 <b>Промокод белсендірілді!</b>\n\nСіздің Premium жазылымыңыз тегін белсендірілді!\n\n✅ Шексіз әдеттер\n✅ Кеңейтілген статистика\n✅ Басым қолдау\n\nҚосымшаны ашып, ләззат алыңыз! 💪'
            };
            const msg = messages[language] || messages['en'];
            await bot.sendMessage(telegram_id, msg, { parse_mode: 'HTML' });
          }
        } catch (botErr) {
          console.warn('⚠️ Failed to send promo notification:', botErr.message);
        }

        return res.json({
          success: true,
          subscription_id: subResult.rows[0].id,
          plan_type: planType,
          expires_at: expiresAt,
          promo_applied: true,
          free_activation: true
        });

      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Activate with promo error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // Проверить статус платежа по payload
  async checkPaymentStatusByPayload(req, res) {
    try {
      const { payload } = req.query;
      
      if (!payload) {
        return res.status(400).json({
          success: false,
          error: 'Payload required'
        });
      }

      const result = await db.query(
        `SELECT 
          tp.*,
          s.is_active as subscription_active,
          u.is_premium
         FROM telegram_payments tp
         LEFT JOIN subscriptions s ON s.telegram_payment_charge_id = tp.telegram_payment_charge_id
         LEFT JOIN users u ON u.id = tp.user_id
         WHERE tp.invoice_payload = $1
         ORDER BY tp.created_at DESC
         LIMIT 1`,
        [payload]
      );

      if (result.rows.length === 0) {
        return res.json({
          success: true,
          status: 'pending',
          paid: false
        });
      }

      const payment = result.rows[0];

      res.json({
        success: true,
        status: payment.status,
        paid: payment.status === 'completed',
        subscriptionActive: payment.subscription_active || false,
        isPremium: payment.is_premium || false
      });

    } catch (error) {
      console.error('Check payment status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check status'
      });
    }
  }
};

module.exports = telegramPaymentController;