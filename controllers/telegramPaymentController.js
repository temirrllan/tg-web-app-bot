const TelegramStarsService = require('../services/telegramStarsService');
const db = require('../config/database');
const telegramPaymentController = {
  // Обработка webhook от Telegram
  async handleWebhook(req, res) {
    try {
      console.log('📥 Telegram webhook received');
      console.log('Body:', JSON.stringify(req.body, null, 2));

      const update = req.body;

      // Проверяем наличие successful_payment
      if (update.message && update.message.successful_payment) {
        const payment = update.message.successful_payment;
        const from_user_id = update.message.from.id;

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
          
          // Здесь можно отправить уведомление пользователю через бота
          try {
            const bot = require('../server').bot;
            await bot.sendMessage(
              from_user_id,
              '🎉 <b>Payment successful!</b>\n\nYour Premium subscription is now active. Enjoy unlimited habits!',
              { parse_mode: 'HTML' }
            );
          } catch (botError) {
            console.error('Failed to send confirmation message:', botError);
          }

          return res.status(200).json({ success: true });
        } else {
          console.error('❌ Payment processing failed:', result.error);
          
          // Не возвращаем ошибку Telegram, чтобы избежать повторной отправки
          return res.status(200).json({ success: false, error: result.error });
        }
      }

      // Если это не successful_payment, просто подтверждаем получение
      res.status(200).json({ success: true });

    } catch (error) {
      console.error('💥 Webhook error:', error);
      // Возвращаем 200 чтобы Telegram не повторял запрос
      res.status(200).json({ success: false, error: error.message });
    }
  },
// Отправить invoice кнопку пользователю
async requestInvoiceButton(req, res) {
  try {
    const { planType } = req.body;
    const userId = req.user.id;

    console.log(`📨 Sending invoice button to user ${userId}, plan: ${planType}`);

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

    // Генерируем invoice payload
    const invoicePayload = TelegramStarsService.generateInvoicePayload(userId, planType);

    // Создаем запись о платеже
    await TelegramStarsService.createPaymentRecord(userId, planType, invoicePayload, price);

    // Отправляем invoice через бота
    const bot = require('../server').bot;

    try {
      await bot.sendInvoice(
        telegram_id,
        plan.name, // title
        plan.features.join('\n• '), // description
        invoicePayload, // payload
        '', // provider_token (пустой для Stars)
        'XTR', // currency
        [{ label: plan.name, amount: price }], // prices
        {
          photo_url: 'https://i.imgur.com/8QF3Z1M.png', // Можешь добавить свою картинку
          photo_width: 512,
          photo_height: 512,
          need_name: false,
          need_phone_number: false,
          need_email: false,
          need_shipping_address: false,
          is_flexible: false,
          send_phone_number_to_provider: false,
          send_email_to_provider: false
        }
      );

      console.log('✅ Invoice sent successfully');

      res.json({
        success: true,
        message: 'Invoice sent to user',
        invoicePayload: invoicePayload
      });

    } catch (botError) {
      console.error('❌ Failed to send invoice:', botError);
      
      // Проверяем если пользователь заблокировал бота
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
},
  // Инициировать платеж (создать invoice)
  async createInvoice(req, res) {
    try {
      const { planType } = req.body;
      const userId = req.user.id;

      console.log(`Creating invoice for user ${userId}, plan: ${planType}`);

      // Проверяем валидность плана
      const price = TelegramStarsService.getPlanPrice(planType);
      if (!price) {
        return res.status(400).json({
          success: false,
          error: 'Invalid plan type'
        });
      }

      // Генерируем уникальный invoice_payload
      const invoicePayload = TelegramStarsService.generateInvoicePayload(userId, planType);

      // Создаем запись о платеже в БД
      await TelegramStarsService.createPaymentRecord(userId, planType, invoicePayload, price);

      const plan = TelegramStarsService.PLANS[planType];

      // Формируем данные для invoice
      const invoiceData = {
        title: plan.name,
        description: plan.features.join(', '),
        payload: invoicePayload,
        currency: 'XTR',
        prices: [{ label: plan.name, amount: price }]
      };

      console.log('Invoice data:', invoiceData);

      res.json({
        success: true,
        invoice: invoiceData
      });

    } catch (error) {
      console.error('Create invoice error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create invoice'
      });
    }
  },

  // Проверить статус платежа
  async checkPaymentStatus(req, res) {
    try {
      const { paymentId } = req.params;
      
      const status = await TelegramStarsService.checkPaymentStatus(paymentId);
      
      if (!status) {
        return res.status(404).json({
          success: false,
          error: 'Payment not found'
        });
      }

      res.json({
        success: true,
        payment: status
      });

    } catch (error) {
      console.error('Check payment status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check payment status'
      });
    }
  }
};

module.exports = telegramPaymentController;