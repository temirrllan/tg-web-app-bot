-- Исправляем поле is_premium для всех пользователей
-- Устанавливаем false для всех, у кого нет активной подписки в нашей системе

-- Сначала сбрасываем все is_premium в false
UPDATE users SET is_premium = false;

-- Если у вас есть таблица subscriptions, активируем премиум для тех, у кого есть активная подписка
UPDATE users u
SET is_premium = true
FROM subscriptions s
WHERE u.id = s.user_id
AND s.is_active = true
AND s.type = 'premium';

-- Проверяем результат
SELECT 
  COUNT(*) as total_users,
  COUNT(CASE WHEN is_premium = true THEN 1 END) as premium_users,
  COUNT(CASE WHEN is_premium = false THEN 1 END) as free_users
FROM users;