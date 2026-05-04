const cron = require('node-cron');
const db = require('../config/database');
const HabitMark = require('../models/HabitMark');
const { TIMEZONE } = require('../utils/dateHelper');

// Ежедневный пересчёт стриков всех активных привычек.
// Решает «тающий стрик»: значение в БД не уменьшалось пока юзер не отметит,
// поэтому пользователь мог видеть устаревший стрик через несколько дней
// после пропуска. Cron запускается в 00:10 по Asia/Almaty — после полуночи
// все вчерашние пропуски корректно схлопываются в реальный стрик.
class StreakCronService {
  constructor() {
    this.task = null;
  }

  start() {
    this.task = cron.schedule('10 0 * * *', async () => {
      console.log('🔄 Daily streak recalculation started...');
      try {
        const { ok, failed, total } = await this.recalcAll();
        console.log(`✅ Streak recalc done: ${ok}/${total} ok, ${failed} failed`);
      } catch (err) {
        console.error('❌ Error in streak cron job:', err);
      }
    }, {
      scheduled: true,
      timezone: TIMEZONE,
    });

    console.log('⏰ Streak cron service started (daily at 00:10 Asia/Almaty)');

    // Дополнительный пересчёт через 30 секунд после старта сервера —
    // на случай deploy в середине дня, чтобы стрики обновились сразу,
    // не дожидаясь ближайшей полуночи.
    setTimeout(() => {
      this.recalcAll().catch(err =>
        console.error('Initial streak recalc failed:', err)
      );
    }, 30000);
  }

  async recalcAll() {
    const { rows } = await db.query(
      'SELECT id FROM habits WHERE is_active = true'
    );

    let ok = 0;
    let failed = 0;
    for (const habit of rows) {
      try {
        await HabitMark.recalculateStreak(habit.id);
        ok++;
      } catch (err) {
        failed++;
        console.error(`Streak recalc failed for habit ${habit.id}:`, err.message);
      }
    }
    return { ok, failed, total: rows.length };
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('⏰ Streak cron service stopped');
    }
  }
}

module.exports = new StreakCronService();
