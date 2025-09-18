-- Синхронизация данных подписок между таблицами subscriptions и users
-- Запустите этот скрипт чтобы исправить существующие несоответствия

-- 1. Обновляем пользователей с активными подписками
UPDATE users u
SET 
    subscription_type = s.plan_type,
    subscription_expires_at = s.expires_at,
    is_premium = true
FROM subscriptions s
WHERE u.id = s.user_id 
AND s.is_active = true
AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP);

-- 2. Сбрасываем премиум у пользователей без активных подписок
UPDATE users u
SET 
    subscription_type = NULL,
    subscription_expires_at = NULL,
    is_premium = false
WHERE NOT EXISTS (
    SELECT 1 FROM subscriptions s 
    WHERE s.user_id = u.id 
    AND s.is_active = true
    AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
)
AND (u.subscription_type IS NOT NULL OR u.is_premium = true);

-- 3. Деактивируем истекшие подписки
UPDATE subscriptions 
SET is_active = false, cancelled_at = CURRENT_TIMESTAMP
WHERE is_active = true 
AND expires_at IS NOT NULL 
AND expires_at < CURRENT_TIMESTAMP;

-- 4. Проверяем результат
SELECT 
    u.id,
    u.telegram_id,
    u.first_name,
    u.is_premium,
    u.subscription_type,
    u.subscription_expires_at,
    s.id as subscription_id,
    s.plan_type,
    s.expires_at as subscription_expires,
    s.is_active as subscription_active,
    CASE 
        WHEN s.id IS NOT NULL AND s.is_active = true THEN 'Active Subscription'
        WHEN u.is_premium = true AND s.id IS NULL THEN 'Premium without subscription (ERROR)'
        WHEN u.subscription_type IS NOT NULL AND s.id IS NULL THEN 'Has type but no subscription (ERROR)'
        ELSE 'Free User'
    END as status
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
ORDER BY u.id;