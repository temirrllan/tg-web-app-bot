-- 018: Индекс для быстрых выборок отметок по пользователю и дате.
-- Запросы вида "отметки юзера за день/период" (Today, статистика, пересчёт стриков)
-- фильтруют по user_id + date. Существующие индексы покрывают (habit_id),(date),(habit_id,date),
-- но не (user_id, date) — отсюда seq scan на больших объёмах habit_marks.
CREATE INDEX IF NOT EXISTS idx_habit_marks_user_date
  ON habit_marks(user_id, date);
