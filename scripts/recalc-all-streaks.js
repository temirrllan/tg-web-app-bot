// Разовый пересчёт стриков всех активных привычек.
// Запуск: node scripts/recalc-all-streaks.js

require('dotenv').config();
const db = require('../config/database');
const HabitMark = require('../models/HabitMark');

(async () => {
  const start = Date.now();
  console.log('🔄 Recalculating streaks for all active habits...');

  try {
    const { rows } = await db.query(
      'SELECT id FROM habits WHERE is_active = true ORDER BY id'
    );

    console.log(`Found ${rows.length} active habits`);

    let ok = 0;
    let failed = 0;

    for (const habit of rows) {
      try {
        await HabitMark.recalculateStreak(habit.id);
        ok++;
      } catch (err) {
        failed++;
        console.error(`  ✗ habit ${habit.id} failed:`, err.message);
      }
      if ((ok + failed) % 100 === 0) {
        console.log(`  ... ${ok + failed}/${rows.length}`);
      }
    }

    console.log(`✅ Done in ${Math.round((Date.now() - start) / 1000)}s — ok=${ok} failed=${failed}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  }
})();
