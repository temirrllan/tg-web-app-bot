const db = require('../config/database');

class PromoCodeService {
  /**
   * Проверка валидности промокода
   */
  static async validatePromoCode(code, userId, planType) {
    try {
      console.log(`🎫 Validating promo code: ${code} for user ${userId}, plan ${planType}`);
      
      const result = await db.query(
        `SELECT * FROM validate_promo_code($1, $2, $3)`,
        [code.toUpperCase().trim(), userId, planType]
      );
      
      const validation = result.rows[0];
      
      if (!validation.is_valid) {
        console.log(`❌ Promo code validation failed: ${validation.error_message}`);
        return {
          valid: false,
          error: validation.error_message
        };
      }
      
      console.log(`✅ Promo code valid: ${code}`);
      
      return {
        valid: true,
        promoId: validation.promo_id,
        discountPercent: validation.discount_percent,
        discountStars: validation.discount_stars,
        bonusDays: validation.bonus_days
      };
    } catch (error) {
      console.error('Error validating promo code:', error);
      return {
        valid: false,
        error: 'Failed to validate promo code'
      };
    }
  }

  /**
   * Применение промокода к подписке
   */
  static async applyPromoCode(promoId, userId, subscriptionId, discountAppliedStars) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Записываем использование промокода
      await client.query(
        `INSERT INTO promo_uses (promo_code_id, user_id, subscription_id, discount_applied_stars)
         VALUES ($1, $2, $3, $4)`,
        [promoId, userId, subscriptionId, discountAppliedStars]
      );
      
      // Увеличиваем счетчик использований
      await client.query(
        `UPDATE promo_codes 
         SET used_count = used_count + 1
         WHERE id = $1`,
        [promoId]
      );
      
      await client.query('COMMIT');
      
      console.log(`✅ Promo code ${promoId} applied successfully`);
      
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error applying promo code:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Расчет финальной цены с учетом промокода
   */
  static calculateDiscountedPrice(originalPrice, discountPercent, discountStars) {
    let finalPrice = originalPrice;
    
    if (discountPercent) {
      finalPrice = Math.round(originalPrice * (1 - discountPercent / 100));
    } else if (discountStars) {
      finalPrice = Math.max(0, originalPrice - discountStars);
    }
    
    return {
      originalPrice,
      finalPrice,
      discount: originalPrice - finalPrice
    };
  }

  /**
   * Получить активные промокоды (для админки)
   */
  static async getActivePromoCodes() {
    try {
      const result = await db.query(
        `SELECT 
          id,
          code,
          description,
          discount_percent,
          discount_stars,
          bonus_days,
          max_uses,
          used_count,
          valid_from,
          valid_until,
          applies_to_plans
         FROM promo_codes
         WHERE is_active = true
         AND (valid_until IS NULL OR valid_until >= CURRENT_TIMESTAMP)
         ORDER BY created_at DESC`
      );
      
      return result.rows;
    } catch (error) {
      console.error('Error getting active promo codes:', error);
      return [];
    }
  }

  /**
   * Деактивация промокода
   */
  static async deactivatePromoCode(promoId) {
    try {
      await db.query(
        `UPDATE promo_codes SET is_active = false WHERE id = $1`,
        [promoId]
      );
      
      console.log(`✅ Promo code ${promoId} deactivated`);
      return { success: true };
    } catch (error) {
      console.error('Error deactivating promo code:', error);
      throw error;
    }
  }
}

module.exports = PromoCodeService;