const db = require('../config/database');

class HabitMark {
  static async mark(habitId, date, status) {
    console.log('HabitMark.mark called:', { habitId, date, status });
    
    // Валидация статуса
    const validStatuses = ['completed', 'failed', 'skipped'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    // Убедимся, что дата в правильном формате
    const formattedDate = this.formatDate(date);
    console.log('Formatted date:', formattedDate);

    try {
      // Используем UPSERT для создания или обновления отметки
      const result = await db.query(
        `INSERT INTO habit_marks (habit_id, date, status, marked_at) 
         VALUES ($1, $2::date, $3, CURRENT_TIMESTAMP) 
         ON CONFLICT (habit_id, date) 
         DO UPDATE SET 
           status = EXCLUDED.status, 
           marked_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [habitId, formattedDate, status]
      );

      console.log('Mark saved:', {
        id: result.rows[0].id,
        habit_id: result.rows[0].habit_id,
        date: result.rows[0].date,
        status: result.rows[0].status
      });

      // Обновляем streak только для completed/failed
      if (status === 'completed') {
        await this.updateStreak(habitId, true);
      } else if (status === 'failed') {
        await this.updateStreak(habitId, false);
      }
      // Для skipped не меняем streak

      return result.rows[0];
    } catch (error) {
      console.error('Error saving mark:', error);
      throw error;
    }
  }

  static async updateStreak(habitId, isCompleted) {
    console.log('Updating streak:', { habitId, isCompleted });
    
    try {
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
        // Сбрасываем текущий streak для failed
        await db.query(
          'UPDATE habits SET streak_current = 0 WHERE id = $1',
          [habitId]
        );
      }
    } catch (error) {
      console.error('Error updating streak:', error);
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

    try {
      const result = await db.query(
        'DELETE FROM habit_marks WHERE habit_id = $1 AND date = $2::date RETURNING *',
        [habitId, formattedDate]
      );

      if (result.rowCount > 0) {
        console.log('Mark deleted:', result.rows[0]);
        // Пересчитываем streak
        await this.recalculateStreak(habitId);
      } else {
        console.log('No mark found to delete');
      }

      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting mark:', error);
      throw error;
    }
  }

  static async recalculateStreak(habitId) {
    console.log('Recalculating streak for habit:', habitId);
    
    try {
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
    } catch (error) {
      console.error('Error recalculating streak:', error);
    }
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
       AND date >= $2::date 
       AND date <= $3::date
       ORDER BY date DESC`,
      [habitId, startDate, endDate]
    );

    return result.rows;
  }
}

module.exports = HabitMark;