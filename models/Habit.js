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

  // НОВЫЙ МЕТОД: Проверка, является ли пользователь создателем привычки
  static async isHabitOwner(habitId, userId) {
    const result = await db.query(
      `SELECT 
        CASE 
          WHEN h.parent_habit_id IS NULL THEN h.user_id = $2
          ELSE (SELECT user_id FROM habits WHERE id = h.parent_habit_id) = $2
        END as is_owner
       FROM habits h
       WHERE h.id = $1`,
      [habitId, userId]
    );
    
    return result.rows.length > 0 && result.rows[0].is_owner;
  }

  // НОВЫЙ МЕТОД: Получить ID родительской привычки (создателя)
  static async getParentHabitId(habitId) {
    const result = await db.query(
      `SELECT 
        CASE 
          WHEN h.parent_habit_id IS NULL THEN h.id
          ELSE h.parent_habit_id
        END as parent_id
       FROM habits h
       WHERE h.id = $1`,
      [habitId]
    );
    
    return result.rows.length > 0 ? result.rows[0].parent_id : null;
  }

  // ОБНОВЛЁННЫЙ МЕТОД: Обновление с синхронизацией для связанных привычек
  static async update(id, userId, updates) {
    const allowed = new Set([
      'category_id','title','goal','schedule_type','schedule_days',
      'reminder_time','reminder_enabled','is_bad_habit','is_active',
      'streak_current','streak_best'
    ]);

    // Проверяем, является ли пользователь создателем
    const isOwner = await this.isHabitOwner(id, userId);
    
    if (!isOwner) {
      throw new Error('Only the habit creator can edit this habit');
    }

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

    // Обновляем родительскую привычку
    const result = await db.query(
      `UPDATE habits 
       SET ${fields.join(', ')}
       WHERE id = $${i++} AND user_id = $${i}
       RETURNING *`,
      values
    );

    const updatedHabit = result.rows[0];

    // Синхронизируем изменения с дочерними привычками
    if (updatedHabit) {
      await this.syncChildHabits(id, updates);
    }

    return updatedHabit;
  }

  // НОВЫЙ МЕТОД: Синхронизация дочерних привычек
  static async syncChildHabits(parentHabitId, updates) {
    try {
      console.log(`🔄 Syncing child habits for parent ${parentHabitId}`);
      
      // Получаем ID родительской привычки (на случай если обновляем дочернюю)
      const actualParentId = await this.getParentHabitId(parentHabitId);
      
      if (!actualParentId) return;

      // Фильтруем поля, которые должны синхронизироваться
      const syncFields = {};
      const syncableFields = ['title', 'goal', 'category_id', 'schedule_type', 
                               'schedule_days', 'reminder_time', 'reminder_enabled'];
      
      Object.entries(updates).forEach(([key, value]) => {
        if (syncableFields.includes(key) && value !== undefined) {
          syncFields[key] = value;
        }
      });

      if (Object.keys(syncFields).length === 0) {
        console.log('No syncable fields to update');
        return;
      }

      // Строим запрос для обновления
      const fields = [];
      const values = [];
      let i = 1;

      Object.entries(syncFields).forEach(([key, value]) => {
        fields.push(`${key} = $${i++}`);
        values.push(value);
      });

      values.push(actualParentId);

      // Обновляем все дочерние привычки
      const updateResult = await db.query(
        `UPDATE habits 
         SET ${fields.join(', ')}
         WHERE parent_habit_id = $${i}
         AND id != $1
         RETURNING id, user_id`,
        [parentHabitId, ...values]
      );

      console.log(`✅ Synced ${updateResult.rowCount} child habits`);

      // Отправляем уведомления участникам об изменениях
      if (updateResult.rows.length > 0) {
        await this.notifyMembersAboutChanges(actualParentId, updateResult.rows);
      }

    } catch (error) {
      console.error('Error syncing child habits:', error);
      // Не пробрасываем ошибку, чтобы не блокировать основное обновление
    }
  }

  // НОВЫЙ МЕТОД: Уведомление участников об изменениях
  static async notifyMembersAboutChanges(parentHabitId, affectedUsers) {
    try {
      const bot = require('../server').bot;
      
      // Получаем информацию о привычке
      const habitInfo = await db.query(
        'SELECT title FROM habits WHERE id = $1',
        [parentHabitId]
      );
      
      if (habitInfo.rows.length === 0) return;
      
      const habitTitle = habitInfo.rows[0].title;

      // Отправляем уведомления каждому участнику
      for (const user of affectedUsers) {
        try {
          const userInfo = await db.query(
            'SELECT telegram_id, language FROM users WHERE id = $1',
            [user.user_id]
          );
          
          if (userInfo.rows.length === 0) continue;
          
          const { telegram_id, language } = userInfo.rows[0];
          const lang = language || 'en';
          
          const messages = {
            ru: `🔄 <b>Привычка обновлена!</b>\n\n` +
                `Создатель внёс изменения в привычку:\n` +
                `📝 <b>"${habitTitle}"</b>\n\n` +
                `Изменения автоматически применены к вашей копии привычки.`,
            en: `🔄 <b>Habit Updated!</b>\n\n` +
                `The creator made changes to the habit:\n` +
                `📝 <b>"${habitTitle}"</b>\n\n` +
                `Changes have been automatically applied to your habit copy.`,
            kk: `🔄 <b>Әдет жаңартылды!</b>\n\n` +
                `Жасаушы әдетке өзгерістер енгізді:\n` +
                `📝 <b>"${habitTitle}"</b>\n\n` +
                `Өзгерістер автоматты түрде сіздің әдеттіңізге қолданылды.`
          };
          
          const message = messages[lang] || messages['en'];
          
          await bot.sendMessage(telegram_id, message, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: lang === 'ru' ? '📱 Открыть приложение' : 
                        lang === 'kk' ? '📱 Қосымшаны ашу' : '📱 Open App',
                  web_app: { 
                    url: process.env.WEBAPP_URL || process.env.FRONTEND_URL 
                  }
                }
              ]]
            }
          });
          
          console.log(`✅ Notification sent to user ${user.user_id}`);
        } catch (notifyError) {
          console.error(`Failed to notify user ${user.user_id}:`, notifyError.message);
        }
        
        // Задержка между отправками
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error('Error notifying members:', error);
    }
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