const db = require('../config/database');

class HabitMark {
  static async mark(habitId, date, status) {
    console.log('HabitMark.mark called:', { habitId, date, status });
    
    // Валидация статуса
    const validStatuses = ['completed', 'failed', 'skipped'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    // Убедимся, что дата в правильном формате
    const formattedDate = this.formatDate(date);
    console.log('Formatted date:', formattedDate);

    const result = await db.query(
      `INSERT INTO habit_marks (habit_id, date, status) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (habit_id, date) 
       DO UPDATE SET status = $3, marked_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [habitId, formattedDate, status]
    );

    // Обновляем streak если отметка completed
    if (status === 'completed') {
      await this.updateStreak(habitId, true);
    } else if (status === 'failed' || status === 'skipped') {
      await this.updateStreak(habitId, false);
    }

    return result.rows[0];
  }

  static async updateStreak(habitId, isCompleted) {
    console.log('Updating streak:', { habitId, isCompleted });
    
    if (isCompleted) {
      // Увеличиваем текущий streak
      await db.query(
        `UPDATE habits 
         SET streak_current = streak_current + 1,
             streak_best = GREATEST(streak_current + 1, streak_best)
         WHERE id = $1`,
        [habitId]
      );
    } else {
      // Сбрасываем текущий streak
      await db.query(
        'UPDATE habits SET streak_current = 0 WHERE id = $1',
        [habitId]
      );
    }
  }

  static async canMark(date) {
    try {
      console.log('Checking if can mark date:', date);
      
      // Обрабатываем случай, когда дата не указана
      if (!date) {
        console.log('No date provided, using today');
        return true; // Разрешаем отметку на сегодня
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);
      
      // Проверяем, что дата не в будущем
      if (targetDate > today) {
        console.log('Date is in the future');
        return false;
      }
      
      // Проверяем, что дата не раньше вчерашнего дня
      const canMark = targetDate >= yesterday;
      console.log('Can mark result:', canMark, {
        target: targetDate.toISOString(),
        yesterday: yesterday.toISOString(),
        today: today.toISOString()
      });
      
      return canMark;
    } catch (error) {
      console.error('Error in canMark:', error);
      return false;
    }
  }

  static async deleteMark(habitId, date) {
    // Валидация даты
    if (!date) {
      throw new Error('Date is required');
    }

    const formattedDate = this.formatDate(date);
    console.log('Deleting mark for:', { habitId, date: formattedDate });

    const result = await db.query(
      'DELETE FROM habit_marks WHERE habit_id = $1 AND date = $2 RETURNING *',
      [habitId, formattedDate]
    );

    if (result.rowCount > 0) {
      // Пересчитываем streak
      await this.recalculateStreak(habitId);
    }

    return result.rowCount > 0;
  }

  static async recalculateStreak(habitId) {
    console.log('Recalculating streak for habit:', habitId);
    
    // Получаем последние отметки для пересчета streak
    const result = await db.query(
      `SELECT date, status 
       FROM habit_marks 
       WHERE habit_id = $1 AND status = 'completed'
       ORDER BY date DESC`,
      [habitId]
    );

    let currentStreak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Проверяем непрерывность выполнения с сегодняшнего дня назад
    for (let i = 0; i < result.rows.length; i++) {
      const markDate = new Date(result.rows[i].date);
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - i);

      if (markDate.toDateString() === expectedDate.toDateString()) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Обновляем streak в таблице habits
    await db.query(
      'UPDATE habits SET streak_current = $1 WHERE id = $2',
      [currentStreak, habitId]
    );
  }

  static formatDate(date) {
    if (!date) {
      return new Date().toISOString().split('T')[0];
    }
    
    // Если уже в формате YYYY-MM-DD, возвращаем как есть
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    
    // Иначе конвертируем
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  }

  static async getHabitMarks(habitId, startDate, endDate) {
    const result = await db.query(
      `SELECT date, status 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND date >= $2 
       AND date <= $3
       ORDER BY date DESC`,
      [habitId, startDate, endDate]
    );

    return result.rows;
  }
}

module.exports = HabitMark;