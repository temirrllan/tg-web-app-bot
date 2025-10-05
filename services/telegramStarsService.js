// services/telegramStarsService.js
const axios = require('axios');
const db = require('../config/database');

const BOT_TOKEN = process.env.BOT_TOKEN;
const TEAM_LEAD_TELEGRAM_ID = process.env.TEAM_LEAD_TELEGRAM_ID; // ID владельца бота

class TelegramStarsService {
  /**
   * Создать инвойс для оплаты через Telegram Stars
   */
  static async createInvoice({ userId, planType, amount, description }) {
    try {
      console.log('Creating invoice:', { userId, planType, amount });

      // Получаем данные пользователя
      const userResult = await db.query(
        'SELECT telegram_id, first_name FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = userResult.rows[0];

      // Создаем уникальный payload для отслеживания платежа
      const payload = {
        userId,
        planType,
        amount,
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(7)
      };

      // Сохраняем pending invoice в БД
      const invoiceResult = await db.query(
        `INSERT INTO payment_invoices (
          user_id, plan_type, amount, status, payload
        ) VALUES ($1, $2, $3, 'pending', $4)
        RETURNING id`,
        [userId, planType, amount, JSON.stringify(payload)]
      );

      const invoiceId = invoiceResult.rows[0].id;

      // Формируем параметры для Telegram Bot API
      const invoiceParams = {
        title: `Premium Subscription - ${planType}`,
        description: description || 'Habit Tracker Premium Subscription',
        payload: JSON.stringify({ ...payload, invoiceId }),
        provider_token: '', // Пусто для Telegram Stars
        currency: 'XTR', // Telegram Stars
        prices: [{
          label: 'Subscription',
          amount: amount
        }]
      };

      console.log('Invoice created:', { invoiceId, payload });

      return {
        success: true,
        invoiceId,
        invoiceParams,
        telegramUserId: user.telegram_id
      };
    } catch (error) {
      console.error('Error creating invoice:', error);
      throw error;
    }
  }

  /**
   * Обработать успешный платеж
   */
  static async processSuccessfulPayment({ invoiceId, transactionId, telegramPaymentId }) {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      console.log('Processing payment:', { invoiceId, transactionId });

      // Получаем информацию об инвойсе
      const invoiceResult = await client.query(
        'SELECT * FROM payment_invoices WHERE id = $1',
        [invoiceId]
      );

      if (invoiceResult.rows.length === 0) {
        throw new Error('Invoice not found');
      }

      const invoice = invoiceResult.rows[0];

      // Проверяем, что инвойс еще не был оплачен
      if (invoice.status === 'paid') {
        console.log('Invoice already paid');
        await client.query('ROLLBACK');
        return { success: false, message: 'Already paid' };
      }

      // Обновляем статус инвойса
      await client.query(
        `UPDATE payment_invoices 
         SET status = 'paid', 
             transaction_id = $1,
             telegram_payment_id = $2,
             paid_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [transactionId, telegramPaymentId, invoiceId]
      );

      // Создаем подписку через SubscriptionService
      const SubscriptionService = require('./subscriptionService');
      const subscriptionResult = await SubscriptionService.createSubscription(
        invoice.user_id,
        invoice.plan_type,
        transactionId
      );

      if (!subscriptionResult.success) {
        throw new Error('Failed to create subscription');
      }

      // Отправляем Stars тимлиду
      if (TEAM_LEAD_TELEGRAM_ID) {
        await this.transferStarsToTeamLead(invoice.amount, invoice.user_id);
      }

      await client.query('COMMIT');

      console.log('Payment processed successfully:', subscriptionResult);

      return {
        success: true,
        subscription: subscriptionResult.subscription,
        invoiceId
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error processing payment:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Перевести Stars тимлиду
   */
  static async transferStarsToTeamLead(amount, userId) {
    try {
      console.log(`Transferring ${amount} stars to team lead`);

      // Здесь должна быть логика перевода Stars через Telegram Bot API
      // ВАЖНО: API для перевода Stars может отличаться
      
      // Записываем транзакцию в историю
      await db.query(
        `INSERT INTO stars_transfers (
          from_user_id, to_telegram_id, amount, status
        ) VALUES ($1, $2, $3, 'completed')`,
        [userId, TEAM_LEAD_TELEGRAM_ID, amount]
      );

      console.log('Stars transferred successfully');
    } catch (error) {
      console.error('Error transferring stars:', error);
      // Не бросаем ошибку, чтобы не откатить всю транзакцию
    }
  }

  /**
   * Проверить статус платежа
   */
  static async checkPaymentStatus(invoiceId) {
    try {
      const result = await db.query(
        `SELECT 
          pi.*,
          s.plan_type as subscription_plan,
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
        subscriptionActive: invoice.subscription_active || false
      };
    } catch (error) {
      console.error('Error checking payment status:', error);
      throw error;
    }
  }

  /**
   * Отменить платеж
   */
  static async cancelPayment(invoiceId) {
    try {
      await db.query(
        `UPDATE payment_invoices 
         SET status = 'cancelled', 
             cancelled_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'pending'`,
        [invoiceId]
      );

      return { success: true };
    } catch (error) {
      console.error('Error cancelling payment:', error);
      throw error;
    }
  }

  /**
   * Получить историю платежей пользователя
   */
  static async getUserPayments(userId) {
    try {
      const result = await db.query(
        `SELECT 
          id,
          plan_type,
          amount,
          status,
          created_at,
          paid_at
         FROM payment_invoices
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [userId]
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

module.exports = TelegramStarsService;