-- 012: Таблица subscription_plans — управление планами подписок из админки
-- Вместо хардкода в коде, планы хранятся в БД

CREATE TABLE IF NOT EXISTS subscription_plans (
    id SERIAL PRIMARY KEY,
    plan_key VARCHAR(50) UNIQUE NOT NULL,        -- 'month', '6_months', '1_year'
    name VARCHAR(100) NOT NULL,                   -- 'Premium for 1 Month'
    display_name_ru VARCHAR(100),                 -- 'На 1 месяц'
    display_name_en VARCHAR(100),                 -- 'For 1 Month'
    display_name_kk VARCHAR(100),                 -- '1 айға'
    duration_months INTEGER NOT NULL DEFAULT 1,
    price_stars INTEGER NOT NULL,
    features TEXT DEFAULT '[]',                    -- JSON array of feature strings
    badge_ru VARCHAR(50),                         -- '-30%' badge text
    badge_en VARCHAR(50),
    badge_kk VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,             -- pre-selected plan
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed with current plans
INSERT INTO subscription_plans (plan_key, name, display_name_ru, display_name_en, display_name_kk, duration_months, price_stars, features, badge_en, badge_ru, badge_kk, is_active, is_default, sort_order)
VALUES
    ('month', 'Premium for 1 Month', 'На 1 месяц', 'For 1 Month', '1 айға', 1, 59, '["Unlimited habits", "Unlimited friends", "Advanced statistics", "Priority support"]', NULL, NULL, NULL, true, false, 1),
    ('6_months', 'Premium for 6 Months', 'На 6 месяцев', 'For 6 Months', '6 айға', 6, 299, '["Unlimited habits", "Unlimited friends", "Advanced statistics", "Priority support"]', NULL, NULL, NULL, true, true, 2),
    ('1_year', 'Premium for 1 Year', 'На 1 год', 'For 1 Year', '1 жылға', 12, 500, '["Unlimited habits", "Unlimited friends", "Advanced statistics", "Priority support", "Save 30%"]', '-30%', '-30%', '-30%', true, false, 3)
ON CONFLICT (plan_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active ON subscription_plans(is_active);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_sort ON subscription_plans(sort_order);
