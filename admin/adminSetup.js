// admin/adminSetup.js
// AdminJS-based admin panel for Habit Tracker
// Replaces the old HTML/session-based admin panel
//
// Access: /admin  (login with ADMIN_PASSWORD env var)

'use strict';

const AdminJS            = require('adminjs');
const AdminJSExpress     = require('@adminjs/express');
const { Database, Resource } = require('@adminjs/sql');
const knex               = require('knex');

// Register the @adminjs/sql adapter
AdminJS.registerAdapter({ Database, Resource });

// ─── Connection helpers ───────────────────────────────────────────────────────

function buildKnexConnection() {
  const isProd = process.env.NODE_ENV === 'production';

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: isProd ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:      isProd ? { rejectUnauthorized: false } : false,
  };
}

// ─── Resource options helpers ─────────────────────────────────────────────────

const readOnlyActions = {
  new:    { isAccessible: false },
  delete: { isAccessible: false },
};

const viewOnlyActions = {
  new:    { isAccessible: false },
  delete: { isAccessible: false },
  edit:   { isAccessible: false },
};

// ─── Main builder ─────────────────────────────────────────────────────────────

async function buildAdminRouter() {
  // Create knex instance (separate from the main pg pool)
  const knexInstance = knex({
    client:     'pg',
    connection: buildKnexConnection(),
    pool:       { min: 1, max: 3 },
  });

  // Introspect schema
  const db = new Database(knexInstance);
  await db.init();

  // ── AdminJS instance ─────────────────────────────────────────────────────
  const adminJs = new AdminJS({
    rootPath: '/admin',

    resources: [

      // ── Habit Packs (full CRUD) ─────────────────────────────────────────
      {
        resource: await db.table('special_habit_packs'),
        options: {
          navigation:  { name: 'Пакеты', icon: 'Star' },
          sort:        { sortBy: 'sort_order', direction: 'asc' },
          listProperties: ['id', 'name', 'price_stars', 'is_active', 'sort_order'],
          editProperties: [
            'name', 'short_description', 'biography', 'photo_url',
            'learn_more_url', 'price_stars', 'original_price_stars',
            'bg_color', 'sort_order', 'is_active',
          ],
          showProperties: [
            'id', 'name', 'short_description', 'biography', 'photo_url',
            'learn_more_url', 'price_stars', 'original_price_stars',
            'bg_color', 'sort_order', 'is_active', 'created_at',
          ],
        },
      },

      // ── Pack Habit Templates ───────────────────────────────────────────
      {
        resource: await db.table('special_habit_templates'),
        options: {
          navigation:  { name: 'Пакеты' },
          sort:        { sortBy: 'sort_order', direction: 'asc' },
          listProperties: ['id', 'pack_id', 'title', 'goal', 'day_period', 'sort_order'],
          editProperties: [
            'pack_id', 'title', 'goal', 'category_id',
            'schedule_days', 'reminder_time', 'reminder_enabled',
            'day_period', 'sort_order',
          ],
        },
      },

      // ── Pack Achievements ──────────────────────────────────────────────
      {
        resource: await db.table('pack_achievements'),
        options: {
          navigation:  { name: 'Пакеты' },
          sort:        { sortBy: 'sort_order', direction: 'asc' },
          listProperties: ['id', 'pack_id', 'title', 'icon', 'required_count', 'sort_order'],
          editProperties: ['pack_id', 'title', 'icon', 'description', 'required_count', 'sort_order'],
        },
      },

      // ── Users (no create/delete) ───────────────────────────────────────
      {
        resource: await db.table('users'),
        options: {
          navigation:   { name: 'Пользователи', icon: 'User' },
          actions:      readOnlyActions,
          sort:         { sortBy: 'id', direction: 'desc' },
          listProperties: ['id', 'first_name', 'username', 'language', 'is_admin', 'is_premium', 'created_at'],
          editProperties: ['is_admin', 'is_premium'],
          showProperties: [
            'id', 'telegram_id', 'first_name', 'last_name', 'username',
            'language', 'is_admin', 'is_premium',
            'show_swipe_hint', 'show_friend_hint', 'created_at',
          ],
          filterProperties: ['first_name', 'username', 'language', 'is_admin', 'is_premium'],
        },
      },

      // ── Subscriptions (view only) ──────────────────────────────────────
      {
        resource: await db.table('subscriptions'),
        options: {
          navigation:  { name: 'Пользователи' },
          actions:     viewOnlyActions,
          sort:        { sortBy: 'id', direction: 'desc' },
          listProperties: ['id', 'user_id', 'type', 'stars_amount', 'started_at', 'expires_at', 'is_active'],
        },
      },

      // ── Categories (full CRUD) ─────────────────────────────────────────
      {
        resource: await db.table('categories'),
        options: {
          navigation:  { name: 'Контент', icon: 'Tags' },
          sort:        { sortBy: 'sort_order', direction: 'asc' },
          listProperties: ['id', 'name_ru', 'name_en', 'icon', 'color', 'sort_order'],
          editProperties: ['name_ru', 'name_en', 'icon', 'color', 'sort_order'],
        },
      },

      // ── Purchases (view only) ──────────────────────────────────────────
      {
        resource: await db.table('special_habit_purchases'),
        options: {
          navigation:  { name: 'Продажи', icon: 'Currency' },
          actions:     viewOnlyActions,
          sort:        { sortBy: 'purchased_at', direction: 'desc' },
          listProperties: ['id', 'user_id', 'pack_id', 'price_paid_stars', 'payment_status', 'purchased_at'],
        },
      },

    ],

    // ── Dashboard ──────────────────────────────────────────────────────────
    dashboard: {
      component: AdminJS.bundle('./components/Dashboard'),
    },

    // ── Branding ───────────────────────────────────────────────────────────
    branding: {
      companyName:     'Habit Tracker',
      logo:            false,
      withMadeWithLove: false,
    },
  });

  // ── Build authenticated Express router ─────────────────────────────────
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
  const COOKIE_SECRET  = process.env.SESSION_SECRET  || 'adminjs-secret-at-least-32-chars!!';

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
    null, // custom router (null = create new)
    {
      resave:             false,
      saveUninitialized:  true,
      secret:             COOKIE_SECRET,
    }
  );

  // ── Stats API (uses AdminJS session) ──────────────────────────────────
  router.get('/api/stats', async (req, res) => {
    if (!req.session?.adminUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const result = await knexInstance.raw(`
        SELECT
          (SELECT COUNT(*)::int FROM users)                                                      AS total_users,
          (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '7 days')        AS new_users_week,
          (SELECT COUNT(*)::int FROM users WHERE created_at > NOW() - INTERVAL '30 days')       AS new_users_month,
          (SELECT COUNT(*)::int FROM special_habit_purchases WHERE payment_status = 'completed') AS total_purchases,
          (SELECT COALESCE(SUM(price_paid_stars),0)::int FROM special_habit_purchases WHERE payment_status = 'completed') AS total_stars_earned,
          (SELECT COUNT(*)::int FROM subscriptions WHERE is_active = true)                       AS active_subscriptions,
          (SELECT COUNT(*)::int FROM habits WHERE is_active = true)                              AS total_habits,
          (SELECT COUNT(*)::int FROM special_habit_packs)                                        AS total_packs
      `);
      res.json(result.rows[0]);
    } catch (err) {
      console.error('AdminJS stats error:', err);
      res.status(500).json({ error: 'DB error' });
    }
  });

  return { adminJs, router };
}

module.exports = { buildAdminRouter };
