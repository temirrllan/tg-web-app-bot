-- Исправляем существующие подписки
-- Синхронизируем данные из таблицы subscriptions в таблицу users

-- Обновляем поля subscription_type и subscription_expires_at для всех пользователей с активными подписками
UPDATE users u
SET 
    subscription_type = s.plan_type,
    subscription_expires_at = s.expires_at,
    is_premium = true
FROM subscriptions s
WHERE u.id = s.user_id 
AND s.is_active = true
AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP);

-- Сбрасываем поля для пользователей без активных подписок
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
);

-- Проверяем результат
SELECT 
    u.id,
    u.telegram_id,
    u.first_name,
    u.is_premium,
    u.subscription_type,
    u.subscription_expires_at,
    s.plan_type,
    s.expires_at,
    s.is_active
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
ORDER BY u.id;