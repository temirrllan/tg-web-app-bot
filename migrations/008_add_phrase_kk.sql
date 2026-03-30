-- Migration 008: Add Kazakh translations for motivational phrases

ALTER TABLE motivational_phrases ADD COLUMN IF NOT EXISTS phrase_kk TEXT;

UPDATE motivational_phrases SET phrase_kk = CASE phrase_en
  -- encouragement
  WHEN 'Start right now!' THEN 'Дәл қазір баста!'
  WHEN 'You can do it!' THEN 'Сен қолыңнан келеді!'
  WHEN 'Take the first step!' THEN 'Алғашқы қадамыңды жаса!'
  WHEN 'Believe in yourself!' THEN 'Өзіңе сен!'
  WHEN 'Today is your day!' THEN 'Бүгін сенің күнің!'
  -- success (1-2)
  WHEN 'Great start!' THEN 'Тамаша бастама!'
  WHEN 'Keep it up!' THEN 'Осылай жалғастыр!'
  WHEN 'You''re on the right track!' THEN 'Сен дұрыс жолдасың!'
  WHEN 'Keep going!' THEN 'Жалғастыр!'
  WHEN 'Good progress!' THEN 'Жақсы прогресс!'
  -- success (3-4)
  WHEN 'You''re doing great!' THEN 'Сен керемет жұмыс істеп жатырсың!'
  WHEN 'Excellent!' THEN 'Өте жақсы!'
  WHEN 'Amazing!' THEN 'Таңғажайып!'
  WHEN 'Incredible progress!' THEN 'Керемет прогресс!'
  WHEN 'You rock!' THEN 'Сен зорсың!'
  -- streak
  WHEN 'Don''t stop now!' THEN 'Тоқтама!'
  WHEN 'You''re on fire!' THEN 'Сен отқа айналдың!'
  WHEN 'Amazing streak!' THEN 'Керемет серия!'
  WHEN 'Unstoppable!' THEN 'Тоқтатуға болмайды!'
  -- perfect
  WHEN 'All done! Incredible!' THEN 'Бәрі орындалды! Керемет!'
  WHEN 'Perfect day!' THEN 'Мінсіз күн!'
  WHEN 'You''re a champion!' THEN 'Сен чемпионсың!'
  WHEN 'Flawless!' THEN 'Мінсіз!'
  WHEN 'Legend!' THEN 'Аңыз!'
  WHEN 'Superhero of the day!' THEN 'Күннің супер батыры!'
  WHEN 'Mission complete!' THEN 'Мақсат орындалды!'
  WHEN '100% done!' THEN '100% орындалды!'
  WHEN 'You nailed it all!' THEN 'Бәрін орындадың!'
  WHEN 'Magnificent work!' THEN 'Ғажайып жұмыс!'
  ELSE phrase_en
END
WHERE phrase_kk IS NULL;
