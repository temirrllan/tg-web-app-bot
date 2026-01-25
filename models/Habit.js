// models/Habit.js - ПОЛНЫЙ КОД с day_period

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
      is_bad_habit = false,
      day_period = 'morning' // 🆕 Добавили day_period
    } = habitData;

    try {
      const result = await db.query(
        `INSERT INTO habits
         (user_id, creator_id, category_id, title, goal, schedule_type, schedule_days,
          reminder_time, reminder_enabled, is_bad_habit, day_period)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          userId,
          userId, // creator_id = user_id для новых привычек
          category_id || null,
          title,
          goal,
          schedule_type,
          schedule_days,
          reminder_time || null,
          reminder_enabled,
          is_bad_habit,
          day_period // 🆕 Передаём day_period
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
         COALESCE(m.status, 'pending') AS today_status,
         m.id AS mark_id
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
    const allowed = new Set([
      'category_id','title','goal','schedule_type','schedule_days',
      'reminder_time','reminder_enabled','is_bad_habit','is_active',
      'streak_current','streak_best','day_period' // 🆕 Добавили day_period
    ]);

    const fields = [];
    const values = [];
    let i = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined && allowed.has(key)) {
        fields.push(`${key} = $${i++}`);
        values.push(value);
      }
    });

    if (fields.length === 0) {
      const existing = await db.query(
        'SELECT * FROM habits WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      return existing.rows[0] || null;
    }

    values.push(id, userId);

    const result = await db.query(
      `UPDATE habits 
       SET ${fields.join(', ')}
       WHERE id = $${i++} AND user_id = $${i}
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
    return parseInt(result.rows[0].count, 10);
  }
}

module.exports = Habit;