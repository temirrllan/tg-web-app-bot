const db = require('../config/database');

class AchievementService {
  // Проверить и наградить достижениями за серию
  async checkAndAwardStreakAchievements(userId) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Получаем текущую серию пользователя
      const streakResult = await client.query(
        'SELECT perfect_day_streak_current FROM user_streaks WHERE user_id = $1',
        [userId]
      );
      
      if (streakResult.rows.length === 0) {
        // Инициализируем серию
        await client.query(
          `INSERT INTO user_streaks (user_id, perfect_day_streak_current)
           VALUES ($1, 0)`,
          [userId]
        );
        await client.query('COMMIT');
        return;
      }
      
      const currentStreak = streakResult.rows[0].perfect_day_streak_current;
      
      // Получаем достижения для серий
      const achievementsResult = await client.query(
        `SELECT * FROM achievements 
         WHERE type = 'perfect_day_streak' 
         AND threshold <= $1
         AND is_active = true`,
        [currentStreak]
      );
      
      // Проверяем, какие уже получены
      for (const achievement of achievementsResult.rows) {
        const hasAchievement = await client.query(
          `SELECT id FROM user_achievements 
           WHERE user_id = $1 AND achievement_id = $2`,
          [userId, achievement.id]
        );
        
        if (hasAchievement.rows.length === 0) {
          // Награждаем
          await client.query(
            `INSERT INTO user_achievements (user_id, achievement_id, meta_json)
             VALUES ($1, $2, $3)`,
            [
              userId,
              achievement.id,
              JSON.stringify({ streak_at_award: currentStreak })
            ]
          );
          
          console.log(`🏆 User ${userId} earned achievement: ${achievement.title}`);
          
          // Отправляем уведомление
          await this.notifyAchievement(userId, achievement);
        }
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error checking achievements:', error);
    } finally {
      client.release();
    }
  }

  async notifyAchievement(userId, achievement) {
    try {
      const bot = require('../server').bot;
      
      const userResult = await db.query(
        'SELECT telegram_id, first_name FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length === 0) return;
      
      const user = userResult.rows[0];
      
      const message = `🏆 <b>Achievement Unlocked!</b>\n\n` +
        `<b>${achievement.title}</b>\n` +
        `${achievement.description}\n\n` +
        `Keep up the great work! 💪`;
      
      await bot.sendMessage(user.telegram_id, message, {
        parse_mode: 'HTML'
      });
    } catch (error) {
      console.error('Failed to send achievement notification:', error);
    }
  }

  // Обновить серию "идеального дня"
  async updatePerfectDayStreak(userId) {
    const today = new Date().toISOString().split('T')[0];
    
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Получаем все привычки пользователя на сегодня
      const habitsResult = await client.query(
        `SELECT h.id, COALESCE(hm.status, 'pending') as status
         FROM habits h
         LEFT JOIN habit_marks hm ON (hm.habit_id = h.id AND hm.date = $2::date)
         WHERE h.user_id = $1 
         AND h.is_active = true
         AND h.is_bad_habit = false`, // bad habits не считаются
        [userId, today]
      );
      
      const habits = habitsResult.rows;
      const allCompleted = habits.length > 0 && 
        habits.every(h => h.status === 'completed');
      
      // Получаем текущую серию
      let streakResult = await client.query(
        'SELECT * FROM user_streaks WHERE user_id = $1',
        [userId]
      );
      
      if (streakResult.rows.length === 0) {
        // Создаём запись
        await client.query(
          `INSERT INTO user_streaks (user_id, perfect_day_streak_current, last_checked_date)
           VALUES ($1, 0, $2)`,
          [userId, today]
        );
        
        streakResult = await client.query(
          'SELECT * FROM user_streaks WHERE user_id = $1',
          [userId]
        );
      }
      
      const streak = streakResult.rows[0];
      
      if (allCompleted && streak.last_checked_date !== today) {
        // Увеличиваем серию
        const newCurrent = streak.perfect_day_streak_current + 1;
        const newBest = Math.max(newCurrent, streak.perfect_day_streak_best);
        
        await client.query(
          `UPDATE user_streaks 
           SET perfect_day_streak_current = $2,
               perfect_day_streak_best = $3,
               last_checked_date = $4
           WHERE user_id = $1`,
          [userId, newCurrent, newBest, today]
        );
        
        console.log(`✨ Perfect day streak for user ${userId}: ${newCurrent}`);
        
        // Проверяем достижения
        await this.checkAndAwardStreakAchievements(userId);
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating perfect day streak:', error);
    } finally {
      client.release();
    }
  }
}

module.exports = new AchievementService();