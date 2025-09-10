-- Проверяем структуру таблицы habit_members
-- Если поле is_active не существует, добавляем его
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'habit_members' 
        AND column_name = 'is_active'
    ) THEN
        ALTER TABLE habit_members 
        ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Обновляем все существующие записи, чтобы они были активными
UPDATE habit_members 
SET is_active = true 
WHERE is_active IS NULL;

-- Создаем индекс для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_habit_members_active 
ON habit_members(is_active);

-- Функция для полной очистки участника (для тестирования)
CREATE OR REPLACE FUNCTION clean_member_participation(
    p_user_id INTEGER,
    p_habit_id INTEGER
) RETURNS void AS $$
BEGIN
    -- Деактивируем участие в основной привычке
    UPDATE habit_members 
    SET is_active = false 
    WHERE user_id = p_user_id 
    AND habit_id = p_habit_id;
    
    -- Деактивируем привычку пользователя
    UPDATE habits 
    SET is_active = false 
    WHERE user_id = p_user_id 
    AND parent_habit_id = p_habit_id;
    
    -- Деактивируем все связанные записи в habit_members
    UPDATE habit_members 
    SET is_active = false 
    WHERE habit_id IN (
        SELECT id FROM habits 
        WHERE user_id = p_user_id 
        AND parent_habit_id = p_habit_id
    );
END;
$$ LANGUAGE plpgsql;

-- Функция для восстановления участника
CREATE OR REPLACE FUNCTION restore_member_participation(
    p_user_id INTEGER,
    p_habit_id INTEGER,
    p_owner_id INTEGER
) RETURNS void AS $$
DECLARE
    v_user_habit_id INTEGER;
BEGIN
    -- Активируем участие в основной привычке
    UPDATE habit_members 
    SET is_active = true 
    WHERE user_id = p_user_id 
    AND habit_id = p_habit_id;
    
    -- Проверяем существование привычки пользователя
    SELECT id INTO v_user_habit_id
    FROM habits 
    WHERE user_id = p_user_id 
    AND parent_habit_id = p_habit_id
    LIMIT 1;
    
    IF v_user_habit_id IS NOT NULL THEN
        -- Активируем существующую привычку
        UPDATE habits 
        SET is_active = true 
        WHERE id = v_user_habit_id;
        
        -- Восстанавливаем связи в habit_members
        INSERT INTO habit_members (habit_id, user_id, is_active)
        VALUES (v_user_habit_id, p_owner_id, true)
        ON CONFLICT (habit_id, user_id) 
        DO UPDATE SET is_active = true;
    END IF;
END;
$$ LANGUAGE plpgsql;