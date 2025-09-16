-- Убедимся, что колонка date имеет правильный тип
ALTER TABLE habit_marks ALTER COLUMN date TYPE DATE USING date::date;

-- Создаем составной уникальный индекс если его нет
DROP INDEX IF EXISTS idx_habit_marks_unique;
CREATE UNIQUE INDEX idx_habit_marks_unique ON habit_marks(habit_id, date);

-- Добавляем индекс для быстрого поиска по дате
CREATE INDEX IF NOT EXISTS idx_habit_marks_date_only ON habit_marks(date);

-- Функция для проверки корректности дат
CREATE OR REPLACE FUNCTION check_habit_marks_dates()
RETURNS TABLE (
  habit_id INTEGER,
  date DATE,
  status VARCHAR,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    hm.habit_id,
    hm.date,
    hm.status,
    COUNT(*) as count
  FROM habit_marks hm
  GROUP BY hm.habit_id, hm.date, hm.status
  HAVING COUNT(*) > 1;
END;
$$ LANGUAGE plpgsql;

-- Удаляем дубликаты если есть
DELETE FROM habit_marks
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY habit_id, date ORDER BY marked_at DESC) as rn
    FROM habit_marks
  ) t
  WHERE t.rn > 1
);