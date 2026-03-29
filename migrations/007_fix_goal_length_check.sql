-- Migration 007: Increase goal length limit from 35 to 100 characters
-- The old limit was too short for special habit pack templates

ALTER TABLE habits DROP CONSTRAINT IF EXISTS habits_goal_length_check;
ALTER TABLE habits ADD CONSTRAINT habits_goal_length_check CHECK (char_length(goal) <= 100);
