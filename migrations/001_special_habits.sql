-- ============================================================
-- Migration: Special Habits - Celebrity Habit Pack Store
-- Run this script once against your PostgreSQL database
-- ============================================================

-- 1. Add is_admin to users (if not exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- 2. Add new columns to habits table
ALTER TABLE habits ADD COLUMN IF NOT EXISTS is_special   BOOLEAN DEFAULT false;
ALTER TABLE habits ADD COLUMN IF NOT EXISTS pack_id      INTEGER;
ALTER TABLE habits ADD COLUMN IF NOT EXISTS template_id  INTEGER;

-- 3. Create special_habit_packs table
CREATE TABLE IF NOT EXISTS special_habit_packs (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(100) NOT NULL,
  photo_url            TEXT,
  short_description    VARCHAR(200),
  biography            TEXT,
  learn_more_url       TEXT,
  price_stars          INTEGER NOT NULL DEFAULT 0,
  original_price_stars INTEGER,
  is_active            BOOLEAN DEFAULT true,
  sort_order           INTEGER DEFAULT 0,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create special_habit_templates table
CREATE TABLE IF NOT EXISTS special_habit_templates (
  id               SERIAL PRIMARY KEY,
  pack_id          INTEGER NOT NULL REFERENCES special_habit_packs(id) ON DELETE CASCADE,
  title            VARCHAR(50) NOT NULL,
  goal             TEXT,
  category_id      INTEGER REFERENCES categories(id),
  schedule_days    INTEGER[] DEFAULT ARRAY[1,2,3,4,5,6,7],
  reminder_time    TIME,
  reminder_enabled BOOLEAN DEFAULT true,
  day_period       VARCHAR(20) DEFAULT 'morning',
  sort_order       INTEGER DEFAULT 0,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Create pack_achievements table
CREATE TABLE IF NOT EXISTS pack_achievements (
  id             SERIAL PRIMARY KEY,
  pack_id        INTEGER NOT NULL REFERENCES special_habit_packs(id) ON DELETE CASCADE,
  title          VARCHAR(100) NOT NULL,
  icon           TEXT,
  description    TEXT,
  required_count INTEGER NOT NULL,
  sort_order     INTEGER DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Create special_habit_purchases table
CREATE TABLE IF NOT EXISTS special_habit_purchases (
  id                         SERIAL PRIMARY KEY,
  user_id                    INTEGER NOT NULL REFERENCES users(id),
  pack_id                    INTEGER NOT NULL REFERENCES special_habit_packs(id),
  price_paid_stars           INTEGER NOT NULL DEFAULT 0,
  telegram_payment_charge_id VARCHAR(255),
  payment_status             VARCHAR(50) DEFAULT 'pending',
  purchased_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, pack_id)
);

-- 7. Create pack_achievement_progress table
CREATE TABLE IF NOT EXISTS pack_achievement_progress (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  pack_id        INTEGER NOT NULL REFERENCES special_habit_packs(id),
  achievement_id INTEGER NOT NULL REFERENCES pack_achievements(id),
  current_count  INTEGER NOT NULL DEFAULT 0,
  is_unlocked    BOOLEAN DEFAULT false,
  unlocked_at    TIMESTAMP,
  notified_at    TIMESTAMP,
  UNIQUE(user_id, achievement_id)
);

-- 8. Add FK constraints to habits (after tables exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'habits_pack_id_fkey'
  ) THEN
    ALTER TABLE habits
      ADD CONSTRAINT habits_pack_id_fkey
      FOREIGN KEY (pack_id) REFERENCES special_habit_packs(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'habits_template_id_fkey'
  ) THEN
    ALTER TABLE habits
      ADD CONSTRAINT habits_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES special_habit_templates(id);
  END IF;
END $$;

-- 9. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_habits_is_special ON habits(is_special) WHERE is_special = true;
CREATE INDEX IF NOT EXISTS idx_habits_pack_id ON habits(pack_id) WHERE pack_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_special_packs_active ON special_habit_packs(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_purchases_user_pack ON special_habit_purchases(user_id, pack_id);
CREATE INDEX IF NOT EXISTS idx_achievement_progress_user ON pack_achievement_progress(user_id, pack_id);
