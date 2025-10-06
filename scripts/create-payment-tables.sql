-- Таблица для хранения инвойсов
CREATE TABLE IF NOT EXISTS payment_invoices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_type VARCHAR(50) NOT NULL,
  amount INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, processing, paid, cancelled, failed
  payload TEXT,
  invoice_link TEXT,
  transaction_id VARCHAR(255),
  telegram_payment_id VARCHAR(255),
  pre_checkout_query_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP,
  cancelled_at TIMESTAMP
);

-- Индексы для быстрого поиска
CREATE INDEX idx_payment_invoices_user_id ON payment_invoices(user_id);
CREATE INDEX idx_payment_invoices_status ON payment_invoices(status);
CREATE INDEX idx_payment_invoices_transaction_id ON payment_invoices(transaction_id);

-- Таблица для промокодов (если еще нет)
CREATE TABLE IF NOT EXISTS promo_codes (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  discount_percent INTEGER NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица использования промокодов
CREATE TABLE IF NOT EXISTS promo_code_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  promo_code VARCHAR(50) NOT NULL REFERENCES promo_codes(code),
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, promo_code)
);