-- Migration 006: Drop hint columns — hint state is now tracked via localStorage only
-- Hints are shown once per new user (isNewUser flag from auth), no DB persistence needed.

ALTER TABLE users DROP COLUMN IF EXISTS swipe_hint_dismissed;
ALTER TABLE users DROP COLUMN IF EXISTS friend_hint_dismissed;
