-- Migration 005: Rename hint columns to clearer semantics
-- swipe_hint_dismissed = true  → не показывать (галочка была поставлена)
-- swipe_hint_dismissed = false → показывать   (по умолчанию для всех)

-- Drop old column (added in migration 003)
ALTER TABLE users DROP COLUMN IF EXISTS show_swipe_hint;
ALTER TABLE users DROP COLUMN IF EXISTS show_friend_hint;

-- New columns: false = show hint, true = dismissed (don't show)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS swipe_hint_dismissed  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS friend_hint_dismissed BOOLEAN NOT NULL DEFAULT FALSE;
