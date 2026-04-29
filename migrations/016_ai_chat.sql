-- ============================================================================
-- Migration 016: AI chat tables for admin panel
-- ============================================================================
-- Stores chat sessions, messages, SQL audit log, and monthly usage for cost cap.
-- See: ADR 0004 in Obsidian vault Decisions/0004-ai-admin-openai-integration.md
-- ============================================================================

-- ── 1. Chat sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id BIGSERIAL PRIMARY KEY,
  admin_email TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Новый чат',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_updated_at
  ON ai_chat_sessions(updated_at DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_admin_email
  ON ai_chat_sessions(admin_email);

-- ── 2. Chat messages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_call_id TEXT,
  model TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_cents NUMERIC(10, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session
  ON ai_chat_messages(session_id, created_at);

-- ── 3. SQL query audit log ──────────────────────────────────────────────────
-- Every SQL the AI executes is logged. Used for debugging, security audits,
-- and showing the admin "what query did the AI run".
CREATE TABLE IF NOT EXISTS ai_query_log (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT REFERENCES ai_chat_messages(id) ON DELETE SET NULL,
  admin_email TEXT,
  sql_text TEXT NOT NULL,
  rows_returned INTEGER,
  duration_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_query_log_created_at
  ON ai_query_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_query_log_message_id
  ON ai_query_log(message_id);

-- ── 4. Monthly usage aggregate (for cost cap) ───────────────────────────────
-- Updated after every assistant response. Backend reads this to enforce $5/mo cap.
CREATE TABLE IF NOT EXISTS ai_usage_monthly (
  month DATE PRIMARY KEY,
  total_cost_cents NUMERIC(12, 4) NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  tokens_in_total BIGINT NOT NULL DEFAULT 0,
  tokens_out_total BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. Trigger: bump session.updated_at on new message ──────────────────────
CREATE OR REPLACE FUNCTION fn_ai_bump_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ai_chat_sessions
     SET updated_at = NOW()
   WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_bump_session_updated_at ON ai_chat_messages;
CREATE TRIGGER trg_ai_bump_session_updated_at
  AFTER INSERT ON ai_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION fn_ai_bump_session_updated_at();

-- ── Done ────────────────────────────────────────────────────────────────────
-- After applying this migration, run scripts/setup-ai-readonly.sh
-- to create the read-only PG role used by the AI tool layer.
