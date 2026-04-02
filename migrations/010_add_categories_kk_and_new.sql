-- 010: Add name_kk column to categories + new categories + remove duplicates

-- 0. Remove duplicate categories (keep lowest id for each sort_order)
DELETE FROM categories
WHERE id NOT IN (
  SELECT MIN(id) FROM categories GROUP BY sort_order
);

-- 1. Add Kazakh language column
ALTER TABLE categories ADD COLUMN IF NOT EXISTS name_kk VARCHAR(50);

-- 2. Fill name_kk for existing categories
UPDATE categories SET name_kk = 'Спорт' WHERE sort_order = 1;
UPDATE categories SET name_kk = 'Денсаулық' WHERE sort_order = 2;
UPDATE categories SET name_kk = 'Су' WHERE sort_order = 3;
UPDATE categories SET name_kk = 'Йога' WHERE sort_order = 4;
UPDATE categories SET name_kk = 'Медитация' WHERE sort_order = 5;
UPDATE categories SET name_kk = 'Оқу' WHERE sort_order = 6;
UPDATE categories SET name_kk = 'Оқу-білім' WHERE sort_order = 7;
UPDATE categories SET name_kk = 'Тамақтану' WHERE sort_order = 8;
UPDATE categories SET name_kk = 'Ұйқы' WHERE sort_order = 9;
UPDATE categories SET name_kk = 'Басқа' WHERE sort_order = 10;

-- 3. Insert new categories (skip if sort_order already exists)
INSERT INTO categories (name_ru, name_en, name_kk, icon, color, sort_order)
SELECT * FROM (VALUES
    ('Финансы', 'Finance', 'Қаржы', '💰', '#F97316', 11),
    ('Продуктивность', 'Productivity', 'Өнімділік', '⚡', '#0EA5E9', 12),
    ('Социальные', 'Social', 'Әлеуметтік', '👥', '#EC4899', 13),
    ('Творчество', 'Creativity', 'Шығармашылық', '🎨', '#D946EF', 14),
    ('Уход за собой', 'Self-care', 'Өзіне күтім', '🪥', '#F472B6', 15),
    ('Психология', 'Mental Health', 'Психология', '🧠', '#7C3AED', 16),
    ('Языки', 'Languages', 'Тілдер', '🌍', '#06B6D4', 17),
    ('Работа', 'Work', 'Жұмыс', '💼', '#64748B', 18),
    ('Дом', 'Home', 'Үй', '🏠', '#78716C', 19),
    ('Без экранов', 'Digital Detox', 'Сандық тазалау', '📵', '#1E293B', 20),
    ('Прогулки', 'Walking', 'Серуендеу', '🚶', '#22C55E', 21),
    ('Питомцы', 'Pets', 'Үй жануарлары', '🐾', '#A16207', 22),
    ('Духовность', 'Spirituality', 'Рухaniят', '🙏', '#9333EA', 23)
) AS new_cats(name_ru, name_en, name_kk, icon, color, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM categories WHERE categories.sort_order = new_cats.sort_order
);
