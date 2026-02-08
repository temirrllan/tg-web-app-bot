// routes/packs.js - API для работы с пакетами привычек

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ============================================
// 1. ПОЛУЧИТЬ СПИСОК ПАКЕТОВ В МАГАЗИНЕ
// ============================================
router.get('/store', authenticateToken, async (req, res) => {
  try {
    const { rows: packs } = await db.query(`
      SELECT 
        sp.id,
        sp.slug,
        sp.cover_image_url,
        sp.title,
        sp.subtitle,
        sp.short_description,
        sp.price_stars,
        sp.count_habits,
        sp.count_achievements,
        sp.sort_order,
        EXISTS(
          SELECT 1 FROM pack_purchases pp 
          WHERE pp.pack_id = sp.id 
            AND pp.user_id = $1 
            AND pp.status = 'ACTIVE'
        ) as is_purchased
      FROM store_packs sp
      WHERE sp.is_active = true
      ORDER BY sp.sort_order ASC, sp.created_at DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: packs,
    });
  } catch (error) {
    console.error('Error fetching store packs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch packs',
    });
  }
});

// ============================================
// 2. ПОЛУЧИТЬ ДЕТАЛИ ПАКЕТА
// ============================================
router.get('/store/:slug', authenticateToken, async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.id;

    // Получаем информацию о пакете
    const { rows: packRows } = await db.query(`
      SELECT 
        sp.id,
        sp.slug,
        sp.cover_image_url,
        sp.title,
        sp.subtitle,
        sp.short_description,
        sp.long_description,
        sp.price_stars,
        sp.count_habits,
        sp.count_achievements,
        EXISTS(
          SELECT 1 FROM pack_purchases pp 
          WHERE pp.pack_id = sp.id 
            AND pp.user_id = $1 
            AND pp.status = 'ACTIVE'
        ) as is_purchased
      FROM store_packs sp
      WHERE sp.slug = $2 AND sp.is_active = true
    `, [userId, slug]);

    if (packRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Pack not found',
      });
    }

    const pack = packRows[0];

    // Получаем список привычек (без приватных данных для незакупленных)
    const { rows: habits } = await db.query(`
      SELECT 
        pht.goal,
        c.name as category_name,
        c.icon as category_icon,
        pht.schedule_type,
        pht.reminder_time,
        pht.is_bad_habit,
        pi.sort_order
      FROM pack_items pi
      JOIN pack_habit_templates pht ON pi.template_id = pht.id
      LEFT JOIN categories c ON pht.category_id = c.id
      WHERE pi.pack_id = $1 AND pht.is_active = true
      ORDER BY pi.sort_order ASC
    `, [pack.id]);

    // Получаем уровни достижений
    const { rows: achievements } = await db.query(`
      SELECT 
        pal.id,
        pal.title,
        pal.description,
        pal.required_completions,
        pal.sort_order,
        EXISTS(
          SELECT 1 FROM user_pack_achievements upa
          WHERE upa.level_id = pal.id AND upa.user_id = $1
        ) as is_achieved
      FROM pack_achievement_levels pal
      WHERE pal.pack_id = $2 AND pal.is_active = true
      ORDER BY pal.sort_order ASC
    `, [userId, pack.id]);

    // Если пакет куплен, получаем прогресс
    let progress = null;
    if (pack.is_purchased) {
      const { rows: progressRows } = await db.query(`
        SELECT COUNT(DISTINCT hm.id) as completed_count
        FROM pack_purchases pp
        JOIN habits h ON h.pack_purchase_id = pp.id
        LEFT JOIN habit_marks hm ON hm.habit_id = h.id
        WHERE pp.pack_id = $1 
          AND pp.user_id = $2 
          AND pp.status = 'ACTIVE'
      `, [pack.id, userId]);

      progress = {
        completed_count: parseInt(progressRows[0].completed_count),
        total_count: pack.count_habits,
      };
    }

    res.json({
      success: true,
      data: {
        pack,
        habits: pack.is_purchased ? habits : habits.map(h => ({
          ...h,
          goal: '🔒 Разблокируйте пакет',
        })),
        achievements,
        progress,
      },
    });
  } catch (error) {
    console.error('Error fetching pack details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pack details',
    });
  }
});

// ============================================
// 3. СОЗДАТЬ ЗАКАЗ (для платных пакетов)
// ============================================
router.post('/orders/create', authenticateToken, async (req, res) => {
  try {
    const { pack_id } = req.body;
    const userId = req.user.id;

    // Проверяем существование пакета
    const { rows: packRows } = await db.query(`
      SELECT id, price_stars, title
      FROM store_packs
      WHERE id = $1 AND is_active = true
    `, [pack_id]);

    if (packRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Pack not found',
      });
    }

    const pack = packRows[0];

    // Проверяем, не куплен ли уже
    const { rows: existingPurchase } = await db.query(`
      SELECT id FROM pack_purchases
      WHERE user_id = $1 AND pack_id = $2 AND status = 'ACTIVE'
    `, [userId, pack_id]);

    if (existingPurchase.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Pack already purchased',
      });
    }

    // Если пакет бесплатный, создаём покупку напрямую
    if (pack.price_stars === 0) {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // Создаём покупку
        const { rows: purchaseRows } = await client.query(`
          INSERT INTO pack_purchases (user_id, pack_id, source, status, granted_at)
          VALUES ($1, $2, 'free', 'ACTIVE', NOW())
          RETURNING id
        `, [userId, pack_id]);

        const purchaseId = purchaseRows[0].id;

        // Запускаем установку
        await installPackHabits(client, purchaseId, userId, pack_id);

        await client.query('COMMIT');

        return res.json({
          success: true,
          data: {
            purchase_id: purchaseId,
            type: 'free',
          },
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    // Для платных пакетов создаём заказ
    const { rows: orderRows } = await db.query(`
      INSERT INTO pack_orders (user_id, pack_id, amount_stars, status, provider, created_at)
      VALUES ($1, $2, $3, 'CREATED', 'telegram_stars', NOW())
      RETURNING id
    `, [userId, pack_id, pack.price_stars]);

    const orderId = orderRows[0].id;

    // TODO: Интеграция с Telegram Stars API
    // const invoice = await createTelegramInvoice(orderId, pack);

    res.json({
      success: true,
      data: {
        order_id: orderId,
        amount_stars: pack.price_stars,
        type: 'paid',
        // invoice_url: invoice.url,
      },
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create order',
    });
  }
});

// ============================================
// 4. WEBHOOK ДЛЯ TELEGRAM STARS (после оплаты)
// ============================================
router.post('/orders/webhook', async (req, res) => {
  try {
    const { order_id, payment_id, status } = req.body;

    // TODO: Верификация подписи от Telegram

    if (status !== 'paid') {
      return res.json({ success: true });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Обновляем заказ
      const { rows: orderRows } = await client.query(`
        UPDATE pack_orders
        SET status = 'PAID', provider_payment_id = $1, paid_at = NOW()
        WHERE id = $2
        RETURNING user_id, pack_id
      `, [payment_id, order_id]);

      if (orderRows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      const { user_id, pack_id } = orderRows[0];

      // Создаём покупку
      const { rows: purchaseRows } = await client.query(`
        INSERT INTO pack_purchases (user_id, pack_id, order_id, source, status, granted_at)
        VALUES ($1, $2, $3, 'paid', 'ACTIVE', NOW())
        RETURNING id
      `, [user_id, pack_id, order_id]);

      const purchaseId = purchaseRows[0].id;

      // Устанавливаем привычки
      await installPackHabits(client, purchaseId, user_id, pack_id);

      await client.query('COMMIT');

      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ success: false, error: 'Webhook processing failed' });
  }
});

// ============================================
// 5. ПОЛУЧИТЬ МОИ КУПЛЕННЫЕ ПАКЕТЫ
// ============================================
router.get('/my-purchases', authenticateToken, async (req, res) => {
  try {
    const { rows: purchases } = await db.query(`
      SELECT 
        pp.id as purchase_id,
        sp.id as pack_id,
        sp.slug,
        sp.cover_image_url,
        sp.title,
        sp.subtitle,
        pp.granted_at,
        (
          SELECT COUNT(DISTINCT hm.id)
          FROM habits h
          LEFT JOIN habit_marks hm ON hm.habit_id = h.id
          WHERE h.pack_purchase_id = pp.id
        ) as completed_count,
        sp.count_habits as total_count
      FROM pack_purchases pp
      JOIN store_packs sp ON pp.pack_id = sp.id
      WHERE pp.user_id = $1 AND pp.status = 'ACTIVE'
      ORDER BY pp.granted_at DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: purchases,
    });
  } catch (error) {
    console.error('Error fetching purchases:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch purchases',
    });
  }
});

// ============================================
// ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: УСТАНОВКА ПРИВЫЧЕК
// ============================================
async function installPackHabits(client, purchaseId, userId, packId) {
  // Создаём запись об установке
  const { rows: installRows } = await client.query(`
    INSERT INTO pack_installations (purchase_id, status, started_at)
    VALUES ($1, 'STARTED', NOW())
    RETURNING id
  `, [purchaseId]);

  const installId = installRows[0].id;

  try {
    // Получаем шаблоны привычек
    const { rows: templates } = await client.query(`
      SELECT 
        pht.id,
        pht.goal,
        pht.category_id,
        pht.schedule_type,
        pht.schedule_days,
        pht.reminder_time,
        pht.reminder_enabled,
        pht.is_bad_habit
      FROM pack_items pi
      JOIN pack_habit_templates pht ON pi.template_id = pht.id
      WHERE pi.pack_id = $1 AND pht.is_active = true
      ORDER BY pi.sort_order ASC
    `, [packId]);

    // Создаём привычки для пользователя
    for (const template of templates) {
      // Вычисляем day_period из reminder_time
      let dayPeriod = 'morning';
      if (template.reminder_time) {
        const hour = parseInt(template.reminder_time.split(':')[0]);
        if (hour >= 6 && hour < 12) dayPeriod = 'morning';
        else if (hour >= 12 && hour < 18) dayPeriod = 'day';
        else if (hour >= 18 && hour < 24) dayPeriod = 'evening';
        else dayPeriod = 'night';
      }

      await client.query(`
        INSERT INTO habits (
          user_id, 
          goal, 
          category_id,
          schedule_type,
          schedule_days,
          day_period,
          reminder_time,
          reminder_enabled,
          is_bad_habit,
          template_id,
          pack_purchase_id,
          is_locked,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, NOW())
      `, [
        userId,
        template.goal,
        template.category_id,
        template.schedule_type,
        template.schedule_days,
        dayPeriod,
        template.reminder_time,
        template.reminder_enabled,
        template.is_bad_habit,
        template.id,
        purchaseId,
      ]);
    }

    // Обновляем статус установки
    await client.query(`
      UPDATE pack_installations
      SET status = 'SUCCESS', finished_at = NOW()
      WHERE id = $1
    `, [installId]);

  } catch (error) {
    // Отмечаем ошибку установки
    await client.query(`
      UPDATE pack_installations
      SET status = 'FAILED', error = $1, finished_at = NOW()
      WHERE id = $2
    `, [error.message, installId]);

    throw error;
  }
}

module.exports = router;