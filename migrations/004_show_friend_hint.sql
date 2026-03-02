-- Migration 004: Add show_friend_hint preference to users table
-- Run in DBeaver or psql before deploying

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS show_friend_hint BOOLEAN NOT NULL DEFAULT TRUE;

-- Existing users keep show_friend_hint = true (they will see the hint once)
-- After they check "don't show again" the backend sets it to false
