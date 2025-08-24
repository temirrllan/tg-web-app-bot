-- Таблица промокодов
CREATE TABLE promo_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    discount_percent INTEGER, -- процент скидки
    discount_stars INTEGER, -- фиксированная скидка в звездах
    bonus_days INTEGER, -- бонусные дни подписки
    max_uses INTEGER DEFAULT 1, -- максимальное количество использований
    used_count INTEGER DEFAULT 0, -- сколько раз использован
    valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица использования промокодов
CREATE TABLE promo_uses (
    id SERIAL PRIMARY KEY,
    promo_code_id INTEGER REFERENCES promo_codes(id),
    user_id INTEGER REFERENCES users(id),
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(promo_code_id, user_id) -- один пользователь не может использовать промокод дважды
);

-- Индексы
CREATE INDEX idx_promo_codes_code ON promo_codes(code);
CREATE INDEX idx_promo_codes_active ON promo_codes(is_active);
CREATE INDEX idx_promo_uses_user ON promo_uses(user_id);

-- Тестовые промокоды
INSERT INTO promo_codes (code, description, discount_percent, max_uses) VALUES
    ('WELCOME2024', 'Welcome discount', 20, 100),
    ('HABITS50', 'Half price discount', 50, 50),
    ('NEWYEAR', 'New Year special', 30, 1000);