// controllers/specialHabitsController.js
const db = require('../config/database');
const HabitMark = require('../models/HabitMark');
const { getToday } = require('../utils/dateHelper');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Instantiate achievement progress rows for a user / pack if not yet present,
 * then bump every achievement's counter by `delta`.
 */
async function upsertAchievementProgress(client, userId, packId, delta) {
  // Ensure rows exist for every achievement in this pack
  await client.query(
    `INSERT INTO pack_achievement_progress (user_id, pack_id, achievement_id, current_count)
     SELECT $1, $2, id, 0
     FROM   pack_achievements
     WHERE  pack_id = $2
     ON CONFLICT (user_id, achievement_id) DO NOTHING`,
    [userId, packId]
  );

  // Apply delta (never go below 0)
  await client.query(
    `UPDATE pack_achievement_progress
     SET    current_count = GREATEST(0, current_count + $1)
     WHERE  user_id = $2 AND pack_id = $3`,
    [delta, userId, packId]
  );
}

/**
 * Unlock achievements whose threshold has now been reached.
 * Returns newly-unlocked rows so the frontend can show a popup.
 */
async function checkAndUnlockAchievements(client, userId, packId) {
  const result = await client.query(
    `UPDATE pack_achievement_progress pap
     SET    is_unlocked = true,
            unlocked_at = NOW(),
            notified_at = NOW()
     FROM   pack_achievements a
     WHERE  pap.achievement_id = a.id
       AND  pap.user_id        = $1
       AND  pap.pack_id        = $2
       AND  pap.is_unlocked    = false
       AND  pap.current_count >= a.required_count
     RETURNING a.title, a.icon, a.description, a.required_count, pap.current_count`,
    [userId, packId]
  );
  return result.rows;
}

/**
 * Create all habits for a user from pack templates and record the purchase.
 * Safe to call for both free packs and after a paid webhook.
 */
async function createPackHabitsForUser(userId, packId, telegramPaymentChargeId = null) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Idempotency: skip if already completed
    const existing = await client.query(
      `SELECT id FROM special_habit_purchases
       WHERE user_id = $1 AND pack_id = $2 AND payment_status = 'completed'`,
      [userId, packId]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return { alreadyDone: true };
    }

    // Fetch templates
    const templates = await client.query(
      `SELECT * FROM special_habit_templates WHERE pack_id = $1 ORDER BY sort_order ASC, id ASC`,
      [packId]
    );

    // Insert habits
    for (const t of templates.rows) {
      const reminderEnabled = t.reminder_time ? t.reminder_enabled : false;
      await client.query(
        `INSERT INTO habits
           (user_id, creator_id, title, goal, category_id,
            schedule_days, reminder_time, reminder_enabled, day_period,
            is_active, is_special, pack_id, template_id, created_at, updated_at)
         VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,true,true,$9,$10,NOW(),NOW())`,
        [
          userId,
          t.title, t.goal, t.category_id,
          t.schedule_days, t.reminder_time, reminderEnabled, t.day_period,
          packId, t.id
        ]
      );
    }

    // Record purchase
    const packResult = await client.query(
      'SELECT price_stars FROM special_habit_packs WHERE id = $1',
      [packId]
    );
    const pricePaid = packResult.rows[0]?.price_stars || 0;

    await client.query(
      `INSERT INTO special_habit_purchases
         (user_id, pack_id, price_paid_stars, telegram_payment_charge_id, payment_status, purchased_at)
       VALUES ($1,$2,$3,$4,'completed',NOW())
       ON CONFLICT (user_id, pack_id)
       DO UPDATE SET
         payment_status             = 'completed',
         telegram_payment_charge_id = COALESCE(EXCLUDED.telegram_payment_charge_id, special_habit_purchases.telegram_payment_charge_id),
         purchased_at               = NOW()`,
      [userId, packId, pricePaid, telegramPaymentChargeId]
    );

    // Init achievement progress rows
    await client.query(
      `INSERT INTO pack_achievement_progress (user_id, pack_id, achievement_id, current_count)
       SELECT $1, $2, id, 0 FROM pack_achievements WHERE pack_id = $2
       ON CONFLICT (user_id, achievement_id) DO NOTHING`,
      [userId, packId]
    );

    await client.query('COMMIT');
    console.log(`✅ Created ${templates.rows.length} special habits for user ${userId} from pack ${packId}`);
    return { created: templates.rows.length };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ createPackHabitsForUser error:', err);
    throw err;
  } finally {
    client.release();
  }
}

// ─── Controller ─────────────────────────────────────────────────────────────

const specialHabitsController = {

  // GET /api/special-habits/packs?filter=all|paid|free&search=...
  async getPacks(req, res) {
    try {
      const userId = req.user.id;
      const { filter = 'all', search = '' } = req.query;

      const params = [userId];
      const conditions = ['p.is_active = true'];

      if (filter === 'paid') conditions.push('p.price_stars > 0');
      if (filter === 'free') conditions.push('p.price_stars = 0');

      if (search.trim()) {
        params.push(`%${search.trim()}%`);
        conditions.push(
          `(p.name ILIKE $${params.length} OR p.short_description ILIKE $${params.length})`
        );
      }

      const result = await db.query(
        `SELECT
           p.*,
           (SELECT COUNT(*) FROM special_habit_templates t WHERE t.pack_id = p.id) AS habit_count,
           (SELECT COUNT(*) FROM pack_achievements      a WHERE a.pack_id = p.id) AS achievement_count,
           CASE WHEN shp.id IS NOT NULL THEN true ELSE false END AS is_purchased
         FROM special_habit_packs p
         LEFT JOIN special_habit_purchases shp
           ON shp.pack_id = p.id AND shp.user_id = $1 AND shp.payment_status = 'completed'
         WHERE ${conditions.join(' AND ')}
         ORDER BY p.sort_order ASC, p.created_at DESC`,
        params
      );

      res.json({ success: true, packs: result.rows });
    } catch (err) {
      console.error('getPacks error:', err);
      res.status(500).json({ success: false, error: 'Failed to get packs' });
    }
  },

  // GET /api/special-habits/packs/:id
  async getPackDetails(req, res) {
    try {
      const userId = req.user.id;
      const packId = parseInt(req.params.id);

      const packResult = await db.query(
        `SELECT
           p.*,
           CASE WHEN shp.id IS NOT NULL THEN true ELSE false END AS is_purchased,
           shp.purchased_at
         FROM special_habit_packs p
         LEFT JOIN special_habit_purchases shp
           ON shp.pack_id = p.id AND shp.user_id = $1 AND shp.payment_status = 'completed'
         WHERE p.id = $2 AND p.is_active = true`,
        [userId, packId]
      );

      if (!packResult.rows.length) {
        return res.status(404).json({ success: false, error: 'Pack not found' });
      }

      const pack = packResult.rows[0];

      const habitsResult = await db.query(
        `SELECT t.*, c.icon AS category_icon, c.name_en AS category_name
         FROM special_habit_templates t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.pack_id = $1
         ORDER BY t.sort_order ASC, t.id ASC`,
        [packId]
      );

      const achievementsResult = await db.query(
        `SELECT
           a.*,
           COALESCE(pap.current_count, 0) AS current_count,
           COALESCE(pap.is_unlocked, false) AS is_unlocked,
           pap.unlocked_at
         FROM pack_achievements a
         LEFT JOIN pack_achievement_progress pap
           ON pap.achievement_id = a.id AND pap.user_id = $1
         WHERE a.pack_id = $2
         ORDER BY a.sort_order ASC, a.id ASC`,
        [userId, packId]
      );

      // Count user's owned habits from this pack
      let habitsOwned = 0;
      if (pack.is_purchased) {
        const ownedResult = await db.query(
          `SELECT COUNT(*) AS cnt FROM habits
           WHERE user_id = $1 AND pack_id = $2 AND is_active = true AND is_special = true`,
          [userId, packId]
        );
        habitsOwned = parseInt(ownedResult.rows[0].cnt);
      }

      res.json({
        success: true,
        pack: {
          ...pack,
          habits:               habitsResult.rows,
          achievements:         achievementsResult.rows,
          habits_owned:         habitsOwned,
          habits_total:         habitsResult.rows.length,
          achievements_unlocked: achievementsResult.rows.filter(a => a.is_unlocked).length,
          achievements_total:   achievementsResult.rows.length,
        }
      });
    } catch (err) {
      console.error('getPackDetails error:', err);
      res.status(500).json({ success: false, error: 'Failed to get pack details' });
    }
  },

  // POST /api/special-habits/packs/:id/purchase
  async purchasePack(req, res) {
    try {
      const userId = req.user.id;
      const packId = parseInt(req.params.id);

      const packResult = await db.query(
        'SELECT * FROM special_habit_packs WHERE id = $1 AND is_active = true',
        [packId]
      );

      if (!packResult.rows.length) {
        return res.status(404).json({ success: false, error: 'Pack not found' });
      }

      const pack = packResult.rows[0];

      // Already purchased?
      const existing = await db.query(
        `SELECT id FROM special_habit_purchases
         WHERE user_id = $1 AND pack_id = $2 AND payment_status = 'completed'`,
        [userId, packId]
      );
      if (existing.rows.length > 0) {
        return res.json({ success: true, already_purchased: true });
      }

      // Free pack – create habits immediately
      if (pack.price_stars === 0) {
        await createPackHabitsForUser(userId, packId);
        return res.json({ success: true, free: true });
      }

      // Paid pack – create Telegram Stars invoice
      const bot = require('../server').bot;
      const payload = `pack_${packId}_${userId}_${Date.now()}`;

      // Upsert pending purchase so we can track it
      await db.query(
        `INSERT INTO special_habit_purchases (user_id, pack_id, price_paid_stars, payment_status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (user_id, pack_id)
         DO UPDATE SET payment_status = 'pending'`,
        [userId, packId, pack.price_stars]
      );

      const invoiceLink = await bot.createInvoiceLink(
        pack.name,
        pack.short_description || `${pack.name} habit pack`,
        payload,
        '',
        'XTR',
        [{ label: pack.name, amount: pack.price_stars }],
        { need_name: false, need_phone_number: false, need_email: false, need_shipping_address: false }
      );

      res.json({ success: true, invoice_link: invoiceLink, payload });
    } catch (err) {
      console.error('purchasePack error:', err);
      res.status(500).json({ success: false, error: 'Failed to initiate purchase' });
    }
  },

  // POST /api/special-habits/packs/:id/confirm-payment
  // Called by frontend after Telegram openInvoice returns 'paid'.
  // Waits for the webhook to complete, or creates habits directly as a fallback.
  async confirmPayment(req, res) {
    try {
      const userId = req.user.id;
      const packId = parseInt(req.params.id);

      // Quick check: already completed?
      const done = await db.query(
        `SELECT id FROM special_habit_purchases
         WHERE user_id = $1 AND pack_id = $2 AND payment_status = 'completed'`,
        [userId, packId]
      );
      if (done.rows.length > 0) {
        return res.json({ success: true, status: 'completed' });
      }

      // Must have a pending purchase (created by purchasePack)
      const pending = await db.query(
        `SELECT id FROM special_habit_purchases
         WHERE user_id = $1 AND pack_id = $2 AND payment_status = 'pending'`,
        [userId, packId]
      );
      if (pending.rows.length === 0) {
        return res.status(400).json({ success: false, error: 'No pending purchase found' });
      }

      // Poll briefly — give the webhook a chance to finish (up to 10s)
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const check = await db.query(
          `SELECT id FROM special_habit_purchases
           WHERE user_id = $1 AND pack_id = $2 AND payment_status = 'completed'`,
          [userId, packId]
        );
        if (check.rows.length > 0) {
          return res.json({ success: true, status: 'completed' });
        }
      }

      // Webhook didn't complete after 10s — create habits directly as fallback
      console.log(`⚠️ confirm-payment fallback: creating pack ${packId} habits for user ${userId} (webhook didn't fire)`);
      const result = await createPackHabitsForUser(userId, packId);
      console.log(`✅ confirm-payment fallback result:`, result);

      return res.json({ success: true, status: 'completed_via_fallback', ...result });
    } catch (err) {
      console.error('❌ confirmPayment error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // GET /api/special-habits/my-packs
  async getMyPacks(req, res) {
    try {
      const userId = req.user.id;

      const result = await db.query(
        `SELECT
           p.*,
           shp.purchased_at,
           shp.price_paid_stars,
           (SELECT COUNT(*) FROM habits h
            WHERE h.user_id = $1 AND h.pack_id = p.id AND h.is_active = true AND h.is_special = true
           ) AS habits_count,
           (SELECT COUNT(*) FROM pack_achievements a   WHERE a.pack_id = p.id) AS achievements_total,
           (SELECT COUNT(*) FROM pack_achievement_progress pap
            WHERE pap.pack_id = p.id AND pap.user_id = $1 AND pap.is_unlocked = true
           ) AS achievements_unlocked
         FROM special_habit_purchases shp
         JOIN special_habit_packs p ON p.id = shp.pack_id
         WHERE shp.user_id = $1 AND shp.payment_status = 'completed'
         ORDER BY shp.purchased_at DESC`,
        [userId]
      );

      res.json({ success: true, packs: result.rows });
    } catch (err) {
      console.error('getMyPacks error:', err);
      res.status(500).json({ success: false, error: 'Failed to get my packs' });
    }
  },

  // GET /api/special-habits/packs/:id/progress
  async getPackProgress(req, res) {
    try {
      const userId = req.user.id;
      const packId = parseInt(req.params.id);

      const result = await db.query(
        `SELECT
           a.*,
           COALESCE(pap.current_count, 0) AS current_count,
           COALESCE(pap.is_unlocked, false) AS is_unlocked,
           pap.unlocked_at
         FROM pack_achievements a
         LEFT JOIN pack_achievement_progress pap
           ON pap.achievement_id = a.id AND pap.user_id = $1
         WHERE a.pack_id = $2
         ORDER BY a.sort_order ASC`,
        [userId, packId]
      );

      res.json({ success: true, achievements: result.rows });
    } catch (err) {
      console.error('getPackProgress error:', err);
      res.status(500).json({ success: false, error: 'Failed to get pack progress' });
    }
  },

  // POST /api/special-habits/habit/:habitId/mark
  async markSpecialHabit(req, res) {
    try {
      const userId    = req.user.id;
      const habitId   = parseInt(req.params.habitId);
      const { status, date } = req.body;
      const markDate  = date || getToday();

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        // Verify habit belongs to user and is special
        const habitResult = await client.query(
          'SELECT pack_id FROM habits WHERE id = $1 AND user_id = $2 AND is_special = true AND is_active = true',
          [habitId, userId]
        );
        if (!habitResult.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, error: 'Special habit not found' });
        }

        const packId = habitResult.rows[0].pack_id;

        // Get previous status (before upsert)
        const prevResult = await client.query(
          'SELECT status FROM habit_marks WHERE habit_id = $1 AND date = $2::date',
          [habitId, markDate]
        );
        const previousStatus = prevResult.rows[0]?.status || 'pending';

        // Upsert mark
        await client.query(
          `INSERT INTO habit_marks (habit_id, date, status, marked_at)
           VALUES ($1, $2::date, $3, NOW())
           ON CONFLICT (habit_id, date)
           DO UPDATE SET status = EXCLUDED.status, marked_at = NOW()`,
          [habitId, markDate, status]
        );

        // Calculate achievement delta
        // +1 when newly completing, -1 when un-completing
        const wasCompleted = previousStatus === 'completed';
        const isNowCompleted = status === 'completed';
        const delta = (isNowCompleted ? 1 : 0) - (wasCompleted ? 1 : 0);

        let newlyUnlocked = [];
        if (packId && delta !== 0) {
          await upsertAchievementProgress(client, userId, packId, delta);
          newlyUnlocked = await checkAndUnlockAchievements(client, userId, packId);
        }

        await client.query('COMMIT');

        // Пересчитываем стрик ПОСЛЕ коммита (использует пул, не клиент транзакции)
        await HabitMark.recalculateStreak(habitId);

        res.json({
          success: true,
          mark: { habit_id: habitId, date: markDate, status },
          newly_unlocked: newlyUnlocked
        });
      } catch (innerErr) {
        await client.query('ROLLBACK');
        throw innerErr;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('markSpecialHabit error:', err);
      res.status(500).json({ success: false, error: 'Failed to mark special habit' });
    }
  },

  // GET /api/special-habits/habits?date=YYYY-MM-DD
  // Returns special habits for the user for a given date (with today_status)
  async getSpecialHabitsForDate(req, res) {
    try {
      const userId = req.user.id;
      const { date } = req.query;

      if (!date) {
        return res.status(400).json({ success: false, error: 'date is required' });
      }

      // Day of week for schedule filtering (1=Mon..7=Sun, Postgres: 0=Sun..6=Sat)
      const [y, m, d] = date.split('-').map(Number);
      const jsDate = new Date(y, m - 1, d);
      const jsDow = jsDate.getDay(); // 0=Sun
      // Convert to 1=Mon..7=Sun
      const dow = jsDow === 0 ? 7 : jsDow;

      const result = await db.query(
        `SELECT
           h.id, h.title, h.goal, h.day_period, h.pack_id, h.template_id,
           h.is_special, h.schedule_days,
           c.icon AS category_icon,
           COALESCE(hm.status, 'pending') AS today_status,
           sp.name AS pack_name,
           sp.photo_url AS pack_photo_url
         FROM habits h
         LEFT JOIN categories c ON c.id = h.category_id
         LEFT JOIN habit_marks hm ON hm.habit_id = h.id AND hm.date = $2::date
         LEFT JOIN special_habit_packs sp ON sp.id = h.pack_id
         WHERE h.user_id = $1
           AND h.is_active = true
           AND h.is_special = true
           AND $3 = ANY(h.schedule_days)
         ORDER BY h.pack_id, h.day_period, h.id`,
        [userId, date, dow]
      );

      res.json({ success: true, habits: result.rows });
    } catch (err) {
      console.error('getSpecialHabitsForDate error:', err);
      res.status(500).json({ success: false, error: 'Failed to get special habits' });
    }
  },
};

module.exports = specialHabitsController;
module.exports.createPackHabitsForUser = createPackHabitsForUser;
