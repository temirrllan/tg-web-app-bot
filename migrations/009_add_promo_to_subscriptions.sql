-- 009: Полная миграция промокодов

-- ═══ promo_codes: недостающие колонки ═══
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS discount_stars INTEGER DEFAULT 0;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS bonus_days INTEGER DEFAULT 0;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP;

-- ═══ promo_uses: таблица использований ═══
CREATE TABLE IF NOT EXISTS promo_uses (
    id SERIAL PRIMARY KEY,
    promo_code_id INTEGER REFERENCES promo_codes(id),
    user_id INTEGER REFERENCES users(id),
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(promo_code_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_promo_uses_user ON promo_uses(user_id);
CREATE INDEX IF NOT EXISTS idx_promo_uses_code ON promo_uses(promo_code_id);

-- ═══ subscriptions: поля промокодов ═══
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS promo_code_id INTEGER REFERENCES promo_codes(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS promo_discount_stars INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS bonus_days INTEGER DEFAULT 0;

-- ═══ telegram_payments: поля промокодов ═══
ALTER TABLE telegram_payments ADD COLUMN IF NOT EXISTS promo_code_id INTEGER REFERENCES promo_codes(id);
ALTER TABLE telegram_payments ADD COLUMN IF NOT EXISTS promo_discount_stars INTEGER DEFAULT 0;

-- ═══ Индексы ═══
CREATE INDEX IF NOT EXISTS idx_subscriptions_promo ON subscriptions(promo_code_id) WHERE promo_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_payments_promo ON telegram_payments(promo_code_id) WHERE promo_code_id IS NOT NULL;
