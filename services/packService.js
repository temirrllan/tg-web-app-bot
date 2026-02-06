const db = require('../config/database');

class PackService {
  // Получить все активные паки для магазина
  async getActiveStorePacks() {
    const result = await db.query(
      `SELECT 
        id, slug, cover_image_url, title, 
        short_description, author_name, 
        count_habits, price_stars, sort_order
       FROM store_packs
       WHERE is_active = true
       ORDER BY sort_order ASC, created_at DESC`
    );
    
    return result.rows;
  }

  // Получить детали пака по slug
  async getPackBySlug(slug) {
    const packResult = await db.query(
      `SELECT * FROM store_packs WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    
    if (packResult.rows.length === 0) {
      return null;
    }
    
    return packResult.rows[0];
  }

  // Получить детали КУПЛЕННОГО пака (с привычками)
  async getPurchasedPackDetails(packId, userId) {
    // Проверяем владение
    const ownershipCheck = await db.query(
      `SELECT id FROM pack_purchases 
       WHERE user_id = $1 AND pack_id = $2 AND status = 'ACTIVE'`,
      [userId, packId]
    );
    
    if (ownershipCheck.rows.length === 0) {
      return { owned: false };
    }
    
    // Получаем пак
    const packResult = await db.query(
      `SELECT * FROM store_packs WHERE id = $1`,
      [packId]
    );
    
    // Получаем привычки пользователя из этого пака
    const habitsResult = await db.query(
      `SELECT h.*, c.name_en, c.icon as category_icon
       FROM habits h
       LEFT JOIN categories c ON h.category_id = c.id
       WHERE h.user_id = $1 
       AND h.pack_purchase_id = (
         SELECT id FROM pack_purchases 
         WHERE user_id = $1 AND pack_id = $2
       )
       AND h.is_active = true
       ORDER BY h.created_at`,
      [userId, packId]
    );
    
    // Получаем достижения пака
    // TODO: Реализовать логику достижений для паков
    
    return {
      owned: true,
      pack: packResult.rows[0],
      habits: habitsResult.rows,
      achievements: [] // Заглушка
    };
  }

  // Создать заказ на покупку пака
  async createPackOrder(userId, packId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Проверяем, что пак существует и активен
      const packResult = await client.query(
        `SELECT id, price_stars FROM store_packs 
         WHERE id = $1 AND is_active = true`,
        [packId]
      );
      
      if (packResult.rows.length === 0) {
        throw new Error('Pack not found or inactive');
      }
      
      const pack = packResult.rows[0];
      
      // Проверяем, не куплен ли уже
      const existingPurchase = await client.query(
        `SELECT id FROM pack_purchases 
         WHERE user_id = $1 AND pack_id = $2 AND status = 'ACTIVE'`,
        [userId, packId]
      );
      
      if (existingPurchase.rows.length > 0) {
        throw new Error('Pack already purchased');
      }
      
      // Создаём заказ
      const orderResult = await client.query(
        `INSERT INTO pack_orders (user_id, pack_id, amount_stars, status)
         VALUES ($1, $2, $3, 'CREATED')
         RETURNING *`,
        [userId, packId, pack.price_stars]
      );
      
      await client.query('COMMIT');
      
      return orderResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Установить привычки из пака после покупки
  async installPackHabits(purchaseId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Проверяем, что не установлено уже
      const installCheck = await client.query(
        `SELECT id FROM pack_installations 
         WHERE purchase_id = $1 AND status = 'SUCCESS'`,
        [purchaseId]
      );
      
      if (installCheck.rows.length > 0) {
        console.log(`Pack already installed for purchase ${purchaseId}`);
        await client.query('COMMIT');
        return { success: true, already_installed: true };
      }
      
      // Создаём запись установки
      const installationResult = await client.query(
        `INSERT INTO pack_installations (purchase_id, status)
         VALUES ($1, 'STARTED')
         RETURNING id`,
        [purchaseId]
      );
      
      const installationId = installationResult.rows[0].id;
      
      // Получаем данные покупки
      const purchaseResult = await client.query(
        `SELECT user_id, pack_id FROM pack_purchases WHERE id = $1`,
        [purchaseId]
      );
      
      if (purchaseResult.rows.length === 0) {
        throw new Error('Purchase not found');
      }
      
      const { user_id, pack_id } = purchaseResult.rows[0];
      
      // Получаем шаблоны привычек из пака
      const templatesResult = await client.query(
        `SELECT ht.* 
         FROM habit_templates ht
         JOIN pack_items pi ON pi.template_id = ht.id
         WHERE pi.pack_id = $1 AND ht.is_active = true
         ORDER BY pi.sort_order`,
        [pack_id]
      );
      
      const templates = templatesResult.rows;
      
      // Создаём привычки для пользователя
      const createdHabits = [];
      
      for (const template of templates) {
        const habitResult = await client.query(
          `INSERT INTO habits (
            user_id, category_id, title, goal, 
            schedule_type, schedule_days, 
            reminder_time, reminder_enabled, 
            is_bad_habit, template_id, pack_purchase_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id`,
          [
            user_id,
            template.category_id,
            template.title_private,
            template.goal,
            template.schedule_type,
            template.schedule_days,
            template.reminder_time,
            template.reminder_enabled,
            template.is_bad_habit,
            template.id,
            purchaseId
          ]
        );
        
        createdHabits.push(habitResult.rows[0].id);
      }
      
      // Обновляем статус установки
      await client.query(
        `UPDATE pack_installations 
         SET status = 'SUCCESS', finished_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [installationId]
      );
      
      await client.query('COMMIT');
      
      return { 
        success: true, 
        habits_created: createdHabits.length,
        habit_ids: createdHabits
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      
      // Логируем ошибку в таблицу
      try {
        await db.query(
          `UPDATE pack_installations 
           SET status = 'FAILED', error = $2, finished_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [installationId, error.message]
        );
      } catch (logError) {
        console.error('Failed to log installation error:', logError);
      }
      
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new PackService();