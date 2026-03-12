const db = require('../config/database');

class HabitMark {
  static async mark(habitId, date, status) {
    console.log('HabitMark.mark called:', { habitId, date, status });
    
    // Валидация статуса
    const validStatuses = ['completed', 'failed', 'skipped'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    // ВАЖНО: Форматируем дату правильно, учитывая часовой пояс
    const formattedDate = this.formatDate(date);
    console.log('Formatted date for marking:', formattedDate);

    try {
      // Используем UPSERT для создания или обновления отметки
      // ВАЖНО: Явно указываем тип date при вставке
      const result = await db.query(
        `INSERT INTO habit_marks (habit_id, date, status, marked_at) 
         VALUES ($1, $2::date, $3, CURRENT_TIMESTAMP) 
         ON CONFLICT (habit_id, date) 
         DO UPDATE SET 
           status = EXCLUDED.status, 
           marked_at = CURRENT_TIMESTAMP
         RETURNING id, habit_id, date::text as date, status, marked_at`,
        [habitId, formattedDate, status]
      );

      console.log('Mark saved:', {
        id: result.rows[0].id,
        habit_id: result.rows[0].habit_id,
        date: result.rows[0].date,
        status: result.rows[0].status
      });

      // Всегда пересчитываем стрик из реальных данных — никакого +1 вслепую.
      // Это защищает от дублей при быстрой смене статусов.
      await this.recalculateStreak(habitId);

      return result.rows[0];
    } catch (error) {
      console.error('Error saving mark:', error);
      throw error;
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

      // ВАЖНО: Создаем даты в локальном часовом поясе
      const today = new Date();
      // Обнуляем время для корректного сравнения дат
      today.setHours(0, 0, 0, 0);
      
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      // Парсим целевую дату правильно
      const [year, month, day] = date.split('-').map(Number);
      const targetDate = new Date(year, month - 1, day);
      targetDate.setHours(0, 0, 0, 0);
      
      // Проверяем, что дата не в будущем
      if (targetDate > today) {
        console.log('Date is in the future');
        return false;
      }
      
      // Проверяем, что дата не раньше вчерашнего дня
      const canMark = targetDate >= yesterday;
      console.log('Can mark result:', canMark, {
        target: this.formatDate(targetDate),
        yesterday: this.formatDate(yesterday),
        today: this.formatDate(today)
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
      const result = await db.query(
        `SELECT date::text AS date
         FROM habit_marks
         WHERE habit_id = $1 AND status = 'completed'
         ORDER BY date DESC`,
        [habitId]
      );

      let currentStreak = 0;

      if (result.rows.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        // Берём самую последнюю выполненную дату
        const latestMark = new Date(result.rows[0].date + 'T00:00:00');

        // Стрик активен только если последняя отметка — сегодня или вчера
        // (если позавчера и раньше — стрик уже прерван)
        if (latestMark >= yesterday) {
          // Считаем подряд идущие дни НАЗАД от самой последней отметки
          for (let i = 0; i < result.rows.length; i++) {
            const markDate = new Date(result.rows[i].date + 'T00:00:00');
            const expected = new Date(latestMark);
            expected.setDate(latestMark.getDate() - i);

            if (markDate.toDateString() === expected.toDateString()) {
              currentStreak++;
            } else {
              break; // цепочка прервалась
            }
          }
        }
      }

      await db.query(
        `UPDATE habits
         SET streak_current = $1,
             streak_best = GREATEST(streak_best, $1)
         WHERE id = $2`,
        [currentStreak, habitId]
      );

      console.log(`Streak recalculated: ${currentStreak} for habit ${habitId}`);
    } catch (error) {
      console.error('Error recalculating streak:', error);
    }
  }

  // ВАЖНО: Улучшенная функция форматирования даты
  static formatDate(date) {
    if (!date) {
      // Если дата не указана, возвращаем сегодня в формате YYYY-MM-DD
      const today = new Date();
      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    }
    
    // Если уже в формате YYYY-MM-DD, возвращаем как есть
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    
    // Если это объект Date
    if (date instanceof Date) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    
    // Пытаемся распарсить строку даты
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date format: ${date}`);
    }
    
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  static async getHabitMarks(habitId, startDate, endDate) {
    const result = await db.query(
      `SELECT date::text as date, status 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND date >= $2::date 
       AND date <= $3::date
       ORDER BY date DESC`,
      [habitId, startDate, endDate]
    );

    return result.rows;
  }

  // Новый метод для получения отметки на конкретную дату
  static async getMarkForDate(habitId, date) {
    const formattedDate = this.formatDate(date);
    
    const result = await db.query(
      `SELECT id, status, date::text as date, marked_at
       FROM habit_marks 
       WHERE habit_id = $1 
       AND date = $2::date`,
      [habitId, formattedDate]
    );

    return result.rows[0] || null;
  }
}

module.exports = HabitMark;