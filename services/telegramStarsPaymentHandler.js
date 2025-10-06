// services/telegramStarsPaymentHandler.js - ПОЛНАЯ ЗАМЕНА
const db = require('../config/database');
const SubscriptionService = require('./subscriptionService');

class TelegramStarsPaymentHandler {
  constructor(bot) {
    this.bot = bot;
    this.setupHandlers();
  }

  setupHandlers() {
    console.log('🔐 Setting up Telegram Stars payment handlers...');

    // Обработчик pre_checkout_query - ОБЯЗАТЕЛЕН!
    this.bot.on('pre_checkout_query', async (query) => {
      console.log('💳 Pre-checkout query received:', {
        id: query.id,
        from: query.from.id,
        currency: query.currency,
        total_amount: query.total_amount,
        invoice_payload: query.invoice_payload
      });

      try {
        // Парсим payload
        const payload = JSON.parse(query.invoice_payload);
        const { invoiceId, userId, planType } = payload;

        // Проверяем существование инвойса
        const invoiceCheck = await db.query(
          'SELECT id, status, user_id FROM payment_invoices WHERE id = $1',
          [invoiceId]
        );

        if (invoiceCheck.rows.length === 0) {
          console.error('❌ Invoice not found:', invoiceId);
          await this.bot.answerPreCheckoutQuery(query.id, false, {
            error_message: 'Invoice not found'
          });
          return;
        }

        const invoice = invoiceCheck.rows[0];

        // Проверяем статус
        if (invoice.status === 'paid') {
          console.warn('⚠️ Invoice already paid:', invoiceId);
          await this.bot.answerPreCheckoutQuery(query.id, false, {
            error_message: 'This invoice has already been paid'
          });
          return;
        }

        // Проверяем владельца
        if (invoice.user_id !== parseInt(userId)) {
          console.error('❌ User mismatch');
          await this.bot.answerPreCheckoutQuery(query.id, false, {
            error_message: 'Invalid invoice'
          });
          return;
        }

        // Обновляем статус на processing
        await db.query(
          `UPDATE payment_invoices 
           SET status = 'processing',
               pre_checkout_query_id = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [invoiceId, query.id]
        );

        // ВАЖНО: Отвечаем Telegram что все ОК
        await this.bot.answerPreCheckoutQuery(query.id, true);
        
        console.log('✅ Pre-checkout approved for invoice:', invoiceId);
      } catch (error) {
        console.error('❌ Pre-checkout error:', error);
        
        try {
          await this.bot.answerPreCheckoutQuery(query.id, false, {
            error_message: 'Payment processing error'
          });
        } catch (answerError) {
          console.error('❌ Failed to answer pre-checkout:', answerError);
        }
      }
    });
    // Продолжение файла services/telegramStarsPaymentHandler.js

    // Обработчик successful_payment
    this.bot.on('message', async (msg) => {
      if (!msg.successful_payment) return;

      const payment = msg.successful_payment;
      
      console.log('💰 Successful payment received:', {
        telegram_payment_charge_id: payment.telegram_payment_charge_id,
        provider_payment_charge_id: payment.provider_payment_charge_id,
        currency: payment.currency,
        total_amount: payment.total_amount,
        invoice_payload: payment.invoice_payload
      });

      const client = await db.getClient();

      try {
        await client.query('BEGIN');

        // Парсим payload
        const payload = JSON.parse(payment.invoice_payload);
        const { invoiceId, userId, planType } = payload;

        console.log('📝 Processing payment for:', {
          invoiceId,
          userId,
          planType
        });

        // Получаем инвойс
        const invoiceResult = await client.query(
          'SELECT * FROM payment_invoices WHERE id = $1',
          [invoiceId]
        );

        if (invoiceResult.rows.length === 0) {
          throw new Error(`Invoice not found: ${invoiceId}`);
        }

        const invoice = invoiceResult.rows[0];

        // Проверяем дубли
        if (invoice.status === 'paid') {
          console.warn('⚠️ Invoice already paid, skipping:', invoiceId);
          await client.query('ROLLBACK');
          
          await this.bot.sendMessage(
            msg.chat.id,
            '✅ Your subscription is already active!',
            { parse_mode: 'HTML' }
          );
          return;
        }

        // Обновляем инвойс
        await client.query(
          `UPDATE payment_invoices 
           SET status = 'paid',
               transaction_id = $2,
               telegram_payment_id = $3,
               paid_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [
            invoiceId,
            payment.provider_payment_charge_id || payment.telegram_payment_charge_id,
            payment.telegram_payment_charge_id
          ]
        );

        console.log('✅ Invoice marked as paid:', invoiceId);

        // Активируем подписку
        const subscriptionResult = await SubscriptionService.createSubscription(
          userId,
          planType,
          payment.telegram_payment_charge_id
        );

        if (!subscriptionResult.success) {
          throw new Error('Failed to activate subscription');
        }

        await client.query('COMMIT');

        console.log('✅ Subscription activated successfully');

        // Отправляем подтверждение пользователю
        const plan = SubscriptionService.PLANS[planType];
        
        await this.bot.sendMessage(
          msg.chat.id,
          `🎉 <b>Payment Successful!</b>\n\n` +
          `✅ Your <b>${plan.name}</b> subscription is now active!\n\n` +
          `💎 <b>What you get:</b>\n` +
          plan.features.map(f => `  • ${f}`).join('\n') +
          `\n\n📱 Open the app to start using Premium features!`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '📱 Open Habit Tracker',
                  web_app: { 
                    url: process.env.WEBAPP_URL || process.env.FRONTEND_URL 
                  }
                }
              ]]
            }
          }
        );

        // Уведомление владельцу бота
        if (process.env.OWNER_TELEGRAM_ID) {
          const userResult = await db.query(
            'SELECT first_name, username, telegram_id FROM users WHERE id = $1',
            [userId]
          );
          
          const user = userResult.rows[0];
          const userName = user?.first_name || user?.username || 'Unknown';
          
          await this.bot.sendMessage(
            process.env.OWNER_TELEGRAM_ID,
            `💰 <b>New Payment!</b>\n\n` +
            `👤 Customer: ${userName}\n` +
            `🆔 Telegram ID: ${user.telegram_id}\n` +
            `📦 Plan: ${plan.name}\n` +
            `⭐ Amount: ${payment.total_amount} Stars\n` +
            `💳 Transaction: <code>${payment.telegram_payment_charge_id}</code>\n` +
            `📅 Date: ${new Date().toISOString()}\n\n` +
            `✅ Stars credited to your account.`,
            { parse_mode: 'HTML' }
          );
        }

        console.log('🎊 Payment processed successfully!');

      } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Payment processing error:', error);

        // Уведомляем пользователя об ошибке
        try {
          await this.bot.sendMessage(
            msg.chat.id,
            '❌ <b>Payment Processing Error</b>\n\n' +
            'Your payment was received but there was an error activating your subscription.\n\n' +
            'Please contact support with this ID:\n' +
            `<code>${payment.telegram_payment_charge_id}</code>`,
            { parse_mode: 'HTML' }
          );
        } catch (notifyError) {
          console.error('❌ Failed to notify user:', notifyError);
        }
      } finally {
        client.release();
      }
    });

    console.log('✅ Payment handlers configured');
  }

  // Метод для ручной проверки статуса платежа
  async checkPaymentStatus(invoiceId) {
    try {
      const result = await db.query(
        `SELECT 
          pi.*,
          s.is_active as subscription_active
         FROM payment_invoices pi
         LEFT JOIN subscriptions s ON s.transaction_id = pi.transaction_id
         WHERE pi.id = $1`,
        [invoiceId]
      );

      if (result.rows.length === 0) {
        return { success: false, message: 'Invoice not found' };
      }

      const invoice = result.rows[0];

      return {
        success: true,
        status: invoice.status,
        isPaid: invoice.status === 'paid',
        subscriptionActive: invoice.subscription_active || false,
        data: invoice
      };
    } catch (error) {
      console.error('Error checking payment status:', error);
      throw error;
    }
  }
}

module.exports = TelegramStarsPaymentHandler;