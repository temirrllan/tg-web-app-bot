-- Таблица пользователей (уже существует)
-- users: id, telegram_id, language, is_admin, is_premium, created_at, first_name, last_name, username, photo_url

-- Таблица категорий привычек
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name_ru VARCHAR(50) NOT NULL,
    name_en VARCHAR(50) NOT NULL,
    icon VARCHAR(10) NOT NULL, -- эмодзи
    color VARCHAR(7) DEFAULT '#3B82F6', -- hex цвет
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Начальные категории
INSERT INTO categories (name_ru, name_en, icon, color, sort_order) VALUES
    ('Спорт', 'Sport', '🏃', '#EF4444', 1),
    ('Здоровье', 'Health', '💊', '#10B981', 2),
    ('Вода', 'Water', '💧', '#3B82F6', 3),
    ('Йога', 'Yoga', '🧘', '#8B5CF6', 4),
    ('Медитация', 'Meditation', '🧘‍♂️', '#6366F1', 5),
    ('Чтение', 'Reading', '📚', '#F59E0B', 6),
    ('Учёба', 'Study', '📖', '#14B8A6', 7),
    ('Питание', 'Nutrition', '🥗', '#84CC16', 8),
    ('Сон', 'Sleep', '😴', '#6B7280', 9),
    ('Другое', 'Other', '⭐', '#A855F7', 10);

-- Таблица привычек
CREATE TABLE habits (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id),
    title VARCHAR(255) NOT NULL,
    goal TEXT, -- цель/мотивация
    schedule_type VARCHAR(20) NOT NULL DEFAULT 'daily', -- 'daily', 'weekly', 'custom'
    schedule_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5,6,7], -- 1=пн, 7=вс
    reminder_time TIME, -- время напоминания
    reminder_enabled BOOLEAN DEFAULT true,
    is_bad_habit BOOLEAN DEFAULT false,
    streak_current INTEGER DEFAULT 0,
    streak_best INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Индекс для быстрой выборки привычек пользователя
CREATE INDEX idx_habits_user_id ON habits(user_id);
CREATE INDEX idx_habits_active ON habits(is_active);

-- Таблица отметок выполнения
CREATE TABLE habit_marks (
    id SERIAL PRIMARY KEY,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'completed', 'failed', 'skipped', 'pending'
    marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(habit_id, date)
);

-- Индексы для быстрой выборки
CREATE INDEX idx_habit_marks_habit_id ON habit_marks(habit_id);
CREATE INDEX idx_habit_marks_date ON habit_marks(date);
CREATE INDEX idx_habit_marks_status ON habit_marks(status);

-- Таблица мотивационных фраз
CREATE TABLE motivational_phrases (
    id SERIAL PRIMARY KEY,
    phrase_ru TEXT NOT NULL,
    phrase_en TEXT NOT NULL,
    emoji VARCHAR(10),
    type VARCHAR(20) DEFAULT 'success', -- 'success', 'encouragement', 'streak'
    min_completed INTEGER DEFAULT 0, -- минимум выполненных привычек для показа
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Начальные мотивационные фразы
INSERT INTO motivational_phrases (phrase_ru, phrase_en, emoji, type, min_completed) VALUES
    ('Отличное начало!', 'Great start!', '🌟', 'success', 1),
    ('Так держать!', 'Keep it up!', '💪', 'success', 2),
    ('Ты молодец!', 'You''re doing great!', '🎉', 'success', 3),
    ('Превосходно!', 'Excellent!', '🏆', 'success', 4),
    ('Slaaaay Queen', 'Slaaaay Queen', '🔥', 'success', 3),
    ('Yes U Can!', 'Yes U Can!', '✨', 'encouragement', 0),
    ('Не сдавайся!', 'Don''t give up!', '💫', 'encouragement', 0),
    ('Продолжай в том же духе!', 'Keep going!', '🚀', 'streak', 0),
    ('Ты на правильном пути!', 'You''re on the right track!', '🎯', 'success', 2);

-- Таблица истории напоминаний (для отслеживания отправленных)
CREATE TABLE reminder_history (
    id SERIAL PRIMARY KEY,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    sent_at TIMESTAMP NOT NULL,
    callback_id VARCHAR(100), -- для связи с telegram callback
    is_marked BOOLEAN DEFAULT false,
    marked_at TIMESTAMP
);

-- Индекс для поиска по callback_id
CREATE INDEX idx_reminder_history_callback ON reminder_history(callback_id);

-- Таблица подписок (для интеграции с Telegram Stars)
CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL DEFAULT 'free', -- 'free', 'premium'
    stars_amount INTEGER, -- количество звезд
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    transaction_id VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    UNIQUE(user_id)
);

-- Функция для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для habits
CREATE TRIGGER update_habits_updated_at BEFORE UPDATE ON habits
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();