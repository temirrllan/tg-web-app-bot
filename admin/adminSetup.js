// admin/adminSetup.js
// Lightweight admin panel for Special Habits management
// Protected by is_admin = true in the users table + ADMIN_PASSWORD env var
//
// Install required package:  npm install express-session

const express  = require('express');
const session  = require('express-session');
const db       = require('../config/database');

const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ─── Session middleware (scoped to this router) ───────────────────────────────
router.use(session({
  secret: process.env.SESSION_SECRET || 'habit-admin-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 } // 8h
}));

// ─── Auth helper ──────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminLoggedIn) return next();
  res.redirect('/admin/login');
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function layout(title, body) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} – Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f4f6f9;color:#333}
  nav{background:#1a1a2e;color:#fff;padding:12px 24px;display:flex;align-items:center;gap:16px}
  nav a{color:#9b9bf4;text-decoration:none;font-size:14px}
  nav a:hover{color:#fff}
  nav .brand{font-weight:700;font-size:16px;color:#fff;margin-right:auto}
  .container{max-width:1100px;margin:32px auto;padding:0 16px}
  h1{font-size:22px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1)}
  th,td{padding:10px 14px;text-align:left;font-size:13px;border-bottom:1px solid #eee}
  th{background:#f8f9fa;font-weight:600;color:#555}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#fafafa}
  .btn{display:inline-block;padding:7px 14px;border-radius:6px;font-size:13px;text-decoration:none;border:none;cursor:pointer}
  .btn-primary{background:#4f46e5;color:#fff}
  .btn-danger{background:#ef4444;color:#fff}
  .btn-sm{padding:4px 10px;font-size:12px}
  form label{display:block;font-size:13px;font-weight:500;margin-bottom:4px;margin-top:12px}
  form input,form textarea,form select{width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
  form textarea{min-height:100px;resize:vertical}
  .card{background:#fff;border-radius:8px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.1);max-width:640px}
  .alert{padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:13px}
  .alert-success{background:#d1fae5;color:#065f46}
  .alert-error{background:#fee2e2;color:#991b1b}
  .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px}
  .badge-free{background:#d1fae5;color:#065f46}
  .badge-paid{background:#ede9fe;color:#4c1d95}
  .flex{display:flex;gap:8px;align-items:center}
</style>
</head><body>
<nav>
  <span class="brand">✨ Special Habits Admin</span>
  <a href="/admin">Packs</a>
  <a href="/admin/logout">Logout</a>
</nav>
<div class="container">
<h1>${title}</h1>
${body}
</div></body></html>`;
}

// ─── Login ────────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  const err = req.query.error ? '<div class="alert alert-error">Invalid password</div>' : '';
  res.send(layout('Login', `
    <div class="card">
      ${err}
      <form method="POST" action="/admin/login">
        <label>Admin Password</label>
        <input type="password" name="password" autofocus required>
        <br><br>
        <button class="btn btn-primary" type="submit">Sign In</button>
      </form>
    </div>`));
});

router.post('/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.adminLoggedIn = true;
    res.redirect('/admin');
  } else {
    res.redirect('/admin/login?error=1');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ─── Dashboard / Pack list ────────────────────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  const packs = await db.query(
    `SELECT p.*,
       (SELECT COUNT(*) FROM special_habit_templates t WHERE t.pack_id = p.id) AS habit_count,
       (SELECT COUNT(*) FROM pack_achievements a WHERE a.pack_id = p.id) AS achievement_count
     FROM special_habit_packs p ORDER BY p.sort_order, p.id`
  );

  const rows = packs.rows.map(p => `
    <tr>
      <td>${p.id}</td>
      <td><img src="${p.photo_url||''}" style="width:40px;height:40px;border-radius:50%;object-fit:cover" onerror="this.style.display='none'"> ${p.name}</td>
      <td>${p.short_description || ''}</td>
      <td>${p.price_stars === 0 ? '<span class="badge badge-free">FREE</span>' :
          `<span class="badge badge-paid">⭐ ${p.price_stars}${p.original_price_stars ? ` <s>${p.original_price_stars}</s>` : ''}</span>`}</td>
      <td>${p.habit_count}</td>
      <td>${p.achievement_count}</td>
      <td>${p.is_active ? '✅' : '❌'}</td>
      <td>${p.sort_order}</td>
      <td class="flex">
        <a href="/admin/packs/${p.id}/edit" class="btn btn-primary btn-sm">Edit</a>
        <a href="/admin/packs/${p.id}/templates" class="btn btn-sm" style="background:#e0e7ff;color:#3730a3">Habits</a>
        <a href="/admin/packs/${p.id}/achievements" class="btn btn-sm" style="background:#fef3c7;color:#92400e">Awards</a>
        <a href="/admin/packs/${p.id}/delete" class="btn btn-danger btn-sm" onclick="return confirm('Delete this pack?')">Del</a>
      </td>
    </tr>`).join('');

  res.send(layout('Celebrity Habit Packs', `
    <div class="flex" style="margin-bottom:16px">
      <a href="/admin/packs/new" class="btn btn-primary">+ New Pack</a>
    </div>
    <table>
      <thead><tr>
        <th>#</th><th>Name</th><th>Description</th><th>Price</th>
        <th>Habits</th><th>Awards</th><th>Active</th><th>Order</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#999">No packs yet</td></tr>'}</tbody>
    </table>`));
});

// ─── New Pack ─────────────────────────────────────────────────────────────────
router.get('/packs/new', requireAdmin, (req, res) => {
  res.send(layout('New Pack', packForm({})));
});

router.post('/packs/new', requireAdmin, async (req, res) => {
  const { name, photo_url, short_description, biography, learn_more_url,
          price_stars, original_price_stars, is_active, sort_order } = req.body;
  await db.query(
    `INSERT INTO special_habit_packs
       (name,photo_url,short_description,biography,learn_more_url,price_stars,original_price_stars,is_active,sort_order)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [name, photo_url||null, short_description||null, biography||null, learn_more_url||null,
     parseInt(price_stars)||0, original_price_stars ? parseInt(original_price_stars) : null,
     is_active === 'on', parseInt(sort_order)||0]
  );
  res.redirect('/admin');
});

// ─── Edit Pack ────────────────────────────────────────────────────────────────
router.get('/packs/:id/edit', requireAdmin, async (req, res) => {
  const result = await db.query('SELECT * FROM special_habit_packs WHERE id = $1', [req.params.id]);
  if (!result.rows.length) return res.redirect('/admin');
  res.send(layout('Edit Pack', packForm(result.rows[0], req.params.id)));
});

router.post('/packs/:id/edit', requireAdmin, async (req, res) => {
  const { name, photo_url, short_description, biography, learn_more_url,
          price_stars, original_price_stars, is_active, sort_order } = req.body;
  await db.query(
    `UPDATE special_habit_packs SET
       name=$1,photo_url=$2,short_description=$3,biography=$4,learn_more_url=$5,
       price_stars=$6,original_price_stars=$7,is_active=$8,sort_order=$9,updated_at=NOW()
     WHERE id=$10`,
    [name, photo_url||null, short_description||null, biography||null, learn_more_url||null,
     parseInt(price_stars)||0, original_price_stars ? parseInt(original_price_stars) : null,
     is_active === 'on', parseInt(sort_order)||0, req.params.id]
  );
  res.redirect('/admin');
});

router.get('/packs/:id/delete', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM special_habit_packs WHERE id = $1', [req.params.id]);
  res.redirect('/admin');
});

function packForm(p, id) {
  const action = id ? `/admin/packs/${id}/edit` : '/admin/packs/new';
  return `<div class="card">
    <form method="POST" action="${action}">
      <label>Name / Celebrity Name *</label>
      <input name="name" required value="${p.name||''}">
      <label>Photo URL</label>
      <input name="photo_url" value="${p.photo_url||''}">
      <label>Short Description (profession)</label>
      <input name="short_description" value="${p.short_description||''}">
      <label>Biography</label>
      <textarea name="biography">${p.biography||''}</textarea>
      <label>Learn More URL</label>
      <input name="learn_more_url" value="${p.learn_more_url||''}">
      <label>Price in Stars (0 = free)</label>
      <input name="price_stars" type="number" min="0" value="${p.price_stars||0}">
      <label>Original Price (before discount, optional)</label>
      <input name="original_price_stars" type="number" min="0" value="${p.original_price_stars||''}">
      <label>Sort Order</label>
      <input name="sort_order" type="number" value="${p.sort_order||0}">
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px">
        <input name="is_active" type="checkbox" ${p.is_active !== false ? 'checked' : ''}> Active
      </label>
      <br>
      <button class="btn btn-primary" type="submit">${id ? 'Save Changes' : 'Create Pack'}</button>
      <a href="/admin" class="btn" style="background:#e5e7eb;color:#374151;margin-left:8px">Cancel</a>
    </form>
  </div>`;
}

// ─── Habit Templates ──────────────────────────────────────────────────────────
router.get('/packs/:id/templates', requireAdmin, async (req, res) => {
  const packId = req.params.id;
  const packRes = await db.query('SELECT name FROM special_habit_packs WHERE id=$1', [packId]);
  const templates = await db.query(
    `SELECT t.*, c.name_en AS cat FROM special_habit_templates t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.pack_id=$1 ORDER BY t.sort_order,t.id`, [packId]
  );
  const cats = await db.query('SELECT id,name_en,icon FROM categories ORDER BY name_en');

  const rows = templates.rows.map(t => `
    <tr>
      <td>${t.id}</td><td>${t.title}</td><td>${t.goal||''}</td>
      <td>${t.cat||''}</td><td>${t.day_period}</td>
      <td>${t.reminder_time||''}</td><td>${(t.schedule_days||[]).join(',')}</td>
      <td>${t.sort_order}</td>
      <td class="flex">
        <a href="/admin/packs/${packId}/templates/${t.id}/edit" class="btn btn-primary btn-sm">Edit</a>
        <a href="/admin/packs/${packId}/templates/${t.id}/delete" class="btn btn-danger btn-sm" onclick="return confirm('Delete?')">Del</a>
      </td>
    </tr>`).join('');

  res.send(layout(`Habits – ${packRes.rows[0]?.name}`, `
    <p style="margin-bottom:12px"><a href="/admin">← Packs</a></p>
    <div class="flex" style="margin-bottom:16px">
      <a href="/admin/packs/${packId}/templates/new" class="btn btn-primary">+ New Habit Template</a>
    </div>
    <table>
      <thead><tr><th>#</th><th>Title</th><th>Goal</th><th>Category</th><th>Period</th><th>Reminder</th><th>Days</th><th>Order</th><th>Actions</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="9" style="text-align:center;color:#999">No templates</td></tr>'}</tbody>
    </table>`));
});

router.get('/packs/:id/templates/new', requireAdmin, async (req, res) => {
  const cats = await db.query('SELECT id,name_en,icon FROM categories ORDER BY name_en');
  res.send(layout('New Habit Template', templateForm({}, req.params.id, cats.rows)));
});

router.post('/packs/:id/templates/new', requireAdmin, async (req, res) => {
  const packId = req.params.id;
  const { title, goal, category_id, day_period, reminder_time, reminder_enabled, sort_order, schedule_days } = req.body;
  const days = Array.isArray(schedule_days) ? schedule_days.map(Number) : (schedule_days ? [parseInt(schedule_days)] : [1,2,3,4,5,6,7]);
  await db.query(
    `INSERT INTO special_habit_templates
       (pack_id,title,goal,category_id,day_period,reminder_time,reminder_enabled,sort_order,schedule_days)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [packId, title, goal||null, category_id||null, day_period||'morning',
     reminder_time||null, reminder_enabled==='on', parseInt(sort_order)||0, days]
  );
  res.redirect(`/admin/packs/${packId}/templates`);
});

router.get('/packs/:id/templates/:tid/edit', requireAdmin, async (req, res) => {
  const t = await db.query('SELECT * FROM special_habit_templates WHERE id=$1', [req.params.tid]);
  const cats = await db.query('SELECT id,name_en,icon FROM categories ORDER BY name_en');
  if (!t.rows.length) return res.redirect(`/admin/packs/${req.params.id}/templates`);
  res.send(layout('Edit Habit Template', templateForm(t.rows[0], req.params.id, cats.rows, req.params.tid)));
});

router.post('/packs/:id/templates/:tid/edit', requireAdmin, async (req, res) => {
  const { title, goal, category_id, day_period, reminder_time, reminder_enabled, sort_order, schedule_days } = req.body;
  const days = Array.isArray(schedule_days) ? schedule_days.map(Number) : (schedule_days ? [parseInt(schedule_days)] : [1,2,3,4,5,6,7]);
  await db.query(
    `UPDATE special_habit_templates SET
       title=$1,goal=$2,category_id=$3,day_period=$4,reminder_time=$5,reminder_enabled=$6,sort_order=$7,schedule_days=$8
     WHERE id=$9`,
    [title, goal||null, category_id||null, day_period||'morning',
     reminder_time||null, reminder_enabled==='on', parseInt(sort_order)||0, days, req.params.tid]
  );
  res.redirect(`/admin/packs/${req.params.id}/templates`);
});

router.get('/packs/:id/templates/:tid/delete', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM special_habit_templates WHERE id=$1', [req.params.tid]);
  res.redirect(`/admin/packs/${req.params.id}/templates`);
});

function templateForm(t, packId, cats, tid) {
  const action = tid ? `/admin/packs/${packId}/templates/${tid}/edit` : `/admin/packs/${packId}/templates/new`;
  const days = t.schedule_days || [1,2,3,4,5,6,7];
  const dayLabels = ['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const dayCheckboxes = [1,2,3,4,5,6,7].map(d =>
    `<label style="display:inline-flex;align-items:center;gap:4px;margin-right:8px">
      <input type="checkbox" name="schedule_days" value="${d}" ${days.includes(d)?'checked':''}> ${dayLabels[d]}
    </label>`).join('');
  const catOptions = cats.map(c =>
    `<option value="${c.id}" ${t.category_id==c.id?'selected':''}>${c.icon} ${c.name_en}</option>`).join('');
  const periods = ['morning','afternoon','evening','night'];
  const periodOptions = periods.map(p =>
    `<option value="${p}" ${t.day_period===p?'selected':''}>${p}</option>`).join('');

  return `<div class="card">
    <p style="margin-bottom:12px"><a href="/admin/packs/${packId}/templates">← Back to Habits</a></p>
    <form method="POST" action="${action}">
      <label>Title *</label>
      <input name="title" required maxlength="50" value="${t.title||''}">
      <label>Goal / Description</label>
      <input name="goal" value="${t.goal||''}">
      <label>Category</label>
      <select name="category_id"><option value="">— none —</option>${catOptions}</select>
      <label>Day Period</label>
      <select name="day_period">${periodOptions}</select>
      <label>Reminder Time (optional)</label>
      <input name="reminder_time" type="time" value="${t.reminder_time||''}">
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px">
        <input name="reminder_enabled" type="checkbox" ${t.reminder_enabled!==false?'checked':''}> Reminder enabled
      </label>
      <label>Schedule Days</label>
      <div>${dayCheckboxes}</div>
      <label>Sort Order</label>
      <input name="sort_order" type="number" value="${t.sort_order||0}">
      <br>
      <button class="btn btn-primary" type="submit">${tid?'Save':'Create'}</button>
    </form>
  </div>`;
}

// ─── Achievements ─────────────────────────────────────────────────────────────
router.get('/packs/:id/achievements', requireAdmin, async (req, res) => {
  const packId = req.params.id;
  const packRes = await db.query('SELECT name FROM special_habit_packs WHERE id=$1', [packId]);
  const achievements = await db.query(
    'SELECT * FROM pack_achievements WHERE pack_id=$1 ORDER BY sort_order,id', [packId]
  );

  const rows = achievements.rows.map(a => `
    <tr>
      <td>${a.id}</td><td>${a.icon||''}</td><td>${a.title}</td>
      <td>${a.description||''}</td><td>${a.required_count}</td><td>${a.sort_order}</td>
      <td class="flex">
        <a href="/admin/packs/${packId}/achievements/${a.id}/edit" class="btn btn-primary btn-sm">Edit</a>
        <a href="/admin/packs/${packId}/achievements/${a.id}/delete" class="btn btn-danger btn-sm" onclick="return confirm('Delete?')">Del</a>
      </td>
    </tr>`).join('');

  res.send(layout(`Achievements – ${packRes.rows[0]?.name}`, `
    <p style="margin-bottom:12px"><a href="/admin">← Packs</a></p>
    <div class="flex" style="margin-bottom:16px">
      <a href="/admin/packs/${packId}/achievements/new" class="btn btn-primary">+ New Achievement</a>
    </div>
    <table>
      <thead><tr><th>#</th><th>Icon</th><th>Title</th><th>Description</th><th>Required</th><th>Order</th><th>Actions</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="7" style="text-align:center;color:#999">No achievements</td></tr>'}</tbody>
    </table>`));
});

router.get('/packs/:id/achievements/new', requireAdmin, (req, res) => {
  res.send(layout('New Achievement', achievementForm({}, req.params.id)));
});

router.post('/packs/:id/achievements/new', requireAdmin, async (req, res) => {
  const { title, icon, description, required_count, sort_order } = req.body;
  await db.query(
    'INSERT INTO pack_achievements (pack_id,title,icon,description,required_count,sort_order) VALUES($1,$2,$3,$4,$5,$6)',
    [req.params.id, title, icon||null, description||null, parseInt(required_count), parseInt(sort_order)||0]
  );
  res.redirect(`/admin/packs/${req.params.id}/achievements`);
});

router.get('/packs/:id/achievements/:aid/edit', requireAdmin, async (req, res) => {
  const a = await db.query('SELECT * FROM pack_achievements WHERE id=$1', [req.params.aid]);
  if (!a.rows.length) return res.redirect(`/admin/packs/${req.params.id}/achievements`);
  res.send(layout('Edit Achievement', achievementForm(a.rows[0], req.params.id, req.params.aid)));
});

router.post('/packs/:id/achievements/:aid/edit', requireAdmin, async (req, res) => {
  const { title, icon, description, required_count, sort_order } = req.body;
  await db.query(
    'UPDATE pack_achievements SET title=$1,icon=$2,description=$3,required_count=$4,sort_order=$5 WHERE id=$6',
    [title, icon||null, description||null, parseInt(required_count), parseInt(sort_order)||0, req.params.aid]
  );
  res.redirect(`/admin/packs/${req.params.id}/achievements`);
});

router.get('/packs/:id/achievements/:aid/delete', requireAdmin, async (req, res) => {
  await db.query('DELETE FROM pack_achievements WHERE id=$1', [req.params.aid]);
  res.redirect(`/admin/packs/${req.params.id}/achievements`);
});

function achievementForm(a, packId, aid) {
  const action = aid ? `/admin/packs/${packId}/achievements/${aid}/edit` : `/admin/packs/${packId}/achievements/new`;
  return `<div class="card">
    <p style="margin-bottom:12px"><a href="/admin/packs/${packId}/achievements">← Back</a></p>
    <form method="POST" action="${action}">
      <label>Title *</label>
      <input name="title" required maxlength="100" value="${a.title||''}">
      <label>Icon (emoji or image URL)</label>
      <input name="icon" value="${a.icon||''}">
      <label>Condition Description</label>
      <input name="description" value="${a.description||''}">
      <label>Required Count (unlock threshold) *</label>
      <input name="required_count" type="number" min="1" required value="${a.required_count||''}">
      <label>Sort Order</label>
      <input name="sort_order" type="number" value="${a.sort_order||0}">
      <br>
      <button class="btn btn-primary" type="submit">${aid?'Save':'Create'}</button>
    </form>
  </div>`;
}

module.exports = router;
