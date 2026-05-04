-- 017_fix_schedule_type_enum.sql
-- Чистим легаси-значение 'everyday' и фиксируем валидный набор типов расписания.
-- В JS-коде ('daily','weekdays','weekend','custom') — приводим БД в соответствие.

UPDATE habits
SET schedule_type = 'daily'
WHERE schedule_type = 'everyday';

ALTER TABLE habits DROP CONSTRAINT IF EXISTS habits_schedule_type_check;

ALTER TABLE habits
  ADD CONSTRAINT habits_schedule_type_check
  CHECK (schedule_type IN ('daily', 'weekdays', 'weekend', 'custom'));
