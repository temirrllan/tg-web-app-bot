-- Добавляем новый тип для идеальных дней
ALTER TABLE motivational_phrases 
ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'success';

-- Обновляем существующие записи
UPDATE motivational_phrases SET type = 'success' WHERE type IS NULL;

-- Удаляем старые фразы (опционально)
DELETE FROM motivational_phrases;

-- Вставляем новые фразы с правильными типами
INSERT INTO motivational_phrases (phrase_ru, phrase_en, emoji, type, min_completed) VALUES
-- Фразы для начала (0 выполненных)
('Начни прямо сейчас!', 'Start right now!', '🚀', 'encouragement', 0),
('Ты справишься!', 'You can do it!', '💪', 'encouragement', 0),
('Сделай первый шаг!', 'Take the first step!', '👣', 'encouragement', 0),
('Верь в себя!', 'Believe in yourself!', '⭐', 'encouragement', 0),
('Сегодня твой день!', 'Today is your day!', '☀️', 'encouragement', 0),

-- Фразы для прогресса (1-2 выполненных)
('Отличное начало!', 'Great start!', '🌟', 'success', 1),
('Так держать!', 'Keep it up!', '💪', 'success', 1),
('Ты на правильном пути!', 'You''re on the right track!', '🎯', 'success', 1),
('Продолжай!', 'Keep going!', '🔥', 'success', 2),
('Хороший прогресс!', 'Good progress!', '📈', 'success', 2),

-- Фразы для хорошего прогресса (3-4 выполненных)
('Ты молодец!', 'You''re doing great!', '🎉', 'success', 3),
('Превосходно!', 'Excellent!', '🏆', 'success', 3),
('Потрясающе!', 'Amazing!', '✨', 'success', 4),
('Невероятный прогресс!', 'Incredible progress!', '🚀', 'success', 4),
('Ты крут!', 'You rock!', '🤘', 'success', 4),

-- Фразы для серий (streak)
('Не останавливайся!', 'Don''t stop now!', '🔥', 'streak', 2),
('Ты в ударе!', 'You''re on fire!', '🔥', 'streak', 3),
('Невероятная серия!', 'Amazing streak!', '⚡', 'streak', 5),
('Unstoppable!', 'Unstoppable!', '💥', 'streak', 7),

-- Фразы для идеального выполнения (все привычки)
('Ты всё сделал! Невероятно!', 'All done! Incredible!', '🎉', 'perfect', 0),
('Идеальный день!', 'Perfect day!', '💯', 'perfect', 0),
('Ты чемпион!', 'You''re a champion!', '🏆', 'perfect', 0),
('Безупречно!', 'Flawless!', '⭐', 'perfect', 0),
('Легенда!', 'Legend!', '👑', 'perfect', 0),
('Супергерой дня!', 'Superhero of the day!', '🦸', 'perfect', 0),
('Миссия выполнена!', 'Mission complete!', '✅', 'perfect', 0),
('100% выполнено!', '100% done!', '💯', 'perfect', 0),
('Ты справился со всем!', 'You nailed it all!', '🎯', 'perfect', 0),
('Великолепная работа!', 'Magnificent work!', '🌟', 'perfect', 0);

-- Создаем индекс для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_motivational_phrases_type ON motivational_phrases(type);
CREATE INDEX IF NOT EXISTS idx_motivational_phrases_min_completed ON motivational_phrases(min_completed);