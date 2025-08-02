const Habit = require('../models/Habit');
const HabitMark = require('../models/HabitMark');
const Phrase = require('../models/Phrase');

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
      
      console.log('Getting today habits for user:', userId);
      console.log('Today is:', {
        date: today.toISOString().split('T')[0],
        dayOfWeek: dayOfWeek,
        dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][today.getDay()]
      });
      
      const habits = await Habit.getTodayHabits(userId);
      console.log(`✅ Found ${habits.length} habits for today`);
      
      // Считаем статистику
      const completedCount = habits.filter(h => h.today_status === 'completed').length;
      const totalCount = habits.length;
      
      console.log('Statistics:', {
        total: totalCount,
        completed: completedCount,
        pending: totalCount - completedCount
      });

      // Получаем мотивационную фразу
      const language = req.user.language || 'en';
      console.log('Getting motivational phrase for language:', language);
      
      const phrase = await Phrase.getRandom(completedCount, language);
      console.log('Selected phrase:', phrase);

      res.json({
        success: true,
        habits,
        stats: {
          completed: completedCount,
          total: totalCount
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

      console.log('✅ Habit updated successfully:', habit.id);

      res.json({
        success: true,
        habit
      });
    } catch (error) {
      console.error('💥 Update habit error:', error.message);
      console.error('Error stack:', error.stack);
      
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

module.exports = habitController;