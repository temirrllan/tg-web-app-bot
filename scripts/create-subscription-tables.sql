-- Создание таблицы для платежных инвойсов
CREATE TABLE IF NOT EXISTS payment_invoices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_type VARCHAR(50) NOT NULL,
  amount INTEGER NOT NULL, -- в Telegram Stars
  status VARCHAR(20) DEFAULT 'pending', -- pending, paid, cancelled, failed
  payload JSONB,
  transaction_id VARCHAR(255),
  telegram_payment_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP,
  cancelled_at TIMESTAMP
);

CREATE INDEX idx_payment_invoices_user ON payment_invoices(user_id);
CREATE INDEX idx_payment_invoices_status ON payment_invoices(status);
CREATE INDEX idx_payment_invoices_transaction ON payment_invoices(transaction_id);

-- Создание таблицы для промокодов
CREATE TABLE IF NOT EXISTS promo_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  discount_percent INTEGER NOT NULL CHECK (discount_percent >= 0 AND discount_percent <= 100),
  is_active BOOLEAN DEFAULT true,
  max_uses INTEGER, -- NULL = unlimited
  current_uses INTEGER DEFAULT 0,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_promo_codes_code ON promo_codes(code);
CREATE INDEX idx_promo_codes_active ON promo_codes(is_active);

-- Создание таблицы для использования промокодов
CREATE TABLE IF NOT EXISTS promo_code_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  promo_code VARCHAR(50) NOT NULL,
  discount_amount INTEGER NOT NULL,
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, promo_code)
);

CREATE INDEX idx_promo_usage_user ON promo_code_usage(user_id);
CREATE INDEX idx_promo_usage_code ON promo_code_usage(promo_code);

-- Создание таблицы для переводов Stars
CREATE TABLE IF NOT EXISTS stars_transfers (
  id SERIAL PRIMARY KEY,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_telegram_id VARCHAR(50) NOT NULL,
  amount INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed
  transaction_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX idx_stars_transfers_from ON stars_transfers(from_user_id);
CREATE INDEX idx_stars_transfers_status ON stars_transfers(status);

-- Вставляем тестовые промокоды
INSERT INTO promo_codes (code, discount_percent, max_uses, expires_at) VALUES
('WELCOME10', 10, 100, CURRENT_TIMESTAMP + INTERVAL '30 days'),
('FIRST20', 20, 50, CURRENT_TIMESTAMP + INTERVAL '7 days'),
('PREMIUM50', 50, 10, CURRENT_TIMESTAMP + INTERVAL '3 days')
ON CONFLICT (code) DO NOTHING;

-- Добавляем комментарии для документации
COMMENT ON TABLE payment_invoices IS 'Хранит информацию о платежных инвойсах для Telegram Stars';
COMMENT ON TABLE promo_codes IS 'Промокоды для скидок на подписки';
COMMENT ON TABLE promo_code_usage IS 'История использования промокодов пользователями';
COMMENT ON TABLE stars_transfers IS 'История переводов Telegram Stars';

COMMENT ON COLUMN payment_invoices.amount IS 'Сумма в Telegram Stars';
COMMENT ON COLUMN payment_invoices.status IS 'Статус платежа: pending, paid, cancelled, failed';
COMMENT ON COLUMN promo_codes.discount_percent IS 'Процент скидки от 0 до 100';
COMMENT ON COLUMN promo_codes.max_uses IS 'Максимальное количество использований (NULL = без ограничений)';