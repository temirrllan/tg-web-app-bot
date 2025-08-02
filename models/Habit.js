const db = require('../config/database');

class Habit {
  static async create(userId, habitData) {
    const {
      category_id,
      title,
      goal,
      schedule_type = 'daily',
      schedule_days = [1, 2, 3, 4, 5, 6, 7],
      reminder_time,
      reminder_enabled = true,
      is_bad_habit = false
    } = habitData;
console.log('Habit.create called with:', {
      userId,
      category_id,
      title,
      goal,
      schedule_type,
      schedule_days,
      reminder_time,
      reminder_enabled,
      is_bad_habit
    });

     try {
      const result = await db.query(
        `INSERT INTO habits 
         (user_id, category_id, title, goal, schedule_type, schedule_days, 
          reminder_time, reminder_enabled, is_bad_habit) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING *`,
        [
          userId, 
          category_id || null, 
          title, 
          goal, 
          schedule_type, 
          schedule_days, 
          reminder_time || null, 
          reminder_enabled, 
          is_bad_habit
        ]
      );

    return result.rows[0];
    } catch (error) {
      console.error('Database error in Habit.create:', error);
      throw error;
    }
  }

  static async findByUserId(userId) {
    const result = await db.query(
      `SELECT h.*, c.name_ru, c.name_en, c.icon, c.color
       FROM habits h
       LEFT JOIN categories c ON h.category_id = c.id
       WHERE h.user_id = $1 AND h.is_active = true
       ORDER BY h.created_at DESC`,
      [userId]
    );

    return result.rows;
  }

  static async findById(id, userId) {
    const result = await db.query(
      `SELECT h.*, c.name_ru, c.name_en, c.icon, c.color
       FROM habits h
       LEFT JOIN categories c ON h.category_id = c.id
       WHERE h.id = $1 AND h.user_id = $2`,
      [id, userId]
    );

    return result.rows[0];
  }

  static async getTodayHabits(userId) {
    const dayOfWeek = new Date().getDay() || 7; // 1-7

    const result = await db.query(
      `SELECT 
        h.*,
        c.name_ru, c.name_en, c.icon, c.color,
        COALESCE(m.status, 'pending') as today_status,
        m.id as mark_id
      FROM habits h
      LEFT JOIN categories c ON h.category_id = c.id
      LEFT JOIN habit_marks m ON h.id = m.habit_id 
        AND m.date = CURRENT_DATE
      WHERE 
        h.user_id = $1 
        AND h.is_active = true
        AND $2 = ANY(h.schedule_days)
      ORDER BY h.created_at DESC`,
      [userId, dayOfWeek]
    );

    return result.rows;
  }

  static async update(id, userId, updates) {
    const fields = [];
    const values = [];
    let index = 1;

    // Динамически строим запрос
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = $${index}`);
        values.push(value);
        index++;
      }
    });

    values.push(id, userId);

    const result = await db.query(
      `UPDATE habits 
       SET ${fields.join(', ')}
       WHERE id = $${index} AND user_id = $${index + 1}
       RETURNING *`,
      values
    );

    return result.rows[0];
  }

  static async delete(id, userId) {
    const result = await db.query(
      'DELETE FROM habits WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    return result.rowCount > 0;
  }

  static async countActive(userId) {
    const result = await db.query(
      'SELECT COUNT(*) FROM habits WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    return parseInt(result.rows[0].count);
  }
}

module.exports = Habit;