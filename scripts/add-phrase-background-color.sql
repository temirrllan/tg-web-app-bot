-- Добавляем колонку для цвета фона
ALTER TABLE motivational_phrases 
ADD COLUMN IF NOT EXISTS background_color VARCHAR(7) DEFAULT '#A7D96C';

-- Обновляем существующие фразы с разными цветами в зависимости от типа
UPDATE motivational_phrases SET background_color = 
  CASE 
    WHEN type = 'encouragement' AND min_completed = 0 THEN '#FFB3BA'  -- Розовый для начала
    WHEN type = 'success' AND min_completed <= 2 THEN '#FFE4B5'      -- Персиковый для малого прогресса
    WHEN type = 'success' AND min_completed > 2 THEN '#B5E7A0'       -- Зеленый для хорошего прогресса
    WHEN type = 'streak' THEN '#A7D96C'                              -- Основной зеленый для серий
    WHEN type = 'perfect' THEN '#87CEEB'                             -- Голубой для идеального выполнения
    ELSE '#A7D96C'
  END
WHERE background_color IS NULL OR background_color = '#A7D96C';

-- Обновляем конкретные фразы с индивидуальными цветами
UPDATE motivational_phrases SET background_color = '#FFB3BA' WHERE phrase_en = 'Keep going!' AND type = 'encouragement';
UPDATE motivational_phrases SET background_color = '#FFC0CB' WHERE phrase_en = 'You can do it!' AND type = 'encouragement';
UPDATE motivational_phrases SET background_color = '#FFE4E1' WHERE phrase_en = 'Start right now!' AND type = 'encouragement';
UPDATE motivational_phrases SET background_color = '#FFDAB9' WHERE phrase_en = 'Take the first step!' AND type = 'encouragement';
UPDATE motivational_phrases SET background_color = '#F0E68C' WHERE phrase_en = 'Believe in yourself!' AND type = 'encouragement';

UPDATE motivational_phrases SET background_color = '#98FB98' WHERE phrase_en = 'Great start!' AND type = 'success';
UPDATE motivational_phrases SET background_color = '#90EE90' WHERE phrase_en = 'Keep it up!' AND type = 'success';
UPDATE motivational_phrases SET background_color = '#87CEEB' WHERE phrase_en = 'Excellent!' AND type = 'success';
UPDATE motivational_phrases SET background_color = '#ADD8E6' WHERE phrase_en = 'Amazing!' AND type = 'success';

UPDATE motivational_phrases SET background_color = '#DDA0DD' WHERE phrase_en = 'Perfect day!' AND type = 'perfect';
UPDATE motivational_phrases SET background_color = '#E6E6FA' WHERE phrase_en = 'All done! Incredible!' AND type = 'perfect';
UPDATE motivational_phrases SET background_color = '#B19CD9' WHERE phrase_en = 'Flawless!' AND type = 'perfect';

-- Добавляем новые фразы с цветами для розового фона (как на макете)
INSERT INTO motivational_phrases (phrase_ru, phrase_en, emoji, type, min_completed, background_color) VALUES
('Продолжай пробовать, друг!', 'Keep trying buddy!', '🍫', 'encouragement', 0, '#FFB3BA'),
('Не сдавайся, приятель!', 'Don''t give up, buddy!', '🌟', 'encouragement', 0, '#FFC0CB'),
('Ты можешь больше!', 'You can do more!', '💪', 'encouragement', 0, '#FFD1DC');