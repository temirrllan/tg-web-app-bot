-- Добавляем колонку для цвета фона мотивационных фраз
ALTER TABLE motivational_phrases 
ADD COLUMN IF NOT EXISTS background_color VARCHAR(50) DEFAULT '#FFB6C1';

-- Обновляем существующие фразы с разными цветами фона
UPDATE motivational_phrases SET background_color = '#FFB6C1' WHERE type = 'encouragement' AND background_color IS NULL;
UPDATE motivational_phrases SET background_color = '#B8E6B8' WHERE type = 'success' AND background_color IS NULL;
UPDATE motivational_phrases SET background_color = '#FFD700' WHERE type = 'perfect' AND background_color IS NULL;
UPDATE motivational_phrases SET background_color = '#DDA0DD' WHERE type = 'streak' AND background_color IS NULL;

-- Добавляем новые фразы с цветами как на макете
INSERT INTO motivational_phrases (phrase_ru, phrase_en, emoji, type, min_completed, background_color) VALUES
('Продолжай пытаться, друг!', 'Keep trying buddy!', '🍪', 'encouragement', 0, '#FFB6C1'),
('Ты почти у цели!', 'You''re almost there!', '🎯', 'encouragement', 1, '#FFE4B5'),
('Отличный прогресс!', 'Great progress!', '🚀', 'success', 2, '#B8E6B8'),
('Ты справляешься отлично!', 'You''re doing amazing!', '⭐', 'success', 3, '#87CEEB'),
('Идеальный день!', 'Perfect day!', '🏆', 'perfect', 0, '#FFD700')
ON CONFLICT DO NOTHING;

-- Создаем индекс для оптимизации
CREATE INDEX IF NOT EXISTS idx_motivational_phrases_background 
ON motivational_phrases(background_color);