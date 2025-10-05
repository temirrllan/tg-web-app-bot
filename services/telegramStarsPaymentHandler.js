// services/telegramStarsPaymentHandler.js
// Полная реализация обработки платежей через Telegram Stars

const db = require('../config/database');
const SubscriptionService = require('./subscriptionService');

class TelegramStarsPaymentHandler {
  constructor(bot) {
    this.bot = bot;
    this.setupHandlers();
  }

  setupHandlers() {
    console.log('🔐 Setting up Telegram Stars payment handlers...');

    // ============================================
    // КРИТИЧНО: Обработчик pre_checkout_query
    // ============================================
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
        const { userId, planType, amount, invoiceId } = payload;

        // Проверяем валидность данных
        if (!userId || !planType || !amount) {
          console.error('❌ Invalid payload data');
          await this.bot.answerPreCheckoutQuery(query.id, false, {
            error_message: 'Invalid payment data'
          });
          return;
        }

        // Проверяем существование пользователя
        const userCheck = await db.query(
          'SELECT id, telegram_id FROM users WHERE id = $1',
          [userId]
        );

        if (userCheck.rows.length === 0) {
          console.error('❌ User not found:', userId);
          await this.bot.answerPreCheckoutQuery(query.id, false, {
            error_message: 'User not found'
          });
          return;
        }

        // Проверяем существование инвойса
        const invoiceCheck = await db.query(
          'SELECT id, status FROM payment_invoices WHERE id = $1',
          [invoiceId]
        );

        if (invoiceCheck.rows.length === 0) {
          console.error('❌ Invoice not found:', invoiceId);
          await this.bot.answerPreCheckoutQuery(query.id, false, {
            error_message: 'Invoice not found'
          });
          return;
        }

        if (invoiceCheck.rows[0].status === 'paid') {
          console.warn('⚠️ Invoice already paid:', invoiceId);
          await this.bot.answerPreCheckoutQuery(query.id, false, {
            error_message: 'This invoice has already been paid'
          });
          return;
        }

        // Обновляем статус инвойса на "processing"
        await db.query(
          `UPDATE payment_invoices 
           SET status = 'processing',
               pre_checkout_query_id = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [invoiceId, query.id]
        );

        // ✅ ОТВЕЧАЕМ TELEGRAM ЧТО ВСЁ ОК
        await this.bot.answerPreCheckoutQuery(query.id, true);
        
        console.log('✅ Pre-checkout query approved for invoice:', invoiceId);
      } catch (error) {
        console.error('❌ Pre-checkout query error:', error);
        
        // Отклоняем платеж в случае ошибки
        try {
          await this.bot.answerPreCheckoutQuery(query.id, false, {
            error_message: 'Payment processing error. Please try again.'
          });
        } catch (answerError) {
          console.error('❌ Failed to answer pre-checkout query:', answerError);
        }
      }
    });

    // ============================================
    // КРИТИЧНО: Обработчик successful_payment
    // ============================================
    this.bot.on('message', async (msg) => {
      // Проверяем наличие successful_payment
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
        const { userId, planType, amount, invoiceId } = payload;

        console.log('📝 Processing payment for:', {
          userId,
          planType,
          amount,
          invoiceId
        });

        // Получаем информацию об инвойсе
        const invoiceResult = await client.query(
          'SELECT * FROM payment_invoices WHERE id = $1',
          [invoiceId]
        );

        if (invoiceResult.rows.length === 0) {
          throw new Error(`Invoice not found: ${invoiceId}`);
        }

        const invoice = invoiceResult.rows[0];

        // Проверяем статус инвойса
        if (invoice.status === 'paid') {
          console.warn('⚠️ Invoice already paid, skipping:', invoiceId);
          await client.query('ROLLBACK');
          
          // Отправляем пользователю уведомление
          await this.bot.sendMessage(
            msg.chat.id,
            '✅ This subscription is already active!'
          );
          return;
        }

        // Обновляем статус инвойса
        await client.query(
          `UPDATE payment_invoices 
           SET status = 'paid',
               transaction_id = $2,
               telegram_payment_id = $3,
               paid_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [
            invoiceId,
            payment.provider_payment_charge_id || payment.telegram_payment_charge_id,
            payment.telegram_payment_charge_id
          ]
        );

        console.log('✅ Invoice marked as paid:', invoiceId);

        // ============================================
        // АКТИВИРУЕМ ПОДПИСКУ
        // ============================================
        console.log('🎁 Activating subscription for user:', userId);

        const subscriptionResult = await SubscriptionService.createSubscription(
          userId,
          planType,
          payment.telegram_payment_charge_id
        );

        if (!subscriptionResult.success) {
          throw new Error('Failed to activate subscription');
        }

        console.log('✅ Subscription activated:', subscriptionResult);

        await client.query('COMMIT');

        // ============================================
        // УВЕДОМЛЯЕМ ПОЛЬЗОВАТЕЛЯ
        // ============================================
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

        // ============================================
        // УВЕДОМЛЯЕМ ВЛАДЕЛЬЦА БОТА
        // ============================================
        if (process.env.TEAM_LEAD_TELEGRAM_ID) {
          const userResult = await db.query(
            'SELECT first_name, username, telegram_id FROM users WHERE id = $1',
            [userId]
          );
          
          const user = userResult.rows[0];
          const userName = user?.first_name || user?.username || 'Unknown';
          
          await this.bot.sendMessage(
            process.env.TEAM_LEAD_TELEGRAM_ID,
            `💰 <b>New Payment Received!</b>\n\n` +
            `👤 <b>Customer:</b> ${userName}\n` +
            `🆔 <b>Telegram ID:</b> ${user.telegram_id}\n` +
            `📦 <b>Plan:</b> ${plan.name}\n` +
            `⭐ <b>Amount:</b> ${amount} Stars\n` +
            `💳 <b>Transaction ID:</b>\n<code>${payment.telegram_payment_charge_id}</code>\n` +
            `📅 <b>Date:</b> ${new Date().toLocaleString('en-US', {
              timeZone: 'UTC',
              dateStyle: 'medium',
              timeStyle: 'short'
            })}\n\n` +
            `✅ <i>Stars automatically credited to your Telegram account.</i>`,
            { parse_mode: 'HTML' }
          );
        }

        console.log('🎊 Payment fully processed successfully!');

      } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Payment processing error:', error);

        // Уведомляем пользователя об ошибке
        try {
          await this.bot.sendMessage(
            msg.chat.id,
            '❌ <b>Payment Processing Error</b>\n\n' +
            'Your payment was received, but there was an error activating your subscription.\n\n' +
            'Please contact support with this Transaction ID:\n' +
            `<code>${payment.telegram_payment_charge_id}</code>`,
            { parse_mode: 'HTML' }
          );
        } catch (notifyError) {
          console.error('❌ Failed to notify user about error:', notifyError);
        }

        // Уведомляем владельца бота об ошибке
        if (process.env.TEAM_LEAD_TELEGRAM_ID) {
          try {
            await this.bot.sendMessage(
              process.env.TEAM_LEAD_TELEGRAM_ID,
              `⚠️ <b>Payment Processing Error!</b>\n\n` +
              `💳 Transaction ID: <code>${payment.telegram_payment_charge_id}</code>\n` +
              `❌ Error: ${error.message}\n\n` +
              `⚠️ Manual intervention required!`,
              { parse_mode: 'HTML' }
            );
          } catch (ownerNotifyError) {
            console.error('❌ Failed to notify owner:', ownerNotifyError);
          }
        }
      } finally {
        client.release();
      }
    });

    console.log('✅ Telegram Stars payment handlers configured');
  }

  // ============================================
  // Вспомогательные методы
  // ============================================

  /**
   * Проверить статус платежа
   */
  async checkPaymentStatus(invoiceId) {
    try {
      const result = await db.query(
        `SELECT 
          pi.*,
          s.is_active as subscription_active,
          s.plan_type as subscription_plan
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

  /**
   * Получить список платежей пользователя
   */
  async getUserPayments(userId, limit = 20) {
    try {
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
         LIMIT $2`,
        [userId, limit]
      );

      return {
        success: true,
        payments: result.rows
      };
    } catch (error) {
      console.error('Error getting user payments:', error);
      throw error;
    }
  }
}

module.exports = TelegramStarsPaymentHandler;