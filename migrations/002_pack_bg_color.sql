-- Migration 002: Add bg_color to special_habit_packs
-- Run once against your PostgreSQL database

ALTER TABLE special_habit_packs ADD COLUMN IF NOT EXISTS bg_color VARCHAR(20) DEFAULT NULL;
