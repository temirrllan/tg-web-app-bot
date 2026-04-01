-- 009: Добавляем поля промокода в subscriptions и telegram_payments

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS promo_code_id INTEGER REFERENCES promo_codes(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS promo_discount_stars INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS bonus_days INTEGER DEFAULT 0;

ALTER TABLE telegram_payments ADD COLUMN IF NOT EXISTS promo_code_id INTEGER REFERENCES promo_codes(id);
ALTER TABLE telegram_payments ADD COLUMN IF NOT EXISTS promo_discount_stars INTEGER DEFAULT 0;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_subscriptions_promo ON subscriptions(promo_code_id) WHERE promo_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_payments_promo ON telegram_payments(promo_code_id) WHERE promo_code_id IS NOT NULL;
