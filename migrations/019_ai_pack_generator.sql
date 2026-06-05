-- ============================================================
-- Migration 019: AI Pack Generator
-- Персональные паки привычек, сгенерированные Claude по запросу пользователя.
-- Переиспользует special_habit_packs / templates / achievements / purchases.
-- См. ADR 0006 (Checkhabitly/Decisions/0006-ai-pack-generator.md).
-- ============================================================

-- 1. Новые поля в special_habit_packs (курированные паки остаются с дефолтами)
ALTER TABLE special_habit_packs
  ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE special_habit_packs
  ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE special_habit_packs
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

-- 2. Таблица запросов на генерацию — контроль оплаты, статуса, бесплатной генерации и редо.
CREATE TABLE IF NOT EXISTS ai_generation_requests (
  id                         SERIAL PRIMARY KEY,
  user_id                    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt                     TEXT NOT NULL,                 -- описание цели от пользователя
  survey                     JSONB,                         -- ответы опроса: age/occupation/level/time
  lang                       VARCHAR(5) DEFAULT 'ru',
  status                     VARCHAR(20) NOT NULL DEFAULT 'pending',
                             -- pending | paid | generating | done | failed
  pack_id                    INTEGER REFERENCES special_habit_packs(id) ON DELETE SET NULL,
  price_paid_stars           INTEGER NOT NULL DEFAULT 0,
  telegram_payment_charge_id VARCHAR(255),
  is_free                    BOOLEAN NOT NULL DEFAULT false, -- использована бесплатная генерация новичка
  redo_used                  BOOLEAN NOT NULL DEFAULT false, -- израсходован бесплатный 1 редо
  error                      TEXT,                           -- текст ошибки при status='failed'
  created_at                 TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                 TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Индексы
-- быстро узнать историю генераций юзера (в т.ч. использовал ли бесплатную)
CREATE INDEX IF NOT EXISTS idx_ai_gen_requests_user
  ON ai_generation_requests(user_id, created_at DESC);
-- фильтрация AI-паков
CREATE INDEX IF NOT EXISTS idx_special_packs_ai
  ON special_habit_packs(is_ai_generated, created_by_user_id)
  WHERE is_ai_generated = true;
