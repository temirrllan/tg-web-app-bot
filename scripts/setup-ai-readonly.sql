-- ============================================================================
-- Setup AI read-only PostgreSQL role
-- ============================================================================
-- Creates the `ai_readonly` role used exclusively by the AI tool layer in the
-- admin panel. The role can SELECT from all "data" tables but is REVOKED from
-- AI chat history tables (privacy).
--
-- USAGE:
--   1. Set env var $AI_DB_PASSWORD to a strong password (≥32 chars).
--   2. Run:
--      psql "$DATABASE_URL" \
--        -v ai_pwd="'$AI_DB_PASSWORD'" \
--        -f scripts/setup-ai-readonly.sql
--   3. Add to backend .env: AI_DB_PASSWORD=<same password>
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================================

\set ON_ERROR_STOP on

-- 1. Create role if missing, else just update password
DO $$
DECLARE
  pwd TEXT := :'ai_pwd';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_readonly') THEN
    EXECUTE format('ALTER ROLE ai_readonly WITH LOGIN PASSWORD %L', pwd);
    RAISE NOTICE 'ai_readonly: password updated';
  ELSE
    EXECUTE format('CREATE ROLE ai_readonly WITH LOGIN PASSWORD %L', pwd);
    RAISE NOTICE 'ai_readonly: created';
  END IF;
END
$$;

-- 2. Connect + schema usage
GRANT CONNECT ON DATABASE current_database() TO ai_readonly;
GRANT USAGE ON SCHEMA public TO ai_readonly;

-- 3. SELECT on all current tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ai_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_readonly;

-- 4. SELECT on all FUTURE tables (so new migrations don't lock AI out)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO ai_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO ai_readonly;

-- 5. Revoke AI's own metadata tables — AI must not read its own chat history
--    (privacy + prevents recursive context bleed)
REVOKE SELECT ON ai_chat_sessions   FROM ai_readonly;
REVOKE SELECT ON ai_chat_messages   FROM ai_readonly;
REVOKE SELECT ON ai_query_log       FROM ai_readonly;
REVOKE SELECT ON ai_usage_monthly   FROM ai_readonly;

-- 6. Revoke obviously sensitive payment internals (already SELECT-able by main
--    user, but we want AI to use aggregate stats only, not raw charge IDs)
--    Comment out these lines if you want AI to inspect raw payments.
-- REVOKE SELECT (telegram_payment_charge_id, payload) ON telegram_payments FROM ai_readonly;
-- (uncomment after verifying column names in your schema)

-- 7. Verify (informational output)
DO $$
DECLARE
  table_count INT;
  has_grant   BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO table_count
  FROM information_schema.role_table_grants
  WHERE grantee = 'ai_readonly' AND privilege_type = 'SELECT';

  SELECT bool_or(grantee = 'ai_readonly') INTO has_grant
  FROM information_schema.role_table_grants
  WHERE table_name = 'users';

  RAISE NOTICE 'ai_readonly has SELECT on % tables', table_count;
  RAISE NOTICE 'ai_readonly can read users table: %', has_grant;
END
$$;

\echo ''
\echo '✅ ai_readonly role configured.'
\echo '   Add AI_DB_PASSWORD to your backend .env'
\echo '   Connection string: postgresql://ai_readonly:$AI_DB_PASSWORD@host:5432/dbname'
