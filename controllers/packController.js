// controllers/packController.js - Контроллер для работы с пакетами привычек

const db = require('../config/database');

const packController = {
  /**
   * Получить список всех пакетов в магазине
   * GET /api/packs/store
   */
  async getStorePacks(req, res) {
    try {
      const userId = req.user?.id;

      console.log('📦 Getting store packs for user:', userId);

      const result = await db.query(
        `SELECT 
          sp.*,
          CASE WHEN pp.id IS NOT NULL THEN true ELSE false END as is_purchased
         FROM store_packs sp
         LEFT JOIN pack_purchases pp ON (
           sp.id = pp.pack_id 
           AND pp.user_id = $1 
           AND pp.status = 'ACTIVE'
         )
         WHERE sp.is_active = true
         ORDER BY sp.sort_order ASC, sp.created_at DESC`,
        [userId]
      );

      console.log(`✅ Found ${result.rows.length} packs`);

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('❌ Get store packs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load packs'
      });
    }
  },

  /**
   * Получить детальную информацию о пакете
   * GET /api/packs/store/:slug
   */
  async getPackDetail(req, res) {
    try {
      const { slug } = req.params;
      const userId = req.user?.id;

      console.log('📦 Getting pack detail:', { slug, userId });

      // Получаем информацию о пакете
      const packResult = await db.query(
        `SELECT 
          sp.*,
          CASE WHEN pp.id IS NOT NULL THEN true ELSE false END as is_purchased,
          pp.id as purchase_id
         FROM store_packs sp
         LEFT JOIN pack_purchases pp ON (
           sp.id = pp.pack_id 
           AND pp.user_id = $1 
           AND pp.status = 'ACTIVE'
         )
         WHERE sp.slug = $2 AND sp.is_active = true`,
        [userId, slug]
      );

      if (packResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Pack not found'
        });
      }

      const pack = packResult.rows[0];

      // Получаем привычки пакета
      let habits = [];
      if (pack.is_purchased) {
        // Показываем полную информацию
        habits = await db.query(
          `SELECT 
            pht.id,
            pht.title_private as title,
            pht.goal,
            pht.reminder_time,
            c.name_en as category_name,
            c.icon as category_icon
           FROM pack_items pi
           JOIN pack_habit_templates pht ON pi.template_id = pht.id
           LEFT JOIN categories c ON pht.category_id = c.id
           WHERE pi.pack_id = $1
           ORDER BY pi.sort_order ASC`,
          [pack.id]
        );
      } else {
        // Показываем только количество и цели (без названий)
        habits = await db.query(
          `SELECT 
            pht.goal,
            c.icon as category_icon
           FROM pack_items pi
           JOIN pack_habit_templates pht ON pi.template_id = pht.id
           LEFT JOIN categories c ON pht.category_id = c.id
           WHERE pi.pack_id = $1
           ORDER BY pi.sort_order ASC`,
          [pack.id]
        );
      }

      // Получаем достижения
      const achievements = await db.query(
        `SELECT 
          pal.*,
          CASE WHEN upa.id IS NOT NULL THEN true ELSE false END as is_achieved
         FROM pack_achievement_levels pal
         LEFT JOIN user_pack_achievements upa ON (
           pal.id = upa.level_id 
           AND upa.user_id = $1
         )
         WHERE pal.pack_id = $2 AND pal.is_active = true
         ORDER BY pal.sort_order ASC`,
        [userId, pack.id]
      );

      // Получаем прогресс (если куплен)
      let progress = null;
      if (pack.is_purchased && pack.purchase_id) {
        const progressResult = await db.query(
          `SELECT 
            COUNT(DISTINCT h.id) as total_count,
            COUNT(DISTINCT CASE 
              WHEN hm.status = 'completed' 
              THEN hm.habit_id 
            END) as completed_count
           FROM habits h
           LEFT JOIN habit_marks hm ON (
             h.id = hm.habit_id 
             AND hm.date >= CURRENT_DATE - INTERVAL '30 days'
           )
           WHERE h.pack_purchase_id = $1`,
          [pack.purchase_id]
        );

        progress = progressResult.rows[0];
      }

      console.log('✅ Pack detail loaded');

      res.json({
        success: true,
        data: {
          pack,
          habits: habits.rows,
          achievements: achievements.rows,
          progress
        }
      });
    } catch (error) {
      console.error('❌ Get pack detail error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load pack details'
      });
    }
  },

  /**
   * Создать заказ на покупку пакета
   * POST /api/packs/orders/create
   */
  async createOrder(req, res) {
    const client = await db.getClient();

    try {
      const { pack_id } = req.body;
      const userId = req.user.id;

      console.log('💳 Creating order:', { pack_id, userId });

      await client.query('BEGIN');

      // Проверяем, что пакет существует
      const packResult = await client.query(
        'SELECT * FROM store_packs WHERE id = $1 AND is_active = true',
        [pack_id]
      );

      if (packResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Pack not found'
        });
      }

      const pack = packResult.rows[0];

      // Проверяем, не куплен ли уже
      const existingPurchase = await client.query(
        `SELECT id FROM pack_purchases 
         WHERE user_id = $1 AND pack_id = $2 AND status = 'ACTIVE'`,
        [userId, pack_id]
      );

      if (existingPurchase.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Pack already purchased'
        });
      }

      // Если бесплатный пакет
      if (pack.price_stars === 0) {
        console.log('🎁 Free pack - granting immediately');

        // Создаём purchase
        const purchaseResult = await client.query(
          `INSERT INTO pack_purchases (user_id, pack_id, source, status)
           VALUES ($1, $2, 'free', 'ACTIVE')
           RETURNING *`,
          [userId, pack_id]
        );

        const purchase = purchaseResult.rows[0];

        // Устанавливаем привычки
        await installPackHabits(client, purchase.id, userId, pack_id);

        await client.query('COMMIT');

        return res.json({
          success: true,
          data: {
            type: 'free',
            purchase_id: purchase.id
          }
        });
      }

      // Платный пакет - создаём order
      const orderResult = await client.query(
        `INSERT INTO pack_orders (user_id, pack_id, amount_stars, status)
         VALUES ($1, $2, $3, 'CREATED')
         RETURNING *`,
        [userId, pack_id, pack.price_stars]
      );

      const order = orderResult.rows[0];

      // Создаём invoice через Telegram Stars
      const TelegramStarsService = require('../services/telegramStarsService');
      const invoice = await TelegramStarsService.createPackInvoice(
        userId,
        pack_id,
        pack.price_stars
      );

      // Обновляем order с invoice ID
      await client.query(
        `UPDATE pack_orders 
         SET provider_invoice_id = $1, status = 'PENDING'
         WHERE id = $2`,
        [invoice.link, order.id]
      );

      await client.query('COMMIT');

      console.log('✅ Order created:', order.id);

      res.json({
        success: true,
        data: {
          type: 'paid',
          order_id: order.id,
          invoice_url: invoice.link
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Create order error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create order'
      });
    } finally {
      client.release();
    }
  },

  /**
   * Обработка успешного платежа (webhook от Telegram)
   * POST /api/packs/orders/complete
   */
  async completeOrder(req, res) {
    const client = await db.getClient();

    try {
      const { order_id, payment_id } = req.body;

      console.log('✅ Completing order:', { order_id, payment_id });

      await client.query('BEGIN');

      // Находим заказ
      const orderResult = await client.query(
        'SELECT * FROM pack_orders WHERE id = $1',
        [order_id]
      );

      if (orderResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Order not found'
        });
      }

      const order = orderResult.rows[0];

      // Обновляем статус заказа
      await client.query(
        `UPDATE pack_orders 
         SET status = 'PAID', provider_payment_id = $1, paid_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [payment_id, order_id]
      );

      // Создаём purchase
      const purchaseResult = await client.query(
        `INSERT INTO pack_purchases (user_id, pack_id, order_id, source, status)
         VALUES ($1, $2, $3, 'paid', 'ACTIVE')
         RETURNING *`,
        [order.user_id, order.pack_id, order_id]
      );

      const purchase = purchaseResult.rows[0];

      // Устанавливаем привычки
      await installPackHabits(client, purchase.id, order.user_id, order.pack_id);

      await client.query('COMMIT');

      console.log('✅ Order completed and habits installed');

      res.json({
        success: true,
        data: {
          purchase_id: purchase.id
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Complete order error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to complete order'
      });
    } finally {
      client.release();
    }
  }
};

/**
 * Вспомогательная функция установки привычек из пакета
 */
async function installPackHabits(client, purchaseId, userId, packId) {
  console.log('🔧 Installing pack habits:', { purchaseId, userId, packId });

  // Создаём запись установки
  const installResult = await client.query(
    `INSERT INTO pack_installations (purchase_id, status)
     VALUES ($1, 'STARTED')
     RETURNING *`,
    [purchaseId]
  );

  const installation = installResult.rows[0];

  try {
    // Получаем шаблоны привычек
    const templatesResult = await client.query(
      `SELECT pht.*, pi.sort_order
       FROM pack_items pi
       JOIN pack_habit_templates pht ON pi.template_id = pht.id
       WHERE pi.pack_id = $1
       ORDER BY pi.sort_order ASC`,
      [packId]
    );

    const templates = templatesResult.rows;

    console.log(`📝 Found ${templates.length} habit templates`);

    // Создаём привычки для пользователя
    for (const template of templates) {
      await client.query(
        `INSERT INTO habits (
          user_id, 
          creator_id,
          category_id, 
          title, 
          goal, 
          schedule_type, 
          schedule_days,
          reminder_time, 
          reminder_enabled, 
          is_bad_habit,
          template_id,
          pack_purchase_id,
          is_locked
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)`,
        [
          userId,
          userId,
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
    }

    // Обновляем статус установки
    await client.query(
      `UPDATE pack_installations 
       SET status = 'SUCCESS', finished_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [installation.id]
    );

    console.log('✅ Habits installed successfully');
  } catch (error) {
    console.error('❌ Install habits error:', error);

    // Обновляем статус установки как failed
    await client.query(
      `UPDATE pack_installations 
       SET status = 'FAILED', error = $1, finished_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [error.message, installation.id]
    );

    throw error;
  }
}

module.exports = packController;