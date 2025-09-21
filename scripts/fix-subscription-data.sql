-- Скрипт для проверки и исправления данных подписок

-- 1. Показываем текущее состояние
SELECT 
  u.id,
  u.telegram_id,
  u.first_name,
  u.is_premium,
  u.subscription_type,
  u.subscription_expires_at,
  s.id as sub_id,
  s.plan_type,
  s.expires_at,
  s.is_active
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
WHERE u.is_premium = true OR s.id IS NOT NULL;

-- 2. Синхронизируем данные из subscriptions в users
UPDATE users u
SET 
  is_premium = true,
  subscription_type = s.plan_type,
  subscription_expires_at = s.expires_at
FROM subscriptions s
WHERE u.id = s.user_id 
AND s.is_active = true
AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP);

-- 3. Деактивируем истекшие подписки
UPDATE users u
SET 
  is_premium = false,
  subscription_type = NULL,
  subscription_expires_at = NULL
WHERE u.subscription_expires_at IS NOT NULL 
AND u.subscription_expires_at < CURRENT_TIMESTAMP;

-- 4. Проверяем результат
SELECT 
  COUNT(*) FILTER (WHERE is_premium = true) as premium_users,
  COUNT(*) FILTER (WHERE is_premium = false OR is_premium IS NULL) as free_users,
  COUNT(*) as total_users
FROM users;