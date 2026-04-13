-- Уникальный индекс для ON CONFLICT (habit_id, DATE(sent_at)) в reminderService
-- Без него INSERT ... ON CONFLICT падает с ошибкой 42P10
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_history_habit_date
ON reminder_history (habit_id, DATE(sent_at));
