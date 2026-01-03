-- Скрипт для проверки целостности данных подписок
-- Запускайте этот скрипт после каждого платежа, чтобы убедиться что премиум получил только нужный пользователь

-- ========================================
-- 1. ОБЩАЯ СТАТИСТИКА
-- ========================================
SELECT 
    'Total users' as metric,
    COUNT(*)::TEXT as value
FROM users
UNION ALL
SELECT 
    'Premium users',
    COUNT(*)::TEXT
FROM users
WHERE is_premium = true
UNION ALL
SELECT 
    'Active subscriptions',
    COUNT(*)::TEXT
FROM subscriptions
WHERE is_active = true
UNION ALL
SELECT 
    'Paid today',
    COUNT(*)::TEXT
FROM telegram_payments
WHERE status = 'completed' 
  AND processed_at::DATE = CURRENT_DATE;

-- ========================================
-- 2. ПРОВЕРКА НА ОШИБКИ
-- ========================================
-- Пользователи с премиумом БЕЗ активной подписки (ОШИБКА!)
SELECT 
    '❌ ERRORS: Premium without subscription' as check_name,
    COUNT(*)::TEXT as count,
    CASE 
        WHEN COUNT(*) > 0 THEN '❌ CRITICAL ERROR: Users have premium without active subscription!'
        ELSE '✅ OK: All premium users have subscriptions'
    END as status
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
WHERE u.is_premium = true AND s.id IS NULL
UNION ALL
-- Активные подписки БЕЗ премиума (ОШИБКА!)
SELECT 
    '❌ ERRORS: Subscription without premium',
    COUNT(*)::TEXT,
    CASE 
        WHEN COUNT(*) > 0 THEN '❌ ERROR: Active subscriptions without premium status!'
        ELSE '✅ OK: All active subscriptions have premium status'
    END
FROM subscriptions s
JOIN users u ON s.user_id = u.id
WHERE s.is_active = true AND u.is_premium = false
UNION ALL
-- Истекшие подписки, которые всё ещё активны (ОШИБКА!)
SELECT 
    '❌ ERRORS: Expired but active subscriptions',
    COUNT(*)::TEXT,
    CASE 
        WHEN COUNT(*) > 0 THEN '⚠️ WARNING: Some subscriptions expired but still marked as active!'
        ELSE '✅ OK: No expired subscriptions are active'
    END
FROM subscriptions
WHERE is_active = true 
  AND expires_at IS NOT NULL 
  AND expires_at < CURRENT_TIMESTAMP;

-- ========================================
-- 3. ПОСЛЕДНИЕ ПЛАТЕЖИ (за последние 24 часа)
-- ========================================
SELECT 
    tp.id as payment_id,
    tp.created_at as payment_time,
    tp.processed_at,
    tp.status,
    tp.plan_type,
    tp.total_amount as amount_xtr,
    u.id as user_id,
    u.telegram_id,
    u.first_name,
    u.is_premium,
    u.subscription_type,
    s.id as subscription_id,
    s.is_active as subscription_active,
    CASE 
        WHEN u.is_premium = true AND s.is_active = true THEN '✅ OK'
        WHEN u.is_premium = false THEN '❌ Payment completed but no premium'
        WHEN s.is_active = false THEN '❌ Payment completed but subscription inactive'
        ELSE '⚠️ Unknown state'
    END as check_result
FROM telegram_payments tp
JOIN users u ON tp.user_id = u.id
LEFT JOIN subscriptions s ON s.user_id = u.id AND s.is_active = true
WHERE tp.created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
  AND tp.status = 'completed'
ORDER BY tp.created_at DESC;

-- ========================================
-- 4. ВСЕ ПРЕМИУМ ПОЛЬЗОВАТЕЛИ
-- ========================================
SELECT 
    u.id,
    u.telegram_id,
    u.first_name,
    u.is_premium,
    u.subscription_type,
    TO_CHAR(u.subscription_start_date, 'YYYY-MM-DD HH24:MI') as started,
    TO_CHAR(u.subscription_expires_at, 'YYYY-MM-DD HH24:MI') as expires,
    s.id as sub_id,
    s.plan_type as sub_plan,
    s.is_active as sub_active,
    s.price_stars,
    CASE 
        WHEN s.expires_at IS NULL THEN 'LIFETIME'
        WHEN s.expires_at > CURRENT_TIMESTAMP THEN 
            CONCAT(CEIL(EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP)) / 86400)::TEXT, ' days left')
        ELSE 'EXPIRED'
    END as time_left,
    CASE 
        WHEN u.is_premium = true AND s.is_active = true AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP) THEN '✅ VALID'
        WHEN u.is_premium = true AND s.id IS NULL THEN '❌ NO SUBSCRIPTION'
        WHEN u.is_premium = true AND s.is_active = false THEN '❌ INACTIVE SUB'
        WHEN u.is_premium = true AND s.expires_at < CURRENT_TIMESTAMP THEN '❌ EXPIRED'
        ELSE '⚠️ CHECK NEEDED'
    END as validation
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
WHERE u.is_premium = true
ORDER BY u.id;

-- ========================================
-- 5. ИСТОРИЯ ИЗМЕНЕНИЙ (последние 50 записей)
-- ========================================
SELECT 
    sh.id,
    TO_CHAR(sh.created_at, 'YYYY-MM-DD HH24:MI:SS') as time,
    sh.action,
    u.id as user_id,
    u.telegram_id,
    u.first_name,
    sh.plan_type,
    sh.price_stars,
    s.is_active as current_subscription_active
FROM subscription_history sh
JOIN users u ON sh.user_id = u.id
LEFT JOIN subscriptions s ON sh.subscription_id = s.id
ORDER BY sh.created_at DESC
LIMIT 50;

-- ========================================
-- 6. РЕКОМЕНДАЦИИ ПО ИСПРАВЛЕНИЮ
-- ========================================
DO $$
DECLARE
    premium_without_sub INTEGER;
    sub_without_premium INTEGER;
    expired_active INTEGER;
BEGIN
    -- Считаем ошибки
    SELECT COUNT(*) INTO premium_without_sub
    FROM users u
    LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true
    WHERE u.is_premium = true AND s.id IS NULL;
    
    SELECT COUNT(*) INTO sub_without_premium
    FROM subscriptions s
    JOIN users u ON s.user_id = u.id
    WHERE s.is_active = true AND u.is_premium = false;
    
    SELECT COUNT(*) INTO expired_active
    FROM subscriptions
    WHERE is_active = true AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP;
    
    -- Выводим рекомендации
    IF premium_without_sub > 0 THEN
        RAISE NOTICE '❌ CRITICAL: % users have premium without subscription!', premium_without_sub;
        RAISE NOTICE 'Fix: UPDATE users SET is_premium = false, subscription_type = NULL WHERE id IN (SELECT u.id FROM users u LEFT JOIN subscriptions s ON u.id = s.user_id AND s.is_active = true WHERE u.is_premium = true AND s.id IS NULL);';
    END IF;
    
    IF sub_without_premium > 0 THEN
        RAISE NOTICE '⚠️ WARNING: % active subscriptions without premium status!', sub_without_premium;
        RAISE NOTICE 'Fix: UPDATE users u SET is_premium = true, subscription_type = s.plan_type FROM subscriptions s WHERE u.id = s.user_id AND s.is_active = true AND u.is_premium = false;';
    END IF;
    
    IF expired_active > 0 THEN
        RAISE NOTICE '⚠️ WARNING: % expired subscriptions still marked as active!', expired_active;
        RAISE NOTICE 'Fix: UPDATE subscriptions SET is_active = false, cancelled_at = CURRENT_TIMESTAMP WHERE is_active = true AND expires_at < CURRENT_TIMESTAMP;';
    END IF;
    
    IF premium_without_sub = 0 AND sub_without_premium = 0 AND expired_active = 0 THEN
        RAISE NOTICE '✅ ALL CHECKS PASSED! Data integrity is OK.';
    END IF;
END $$;