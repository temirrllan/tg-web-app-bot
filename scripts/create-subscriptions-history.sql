-- Создание таблицы истории подписок
CREATE TABLE IF NOT EXISTS subscriptions_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES subscriptions(id),
  plan_type VARCHAR(50) NOT NULL,
  plan_name VARCHAR(255) NOT NULL,
  price_stars INTEGER NOT NULL,
  action VARCHAR(50) NOT NULL, -- 'purchased', 'cancelled', 'expired', 'renewed'
  status VARCHAR(50) NOT NULL, -- 'completed', 'pending', 'failed'
  payment_method VARCHAR(50),
  telegram_payment_charge_id VARCHAR(255),
  started_at TIMESTAMP,
  expires_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

-- Индексы для оптимизации
CREATE INDEX idx_subscriptions_history_user ON subscriptions_history(user_id);
CREATE INDEX idx_subscriptions_history_subscription ON subscriptions_history(subscription_id);
CREATE INDEX idx_subscriptions_history_created ON subscriptions_history(created_at);
CREATE INDEX idx_subscriptions_history_action ON subscriptions_history(action);

-- Добавляем недостающие поля в таблицу users если их нет
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP;

-- Комментарии
COMMENT ON TABLE subscriptions_history IS 'История всех операций с подписками пользователей';
COMMENT ON COLUMN subscriptions_history.action IS 'Тип действия: purchased - покупка, cancelled - отмена, expired - истечение, renewed - продление';
COMMENT ON COLUMN subscriptions_history.status IS 'Статус операции: completed - завершено, pending - ожидание, failed - ошибка';