// admin/adminSetup.js
//
// AdminJS v7 uses ESM. Since server.js is CommonJS, we load all AdminJS
// packages via dynamic import() which Node.js allows from CJS.
//
// Access the panel at  /admin
// Login: any email  +  ADMIN_PASSWORD env var (default: admin123)

'use strict';

const db = require('../config/database'); // existing pg pool for stats

// ─── Connection helpers ───────────────────────────────────────────────────────

function getConnectionOptions() {
  const isProd = process.env.NODE_ENV === 'production';

  if (process.env.DATABASE_URL) {
    // Extract database name from the URL
    let database = 'postgres';
    try {
      const url = new URL(process.env.DATABASE_URL);
      database = url.pathname.replace(/^\//, '') || 'postgres';
    } catch (_) {}

    return {
      connectionString: process.env.DATABASE_URL,
      database,
      ssl: isProd ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME     || 'postgres',
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: isProd ? { rejectUnauthorized: false } : false,
  };
}

// ─── Actions shortcuts ────────────────────────────────────────────────────────

const noCreate = { new: { isAccessible: false } };
const noDelete = { delete: { isAccessible: false } };
const viewOnly  = { new: { isAccessible: false }, delete: { isAccessible: false }, edit: { isAccessible: false } };

// ─── Main async builder ───────────────────────────────────────────────────────

async function buildAdminRouter() {
  // ── Dynamic ESM imports ──────────────────────────────────────────────────
  const { default: AdminJS }          = await import('adminjs');
  const { default: AdminJSExpress }   = await import('@adminjs/express');
  const { default: Adapter, Database, Resource } = await import('@adminjs/sql');

  AdminJS.registerAdapter({ Database, Resource });

  // ── Connect to Postgres via @adminjs/sql Adapter ─────────────────────────
  const sqlDb = await new Adapter('postgresql', getConnectionOptions()).init();

  // ── Build AdminJS instance ────────────────────────────────────────────────
  const adminJs = new AdminJS({
    rootPath: '/admin',

    resources: [

      // ── Пакеты привычек (full CRUD) ──────────────────────────────────────
      {
        resource: sqlDb.table('special_habit_packs'),
        options: {
          navigation: { name: 'Пакеты', icon: 'Star' },
          sort: { sortBy: 'sort_order', direction: 'asc' },
          listProperties:  ['id', 'name', 'price_stars', 'original_price_stars', 'is_active', 'sort_order'],
          showProperties:  ['id', 'name', 'short_description', 'biography', 'photo_url', 'learn_more_url', 'price_stars', 'original_price_stars', 'bg_color', 'sort_order', 'is_active', 'created_at'],
          editProperties:  ['name', 'short_description', 'biography', 'photo_url', 'learn_more_url', 'price_stars', 'original_price_stars', 'bg_color', 'sort_order', 'is_active'],
          filterProperties: ['name', 'is_active', 'price_stars'],
        },
      },

      // ── Шаблоны привычек в пакете ────────────────────────────────────────
      {
        resource: sqlDb.table('special_habit_templates'),
        options: {
          navigation: { name: 'Пакеты' },
          sort: { sortBy: 'sort_order', direction: 'asc' },
          listProperties:  ['id', 'pack_id', 'title', 'goal', 'day_period', 'sort_order'],
          editProperties:  ['pack_id', 'title', 'goal', 'category_id', 'schedule_days', 'reminder_time', 'reminder_enabled', 'day_period', 'sort_order'],
          filterProperties: ['pack_id', 'day_period'],
        },
      },

      // ── Достижения пакета ────────────────────────────────────────────────
      {
        resource: sqlDb.table('pack_achievements'),
        options: {
          navigation: { name: 'Пакеты' },
          sort: { sortBy: 'sort_order', direction: 'asc' },
          listProperties:  ['id', 'pack_id', 'title', 'icon', 'required_count', 'sort_order'],
          editProperties:  ['pack_id', 'title', 'icon', 'description', 'required_count', 'sort_order'],
        },
      },

      // ── Пользователи (no create/delete) ──────────────────────────────────
      {
        resource: sqlDb.table('users'),
        options: {
          navigation: { name: 'Пользователи', icon: 'User' },
          actions: { ...noCreate, ...noDelete },
          sort: { sortBy: 'id', direction: 'desc' },
          listProperties:   ['id', 'first_name', 'username', 'language', 'is_admin', 'is_premium', 'created_at'],
          showProperties:   ['id', 'telegram_id', 'first_name', 'last_name', 'username', 'language', 'is_admin', 'is_premium', 'show_swipe_hint', 'show_friend_hint', 'created_at'],
          editProperties:   ['is_admin', 'is_premium'],
          filterProperties: ['first_name', 'username', 'language', 'is_admin', 'is_premium'],
        },
      },

      // ── Подписки (view only) ─────────────────────────────────────────────
      {
        resource: sqlDb.table('subscriptions'),
        options: {
          navigation: { name: 'Пользователи' },
          actions: viewOnly,
          sort: { sortBy: 'id', direction: 'desc' },
          listProperties: ['id', 'user_id', 'type', 'stars_amount', 'started_at', 'expires_at', 'is_active'],
          filterProperties: ['type', 'is_active'],
        },
      },

      // ── Категории (full CRUD) ────────────────────────────────────────────
      {
        resource: sqlDb.table('categories'),
        options: {
          navigation: { name: 'Контент', icon: 'Grid' },
          sort: { sortBy: 'sort_order', direction: 'asc' },
          listProperties:  ['id', 'name_ru', 'name_en', 'icon', 'color', 'sort_order'],
          editProperties:  ['name_ru', 'name_en', 'icon', 'color', 'sort_order'],
        },
      },

      // ── Покупки пакетов (view only) ──────────────────────────────────────
      {
        resource: sqlDb.table('special_habit_purchases'),
        options: {
          navigation: { name: 'Продажи', icon: 'Money' },
          actions: viewOnly,
          sort: { sortBy: 'purchased_at', direction: 'desc' },
          listProperties: ['id', 'user_id', 'pack_id', 'price_paid_stars', 'payment_status', 'purchased_at'],
          filterProperties: ['payment_status', 'pack_id'],
        },
      },

    ],

    branding: {
      companyName:      'Habit Tracker',
      logo:             false,
      withMadeWithLove: false,
    },
  });

  // ── Authenticated router ──────────────────────────────────────────────────
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const COOKIE_SECRET  = process.env.SESSION_SECRET;

  if (!ADMIN_PASSWORD) {
    throw new Error('❌ ADMIN_PASSWORD environment variable is required');
  }
  if (!COOKIE_SECRET || COOKIE_SECRET.length < 32) {
    throw new Error('❌ SESSION_SECRET environment variable is required (min 32 chars)');
  }

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
        maxAge:   8 * 60 * 60 * 1000, // 8h
      },
    }
  );

  // ── Stats API endpoint (behind AdminJS session) ───────────────────────────
  router.get('/api/stats', async (req, res) => {
    if (!req.session?.adminUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const result = await db.query(`
        SELECT
          (SELECT COUNT(*)::int  FROM users)                                                      AS total_users,
          (SELECT COUNT(*)::int  FROM users WHERE created_at > NOW() - INTERVAL '7 days')         AS new_users_week,
          (SELECT COUNT(*)::int  FROM users WHERE created_at > NOW() - INTERVAL '30 days')        AS new_users_month,
          (SELECT COUNT(*)::int  FROM special_habit_purchases WHERE payment_status = 'completed') AS total_purchases,
          (SELECT COALESCE(SUM(price_paid_stars),0)::int
             FROM special_habit_purchases WHERE payment_status = 'completed')                     AS total_stars_earned,
          (SELECT COUNT(*)::int  FROM subscriptions    WHERE is_active = true)                    AS active_subscriptions,
          (SELECT COUNT(*)::int  FROM habits            WHERE is_active = true)                   AS total_habits,
          (SELECT COUNT(*)::int  FROM special_habit_packs)                                        AS total_packs
      `);
      res.json(result.rows[0]);
    } catch (err) {
      console.error('AdminJS /api/stats error:', err.message);
      res.status(500).json({ error: 'Database error' });
    }
  });

  return { adminJs, router };
}

module.exports = { buildAdminRouter };
