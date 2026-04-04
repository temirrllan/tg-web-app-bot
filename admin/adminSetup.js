// admin/adminSetup.js
//
// AdminJS v7  (ESM) loaded via dynamic import() from CommonJS server.js
// Access: /admin   Login: any email + ADMIN_PASSWORD env var

'use strict';

console.log('[adminSetup.js] LOADED AT', new Date().toISOString());

const path   = require('path');
const fs     = require('fs');
const db     = require('../config/database');
const https  = require('https');

// ─── Lightweight Telegram sender (no polling, no circular deps) ───────────────
// Used only by the admin broadcast endpoint — sends messages via Bot API directly.
function tgSendMessage(chatId, text, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...opts });
    const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
    const req = https.request(
      { hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

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

// ─── Schedule days helper ─────────────────────────────────────────────────────
// @adminjs/sql does not reliably handle INTEGER[] columns — it may silently drop
// the value or fail to bind it. Same fix as reminder_time: use a virtual field
// "schedule_days_picker" in editProperties, read it in the before hook, and write
// the real value via a direct db.query() UPDATE in the after hook.

function parseScheduleDays(raw) {
  if (raw == null || raw === '') return [1, 2, 3, 4, 5, 6, 7];
  if (Array.isArray(raw)) return raw.map(Number).filter(n => n > 0);
  const stripped = String(raw).replace(/[{}\[\]]/g, '').trim();
  return stripped
    ? stripped.split(',').map(Number).filter(n => !isNaN(n) && n > 0)
    : [1, 2, 3, 4, 5, 6, 7];
}

// ─── Reminder time helper ─────────────────────────────────────────────────────
// Parses reminder_time (HH:MM string or ISO datetime) → normalises to HH:MM:SS
// and auto-derives day_period:
//   Night 00-05 | Morning 06-11 | Afternoon 12-17 | Evening 18-23

function applyReminderTimeToPeriod(payload) {
  // Coerce to string — guards against Invalid Date objects sent by AdminJS picker
  const raw = String(payload.reminder_time ?? '').trim();
  let hh, mm;

  if (raw && raw !== 'Invalid Date') {
    if (raw.includes('T') || (raw.includes('-') && raw.length > 8)) {
      // ISO datetime from datetime-picker (e.g. "2026-03-11T14:00:00.000+05:00")
      const d = new Date(raw);
      if (!isNaN(d.getTime())) { hh = d.getUTCHours(); mm = d.getUTCMinutes(); }
    } else {
      // Plain time string: "14:30" or "14:30:00"
      const m = raw.match(/^(\d{1,2}):(\d{2})/);
      if (m) { hh = parseInt(m[1], 10); mm = parseInt(m[2], 10); }
    }
  }

  if (hh === undefined) {
    // Unparseable or empty → NULL so PostgreSQL doesn't reject the INSERT/UPDATE
    payload.reminder_time = null;
    return payload;
  }

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
  const PhotoUrlInputComponent = componentLoader.add(
    'PhotoUrlInput',
    path.join(__dirname, 'components/PhotoUrlInput')
  );
  const PackCardPreviewComponent = componentLoader.add(
    'PackCardPreview',
    path.join(__dirname, 'components/PackCardPreview')
  );
  const GradientSelectComponent = componentLoader.add(
    'GradientSelect',
    path.join(__dirname, 'components/GradientSelect')
  );

  // ── Connect DB ──────────────────────────────────────────────────────────
  const sqlDb = await new Adapter('postgresql', getConnectionOptions()).init();

  const t = loadTables(sqlDb, [
    'users', 'subscriptions', 'subscription_history',
    'habits', 'habit_marks', 'shared_habits', 'habit_members', 'habit_punches',
    'categories', 'motivational_phrases',
    'special_habit_packs', 'special_habit_templates', 'pack_achievements',
    'special_habit_purchases', 'pack_achievement_progress',
    'payment_invoices', 'promo_codes', 'promo_uses', 'stars_transfers',
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
        listProperties:   ['id', 'user_id', 'plan_type', 'price_stars', 'is_active', 'promo_code_id', 'promo_discount_stars', 'started_at', 'expires_at'],
        showProperties:   ['id', 'user_id', 'plan_type', 'plan_name', 'price_stars', 'is_active', 'promo_code_id', 'promo_discount_stars', 'bonus_days', 'payment_method', 'telegram_payment_charge_id', 'started_at', 'expires_at', 'cancelled_at'],
        filterProperties: ['plan_type', 'is_active', 'payment_method'],
        properties: {
          promo_code_id:       { description: 'ID промокода (если был)' },
          promo_discount_stars: { description: 'Скидка по промокоду в звёздах' },
          bonus_days:          { description: 'Бонусные дни от промокода' },
        },
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
        editProperties:   ['name', 'short_description', 'photo_url', 'bg_color', 'price_stars', 'original_price_stars', 'pack_preview', 'biography', 'learn_more_url', 'sort_order', 'is_active'],
        filterProperties: ['name', 'is_active', 'price_stars'],
        properties: {
          biography:    { type: 'textarea' },
          photo_url: {
            description: 'URL фото или загрузите файл с устройства',
            components: { edit: PhotoUrlInputComponent },
          },
          bg_color: {
            description: 'Градиент фона карточки',
            components: { edit: GradientSelectComponent },
          },
          price_stars:  { description: 'Цена в Telegram Stars (0 = бесплатно)' },
          pack_preview: {
            type: 'string',
            label: ' ',
            components: { edit: PackCardPreviewComponent },
          },
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
        // reminder_time is intentionally excluded from editProperties — @adminjs/sql iterates
        // over every editProperty and coerces "time" columns via new Date(), which produces
        // a Date object that pg serialises as an ISO datetime string, rejected by PostgreSQL.
        // Instead we use a virtual field "reminder_time_picker" (not a real DB column) to
        // capture the user's input; the before/after hooks write the real value via raw SQL.
        // schedule_days excluded for same reason as reminder_time — @adminjs/sql cannot
        // reliably handle INTEGER[] columns; handled via virtual field + after hook raw SQL.
        editProperties:   ['pack_id', 'title', 'goal', 'category_id', 'schedule_days_picker', 'reminder_time_picker', 'reminder_enabled', 'sort_order'],
        filterProperties: ['pack_id', 'day_period'],
        properties: {
          title: {
            props: { maxLength: 50 },
            description: 'Название привычки (макс. 50 символов)',
          },
          goal: {
            props: { maxLength: 100 },
            description: 'Цель/мотивация (макс. 100 символов)',
          },
          category_id: {
            reference: 'categories',
            description: 'Категория привычки',
          },
          reminder_time: {
            // type:'string' prevents @adminjs/sql from using its datetime formatter which
            // calls new Date("HH:MM:SS") → Invalid Date → renders as "NaN-NaN-NaN NaN:NaN"
            type: 'string',
            description: 'Устанавливается хуком. Для изменения используйте поле выше.',
          },
          reminder_time_picker: {
            // Virtual field — not a real DB column. @adminjs/sql skips it during INSERT/UPDATE
            // because it's absent from the DB schema; the before hook reads it and the after
            // hook writes the real value to reminder_time via a direct db.query().
            type: 'string',
            label: 'Время напоминания',
            description: 'Day Period установится автоматически по выбранному времени.',
            components: {
              edit: ReminderTimeInputComponent,
            },
          },
          schedule_days: {
            type: 'string',
            description: 'Устанавливается хуком.',
          },
          schedule_days_picker: {
            // Virtual field — not a real DB column. Same pattern as reminder_time_picker.
            type: 'string',
            label: 'Дни недели',
            components: {
              edit: ScheduleDaysInputComponent,
            },
          },
          day_period: {
            description: 'Устанавливается автоматически: Утро 06-11 | День 12-17 | Вечер 18-23 | Ночь 00-05',
          },
        },
        actions: {
          // ── show: reconstruct schedule_days from indexed flat keys for display
          show: {
            after: async (response) => {
              const p = response.record?.params;
              if (!p) return response;
              const days = [];
              let i = 0;
              while (p[`schedule_days.${i}`] !== undefined) {
                days.push(Number(p[`schedule_days.${i}`]));
                i++;
              }
              if (days.length === 0 && p.schedule_days && typeof p.schedule_days === 'object' && !Array.isArray(p.schedule_days)) {
                days.push(...Object.values(p.schedule_days).map(Number));
              }
              if (days.length > 0) {
                const labels = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
                p.schedule_days = days.map(d => labels[d - 1] || d).join(', ');
              }
              return response;
            },
          },
          // ── new & edit: before hooks that KEEP schedule_days and reminder_time
          // ── new: before hook sets schedule_days as PG array literal (works),
          // removes reminder_time (so @adminjs/sql can't corrupt it with new Date()),
          // then schedules a deferred UPDATE to set reminder_time via raw SQL.
          new: {
            before: async (request) => {
              if (request.payload) {
                // Validate goal length (max 100 for pack templates)
                if (request.payload.goal && request.payload.goal.length > 100) {
                  throw new Error('Цель не может быть длиннее 100 символов');
                }

                const timeRaw  = request.payload.reminder_time_picker ?? '';
                const schedRaw = request.payload.schedule_days_picker ?? null;

                // Compute day_period
                const parsed = applyReminderTimeToPeriod({ reminder_time: timeRaw });
                if (parsed.day_period) request.payload.day_period = parsed.day_period;
                const reminderTime = parsed.reminder_time; // e.g. '03:20:00' or null

                // Remove reminder_time — @adminjs/sql wraps it in new Date() which
                // produces Invalid Date for TIME strings. INSERT will use NULL default.
                delete request.payload.reminder_time;

                // Set schedule_days as PostgreSQL array literal (this works!)
                const days = parseScheduleDays(schedRaw);
                request.payload.schedule_days = `{${days.join(',')}}`;

                // Remove indexed keys (schedule_days.0, schedule_days.1, ...)
                Object.keys(request.payload).forEach(key => {
                  if (/^schedule_days\.\d+$/.test(key)) delete request.payload[key];
                });

                // Remove virtual picker fields
                delete request.payload.reminder_time_picker;
                delete request.payload.schedule_days_picker;

                // Deferred UPDATE: after INSERT completes, fix reminder_time via raw SQL
                if (reminderTime) {
                  setTimeout(async () => {
                    try {
                      const res = await db.query(
                        `UPDATE special_habit_templates
                         SET reminder_time = $1
                         WHERE id = (SELECT id FROM special_habit_templates ORDER BY id DESC LIMIT 1)
                         AND reminder_time IS NULL`,
                        [reminderTime]
                      );
                      console.log('[AdminJS] deferred UPDATE reminder_time=%s rows=%d', reminderTime, res.rowCount);
                    } catch (err) {
                      console.error('[AdminJS] deferred UPDATE failed:', err.message);
                    }
                  }, 200);
                }

                console.log('[AdminJS before/new] schedule_days=%s reminderTime=%s day_period=%s',
                  request.payload.schedule_days, reminderTime, request.payload.day_period);
              }
              return request;
            },
          },
          edit: {
            before: async (request) => {
              if (request.payload) {
                // Validate goal length (max 100 for pack templates)
                if (request.payload.goal && request.payload.goal.length > 100) {
                  throw new Error('Цель не может быть длиннее 100 символов');
                }

                const timeRaw  = request.payload.reminder_time_picker ?? '';
                const schedRaw = request.payload.schedule_days_picker ?? null;

                const parsed = applyReminderTimeToPeriod({ reminder_time: timeRaw });
                if (parsed.day_period) request.payload.day_period = parsed.day_period;
                const reminderTime = parsed.reminder_time;

                // Remove reminder_time — @adminjs/sql corrupts it with new Date()
                delete request.payload.reminder_time;

                const days = parseScheduleDays(schedRaw);
                request.payload.schedule_days = `{${days.join(',')}}`;

                Object.keys(request.payload).forEach(key => {
                  if (/^schedule_days\.\d+$/.test(key)) delete request.payload[key];
                });

                delete request.payload.reminder_time_picker;
                delete request.payload.schedule_days_picker;

                // For edit, we know the record ID from the URL
                const idMatch = request.params?.recordId;
                if (idMatch) {
                  // Deferred UPDATE to fix reminder_time
                  setTimeout(async () => {
                    try {
                      await db.query(
                        'UPDATE special_habit_templates SET reminder_time = $1 WHERE id = $2',
                        [reminderTime, idMatch]
                      );
                      console.log('[AdminJS] edit deferred UPDATE id=%s time=%s', idMatch, reminderTime);
                    } catch (err) {
                      console.error('[AdminJS] edit deferred UPDATE failed:', err.message);
                    }
                  }, 500);
                }

                console.log('[AdminJS before/edit] schedule_days=%s reminderTime=%s id=%s',
                  request.payload.schedule_days, reminderTime, idMatch);
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
        titleProperty: 'name_ru',
        listProperties:   ['id', 'name_ru', 'name_en', 'name_kk', 'icon', 'color', 'sort_order'],
        showProperties:   ['id', 'name_ru', 'name_en', 'name_kk', 'icon', 'color', 'sort_order', 'created_at'],
        editProperties:   ['name_ru', 'name_en', 'name_kk', 'icon', 'color', 'sort_order'],
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
        showProperties:   ['id', 'phrase_ru', 'phrase_en', 'phrase_kk', 'emoji', 'type', 'min_completed', 'background_color', 'created_at'],
        editProperties:   ['phrase_ru', 'phrase_en', 'phrase_kk', 'emoji', 'type', 'min_completed', 'background_color'],
        filterProperties: ['type'],
        properties: {
          phrase_ru:        { type: 'textarea' },
          phrase_en:        { type: 'textarea' },
          phrase_kk:        { type: 'textarea' },
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
        listProperties:   ['id', 'code', 'description', 'discount_stars', 'bonus_days', 'is_active', 'max_uses', 'current_uses', 'valid_until'],
        showProperties:   ['id', 'code', 'description', 'discount_stars', 'bonus_days', 'is_active', 'max_uses', 'current_uses', 'valid_from', 'valid_until', 'created_at'],
        editProperties:   ['code', 'description', 'discount_stars', 'bonus_days', 'is_active', 'max_uses', 'valid_from', 'valid_until'],
        filterProperties: ['is_active', 'code'],
        properties: {
          discount_stars: { description: 'Скидка в звёздах (XTR)' },
          bonus_days:     { description: 'Бонусные дни к подписке' },
          max_uses:       { description: 'Максимум использований (пусто = без лимита)' },
          current_uses:     { description: 'Сколько раз использован' },
        },
      },
    },

    t.promo_uses && {
      resource: t.promo_uses,
      options: {
        navigation: { name: 'Платежи' },
        actions: viewOnly,
        sort: { sortBy: 'used_at', direction: 'desc' },
        listProperties:   ['id', 'promo_code_id', 'user_id', 'used_at'],
        filterProperties: ['promo_code_id', 'user_id'],
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

  // ── Pre-build component bundle ───────────────────────────────────────────
  // In production, @adminjs/express calls admin.initialize() without await,
  // causing a race condition where the static bundle.js doesn't exist yet
  // when the browser first requests it. Awaiting here ensures the bundle is
  // ready before any requests are served.
  await adminJs.initialize();
  // Prevent @adminjs/express buildAuthenticatedRouter from firing a second
  // initialize() in the background (it calls initializeAdmin which calls
  // initialize() without await and without error handling).
  process.env.ADMIN_JS_SKIP_BUNDLE = 'true';
  console.log('✅ AdminJS: component bundle ready');

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

  // ── File upload API ──────────────────────────────────────────────────────
  // AdminJS использует express-formidable — файл уже разобран в req.files
  // (formidable v1: { path, name, type, size })

  const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  router.post('/api/upload', async (req, res) => {
    if (!req.session?.adminUser) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const file = req.files?.file;
      if (!file) return res.status(400).json({ error: 'Файл не получен' });

      const f = Array.isArray(file) ? file[0] : file;

      if (!(f.type || '').startsWith('image/')) {
        return res.status(400).json({ error: 'Можно загружать только изображения' });
      }
      if ((f.size || 0) > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Файл слишком большой (максимум 5 МБ)' });
      }

      const ext      = path.extname(f.name || '').toLowerCase() || '.jpg';
      const filename = `pack_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
      const dest     = path.join(UPLOAD_DIR, filename);

      fs.copyFileSync(f.path, dest);

      const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${filename}`;
      res.json({ url: fileUrl });
    } catch (err) {
      console.error('AdminJS upload error:', err.message);
      res.status(500).json({ error: 'Ошибка сохранения файла' });
    }
  });

  // ── Enhanced stats API ──────────────────────────────────────────────────
  const safe = async (query, fallback = 0) => {
    try { const r = await db.query(query); return r.rows[0]?.val ?? fallback; }
    catch { return fallback; }
  };

  router.get('/api/stats', async (req, res) => {
    if (!req.session?.adminUser) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const safeRows = async (query) => {
        try { const r = await db.query(query); return r.rows; } catch { return []; }
      };

      const [
        total_users, new_users_today, new_users_week, new_users_month,
        premium_users, users_ru, users_en, users_kk,
        dau, wau, mau,
        total_habits, active_habits, special_habits, bad_habits,
        marks_today, marks_completed_today,
        avg_habits_per_user, avg_streak, max_streak,
        shared_habits_count, habit_members_count,
        active_subscriptions, expiring_soon,
        total_packs, active_packs, total_templates,
        total_purchases, total_stars_packs,
        paid_payments, total_stars_subscriptions,
        active_promo_codes, promo_uses_total,
        promo_subscriptions, promo_total_discount, promo_free_activations,
        total_phrases, total_categories,
        reminders_today, reminders_week, reminders_responded,
      ] = await Promise.all([
        // Users
        safe(`SELECT COUNT(*)::int AS val FROM users`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE created_at::date = CURRENT_DATE`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE created_at > NOW() - INTERVAL '7 days'`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE created_at > NOW() - INTERVAL '30 days'`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE is_premium = true`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE language = 'ru'`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE language = 'en'`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE language = 'kk'`),
        // DAU / WAU / MAU (по last_login_at, fallback на created_at для новых юзеров)
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE COALESCE(last_login_at, created_at) >= CURRENT_DATE`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE COALESCE(last_login_at, created_at) > CURRENT_DATE - 7`),
        safe(`SELECT COUNT(*)::int AS val FROM users WHERE COALESCE(last_login_at, created_at) > CURRENT_DATE - 30`),
        // Habits
        safe(`SELECT COUNT(*)::int AS val FROM habits`),
        safe(`SELECT COUNT(*)::int AS val FROM habits WHERE is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM habits WHERE is_special = true AND is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM habits WHERE is_bad_habit = true AND is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM habit_marks WHERE date = CURRENT_DATE`),
        safe(`SELECT COUNT(*)::int AS val FROM habit_marks WHERE date = CURRENT_DATE AND status = 'completed'`),
        safe(`SELECT ROUND(COALESCE((SELECT COUNT(*)::float FROM habits WHERE is_active = true) / NULLIF((SELECT COUNT(*) FROM users), 0), 0), 1)::float AS val`, 0),
        safe(`SELECT ROUND(AVG(streak_current), 1)::float AS val FROM habits WHERE is_active = true`, 0),
        safe(`SELECT COALESCE(MAX(streak_best), 0)::int AS val FROM habits`),
        safe(`SELECT COUNT(*)::int AS val FROM shared_habits`),
        safe(`SELECT COUNT(*)::int AS val FROM habit_members WHERE is_active = true`),
        // Subscriptions
        safe(`SELECT COUNT(*)::int AS val FROM subscriptions WHERE is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM subscriptions WHERE is_active = true AND expires_at IS NOT NULL AND expires_at > NOW() AND expires_at < NOW() + INTERVAL '7 days'`),
        // Packs
        safe(`SELECT COUNT(*)::int AS val FROM special_habit_packs`),
        safe(`SELECT COUNT(*)::int AS val FROM special_habit_packs WHERE is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM special_habit_templates`),
        safe(`SELECT COUNT(*)::int AS val FROM special_habit_purchases WHERE payment_status = 'completed'`),
        safe(`SELECT COALESCE(SUM(price_paid_stars),0)::int AS val FROM special_habit_purchases WHERE payment_status = 'completed'`),
        // Payments (completed subscription payments via Telegram Stars)
        safe(`SELECT COUNT(*)::int AS val FROM telegram_payments WHERE status = 'completed'`),
        safe(`SELECT COALESCE(SUM(total_amount),0)::int AS val FROM telegram_payments WHERE status = 'completed'`),
        // Promo
        safe(`SELECT COUNT(*)::int AS val FROM promo_codes WHERE is_active = true`),
        safe(`SELECT COUNT(*)::int AS val FROM promo_uses`),
        safe(`SELECT COUNT(*)::int AS val FROM subscriptions WHERE promo_code_id IS NOT NULL`),
        safe(`SELECT COALESCE(SUM(promo_discount_stars),0)::int AS val FROM subscriptions WHERE promo_code_id IS NOT NULL`),
        safe(`SELECT COUNT(*)::int AS val FROM subscriptions WHERE promo_code_id IS NOT NULL AND price_stars = 0`),
        // Content
        safe(`SELECT COUNT(*)::int AS val FROM motivational_phrases`),
        safe(`SELECT COUNT(*)::int AS val FROM categories`),
        // Reminders
        safe(`SELECT COUNT(*)::int AS val FROM reminder_history WHERE sent_at::date = CURRENT_DATE`),
        safe(`SELECT COUNT(*)::int AS val FROM reminder_history WHERE sent_at > NOW() - INTERVAL '7 days'`),
        safe(`SELECT COUNT(*)::int AS val FROM reminder_history WHERE is_marked = true AND sent_at > NOW() - INTERVAL '7 days'`),
      ]);

      // Графики и разбивки
      const [
        weekly_registrations,
        weekly_purchases,
        completion_14d,
        revenue_30d,
        top_packs,
        habits_by_category,
        subscription_plans,
        habits_by_schedule,
        habits_by_period,
        top_promo_codes,
        reminders_14d,
      ] = await Promise.all([
        safeRows(`
          SELECT DATE(created_at) AS date, COUNT(*)::int AS count
          FROM users WHERE created_at > NOW() - INTERVAL '14 days'
          GROUP BY DATE(created_at) ORDER BY date ASC
        `),
        safeRows(`
          SELECT DATE(purchased_at) AS date, COUNT(*)::int AS count,
                 COALESCE(SUM(price_paid_stars),0)::int AS stars
          FROM special_habit_purchases
          WHERE payment_status = 'completed' AND purchased_at > NOW() - INTERVAL '14 days'
          GROUP BY DATE(purchased_at) ORDER BY date ASC
        `),
        safeRows(`
          SELECT date, COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
          FROM habit_marks WHERE date > CURRENT_DATE - 14
          GROUP BY date ORDER BY date ASC
        `),
        safeRows(`
          SELECT day::date AS date,
                 COALESCE(p.stars, 0) + COALESCE(i.stars, 0) AS total,
                 COALESCE(p.stars, 0) AS pack_stars,
                 COALESCE(i.stars, 0) AS invoice_stars
          FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, '1 day'::interval) day
          LEFT JOIN (
            SELECT DATE(purchased_at) AS d, COALESCE(SUM(price_paid_stars),0)::int AS stars
            FROM special_habit_purchases WHERE payment_status = 'completed'
            GROUP BY DATE(purchased_at)
          ) p ON p.d = day::date
          LEFT JOIN (
            SELECT DATE(created_at) AS d, COALESCE(SUM(total_amount),0)::int AS stars
            FROM telegram_payments WHERE status = 'completed'
            GROUP BY DATE(created_at)
          ) i ON i.d = day::date
          ORDER BY day ASC
        `),
        safeRows(`
          SELECT p.name, COUNT(pu.id)::int AS purchases, COALESCE(SUM(pu.price_paid_stars),0)::int AS stars
          FROM special_habit_packs p
          LEFT JOIN special_habit_purchases pu ON pu.pack_id = p.id AND pu.payment_status = 'completed'
          GROUP BY p.id, p.name ORDER BY purchases DESC LIMIT 5
        `),
        safeRows(`
          SELECT c.name_ru AS name, c.color, COUNT(h.id)::int AS count
          FROM categories c
          LEFT JOIN habits h ON h.category_id = c.id AND h.is_active = true
          GROUP BY c.id, c.name_ru, c.color ORDER BY count DESC LIMIT 8
        `),
        safeRows(`
          SELECT COALESCE(plan_type, 'legacy') AS plan_type, COUNT(*)::int AS count
          FROM subscriptions WHERE is_active = true
          GROUP BY plan_type ORDER BY count DESC
        `),
        safeRows(`
          SELECT COALESCE(schedule_type, 'daily') AS schedule_type, COUNT(*)::int AS count
          FROM habits WHERE is_active = true
          GROUP BY schedule_type ORDER BY count DESC
        `),
        safeRows(`
          SELECT COALESCE(day_period, 'unknown') AS period, COUNT(*)::int AS count
          FROM habits WHERE is_active = true
          GROUP BY day_period ORDER BY count DESC
        `),
        safeRows(`
          SELECT pc.code AS promo_code, COUNT(*)::int AS uses
          FROM promo_uses pu
          JOIN promo_codes pc ON pc.id = pu.promo_code_id
          GROUP BY pc.code ORDER BY uses DESC LIMIT 5
        `),
        safeRows(`
          SELECT DATE(sent_at) AS date, COUNT(*)::int AS sent,
                 COUNT(*) FILTER (WHERE is_marked = true)::int AS responded
          FROM reminder_history WHERE sent_at > NOW() - INTERVAL '14 days'
          GROUP BY DATE(sent_at) ORDER BY date ASC
        `),
      ]);

      const total_stars_earned = total_stars_packs + total_stars_subscriptions;
      const reminder_response_rate = reminders_week > 0
        ? Math.round((reminders_responded / reminders_week) * 100) : 0;
      const premium_rate = total_users > 0
        ? Math.round((premium_users / total_users) * 100) : 0;

      res.json({
        // Users
        total_users, new_users_today, new_users_week, new_users_month,
        premium_users, premium_rate, users_ru, users_en, users_kk,
        dau, wau, mau,
        // Habits
        total_habits, active_habits, special_habits, bad_habits,
        marks_today, marks_completed_today,
        avg_habits_per_user, avg_streak, max_streak,
        shared_habits_count, habit_members_count,
        // Subscriptions
        active_subscriptions, expiring_soon,
        // Packs
        total_packs, active_packs, total_templates,
        total_purchases, total_stars_packs,
        // Payments
        paid_payments, total_stars_subscriptions, total_stars_earned,
        // Promo
        active_promo_codes, promo_uses_total, promo_subscriptions, promo_total_discount, promo_free_activations,
        // Content
        total_phrases, total_categories,
        // Reminders
        reminders_today, reminders_week, reminders_responded, reminder_response_rate,
        // Charts
        weekly_registrations, weekly_purchases, completion_14d, revenue_30d,
        top_packs, habits_by_category, subscription_plans,
        habits_by_schedule, habits_by_period, top_promo_codes, reminders_14d,
      });
    } catch (err) {
      console.error('AdminJS /api/stats error:', err.message);
      res.status(500).json({ error: 'Database error' });
    }
  });

  // ── Broadcast API ─────────────────────────────────────────────────────────
  // POST /admin/api/broadcast  { message, parse_mode? }
  // GET  /admin/api/broadcast/count  → { total }
  router.get('/api/broadcast/count', async (req, res) => {
    if (!req.session?.adminUser) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const r = await db.query('SELECT COUNT(*) AS cnt FROM users WHERE telegram_id IS NOT NULL');
      res.json({ total: Number(r.rows[0]?.cnt || 0) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/broadcast', async (req, res) => {
    if (!req.session?.adminUser) return res.status(401).json({ error: 'Unauthorized' });

    // AdminJS uses express-formidable which parses multipart/form-data and
    // x-www-form-urlencoded into req.fields. JSON Content-Type is NOT parsed.
    // Dashboard sends as x-www-form-urlencoded so data lands in req.fields.
    const { message } = req.fields || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    try {
      const usersResult = await db.query(
        'SELECT telegram_id, first_name FROM users WHERE telegram_id IS NOT NULL'
      );
      const users = usersResult.rows;
      console.log(`📢 Admin broadcast: ${users.length} users`);

      let successCount = 0;
      let failCount    = 0;

      for (const user of users) {
        try {
          await tgSendMessage(user.telegram_id, message.trim());
          successCount++;
          // Telegram rate limit: ~30 msg/s — 35 ms gap is safe
          await new Promise(r => setTimeout(r, 35));
        } catch (err) {
          console.error(`Broadcast fail → ${user.telegram_id}:`, err.message);
          failCount++;
        }
      }

      console.log(`✅ Broadcast done: ${successCount} ok, ${failCount} fail`);
      res.json({ success: true, successCount, failCount, total: users.length });
    } catch (err) {
      console.error('Admin broadcast error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Maintenance API ──────────────────────────────────────────────────────
  const maintenanceService = require('../services/maintenanceService');

  router.get('/api/maintenance/status', (req, res) => {
    if (!req.session?.adminUser) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ maintenance: maintenanceService.isEnabled() });
  });

  router.post('/api/maintenance/toggle', (req, res) => {
    if (!req.session?.adminUser) return res.status(401).json({ error: 'Unauthorized' });
    const enabled = maintenanceService.toggle();
    res.json({ maintenance: enabled });
  });

  return { adminJs, router };
}

module.exports = { buildAdminRouter };