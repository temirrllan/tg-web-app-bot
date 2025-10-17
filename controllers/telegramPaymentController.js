const TelegramStarsService = require('../services/telegramStarsService');
const db = require('../config/database');

const telegramPaymentController = {
  // Обработка webhook от Telegram
  async handleWebhook(req, res) {
    try {
      console.log('📥 ========== TELEGRAM PAYMENT WEBHOOK ==========');
      console.log('Headers:', JSON.stringify(req.headers, null, 2));
      console.log('Body:', JSON.stringify(req.body, null, 2));

      const update = req.body;

      // Проверяем наличие successful_payment
      let payment = null;
      let from_user_id = null;

      // Вариант 1: В message
      if (update.message?.successful_payment) {
        payment = update.message.successful_payment;
        from_user_id = update.message.from.id;
        console.log('✅ Found successful_payment in message');
      }
      // Вариант 2: В callback_query
      else if (update.callback_query?.message?.successful_payment) {
        payment = update.callback_query.message.successful_payment;
        from_user_id = update.callback_query.from.id;
        console.log('✅ Found successful_payment in callback_query');
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

        console.log('💳 Processing payment:', paymentData);

        // Обрабатываем платеж
        const result = await TelegramStarsService.processSuccessfulPayment(paymentData);

        if (result.success) {
          console.log('✅ Payment processed successfully');
          
          // Отправляем уведомление пользователю
          try {
            const bot = require('../server').bot;
            
            // Получаем язык пользователя
            const userResult = await db.query(
              'SELECT language FROM users WHERE telegram_id = $1',
              [from_user_id.toString()]
            );
            
            const lang = userResult.rows.length > 0 ? userResult.rows[0].language : 'en';
            
            const message = lang === 'ru'
              ? '🎉 <b>Оплата прошла успешно!</b>\n\nВаша Premium подписка активирована!\n\nТеперь у вас есть:\n✅ Безлимитные привычки\n✅ Расширенная статистика\n✅ Приоритетная поддержка\n\nОткройте приложение и наслаждайтесь! 💪'
              : '🎉 <b>Payment successful!</b>\n\nYour Premium subscription is now active!\n\nYou now have:\n✅ Unlimited habits\n✅ Advanced statistics\n✅ Priority support\n\nOpen the app and enjoy! 💪';
            
            await bot.sendMessage(from_user_id, message, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: '📱 Open App',
                    web_app: { 
                      url: process.env.WEBAPP_URL || process.env.FRONTEND_URL 
                    }
                  }
                ]]
              }
            });
            
            console.log('✅ Confirmation message sent to user');
          } catch (botError) {
            console.error('Failed to send confirmation:', botError.message);
            // Не критично, продолжаем
          }

          return res.status(200).json({ success: true });
        } else {
          console.error('❌ Payment processing failed:', result.error);
          
          // Всё равно возвращаем 200 чтобы Telegram не повторял запрос
          return res.status(200).json({ success: false, error: result.error });
        }
      }

      // Если это не successful_payment, просто подтверждаем получение
      console.log('ℹ️ Not a payment update, acknowledging');
      res.status(200).json({ success: true, message: 'Update received' });

    } catch (error) {
      console.error('💥 Webhook error:', error);
      // ВАЖНО: Всегда возвращаем 200, иначе Telegram будет повторять запрос
      res.status(200).json({ success: false, error: error.message });
    }
  },

  // Создать invoice для оплаты
  async requestInvoiceButton(req, res) {
    try {
      const { planType } = req.body;
      const userId = req.user.id;

      console.log(`📨 Creating invoice for user ${userId}, plan: ${planType}`);

      // Получаем telegram_id пользователя
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

      // Получаем данные плана и цену
      const price = TelegramStarsService.getPlanPrice(planType);
      const plan = TelegramStarsService.PLANS[planType];

      if (!price || !plan) {
        return res.status(400).json({
          success: false,
          error: 'Invalid plan'
        });
      }

      console.log(`💰 Plan: ${plan.name}, Price: ${price} XTR`);

      // Генерируем invoice payload
      const invoicePayload = TelegramStarsService.generateInvoicePayload(userId, planType);

      // Создаем запись о платеже
      await TelegramStarsService.createPaymentRecord(userId, planType, invoicePayload, price);

      console.log(`✅ Invoice created with payload: ${invoicePayload}`);

      // Возвращаем payload для использования в openInvoice
      res.json({
        success: true,
        invoicePayload: invoicePayload,
        price: price,
        planName: plan.name
      });

    } catch (error) {
      console.error('💥 Create invoice error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create invoice'
      });
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
          s.is_active as subscription_active
         FROM telegram_payments tp
         LEFT JOIN subscriptions s ON s.telegram_payment_charge_id = tp.telegram_payment_charge_id
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
        subscriptionActive: payment.subscription_active || false
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