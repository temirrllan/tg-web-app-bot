-- Add is_hidden flag to special_habit_purchases
-- When true, pack habits are hidden from the Special tab but all data is preserved
ALTER TABLE special_habit_purchases ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;
