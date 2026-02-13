// controllers/telegramWebhookController.js - Обработка webhook от Telegram

const TelegramStarsService = require('../services/telegramStarsService');

const telegramWebhookController = {
  /**
   * Обработать входящий update от Telegram
   * POST /webhook/telegram
   */
  // В методе handleUpdate добавьте проверку типа платежа:

async handleUpdate(req, res) {
  try {
    const update = req.body;

    console.log('📨 Received Telegram update:', JSON.stringify(update, null, 2));

    // Проверяем наличие успешного платежа
    if (update.message?.successful_payment) {
      console.log('💰 Successful payment detected');
      
      const payment = update.message.successful_payment;
      const payload = payment.invoice_payload;

      // Определяем тип платежа по payload
      if (payload.startsWith('pack|')) {
        // Это платёж за пакет
        console.log('📦 Pack payment detected');
        
        const paymentData = {
          telegram_payment_charge_id: payment.telegram_payment_charge_id,
          provider_payment_charge_id: payment.provider_payment_charge_id,
          invoice_payload: payload,
          total_amount: payment.total_amount,
          from_user_id: update.message.from.id
        };

        await TelegramStarsService.processPackPayment(paymentData);
      } else {
        // Это платёж за подписку
        console.log('⭐ Subscription payment detected');
        
        const paymentData = {
          telegram_payment_charge_id: payment.telegram_payment_charge_id,
          provider_payment_charge_id: payment.provider_payment_charge_id,
          invoice_payload: payload,
          total_amount: payment.total_amount,
          from_user_id: update.message.from.id
        };

        await TelegramStarsService.processSuccessfulPayment(paymentData);
      }
    }

    // Проверяем наличие pre-checkout query
    if (update.pre_checkout_query) {
      console.log('🔍 Pre-checkout query detected');
      await handlePreCheckoutQuery(update.pre_checkout_query);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('❌ Telegram webhook error:', error);
    res.status(200).json({ ok: true });
  }
}
};

/**
 * Обработать pre-checkout query (проверка перед оплатой)
 */
async function handlePreCheckoutQuery(query) {
  const axios = require('axios');
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

  try {
    console.log('🔍 Processing pre-checkout query:', query.id);

    // Здесь можно добавить дополнительные проверки
    // Например, проверить что пакет всё ещё доступен

    // Отвечаем OK
    await axios.post(`${TELEGRAM_API_URL}/answerPreCheckoutQuery`, {
      pre_checkout_query_id: query.id,
      ok: true
    });

    console.log('✅ Pre-checkout approved');
  } catch (error) {
    console.error('❌ Pre-checkout error:', error);

    // Отвечаем с ошибкой
    await axios.post(`${TELEGRAM_API_URL}/answerPreCheckoutQuery`, {
      pre_checkout_query_id: query.id,
      ok: false,
      error_message: 'Произошла ошибка. Попробуйте позже.'
    });
  }
}

module.exports = telegramWebhookController;