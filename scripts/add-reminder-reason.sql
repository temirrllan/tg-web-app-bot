-- Добавляем колонку для хранения причины напоминания
ALTER TABLE reminder_history 
ADD COLUMN IF NOT EXISTS reminder_reason VARCHAR(20) DEFAULT 'pending';

-- Добавляем индекс для оптимизации
CREATE INDEX IF NOT EXISTS idx_reminder_history_reason 
ON reminder_history(reminder_reason);

-- Обновляем constraint для уникальности
ALTER TABLE reminder_history 
DROP CONSTRAINT IF EXISTS reminder_history_habit_date_unique;

-- Комментарий для документации
COMMENT ON COLUMN reminder_history.reminder_reason IS 
'Reason for sending reminder: pending, skipped, no_mark';