// HTTP routes for the admin AI chat.
// Mounted into the AdminJS authenticated router from admin/adminSetup.js,
// so every handler can rely on req.session.adminUser being set.

const express = require('express');
const db = require('../config/database');
const aiService = require('../services/aiAdminService');
const costGuard = require('../services/aiCostGuard');

// Per-admin rate limit: 30 requests / hour.
// In-memory map; resets on process restart, which is fine for a small admin UI.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 30;
const _hits = new Map();

function checkRateLimit(adminEmail) {
  const now = Date.now();
  const list = (_hits.get(adminEmail) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (list.length >= RATE_LIMIT_MAX) {
    const oldest = list[0];
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - oldest);
    return { ok: false, waitMs };
  }
  list.push(now);
  _hits.set(adminEmail, list);
  return { ok: true, remaining: RATE_LIMIT_MAX - list.length };
}

function requireAdmin(req, res, next) {
  if (!req.session?.adminUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function buildAiRouter() {
  const router = express.Router();

  // JSON parser scoped to this sub-router (AdminJS uses formidable globally,
  // but our custom routes need plain JSON).
  router.use(express.json({ limit: '64kb' }));

  // ── List sessions (shared across all admins) ──────────────────────────────
  router.get('/sessions', requireAdmin, async (req, res) => {
    try {
      const r = await db.query(
        `SELECT s.id, s.admin_email, s.title, s.created_at, s.updated_at,
                COUNT(m.id)::int AS message_count
           FROM ai_chat_sessions s
           LEFT JOIN ai_chat_messages m ON m.session_id = s.id
          WHERE s.is_archived = false
          GROUP BY s.id
          ORDER BY s.updated_at DESC
          LIMIT 100`
      );
      res.json({ sessions: r.rows });
    } catch (e) {
      console.error('[ai/sessions GET]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Create session ────────────────────────────────────────────────────────
  router.post('/sessions', requireAdmin, async (req, res) => {
    try {
      const adminEmail = req.session.adminUser.email || 'admin';
      const title = (req.body?.title || 'Новый чат').slice(0, 200);
      const r = await db.query(
        `INSERT INTO ai_chat_sessions (admin_email, title)
         VALUES ($1, $2)
         RETURNING id, admin_email, title, created_at, updated_at`,
        [adminEmail, title]
      );
      res.json({ session: r.rows[0] });
    } catch (e) {
      console.error('[ai/sessions POST]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Get session messages ──────────────────────────────────────────────────
  router.get('/sessions/:id/messages', requireAdmin, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id, 10);
      if (!Number.isFinite(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id' });
      }
      const r = await db.query(
        `SELECT id, role, content, tool_calls, tool_call_id, model, tokens_in, tokens_out, cost_cents, created_at
           FROM ai_chat_messages
          WHERE session_id = $1
          ORDER BY id ASC`,
        [sessionId]
      );
      // Also fetch the session itself for title
      const sr = await db.query(
        `SELECT id, admin_email, title FROM ai_chat_sessions WHERE id = $1`,
        [sessionId]
      );
      if (sr.rows.length === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({ session: sr.rows[0], messages: r.rows });
    } catch (e) {
      console.error('[ai/sessions/:id/messages]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Delete session ────────────────────────────────────────────────────────
  router.delete('/sessions/:id', requireAdmin, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id, 10);
      if (!Number.isFinite(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id' });
      }
      await db.query(`DELETE FROM ai_chat_sessions WHERE id = $1`, [sessionId]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[ai/sessions DELETE]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Rename session ────────────────────────────────────────────────────────
  router.patch('/sessions/:id', requireAdmin, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id, 10);
      const title = String(req.body?.title || '').slice(0, 200);
      if (!Number.isFinite(sessionId) || !title) {
        return res.status(400).json({ error: 'Invalid input' });
      }
      await db.query(`UPDATE ai_chat_sessions SET title = $1 WHERE id = $2`, [title, sessionId]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Monthly usage / cost cap status ───────────────────────────────────────
  router.get('/usage', requireAdmin, async (req, res) => {
    try {
      const u = await costGuard.getMonthUsage();
      res.json(u);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Chat (SSE streaming) ──────────────────────────────────────────────────
  router.post('/chat', requireAdmin, async (req, res) => {
    const adminEmail = req.session.adminUser.email || 'admin';

    // Rate limit
    const rl = checkRateLimit(adminEmail);
    if (!rl.ok) {
      return res.status(429).json({
        error: `Превышен лимит 30 запросов/час. Подожди ${Math.ceil(rl.waitMs / 60_000)} мин.`,
      });
    }

    const { sessionId: rawSessionId, message: rawMessage } = req.body || {};
    let sessionId = parseInt(rawSessionId, 10);
    const userMessage = String(rawMessage || '').trim().slice(0, 4000);

    if (!userMessage) {
      return res.status(400).json({ error: 'Пустое сообщение' });
    }

    // Auto-create session if not provided
    if (!Number.isFinite(sessionId)) {
      const r = await db.query(
        `INSERT INTO ai_chat_sessions (admin_email, title)
         VALUES ($1, $2)
         RETURNING id`,
        [adminEmail, userMessage.slice(0, 60)]
      );
      sessionId = r.rows[0].id;
    } else {
      // Update title from first message if still default
      await db.query(
        `UPDATE ai_chat_sessions
            SET title = CASE WHEN title = 'Новый чат' THEN $2 ELSE title END
          WHERE id = $1`,
        [sessionId, userMessage.slice(0, 60)]
      );
    }

    // Open SSE stream
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders?.();

    const send = (obj) => {
      try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
    };

    // Heartbeat to keep proxies happy
    const heartbeat = setInterval(() => {
      try { res.write(': hb\n\n'); } catch {}
    }, 15_000);

    let userMessageId = null;

    try {
      // Persist user message
      const userIns = await db.query(
        `INSERT INTO ai_chat_messages (session_id, role, content)
         VALUES ($1, 'user', $2)
         RETURNING id`,
        [sessionId, userMessage]
      );
      userMessageId = userIns.rows[0].id;

      send({ type: 'session', sessionId, userMessageId });

      // Load conversation history (excluding the just-inserted user message
      // because we'll pass userMessage separately to streamChat)
      const histRes = await db.query(
        `SELECT role, content, tool_calls, tool_call_id, model
           FROM ai_chat_messages
          WHERE session_id = $1 AND id < $2
          ORDER BY id ASC`,
        [sessionId, userMessageId]
      );

      // We'll persist the assistant turn AFTER the stream completes so we have
      // the message_id ready for ai_query_log linking.
      // First, allocate an assistant message row (empty) to get an id.
      const assistantIns = await db.query(
        `INSERT INTO ai_chat_messages (session_id, role, content, model)
         VALUES ($1, 'assistant', '', $2)
         RETURNING id`,
        [sessionId, 'pending']
      );
      const assistantMessageId = assistantIns.rows[0].id;

      const result = await aiService.streamChat({
        history: histRes.rows,
        userMessage,
        adminEmail,
        sessionId,
        messageId: assistantMessageId,
        emit: send,
      });

      // Update the assistant message with final content + cost
      await db.query(
        `UPDATE ai_chat_messages
            SET content = $1, tool_calls = $2, model = $3,
                tokens_in = $4, tokens_out = $5, cost_cents = $6
          WHERE id = $7`,
        [
          result.content,
          result.toolCalls?.length ? JSON.stringify(result.toolCalls) : null,
          result.model,
          result.tokensIn,
          result.tokensOut,
          result.costCents,
          assistantMessageId,
        ]
      );

      send({ type: 'end', assistantMessageId });
    } catch (e) {
      console.error('[ai/chat] error:', e);
      send({ type: 'error', error: e.message, code: e.code });
    } finally {
      clearInterval(heartbeat);
      try { res.end(); } catch {}
    }
  });

  return router;
}

module.exports = { buildAiRouter };
