// admin/adminSetup.js
//
// AdminJS v7  (ESM) loaded via dynamic import() from CommonJS server.js
// Access: /admin   Login: any email + ADMIN_PASSWORD env var

'use strict';

const path = require('path');
const db   = require('../config/database');

// ─── DB connection ────────────────────────────────────────────────────────────

function getConnectionOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  if (process.env.DATABASE_URL) {
    let database = 'postgres';
    try { database = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') || 'postgres'; } catch (_) {}
    return { connectionString: process.env.DATABASE_URL, database, ssl: isProd ? { rejectUnauthorized: false } : false };
  }
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: isProd ? { rejectUnauthorized: false } : false,
  };
}

// ─── Action presets ───────────────────────────────────────────────────────────

const noCreate  = { new:    { isAccessible: false } };
const noDelete  = { delete: { isAccessible: false } };
const noEdit    = { edit:   { isAccessible: false } };
const viewOnly  = { new: { isAccessible: false }, delete: { isAccessible: false }, edit: { isAccessible: false } };
const noCreateDelete = { ...noCreate, ...noDelete };

// ─── Safe table loader ────────────────────────────────────────────────────────

function loadTables(sqlDb, names) {
  const result = {};
  for (const name of names) {
    try { result[name] = sqlDb.table(name); }
    catch (e) { console.warn(`⚠️  AdminJS: table "${name}" not found — skipping`); }
  }
  return result;
}

// ─── Reminder time helper ─────────────────────────────────────────────────────
// Parses reminder_time (HH:MM string or ISO datetime) → normalises to HH:MM:SS
// and auto-derives day_period:
//   Night 00-05 | Morning 06-11 | Afternoon 12-17 | Evening 18-23

function applyReminderTimeToPeriod(payload) {
  const raw = (payload.reminder_time || '').trim();
  let hh, mm;

  if (raw.includes('T') || (raw.includes('-') && raw.length > 8)) {
    // ISO datetime from old datetime-picker (e.g. "2026-03-11T14:00:00.000+05:00")
    const d = new Date(raw);
    if (!isNaN(d.getTime())) { hh = d.getUTCHours(); mm = d.getUTCMinutes(); }
  } else {
    // Plain time string: "14:30" or "14:30:00"
    const m = raw.match(/^(\d{1,2}):(\d{2})/);
    if (m) { hh = parseInt(m[1], 10); mm = parseInt(m[2], 10); }
  }

  if (hh === undefined) return payload; // unparseable – leave as-is

  payload.reminder_time = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00`;

  if      (hh >= 6  && hh < 12) payload.day_period = 'morning';
  else if (hh >= 12 && hh < 18) payload.day_period = 'afternoon';
  else if (hh >= 18)             payload.day_period = 'evening';
  else                           payload.day_period = 'night';

  return payload;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

async function buildAdminRouter() {
  const { default: AdminJS, ComponentLoader } = await import('adminjs');
  const { default: AdminJSExpress }           = await import('@adminjs/express');
  const { default: Adapter, Database, Resource } = await import('@adminjs/sql');
  const { dark, light }                       = await import('@adminjs/themes');

  AdminJS.registerAdapter({ Database, Resource });

  // ── Custom components ────────────────────────────────────────────────────
  const componentLoader = new ComponentLoader();
  const DashboardComponent = componentLoader.add(
    'Dashboard',
    path.join(__dirname, 'components/Dashboard')
  );
  const ScheduleDaysInputComponent = componentLoader.add(
    'ScheduleDaysInput',
    path.join(__dirname, 'components/ScheduleDaysInput')
  );
  const ReminderTimeInputComponent = componentLoader.add(
    'ReminderTimeInput',
    path.join(__dirname, 'components/ReminderTimeInput')
  );

  // ── Connect DB ──────────────────────────────────────────────────────────
  const sqlDb = await new Adapter('postgresql', getConnectionOptions()).init();

  const t = loadTables(sqlDb, [
    'users', 'subscriptions', 'subscription_history',
    'habits', 'habit_marks', 'shared_habits', 'habit_members', 'habit_punches',
    'categories', 'motivational_phrases',
    'special_habit_packs', 'special_habit_templates', 'pack_achievements',
    'special_habit_purchases', 'pack_achievement_progress',
    'payment_invoices', 'promo_codes', 'promo_code_usage', 'stars_transfers',
    'reminder_history',
  ]);

  // ── Build resources list (skip missing tables) ──────────────────────────
  const resources = [

    // ═══════════════════════ 👥 ПОЛЬЗОВАТЕЛИ ═══════════════════════════════

    t.users && {
      resource: t.users,
      options: {
        navigation: { name: 'Пользователи', icon: 'User' },
        actions: { ...noCreate, ...noDelete },
        sort: { sortBy: 'id', direction: 'desc' },
        listProperties:   ['id', 'first_name', 'username', 'language', 'is_premium', 'is_admin', 'created_at'],
        showProperties:   ['id', 'telegram_id', 'first_name', 'last_name', 'username', 'language', 'is_admin', 'is_premium', 'photo_url', 'last_login_at', 'created_at'],
        editProperties:   ['is_admin', 'is_premium'],
        filterProperties: ['first_name', 'username', 'language', 'is_admin', 'is_premium'],
        properties: {
          telegram_id: { description: 'Telegram User ID' },
          is_premium:  { description: 'Премиум доступ' },
          is_admin:    { description: 'Доступ к администрированию бота' },
        },
      },
    },

    t.subscriptions && {
      resource: t.subscriptions,
      options: {
        navigation: { name: 'Пользователи' },
        actions: viewOnly,
        sort: { sortBy: 'id', direction: 'desc' },
        listProperties:   ['id', 'user_id', 'type', 'plan_type', 'stars_amount', 'is_active', 'started_at', 'expires_at'],
        showProperties:   ['id', 'user_id', 'type', 'plan_type', 'stars_amount', 'transaction_id', 'is_active', 'started_at', 'expires_at', 'cancelled_at'],
        filterProperties: ['type', 'plan_type', 'is_active'],
      },
    },

    t.subscription_history && {
      resource: t.subscription_history,
      options: {
        navigation: { name: 'Пользователи' },
        actions: viewOnly,
        sort: { sortBy: 'id', direction: 'desc' },
        listProperties:   ['id', 'user_id', 'action', 'plan_type', 'price_stars', 'created_at'],
        filterProperties: ['action', 'user_id'],
      },
    },

    // ═══════════════════════ ✅ ПРИВЫЧКИ ════════════════════════════════════

    t.habits && {
      resource: t.habits,
      options: {
        navigation: { name: 'Привычки', icon: 'CheckSquare' },
        actions: { ...noCreate, ...noDelete, edit: { isAccessible: false } },
        sort: { sortBy: 'id', direction: 'desc' },
        listProperties:   ['id', 'user_id', 'title', 'day_period', 'schedule_type', 'streak_current', 'is_active', 'is_special', 'created_at'],
        showProperties:   ['id', 'user_id', 'category_id', 'pack_id', 'template_id', 'title', 'goal', 'schedule_type', 'schedule_days', 'day_period', 'reminder_time', 'reminder_enabled', 'is_bad_habit', 'is_special', 'streak_current', 'streak_best', 'is_active', 'created_at', 'updated_at'],
        filterProperties: ['is_active', 'is_special', 'day_period', 'schedule_type', 'user_id', 'category_id'],
      },
    },

    t.habit_marks && {
      resource: t.habit_marks,
      options: {
        navigation: { name: 'Привычки' },
        actions: viewOnly,
        sort: { sortBy: 'id', direction: 'desc' },
        listProperties:   ['id', 'habit_id', 'date', 'status', 'marked_at'],
        filterProperties: ['status', 'date', 'habit_id'],
      },
    },

    t.shared_habits && {
      resource: t.shared_habits,
      options: {
        navigation: { name: 'Привычки' },
        actions: viewOnly,
        sort: { sortBy: 'id', direction: 'desc' },
        listProperties:   ['id', 'habit_id', 'owner_user_id', 'share_code', 'created_at'],
        filterProperties: ['owner_user_id'],
      },
    },

    t.habit_members && {
      resource: t.habit_members,
      options: {
        navigation: { name: 'Привычки' },
        actions: viewOnly,
        sort: { sortBy: 'id', direction: 'desc' },
        listProperties:   ['id', 'habit_id', 'user_id', 'is_active', 'joined_at'],
        filterProperties: ['is_active', 'habit_id'],
      },
    },

    // ═══════════════════════ 📦 ПАКЕТЫ ══════════════════════════════════════

    t.special_habit_packs && {
      resource: t.special_habit_packs,
      options: {
        navigation: { name: 'Пакеты', icon: 'Star' },
        sort: { sortBy: 'sort_order', direction: 'asc' },
        listProperties:   ['id', 'name', 'price_stars', 'original_price_stars', 'is_active', 'sort_order'],
        showProperties:   ['id', 'name', 'short_description', 'biography', 'photo_url', 'learn_more_url', 'price_stars', 'original_price_stars', 'bg_color', 'sort_order', 'is_active', 'created_at'],
        editProperties:   ['name', 'short_description', 'biography', 'photo_url', 'learn_more_url', 'price_stars', 'original_price_stars', 'bg_color', 'sort_order', 'is_active'],
        filterProperties: ['name', 'is_active', 'price_stars'],
        properties: {
          biography:    { type: 'textarea' },
          photo_url:    { description: 'URL фото (начинается с https://)' },
          bg_color:     { description: 'CSS-цвет фона карточки, например: #FF5733' },
          price_stars:  { description: 'Цена в Telegram Stars (0 = бесплатно)' },
        },
      },
    },

    t.special_habit_templates && {
      resource: t.special_habit_templates,
      options: {
        navigation: { name: 'Пакеты' },
        sort: { sortBy: 'sort_order', direction: 'asc' },
        listProperties:   ['id', 'pack_id', 'title', 'goal', 'reminder_time', 'day_period', 'sort_order'],
        showProperties:   ['id', 'pack_id', 'title', 'goal', 'category_id', 'schedule_days', 'reminder_time', 'reminder_enabled', 'day_period', 'sort_order'],
        // day_period removed from edit — it's auto-set from reminder_time in the before hook
        editProperties:   ['pack_id', 'title', 'goal', 'category_id', 'schedule_days', 'reminder_time', 'reminder_enabled', 'sort_order'],
        filterProperties: ['pack_id', 'day_period'],
        properties: {
          reminder_time: {
            type: 'string',
            description: 'Day Period установится автоматически по выбранному времени.',
            components: {
              edit: ReminderTimeInputComponent,
            },
          },
          schedule_days: {
            components: {
              edit: ScheduleDaysInputComponent,
            },
          },
          day_period: {
            description: 'Устанавливается автоматически: Утро 06-11 | День 12-17 | Вечер 18-23 | Ночь 00-05',
          },
        },
        actions: {
          new: {
            before: async (request) => {
              if (request.payload && request.payload.reminder_time) {
                request.payload = applyReminderTimeToPeriod(request.payload);
              }
              return request;
            },
          },
          edit: {
            before: async (request) => {
              if (request.payload && request.payload.reminder_time) {
                request.payload = applyReminderTimeToPeriod(request.payload);
              }
              return request;
            },
          },
        },
      },
    },

    t.pack_achievements && {
      resource: t.pack_achievements,
      options: {
        navigation: { name: 'Пакеты' },
        sort: { sortBy: 'sort_order', direction: 'asc' },
        listProperties:   ['id', 'pack_id', 'title', 'icon', 'required_count', 'sort_order'],
        showProperties:   ['id', 'pack_id', 'title', 'icon', 'description', 'required_count', 'sort_order'],
        editProperties:   ['pack_id', 'title', 'icon', 'description', 'required_count', 'sort_order'],
      },
    },

    t.special_habit_purchases && {
      resource: t.special_habit_purchases,
      options: {
        navigation: { name: 'Пакеты' },
        actions: viewOnly,
        sort: { sortBy: 'purchased_at', direction: 'desc' },
        listProperties:   ['id', 'user_id', 'pack_id', 'price_paid_stars', 'payment_status', 'purchased_at'],
        showProperties:   ['id', 'user_id', 'pack_id', 'price_paid_stars', 'telegram_payment_charge_id', 'payment_status', 'purchased_at'],
        filterProperties: ['payment_status', 'pack_id', 'user_id'],
      },
    },

    t.pack_achievement_progress && {
      resource: t.pack_achievement_progress,
      options: {
        navigation: { name: 'Пакеты' },
        actions: viewOnly,
        sort: { sortBy: 'id', direction: 'desc' },
        listProperties:   ['id', 'user_id', 'pack_id', 'achievement_id', 'current_count', 'is_unlocked', 'unlocked_at'],
        filterProperties: ['is_unlocked', 'pack_id', 'user_id'],
      },
    },

    // ═══════════════════════ 🎨 КОНТЕНТ ═════════════════════════════════════

    t.categories && {
      resource: t.categories,
      options: {
        navigation: { name: 'Контент', icon: 'Grid' },
        sort: { sortBy: 'sort_order', direction: 'asc' },
        listProperties:   ['id', 'name_ru', 'name_en', 'icon', 'color', 'sort_order'],
        showProperties:   ['id', 'name_ru', 'name_en', 'icon', 'color', 'sort_order', 'created_at'],
        editProperties:   ['name_ru', 'name_en', 'icon', 'color', 'sort_order'],
        properties: {
          icon:  { description: 'Emoji иконка, например 🏃' },
          color: { description: 'HEX цвет, например #EF4444' },
        },
      },
    },

    t.motivational_phrases && {
      resource: t.motivational_phrases,
      options: {
        navigation: { name: 'Контент' },
        sort: { sortBy: 'id', direction: 'desc' },
        listProperties:   ['id', 'emoji', 'type', 'min_completed', 'phrase_ru'],
        showProperties:   ['id', 'phrase_ru', 'phrase_en', 'emoji', 'type', 'min_completed', 'background_color', 'created_at'],
        editProperties:   ['phrase_ru', 'phrase_en', 'emoji', 'type', 'min_completed', 'background_color'],
        filterProperties: ['type'],
        properties: {
          phrase_ru:        { type: 'textarea' },
          phrase_en:        { type: 'textarea' },
          type:             { availableValues: [
            { value: 'success',       label: 'Успех' },
            { value: 'encouragement', label: 'Ободрение' },
            { value: 'streak',        label: 'Серия' },
            { value: 'perfect',       label: 'Идеальный день' },
          ]},
          background_color: { description: 'HEX цвет фона, например #A7D96C' },
        },
      },
    },

    // ═══════════════════════ 💰 ПЛАТЕЖИ ═════════════════════════════════════

    t.payment_invoices && {
      resource: t.payment_invoices,
      options: {
        navigation: { name: 'Платежи', icon: 'Currency' },
        actions: viewOnly,
        sort: { sortBy: 'created_at', direction: 'desc' },
        listProperties:   ['id', 'user_id', 'plan_type', 'amount', 'status', 'created_at', 'paid_at'],
        showProperties:   ['id', 'user_id', 'plan_type', 'amount', 'status', 'transaction_id', 'telegram_payment_id', 'payload', 'created_at', 'paid_at', 'cancelled_at'],
        filterProperties: ['status', 'plan_type', 'user_id'],
      },
    },

    t.promo_codes && {
      resource: t.promo_codes,
      options: {
        navigation: { name: 'Платежи' },
        actions: { ...noDelete },
        sort: { sortBy: 'created_at', direction: 'desc' },
        listProperties:   ['id', 'code', 'discount_percent', 'is_active', 'max_uses', 'current_uses', 'expires_at'],
        showProperties:   ['id', 'code', 'discount_percent', 'is_active', 'max_uses', 'current_uses', 'expires_at', 'created_at'],
        editProperties:   ['code', 'discount_percent', 'is_active', 'max_uses', 'expires_at'],
        filterProperties: ['is_active'],
        properties: {
          discount_percent: { description: 'Скидка в % (0–100)' },
          max_uses:         { description: 'Максимум использований (пусто = без лимита)' },
        },
      },
    },

    t.promo_code_usage && {
      resource: t.promo_code_usage,
      options: {
        navigation: { name: 'Платежи' },
        actions: viewOnly,
        sort: { sortBy: 'used_at', direction: 'desc' },
        listProperties:   ['id', 'user_id', 'promo_code', 'discount_amount', 'used_at'],
        filterProperties: ['promo_code', 'user_id'],
      },
    },

    t.stars_transfers && {
      resource: t.stars_transfers,
      options: {
        navigation: { name: 'Платежи' },
        actions: viewOnly,
        sort: { sortBy: 'created_at', direction: 'desc' },
        listProperties:   ['id', 'from_user_id', 'to_telegram_id', 'amount', 'status', 'created_at'],
        filterProperties: ['status'],
      },
    },

    // ═══════════════════════ ⚙️ СИСТЕМА ═════════════════════════════════════

    t.reminder_history && {
      resource: t.reminder_history,
      options: {
        navigation: { name: 'Система', icon: 'Settings' },
        actions: viewOnly,
        sort: { sortBy: 'sent_at', direction: 'desc' },
        listProperties:   ['id', 'habit_id', 'sent_at', 'is_marked', 'marked_at'],
        filterProperties: ['is_marked', 'habit_id'],
      },
    },

  ].filter(Boolean);

  // ── AdminJS instance ────────────────────────────────────────────────────
  const adminJs = new AdminJS({
    rootPath: '/admin',
    componentLoader,

    dashboard: {
      component: DashboardComponent,
    },

    resources,

    // Themes: light (default standard look) + dark (switchable via UI icon)
    defaultTheme: light.id,
    availableThemes: [light, dark],

    branding: {
      companyName:      'Habit Tracker',
      logo:             false,
      withMadeWithLove: false,
    },
  });

  // ── Auth router ─────────────────────────────────────────────────────────
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const COOKIE_SECRET  = process.env.SESSION_SECRET;

  if (!ADMIN_PASSWORD) throw new Error('❌ ADMIN_PASSWORD env var is required');
  if (!COOKIE_SECRET || COOKIE_SECRET.length < 32) throw new Error('❌ SESSION_SECRET env var is required (min 32 chars)');

  const router = AdminJSExpress.buildAuthenticatedRouter(
    adminJs,
    {
      authenticate: async (_email, password) => {
        if (password === ADMIN_PASSWORD) return { email: 'admin', role: 'admin' };
        return null;
      },
      cookieName:     'adminjs_session',
      cookiePassword: COOKIE_SECRET,
    },
    null,
    {
      resave:            false,
      saveUninitialized: true,
      secret:            COOKIE_SECRET,
      cookie: {
        secure:   process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge:   8 * 60 * 60 * 1000,
      },
    }
  );

  // ── Enhanced stats API ──────────────────────────────────────────────────
  const safe = async (query, fallback = 0) => {
    try { const r = await db.query(query); return r.rows[0]?.val ?? fallback; }
    catch { return fallback; }
  };

  router.get('/api/stats', async (req, res) => {
    if (!req.session?.adminUser) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const [
        total_users, new_users_week, new_users_month, new_users_today,
        premium_users, users_ru, users_en, users_kk,
        total_habits, active_habits, special_habits,
        marks_today, marks_completed_today,
        active_subscriptions, premium_subscriptions,
        total_packs, active_packs, total_templates,
        total_purchases, total_stars_packs,
        paid_invoices, total_stars_invoices,
        active_promo_codes, promo_uses_total,
        total_phrases, total_categories,
        reminders_today,
      ] = await Promise.all([
        safe(`SELECT COUNT(*)::int AS val FROM users`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE created_at > NOW() - INTERVAL '7 days'`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE created_at > NOW() - INTERVAL '30 days'`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE created_at::date = CURRENT_DATE`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE is_premium = true`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE language = 'ru'`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE language = 'en'`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE language = 'kk'`),
        safe(`SELECT COUNT(*)::int AS val FROM habits`),
        safe(`SELECT COUNT(*)::int AS val FROM habits WHERE is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM habits WHERE is_special = true AND is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM habit_marks WHERE date = CURRENT_DATE`),
        safe(`SELECT COUNT(*)::int AS val FROM habit_marks WHERE date = CURRENT_DATE AND status = 'completed'`),
        safe(`SELECT COUNT(*)::int AS val FROM subscriptions WHERE is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM subscriptions WHERE type = 'premium' AND is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM special_habit_packs`),
        safe(`SELECT COUNT(*)::int AS val FROM special_habit_packs WHERE is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM special_habit_templates`),
        safe(`SELECT COUNT(*)::int AS val FROM special_habit_purchases WHERE payment_status = 'completed'`),
        safe(`SELECT COALESCE(SUM(price_paid_stars),0)::int AS val FROM special_habit_purchases WHERE payment_status = 'completed'`),
        safe(`SELECT COUNT(*)::int AS val FROM payment_invoices WHERE status = 'paid'`),
        safe(`SELECT COALESCE(SUM(amount),0)::int AS val FROM payment_invoices WHERE status = 'paid'`),
        safe(`SELECT COUNT(*)::int AS val FROM promo_codes WHERE is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM promo_code_usage`),
        safe(`SELECT COUNT(*)::int AS val FROM motivational_phrases`),
        safe(`SELECT COUNT(*)::int AS val FROM categories`),
        safe(`SELECT COUNT(*)::int AS val FROM reminder_history WHERE sent_at::date = CURRENT_DATE`),
      ]);

      // Weekly registrations (last 14 days)
      let weekly_registrations = [];
      try {
        const r = await db.query(`
          SELECT DATE(created_at) AS date, COUNT(*)::int AS count
          FROM users
          WHERE created_at > NOW() - INTERVAL '14 days'
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `);
        weekly_registrations = r.rows;
      } catch (_) {}

      // Top packs by purchases
      let top_packs = [];
      try {
        const r = await db.query(`
          SELECT p.name, COUNT(pu.id)::int AS purchases, COALESCE(SUM(pu.price_paid_stars),0)::int AS stars
          FROM special_habit_packs p
          LEFT JOIN special_habit_purchases pu ON pu.pack_id = p.id AND pu.payment_status = 'completed'
          GROUP BY p.id, p.name
          ORDER BY purchases DESC
          LIMIT 5
        `);
        top_packs = r.rows;
      } catch (_) {}

      // Purchases by day (last 14 days)
      let weekly_purchases = [];
      try {
        const r = await db.query(`
          SELECT DATE(purchased_at) AS date, COUNT(*)::int AS count,
                 COALESCE(SUM(price_paid_stars),0)::int AS stars
          FROM special_habit_purchases
          WHERE payment_status = 'completed' AND purchased_at > NOW() - INTERVAL '14 days'
          GROUP BY DATE(purchased_at)
          ORDER BY date ASC
        `);
        weekly_purchases = r.rows;
      } catch (_) {}

      res.json({
        // Users
        total_users, new_users_week, new_users_month, new_users_today,
        premium_users, users_ru, users_en, users_kk,
        // Habits
        total_habits, active_habits, special_habits,
        marks_today, marks_completed_today,
        // Subscriptions
        active_subscriptions, premium_subscriptions,
        // Packs
        total_packs, active_packs, total_templates,
        total_purchases, total_stars_packs,
        // Payments
        paid_invoices, total_stars_invoices,
        total_stars_earned: total_stars_packs + total_stars_invoices,
        // Promo
        active_promo_codes, promo_uses_total,
        // Content
        total_phrases, total_categories,
        // System
        reminders_today,
        // Charts
        weekly_registrations,
        top_packs,
        weekly_purchases,
      });
    } catch (err) {
      console.error('AdminJS /api/stats error:', err.message);
      res.status(500).json({ error: 'Database error' });
    }
  });

  return { adminJs, router };
}

module.exports = { buildAdminRouter };
