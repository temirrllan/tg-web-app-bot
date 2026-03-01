-- Migration 003: Add show_swipe_hint preference to users table
-- Run this in DBeaver or psql before deploying

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS show_swipe_hint BOOLEAN NOT NULL DEFAULT TRUE;

-- Existing users keep show_swipe_hint = true (they will see the hint once)
-- After they check "don't show again" the backend sets it to false
