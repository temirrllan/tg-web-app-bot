const db = require('../config/database');

const subscriptionController = {
  async checkPromoCode(req, res) {
    try {
      const { code } = req.body;
      const userId = req.user.id;

      // Проверяем промокод
      const result = await db.query(
        `SELECT * FROM promo_codes 
         WHERE code = $1 
         AND is_active = true 
         AND (valid_until IS NULL OR valid_until > NOW())
         AND (max_uses IS NULL OR used_count < max_uses)`,
        [code.toUpperCase()]
      );

      if (result.rows.length === 0) {
        return res.json({ valid: false, message: 'Invalid promo code' });
      }

      const promo = result.rows[0];

      // Проверяем, не использовал ли пользователь этот код
      const usedCheck = await db.query(
        'SELECT * FROM promo_uses WHERE promo_code_id = $1 AND user_id = $2',
        [promo.id, userId]
      );

      if (usedCheck.rows.length > 0) {
        return res.json({ valid: false, message: 'Promo code already used' });
      }

      res.json({
        valid: true,
        discount_percent: promo.discount_percent,
        discount_stars: promo.discount_stars,
        bonus_days: promo.bonus_days
      });
    } catch (error) {
      console.error('Check promo error:', error);
      res.status(500).json({ success: false, error: 'Failed to check promo code' });
    }
  },

  async createSubscription(req, res) {
    try {
      const userId = req.user.id;
      const { plan, quantity, isGift, giftUsername, promoCode, totalStars } = req.body;

      // Здесь будет логика создания подписки
      // Пока возвращаем успех
      res.json({
        success: true,
        subscription: {
          plan,
          totalStars,
          userId
        }
      });
    } catch (error) {
      console.error('Create subscription error:', error);
      res.status(500).json({ success: false, error: 'Failed to create subscription' });
    }
  }
};

module.exports = subscriptionController;