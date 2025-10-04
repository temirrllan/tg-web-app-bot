const axios = require('axios');

class TelegramStarsService {
  constructor() {
    this.botToken = process.env.BOT_TOKEN;
    this.teamLeadUserId = process.env.TEAM_LEAD_TELEGRAM_ID; // ID тимлида для получения stars
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * Создание инвойса для оплаты через Telegram Stars
   */
  async createInvoice(userId, planType, amount, description) {
    try {
      console.log(`💰 Creating invoice for user ${userId}: ${amount} stars for ${planType}`);
      
      // Формируем параметры инвойса
      const invoiceParams = {
        title: this.getPlanTitle(planType),
        description: description || 'Premium subscription for Habit Tracker',
        payload: JSON.stringify({
          userId,
          planType,
          timestamp: Date.now()
        }),
        currency: 'XTR', // Telegram Stars currency code
        prices: [
          {
            label: this.getPlanTitle(planType),
            amount: amount // Цена в stars
          }
        ]
      };
      
      // Отправляем инвойс пользователю
      const response = await axios.post(`${this.apiUrl}/sendInvoice`, {
        chat_id: userId,
        ...invoiceParams
      });
      
      if (response.data.ok) {
        console.log(`✅ Invoice created successfully for user ${userId}`);
        return {
          success: true,
          invoiceUrl: response.data.result
        };
      } else {
        throw new Error('Failed to create invoice');
      }
    } catch (error) {
      console.error('Error creating invoice:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Обработка успешного платежа (webhook от Telegram)
   */
  async handleSuccessfulPayment(paymentData) {
    try {
      console.log('💳 Processing successful payment:', paymentData);
      
      const payload = JSON.parse(paymentData.invoice_payload);
      const { userId, planType } = payload;
      const amount = paymentData.total_amount;
      const telegramPaymentChargeId = paymentData.telegram_payment_charge_id;
      
      // Переводим stars тимлиду (если требуется)
      // Примечание: Telegram Stars переводятся автоматически при оплате инвойса
      // Но можно добавить дополнительную логику если нужно
      
      return {
        success: true,
        userId,
        planType,
        amount,
        transactionId: telegramPaymentChargeId
      };
    } catch (error) {
      console.error('Error processing payment:', error);
      throw error;
    }
  }

  /**
   * Проверка баланса пользователя (если API поддерживает)
   */
  async getUserStarsBalance(userId) {
    try {
      // Примечание: Telegram Bot API пока не предоставляет прямого доступа к балансу Stars
      // Это заглушка для будущей функциональности
      console.log(`ℹ️ Checking stars balance for user ${userId} - not available via API yet`);
      
      return {
        available: false,
        message: 'Balance check not available'
      };
    } catch (error) {
      console.error('Error checking balance:', error);
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Получение человекочитаемого названия плана
   */
  getPlanTitle(planType) {
    const titles = {
      '6_months': 'Premium for 6 Months',
      '1_year': 'Premium for 1 Year',
      'lifetime': 'Lifetime Premium'
    };
    
    return titles[planType] || 'Premium Subscription';
  }

  /**
   * Создание ссылки для покупки Stars
   */
  getBuyStarsLink() {
    // Официальная ссылка Telegram для покупки Stars
    return 'https://t.me/PremiumBot';
  }

  /**
   * Отправка уведомления о успешной подписке
   */
  async sendSubscriptionConfirmation(userId, planType, expiresAt) {
    try {
      const bot = require('../server').bot;
      
      const message = `🎉 <b>Congratulations!</b>

Your Premium subscription is now active!

📦 <b>Plan:</b> ${this.getPlanTitle(planType)}
${expiresAt ? `📅 <b>Valid until:</b> ${new Date(expiresAt).toLocaleDateString()}` : '♾️ <b>Lifetime access</b>'}

✨ You now have:
• Unlimited habits
• Advanced statistics
• Priority support

Thank you for your purchase! 💚`;
      
      await bot.sendMessage(userId, message, {
        parse_mode: 'HTML'
      });
      
      console.log(`✅ Confirmation sent to user ${userId}`);
    } catch (error) {
      console.error('Error sending confirmation:', error);
    }
  }
}

module.exports = new TelegramStarsService();