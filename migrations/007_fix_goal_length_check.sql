-- Migration 007: Conditional title/goal length limits
-- Regular habits: title <= 25, goal <= 35
-- Special (pack) habits: title <= 50, goal <= 100

ALTER TABLE habits DROP CONSTRAINT IF EXISTS habits_title_length_check;
ALTER TABLE habits ADD CONSTRAINT habits_title_length_check CHECK (
  (is_special = true AND char_length(title) <= 50) OR
  (is_special IS NOT TRUE AND char_length(title) <= 25)
);

ALTER TABLE habits DROP CONSTRAINT IF EXISTS habits_goal_length_check;
ALTER TABLE habits ADD CONSTRAINT habits_goal_length_check CHECK (
  (is_special = true AND char_length(goal) <= 100) OR
  (is_special IS NOT TRUE AND char_length(goal) <= 35)
);
