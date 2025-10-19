-- Проверяем структуру таблицы users
DO $$ 
BEGIN
    -- Добавляем колонки если их нет
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'is_premium') THEN
        ALTER TABLE users ADD COLUMN is_premium BOOLEAN DEFAULT false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'subscription_type') THEN
        ALTER TABLE users ADD COLUMN subscription_type VARCHAR(50);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'subscription_expires_at') THEN
        ALTER TABLE users ADD COLUMN subscription_expires_at TIMESTAMP;
    END IF;
END $$;

-- Проверяем таблицу subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_type VARCHAR(50) NOT NULL,
    plan_name VARCHAR(100) NOT NULL,
    price_stars INTEGER NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    is_trial BOOLEAN DEFAULT false,
    payment_method VARCHAR(50) DEFAULT 'telegram_stars',
    telegram_payment_charge_id VARCHAR(255),
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_is_active ON subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expires_at ON subscriptions(expires_at);

-- Проверяем таблицу telegram_payments
CREATE TABLE IF NOT EXISTS telegram_payments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    telegram_payment_charge_id VARCHAR(255) UNIQUE,
    provider_payment_charge_id VARCHAR(255),
    invoice_payload TEXT NOT NULL,
    currency VARCHAR(10) DEFAULT 'XTR',
    total_amount INTEGER NOT NULL,
    plan_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telegram_payments_user_id ON telegram_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_payments_status ON telegram_payments(status);
CREATE INDEX IF NOT EXISTS idx_telegram_payments_charge_id ON telegram_payments(telegram_payment_charge_id);

-- Проверяем таблицу subscription_history
CREATE TABLE IF NOT EXISTS subscription_history (
    id SERIAL PRIMARY KEY,
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    plan_type VARCHAR(50),
    price_stars INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscription_history_user_id ON subscription_history(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_history_subscription_id ON subscription_history(subscription_id);

-- Выводим информацию о таблицах
SELECT 'users' as table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name IN ('is_premium', 'subscription_type', 'subscription_expires_at')
UNION ALL
SELECT 'subscriptions' as table_name, 'exists' as column_name, 
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriptions') 
       THEN 'yes' ELSE 'no' END as data_type
UNION ALL
SELECT 'telegram_payments' as table_name, 'exists' as column_name,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'telegram_payments')
       THEN 'yes' ELSE 'no' END as data_type;