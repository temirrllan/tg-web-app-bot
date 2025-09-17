-- Удаляем старую таблицу subscriptions если она существует
DROP TABLE IF EXISTS subscriptions CASCADE;

-- Создаем новую таблицу подписок с полной информацией
CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_type VARCHAR(50) NOT NULL, -- '6_months', '1_year', 'lifetime', etc.
    plan_name VARCHAR(100), -- Человекочитаемое название
    price_stars INTEGER, -- Цена в звездах Telegram
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP, -- NULL для lifetime подписок
    is_active BOOLEAN DEFAULT true,
    is_trial BOOLEAN DEFAULT false,
    auto_renew BOOLEAN DEFAULT false,
    transaction_id VARCHAR(200), -- ID транзакции Telegram Stars (будет позже)
    payment_method VARCHAR(50) DEFAULT 'simulated', -- 'telegram_stars', 'simulated', etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cancelled_at TIMESTAMP, -- Когда была отменена
    UNIQUE(user_id, is_active) -- Только одна активная подписка на пользователя
);

-- Создаем индексы для оптимизации
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_is_active ON subscriptions(is_active);
CREATE INDEX idx_subscriptions_expires_at ON subscriptions(expires_at);
CREATE INDEX idx_subscriptions_plan_type ON subscriptions(plan_type);

-- Таблица истории подписок (для аналитики)
CREATE TABLE subscription_history (
    id SERIAL PRIMARY KEY,
    subscription_id INTEGER REFERENCES subscriptions(id),
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50), -- 'created', 'renewed', 'cancelled', 'expired'
    plan_type VARCHAR(50),
    price_stars INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_subscription_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для subscriptions
CREATE TRIGGER update_subscriptions_updated_at 
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION update_subscription_updated_at();

-- Функция для проверки активности подписки
CREATE OR REPLACE FUNCTION check_subscription_active(p_user_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    v_is_active BOOLEAN;
BEGIN
    SELECT 
        CASE 
            WHEN expires_at IS NULL THEN true -- lifetime
            WHEN expires_at > CURRENT_TIMESTAMP THEN true
            ELSE false
        END INTO v_is_active
    FROM subscriptions
    WHERE user_id = p_user_id
    AND is_active = true
    LIMIT 1;
    
    RETURN COALESCE(v_is_active, false);
END;
$$ LANGUAGE plpgsql;

-- Обновляем поле is_premium в users на основе активных подписок
UPDATE users u
SET is_premium = EXISTS (
    SELECT 1 FROM subscriptions s 
    WHERE s.user_id = u.id 
    AND s.is_active = true 
    AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
);

-- Добавляем столбцы в users если их нет
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS subscription_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP;

-- Синхронизируем данные
UPDATE users u
SET 
    subscription_type = s.plan_type,
    subscription_expires_at = s.expires_at
FROM subscriptions s
WHERE u.id = s.user_id 
AND s.is_active = true;