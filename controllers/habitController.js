const Phrase = require('../models/Phrase');
const Habit = require('../models/Habit');
const HabitMark = require('../models/HabitMark');
// const Phrase = require('../models/Phrase');
const db = require('../config/database');
// В начале файла после существующих импортов добавьте:
const Habit = require('../models/Habit');
const habitController = {
  async create(req, res) {
    console.log('🎯 habitController.create called');
    
    try {
      // Проверка аутентификации
      if (!req.user) {
        console.error('❌ No user in request');
        return res.status(401).json({
          success: false,
          error: 'User not authenticated'
        });
      }

      const userId = req.user.id;
      const habitData = req.body;

      console.log('Creating habit for user:', userId);
      console.log('User details:', {
        id: req.user.id,
        username: req.user.username,
        telegram_id: req.user.telegram_id
      });
      console.log('Habit data received:', JSON.stringify(habitData, null, 2));

      // Валидация обязательных полей
      if (!habitData.title || habitData.title.trim() === '') {
        console.error('❌ Validation failed: title is required');
        return res.status(400).json({
          success: false,
          error: 'Title is required'
        });
      }

      if (!habitData.goal || habitData.goal.trim() === '') {
        console.error('❌ Validation failed: goal is required');
        return res.status(400).json({
          success: false,
          error: 'Goal is required'
        });
      }

      // Обработка bad habit согласно ТЗ
      if (habitData.is_bad_habit) {
        console.log('📌 Processing bad habit - simplifying data');
        habitData.schedule_type = 'daily';
        habitData.schedule_days = [1, 2, 3, 4, 5, 6, 7];
        habitData.reminder_enabled = false;
        habitData.category_id = null;
        habitData.reminder_time = null;
      } else {
        // Для обычных привычек проверяем дополнительные поля
        if (!habitData.category_id) {
          console.error('❌ Validation failed: category is required for good habits');
          return res.status(400).json({
            success: false,
            error: 'Category is required for good habits'
          });
        }

        // Проверяем расписание
        if (!habitData.schedule_days || habitData.schedule_days.length === 0) {
          console.log('⚠️ No schedule days provided, using default (all days)');
          habitData.schedule_days = [1, 2, 3, 4, 5, 6, 7];
        }

        // Проверяем тип расписания
        if (!habitData.schedule_type) {
          console.log('⚠️ No schedule type provided, using default (daily)');
          habitData.schedule_type = 'daily';
        }
      }

      console.log('Final habit data to create:', JSON.stringify(habitData, null, 2));

      // Создаем привычку
      const habit = await Habit.create(userId, habitData);
      
      if (!habit) {
        throw new Error('Failed to create habit in database');
      }

      console.log('✅ Habit created successfully:', {
        id: habit.id,
        title: habit.title,
        user_id: habit.user_id
      });
      
      res.status(201).json({
        success: true,
        habit
      });
    } catch (error) {
      console.error('💥 Create habit error:', error.message);
      console.error('Error stack:', error.stack);
      
      // Проверяем специфические ошибки базы данных
      if (error.code === '23505') { // Unique violation
        return res.status(400).json({ 
          success: false, 
          error: 'A habit with this name already exists'
        });
      }
      
      if (error.code === '23503') { // Foreign key violation
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid category selected'
        });
      }
      
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to create habit',
        details: process.env.NODE_ENV !== 'production' ? error.stack : undefined
      });
    }
  },

  async getAll(req, res) {
    console.log('🎯 habitController.getAll called');
    
    try {
      if (!req.user) {
        console.error('❌ No user in request');
        return res.status(401).json({
          success: false,
          error: 'User not authenticated'
        });
      }

      const userId = req.user.id;
      console.log('Getting all habits for user:', userId);
      
      const habits = await Habit.findByUserId(userId);
      console.log(`✅ Found ${habits.length} habits for user ${userId}`);
      
      // Логируем первые несколько привычек для отладки
      if (habits.length > 0) {
        console.log('Sample habit:', {
          id: habits[0].id,
          title: habits[0].title,
          is_active: habits[0].is_active
        });
      }
      
      res.json({
        success: true,
        habits,
        count: habits.length
      });
    } catch (error) {
      console.error('💥 Get habits error:', error.message);
      console.error('Error stack:', error.stack);
      
      res.status(500).json({ 
        success: false, 
        error: 'Failed to load habits',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined
      });
    }
  },

async getTodayHabits(req, res) {
  console.log('🎯 habitController.getTodayHabits called');
  
  try {
    if (!req.user) {
      console.error('❌ No user in request');
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const userId = req.user.id;
    const today = new Date();
    const dayOfWeek = today.getDay() || 7; // 0 (Sunday) becomes 7
    const todayDate = today.toISOString().split('T')[0];
    
    console.log('Getting today habits for user:', userId);
    console.log('Today is:', {
      date: todayDate,
      dayOfWeek: dayOfWeek,
      dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][today.getDay()]
    });
    
    // Получаем привычки на сегодня по расписанию с их статусами
    const result = await db.query(
      `SELECT 
        h.id,
        h.user_id,
        h.category_id,
        h.title,
        h.goal,
        h.schedule_type,
        h.schedule_days,
        h.reminder_time,
        h.reminder_enabled,
        h.is_bad_habit,
        h.streak_current,
        h.streak_best,
        h.is_active,
        h.parent_habit_id,
        h.created_at,
        h.updated_at,
        c.name_ru, 
        c.name_en, 
        c.icon as category_icon, 
        c.color,
        COALESCE(hm.status, 'pending') as today_status,
        hm.id as mark_id,
        hm.marked_at,
        -- Подсчитываем участников для связанных привычек
        CASE 
          WHEN h.parent_habit_id IS NOT NULL THEN
            (SELECT COUNT(DISTINCT user_id) - 1 FROM habit_members 
             WHERE habit_id IN (
               SELECT id FROM habits 
               WHERE parent_habit_id = h.parent_habit_id OR id = h.parent_habit_id
             ) AND is_active = true)
          ELSE
            (SELECT COUNT(DISTINCT user_id) - 1 FROM habit_members 
             WHERE habit_id IN (
               SELECT id FROM habits 
               WHERE parent_habit_id = h.id OR id = h.id
             ) AND is_active = true)
        END as members_count
       FROM habits h
       LEFT JOIN categories c ON h.category_id = c.id
       LEFT JOIN habit_marks hm ON (
         hm.habit_id = h.id 
         AND hm.date = $3::date
       )
       WHERE 
         h.user_id = $1 
         AND h.is_active = true
         AND $2 = ANY(h.schedule_days)
       ORDER BY h.created_at DESC`,
      [userId, dayOfWeek, todayDate]
    );
    
    console.log(`✅ Found ${result.rows.length} habits for today`);
    
    // Логируем статусы для отладки
    result.rows.forEach(h => {
      console.log(`Habit "${h.title}" (ID: ${h.id}) - Status: ${h.today_status}, Mark ID: ${h.mark_id}`);
    });
    
    // Считаем статистику
    const completedCount = result.rows.filter(h => h.today_status === 'completed').length;
    const failedCount = result.rows.filter(h => h.today_status === 'failed').length;
    const skippedCount = result.rows.filter(h => h.today_status === 'skipped').length;
    const pendingCount = result.rows.filter(h => h.today_status === 'pending').length;
    const totalCount = result.rows.length;
    
    console.log('Statistics:', {
      total: totalCount,
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
      pending: pendingCount
    });

    // Получаем мотивационную фразу с учетом прогресса и цвета фона
    const language = req.user.language || 'en';
    const phrase = await Phrase.getRandomPhrase(language, completedCount, totalCount);

    res.json({
      success: true,
      habits: result.rows,
      stats: {
        completed: completedCount,
        total: totalCount,
        failed: failedCount,
        skipped: skippedCount,
        pending: pendingCount
      },
      phrase
    });
  } catch (error) {
    console.error('💥 Get today habits error:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load today habits',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
},

  async update(req, res) {
  console.log('🎯 habitController.update called');
  
  try {
    if (!req.user) {
      console.error('❌ No user in request');
      return res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
    }

    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    console.log('Updating habit:', {
      habitId: id,
      userId: userId,
      updates: updates
    });

    // Проверяем, является ли пользователь создателем
    const isOwner = await Habit.isHabitOwner(id, userId);
    
    if (!isOwner) {
      console.log('❌ User is not the habit creator');
      return res.status(403).json({
        success: false,
        error: 'Only the habit creator can edit this habit',
        isOwner: false
      });
    }

    // Валидация обновляемых полей
    if (updates.title !== undefined && (!updates.title || updates.title.trim() === '')) {
      return res.status(400).json({
        success: false,
        error: 'Title cannot be empty'
      });
    }

    if (updates.goal !== undefined && (!updates.goal || updates.goal.trim() === '')) {
      return res.status(400).json({
        success: false,
        error: 'Goal cannot be empty'
      });
    }

    const habit = await Habit.update(id, userId, updates);
    
    if (!habit) {
      console.log('❌ Habit not found or user not authorized');
      return res.status(404).json({ 
        success: false, 
        error: 'Habit not found' 
      });
    }

    console.log('✅ Habit updated successfully and synced with members');

    res.json({
      success: true,
      habit,
      synced: true // Указываем, что изменения синхронизированы
    });
  } catch (error) {
    console.error('💥 Update habit error:', error.message);
    console.error('Error stack:', error.stack);
    
    // Проверяем специфическую ошибку прав доступа
    if (error.message === 'Only the habit creator can edit this habit') {
      return res.status(403).json({
        success: false,
        error: error.message,
        isOwner: false
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update habit',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
},

  async delete(req, res) {
    console.log('🎯 habitController.delete called');
    
    try {
      if (!req.user) {
        console.error('❌ No user in request');
        return res.status(401).json({
          success: false,
          error: 'User not authenticated'
        });
      }

      const { id } = req.params;
      const userId = req.user.id;

      console.log('Deleting habit:', {
        habitId: id,
        userId: userId
      });

      const deleted = await Habit.delete(id, userId);
      
      if (!deleted) {
        console.log('❌ Habit not found or user not authorized');
        return res.status(404).json({ 
          success: false, 
          error: 'Habit not found' 
        });
      }

      console.log('✅ Habit deleted successfully');

      res.json({
        success: true,
        message: 'Habit deleted successfully'
      });
    } catch (error) {
      console.error('💥 Delete habit error:', error.message);
      console.error('Error stack:', error.stack);
      
      res.status(500).json({ 
        success: false, 
        error: 'Failed to delete habit',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined
      });
    }
  }
};
async function getRandomPhrase(language = 'en', minCompleted = 0) {
  const lang = String(language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  try {
    const { rows } = await db.query(
      `SELECT phrase_${lang} AS text, emoji, type
       FROM motivational_phrases
       WHERE min_completed <= $1
       ORDER BY RANDOM()
       LIMIT 1`,
      [minCompleted]
    );
    if (rows.length) {
      const r = rows[0];
      return { text: r.text, emoji: r.emoji || '', type: r.type || 'encouragement' };
    }
  } catch (e) {
    console.error('getRandomPhrase error:', e);
  }
  // запасной вариант, чтобы никогда не падать
  return lang === 'ru'
    ? { text: 'Продолжай!', emoji: '💪', type: 'encouragement' }
    : { text: 'Keep going!', emoji: '💪', type: 'encouragement' };
}

module.exports = habitController;