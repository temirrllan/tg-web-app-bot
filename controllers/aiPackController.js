// controllers/aiPackController.js
// AI-генератор паков привычек: опрос → оплата ДО генерации → генерация Claude →
// превью (без ачивок) → активация (переиспользует special packs).
// См. ADR 0006.

const db = require('../config/database');
const aiGen = require('../services/aiPackGenerator');
const { createPackHabitsForUser } = require('./specialHabitsController');

const PRICE_STARS = Number(process.env.AI_PACK_PRICE_STARS || 1);
const FREE_LIMIT  = Number(process.env.AI_PACK_FREE_LIMIT || 1);

// Опции опроса. Значения уходят в промпт как текст; фронт может локализовать подписи,
// но отправляет именно эти строки.
const SURVEY_OPTIONS = {
  age:        ['<18', '18-25', '26-35', '36-45', '46+'],
  occupation: ['Студент', 'Работаю', 'Фриланс', 'Родитель', 'Спортсмен', 'Другое'],
  level:      ['Новичок', 'Средний', 'Опытный'],
  time:       ['5-10 мин', '15-30 мин', '30-60 мин', '60+ мин'],
};

async function getFreeUsed(userId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS c FROM ai_generation_requests WHERE user_id = $1 AND is_free = true`,
    [userId]
  );
  return r.rows[0].c;
}

// Превью БЕЗ достижений (ачивки — сюрприз, см. ADR 0006).
function buildPreview(packId, pack) {
  return {
    pack_id: packId,
    name: pack.name,
    short_description: pack.short_description,
    bg_color: pack.bg_color,
    habits: pack.habits.map((h) => ({
      title: h.title,
      goal: h.goal,
      category_id: h.category_id,
      schedule_days: h.schedule_days,
      day_period: h.day_period,
      reminder_time: h.reminder_time,
    })),
    habit_count: pack.habits.length,
    achievements_hidden: true,
  };
}

// Сохранить сгенерированный пак (pack + templates + achievements) в транзакции.
async function persistPack(userId, pack) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const packIns = await client.query(
      `INSERT INTO special_habit_packs
         (name, short_description, bg_color, price_stars, is_active, sort_order,
          is_ai_generated, is_private, created_by_user_id, created_at, updated_at)
       VALUES ($1, $2, $3, 0, true, 0, true, true, $4, NOW(), NOW())
       RETURNING id`,
      [pack.name, pack.short_description, pack.bg_color, userId]
    );
    const packId = packIns.rows[0].id;

    for (let i = 0; i < pack.habits.length; i++) {
      const h = pack.habits[i];
      await client.query(
        `INSERT INTO special_habit_templates
           (pack_id, title, goal, category_id, schedule_days,
            reminder_time, reminder_enabled, day_period, sort_order, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [packId, h.title, h.goal, h.category_id, h.schedule_days,
         h.reminder_time, Boolean(h.reminder_time), h.day_period, i]
      );
    }

    for (const a of pack.achievements) {
      await client.query(
        `INSERT INTO pack_achievements
           (pack_id, title, icon, description, required_count, sort_order, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [packId, a.title, null, a.description, a.required_count, a.sort_order]
      );
    }

    await client.query('COMMIT');
    return packId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Общий запуск генерации: помечает generating → Claude (с авто-ретраем) → persist → done.
// При ошибке откатывает статус в 'paid' (право на генерацию сохраняется — деньги не теряются).
async function runGeneration(res, request, userId) {
  await db.query(
    `UPDATE ai_generation_requests SET status='generating', updated_at=NOW() WHERE id=$1`,
    [request.id]
  );

  const cats = (await db.query(
    `SELECT id, name_en, name_ru FROM categories ORDER BY sort_order ASC, id ASC`
  )).rows;

  let pack = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      pack = await aiGen.generatePack({
        prompt: request.prompt,
        survey: request.survey,
        lang: request.lang,
        categories: cats,
      });
      break;
    } catch (e) {
      lastErr = e;
      if (e.code === 'AI_NOT_CONFIGURED') {
        await db.query(
          `UPDATE ai_generation_requests SET status='paid', updated_at=NOW() WHERE id=$1`,
          [request.id]
        );
        return res.status(503).json({
          success: false, code: 'AI_NOT_CONFIGURED',
          error: 'AI-генерация временно недоступна. Попробуй позже.',
        });
      }
      // иначе — повторим (авто-ретрай)
    }
  }

  if (!pack) {
    await db.query(
      `UPDATE ai_generation_requests SET status='paid', error=$2, updated_at=NOW() WHERE id=$1`,
      [request.id, String((lastErr && lastErr.message) || 'generation failed')]
    );
    return res.status(502).json({
      success: false, code: 'AI_GENERATION_FAILED',
      error: 'Не удалось собрать пак. Попробуй ещё раз — это бесплатно.',
    });
  }

  const packId = await persistPack(userId, pack);
  await db.query(
    `UPDATE ai_generation_requests SET status='done', pack_id=$2, error=NULL, updated_at=NOW() WHERE id=$1`,
    [request.id, packId]
  );

  return res.json({ success: true, status: 'done', request_id: request.id, preview: buildPreview(packId, pack) });
}

async function loadOwnedRequest(reqId, userId) {
  const r = await db.query(
    `SELECT * FROM ai_generation_requests WHERE id = $1 AND user_id = $2`,
    [reqId, userId]
  );
  return r.rows[0] || null;
}

const aiPackController = {

  // GET /api/ai-packs/options
  async getOptions(req, res) {
    try {
      const userId = req.user.id;
      const freeUsed = await getFreeUsed(userId);
      res.json({
        success: true,
        configured: aiGen.isConfigured(),
        price_stars: PRICE_STARS,
        free_remaining: Math.max(0, FREE_LIMIT - freeUsed),
        survey_options: SURVEY_OPTIONS,
      });
    } catch (err) {
      console.error('aiPacks.getOptions error:', err);
      res.status(500).json({ success: false, error: 'Failed to get options' });
    }
  },

  // POST /api/ai-packs/requests  { prompt, survey, lang }
  // Создаёт запрос. Free → сразу право на генерацию. Paid → инвойс Telegram Stars.
  async createRequest(req, res) {
    try {
      const userId = req.user.id;
      const { prompt, survey, lang } = req.body;

      // Не берём оплату / не тратим бесплатную генерацию, если ИИ не настроен (нет ключа).
      if (!aiGen.isConfigured()) {
        return res.status(503).json({
          success: false, code: 'AI_NOT_CONFIGURED',
          error: 'AI-генерация скоро будет доступна.',
        });
      }

      if (!prompt || !String(prompt).trim()) {
        return res.status(400).json({ success: false, error: 'prompt is required' });
      }
      const cleanLang = ['ru', 'en', 'kk'].includes(lang) ? lang : 'ru';
      const cleanPrompt = String(prompt).trim().slice(0, 1000);

      const freeUsed = await getFreeUsed(userId);
      const isFree = freeUsed < FREE_LIMIT;

      const ins = await db.query(
        `INSERT INTO ai_generation_requests
           (user_id, prompt, survey, lang, status, is_free, price_paid_stars)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [userId, cleanPrompt, JSON.stringify(survey || {}), cleanLang,
         isFree ? 'paid' : 'pending', isFree, isFree ? 0 : PRICE_STARS]
      );
      const requestId = ins.rows[0].id;

      if (isFree) {
        return res.json({ success: true, request_id: requestId, free: true, status: 'paid' });
      }

      // Paid → инвойс. Оплата ДО генерации (ADR 0006).
      const bot = require('../server').bot;
      const payload = `aigen_${requestId}_${userId}_${Date.now()}`;
      const invoiceLink = await bot.createInvoiceLink(
        'AI-пак привычек',
        'Персональный пак привычек, собранный ИИ под твою цель',
        payload,
        '',
        'XTR',
        [{ label: 'AI generation', amount: PRICE_STARS }],
        { need_name: false, need_phone_number: false, need_email: false, need_shipping_address: false }
      );

      res.json({ success: true, request_id: requestId, invoice_link: invoiceLink, payload });
    } catch (err) {
      console.error('aiPacks.createRequest error:', err);
      res.status(500).json({ success: false, error: 'Failed to create request' });
    }
  },

  // POST /api/ai-packs/requests/:id/generate
  async generatePack(req, res) {
    try {
      const userId = req.user.id;
      const reqId = parseInt(req.params.id);
      const request = await loadOwnedRequest(reqId, userId);
      if (!request) return res.status(404).json({ success: false, error: 'Request not found' });

      if (request.status === 'pending') {
        return res.status(402).json({ success: false, error: 'Payment required' });
      }
      if (request.pack_id) {
        // уже сгенерировано — вернём превью из БД
        return aiPackController._previewFromDb(res, request);
      }
      return runGeneration(res, request, userId);
    } catch (err) {
      console.error('aiPacks.generatePack error:', err);
      res.status(500).json({ success: false, error: 'Failed to generate pack' });
    }
  },

  // POST /api/ai-packs/requests/:id/redo  — 1 бесплатная переделка (до активации)
  async redoPack(req, res) {
    try {
      const userId = req.user.id;
      const reqId = parseInt(req.params.id);
      const request = await loadOwnedRequest(reqId, userId);
      if (!request) return res.status(404).json({ success: false, error: 'Request not found' });

      if (!request.pack_id) {
        return res.status(400).json({ success: false, error: 'Nothing to redo yet' });
      }
      if (request.redo_used) {
        return res.status(403).json({ success: false, error: 'Бесплатная переделка уже использована' });
      }

      // Нельзя переделать активированный пак
      const activated = await db.query(
        `SELECT 1 FROM special_habit_purchases
         WHERE user_id = $1 AND pack_id = $2 AND payment_status = 'completed'`,
        [userId, request.pack_id]
      );
      if (activated.rows.length) {
        return res.status(400).json({ success: false, error: 'Пак уже активирован, переделать нельзя' });
      }

      // Удаляем старый сгенерированный пак (templates/achievements каскадом)
      await db.query(
        `DELETE FROM special_habit_packs
         WHERE id = $1 AND is_ai_generated = true AND created_by_user_id = $2`,
        [request.pack_id, userId]
      );
      await db.query(
        `UPDATE ai_generation_requests SET redo_used = true, pack_id = NULL, status = 'paid', updated_at = NOW()
         WHERE id = $1`,
        [request.id]
      );

      request.pack_id = null;
      request.redo_used = true;
      return runGeneration(res, request, userId);
    } catch (err) {
      console.error('aiPacks.redoPack error:', err);
      res.status(500).json({ success: false, error: 'Failed to redo pack' });
    }
  },

  // POST /api/ai-packs/requests/:id/activate — создаёт привычки (переиспускает special packs)
  async activatePack(req, res) {
    try {
      const userId = req.user.id;
      const reqId = parseInt(req.params.id);
      const request = await loadOwnedRequest(reqId, userId);
      if (!request) return res.status(404).json({ success: false, error: 'Request not found' });
      if (!request.pack_id || request.status !== 'done') {
        return res.status(400).json({ success: false, error: 'Pack is not ready' });
      }

      const result = await createPackHabitsForUser(userId, request.pack_id);
      res.json({ success: true, pack_id: request.pack_id, ...result });
    } catch (err) {
      console.error('aiPacks.activatePack error:', err);
      res.status(500).json({ success: false, error: 'Failed to activate pack' });
    }
  },

  // GET /api/ai-packs/requests/:id — статус запроса (для поллинга)
  async getRequestStatus(req, res) {
    try {
      const userId = req.user.id;
      const reqId = parseInt(req.params.id);
      const request = await loadOwnedRequest(reqId, userId);
      if (!request) return res.status(404).json({ success: false, error: 'Request not found' });

      if (request.status === 'done' && request.pack_id) {
        return aiPackController._previewFromDb(res, request);
      }
      res.json({ success: true, status: request.status, request_id: request.id });
    } catch (err) {
      console.error('aiPacks.getRequestStatus error:', err);
      res.status(500).json({ success: false, error: 'Failed to get status' });
    }
  },

  // GET /api/ai-packs/my — активированные AI-паки пользователя
  async getMyAiPacks(req, res) {
    try {
      const userId = req.user.id;
      const result = await db.query(
        `SELECT p.*, shp.purchased_at,
           (SELECT COUNT(*) FROM habits h
            WHERE h.user_id = $1 AND h.pack_id = p.id AND h.is_active = true AND h.is_special = true
           ) AS habits_count
         FROM special_habit_packs p
         JOIN special_habit_purchases shp ON shp.pack_id = p.id
         WHERE p.is_ai_generated = true
           AND p.created_by_user_id = $1
           AND shp.user_id = $1 AND shp.payment_status = 'completed'
         ORDER BY shp.purchased_at DESC`,
        [userId]
      );
      res.json({ success: true, packs: result.rows });
    } catch (err) {
      console.error('aiPacks.getMyAiPacks error:', err);
      res.status(500).json({ success: false, error: 'Failed to get packs' });
    }
  },

  // helper: собрать превью (без ачивок) из БД для готового запроса
  async _previewFromDb(res, request) {
    const packRes = await db.query(
      `SELECT id, name, short_description, bg_color FROM special_habit_packs WHERE id = $1`,
      [request.pack_id]
    );
    if (!packRes.rows.length) {
      return res.json({ success: true, status: request.status, request_id: request.id });
    }
    const p = packRes.rows[0];
    const habits = (await db.query(
      `SELECT title, goal, category_id, schedule_days, day_period, reminder_time
       FROM special_habit_templates WHERE pack_id = $1 ORDER BY sort_order ASC, id ASC`,
      [request.pack_id]
    )).rows;

    res.json({
      success: true,
      status: 'done',
      request_id: request.id,
      preview: {
        pack_id: p.id,
        name: p.name,
        short_description: p.short_description,
        bg_color: p.bg_color,
        habits,
        habit_count: habits.length,
        achievements_hidden: true,
      },
    });
  },
};

module.exports = aiPackController;
