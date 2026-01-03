-- Создание таблицы subscription_history если её нет
CREATE TABLE IF NOT EXISTS subscription_history (
    id SERIAL PRIMARY KEY,
    subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- 'created', 'purchased', 'cancelled', 'expired'
    plan_type VARCHAR(50),
    price_stars INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для оптимизации
CREATE INDEX IF NOT EXISTS idx_subscription_history_user_id ON subscription_history(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_history_subscription_id ON subscription_history(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_history_created ON subscription_history(created_at);
CREATE INDEX IF NOT EXISTS idx_subscription_history_action ON subscription_history(action);

-- Комментарии
COMMENT ON TABLE subscription_history IS 'История всех операций с подписками пользователей';
COMMENT ON COLUMN subscription_history.action IS 'Тип действия: created - создание, purchased - покупка, cancelled - отмена, expired - истечение';

-- ========================================
-- ИСПРАВЛЕНИЕ ПРОБЛЕМЫ С МАССОВЫМ ПРЕМИУМОМ
-- ========================================

-- 1. Показываем текущее состояние
SELECT 
    COUNT(*) as total_premium,
    COUNT(DISTINCT s.user_id) as premium_with_subscription
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
WHERE u.is_premium = true;

-- 2. Находим пользователей с премиумом БЕЗ активной подписки (ошибочно выданный премиум)
SELECT 
    u.id,
    u.telegram_id,
    u.first_name,
    u.is_premium,
    u.subscription_type,
    s.id as subscription_id,
    s.is_active as subscription_active
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
WHERE u.is_premium = true
  AND s.id IS NULL;

-- 3. ИСПРАВЛЕНИЕ: Убираем премиум у пользователей БЕЗ активной подписки
UPDATE users
SET 
    is_premium = false,
    subscription_type = NULL,
    subscription_expires_at = NULL,
    subscription_end_date = CURRENT_TIMESTAMP
WHERE is_premium = true
  AND id NOT IN (
      SELECT DISTINCT user_id 
      FROM subscriptions 
      WHERE is_active = true
  );

-- 4. ПРОВЕРКА: Синхронизируем данные для пользователей С активной подпиской
UPDATE users u
SET 
    is_premium = true,
    subscription_type = s.plan_type,
    subscription_expires_at = s.expires_at,
    subscription_start_date = s.started_at
FROM subscriptions s
WHERE u.id = s.user_id 
  AND s.is_active = true
  AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP);

-- 5. Деактивируем истекшие подписки
UPDATE subscriptions 
SET 
    is_active = false, 
    cancelled_at = CURRENT_TIMESTAMP
WHERE is_active = true 
  AND expires_at IS NOT NULL 
  AND expires_at < CURRENT_TIMESTAMP;

-- 6. Убираем премиум у пользователей с истекшими подписками
UPDATE users u
SET 
    is_premium = false,
    subscription_type = NULL,
    subscription_expires_at = NULL,
    subscription_end_date = CURRENT_TIMESTAMP
WHERE u.subscription_expires_at IS NOT NULL 
  AND u.subscription_expires_at < CURRENT_TIMESTAMP;

-- 7. ФИНАЛЬНАЯ ПРОВЕРКА
SELECT 
    'Total users' as category,
    COUNT(*) as count
FROM users
UNION ALL
SELECT 
    'Premium users',
    COUNT(*)
FROM users
WHERE is_premium = true
UNION ALL
SELECT 
    'Active subscriptions',
    COUNT(*)
FROM subscriptions
WHERE is_active = true
UNION ALL
SELECT 
    'Premium users WITH active subscription',
    COUNT(DISTINCT u.id)
FROM users u
INNER JOIN subscriptions s ON u.id = s.user_id
WHERE u.is_premium = true AND s.is_active = true
UNION ALL
SELECT 
    'Premium users WITHOUT active subscription (ERROR)',
    COUNT(*)
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
WHERE u.is_premium = true AND s.id IS NULL;

-- 8. Детальный отчёт по всем премиум пользователям
SELECT 
    u.id,
    u.telegram_id,
    u.first_name,
    u.is_premium,
    u.subscription_type,
    u.subscription_expires_at,
    s.id as subscription_id,
    s.plan_type,
    s.is_active as subscription_active,
    s.expires_at as subscription_expires,
    s.started_at,
    CASE 
        WHEN u.is_premium = true AND s.id IS NOT NULL AND s.is_active = true THEN '✅ OK'
        WHEN u.is_premium = true AND s.id IS NULL THEN '❌ Premium without subscription'
        WHEN u.is_premium = true AND s.is_active = false THEN '⚠️ Premium with inactive subscription'
        WHEN u.is_premium = false AND s.id IS NOT NULL AND s.is_active = true THEN '⚠️ Active subscription without premium'
        ELSE '✅ Free user'
    END as status
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
WHERE u.is_premium = true OR s.id IS NOT NULL
ORDER BY u.id;