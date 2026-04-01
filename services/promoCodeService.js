// services/promoCodeService.js — Сервис промокодов

const db = require('../config/database');

class PromoCodeService {
  /**
   * Валидация промокода
   * @param {string} code — код промокода
   * @param {number} userId — ID пользователя
   * @returns {{ valid: boolean, promo?: object, error?: string, discountStars?: number, bonusDays?: number }}
   */
  static async validatePromoCode(code, userId) {
    try {
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return { valid: false, error: 'empty_code' };
      }

      const normalizedCode = code.trim().toUpperCase();

      // Ищем промокод
      const promoResult = await db.query(
        `SELECT id, code, description, discount_stars, bonus_days,
                max_uses, used_count, valid_from, valid_until, is_active
         FROM promo_codes
         WHERE UPPER(code) = $1`,
        [normalizedCode]
      );

      if (promoResult.rows.length === 0) {
        return { valid: false, error: 'not_found' };
      }

      const promo = promoResult.rows[0];

      // Проверяем is_active
      if (!promo.is_active) {
        return { valid: false, error: 'inactive' };
      }

      // Проверяем срок действия
      const now = new Date();
      if (promo.valid_from && new Date(promo.valid_from) > now) {
        return { valid: false, error: 'not_started' };
      }
      if (promo.valid_until && new Date(promo.valid_until) < now) {
        return { valid: false, error: 'expired' };
      }

      // Проверяем лимит использований
      if (promo.max_uses && promo.used_count >= promo.max_uses) {
        return { valid: false, error: 'max_used' };
      }

      // Проверяем что пользователь еще не использовал этот промокод
      const usageResult = await db.query(
        `SELECT id FROM promo_uses
         WHERE promo_code_id = $1 AND user_id = $2`,
        [promo.id, userId]
      );

      if (usageResult.rows.length > 0) {
        return { valid: false, error: 'already_used' };
      }

      return {
        valid: true,
        promo: {
          id: promo.id,
          code: promo.code,
          description: promo.description
        },
        discountStars: promo.discount_stars || 0,
        bonusDays: promo.bonus_days || 0
      };
    } catch (error) {
      console.error('❌ Error validating promo code:', error);
      return { valid: false, error: 'server_error' };
    }
  }

  /**
   * Применяет промокод (записывает использование)
   * Вызывать ТОЛЬКО в транзакции, после успешной оплаты/активации
   * @param {object} client — DB client (из транзакции)
   * @param {number} promoCodeId
   * @param {number} userId
   */
  static async applyPromoCode(client, promoCodeId, userId) {
    // Блокируем строку промокода для предотвращения race condition
    const promoResult = await client.query(
      'SELECT id, used_count, max_uses FROM promo_codes WHERE id = $1 FOR UPDATE',
      [promoCodeId]
    );

    if (promoResult.rows.length === 0) {
      throw new Error(`Promo code ${promoCodeId} not found`);
    }

    const promo = promoResult.rows[0];

    // Перепроверяем лимит (с блокировкой)
    if (promo.max_uses && promo.used_count >= promo.max_uses) {
      throw new Error('Promo code max uses exceeded');
    }

    // Записываем использование
    await client.query(
      `INSERT INTO promo_uses (promo_code_id, user_id, used_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (promo_code_id, user_id) DO NOTHING`,
      [promoCodeId, userId]
    );

    // Инкрементим счётчик
    await client.query(
      'UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1',
      [promoCodeId]
    );

    console.log(`✅ Promo code ${promoCodeId} applied for user ${userId}`);
  }

  /**
   * Рассчитывает цену со скидкой
   */
  static calculateDiscountedPrice(originalPrice, discountStars) {
    const finalPrice = Math.max(0, originalPrice - (discountStars || 0));
    return finalPrice;
  }
}

module.exports = PromoCodeService;
