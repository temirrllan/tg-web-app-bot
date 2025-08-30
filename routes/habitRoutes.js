const express = require('express');
const router = express.Router();
const habitController = require('../controllers/habitController');
const categoryController = require('../controllers/categoryController');
const markController = require('../controllers/markController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkSubscriptionLimit } = require('../middleware/subscription');
const { createHabitLimiter } = require('../middleware/rateLimit');
const db = require('../config/database');

// Категории
router.get('/categories', categoryController.getAll);

// Применяем auth middleware к остальным роутам
router.use(authMiddleware);

// Привычки
router.post('/habits', createHabitLimiter, checkSubscriptionLimit, habitController.create);
router.get('/habits', habitController.getAll);
router.get('/habits/today', habitController.getTodayHabits);
router.patch('/habits/:id', habitController.update);
router.delete('/habits/:id', habitController.delete);

// Новый эндпоинт для получения отметок по дате
// Получение отметок привычек для конкретной даты
router.get('/habits/marks', async (req, res) => {
  try {
    const { date } = req.query;
    const userId = req.user.id;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Date parameter is required'
      });
    }
    
    console.log(`Getting marks for user ${userId} on date ${date}`);
    
    // Получаем все отметки пользователя для указанной даты
    // ВАЖНО: Возвращаем только отметки для конкретной даты
    const result = await db.query(
      `SELECT 
        hm.habit_id,
        hm.status,
        hm.date,
        hm.marked_at
       FROM habit_marks hm
       JOIN habits h ON hm.habit_id = h.id
       WHERE h.user_id = $1 
       AND hm.date = $2::date`, // Явно приводим к типу date
      [userId, date]
    );
    
    console.log(`Found ${result.rows.length} marks for ${date}:`, 
      result.rows.map(r => ({ habit_id: r.habit_id, status: r.status }))
    );
    
    res.json({
      success: true,
      marks: result.rows,
      date: date
    });
  } catch (error) {
    console.error('Get marks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get marks'
    });
  }
});

// Получение привычек для конкретной даты
router.get('/habits/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const userId = req.user.id;
    
    // Парсим дату для получения дня недели
    const [year, month, day] = date.split('-');
    const targetDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const dayOfWeek = targetDate.getDay() || 7;
    
    console.log(`Getting habits for date ${date}, day of week: ${dayOfWeek}`);
    
    // Получаем привычки для этого дня недели
    const result = await db.query(
      `SELECT 
        h.*,
        c.name_ru, 
        c.name_en, 
        c.icon, 
        c.color,
        -- Получаем статус ТОЛЬКО для запрошенной даты
        (SELECT status FROM habit_marks 
         WHERE habit_id = h.id 
         AND date = $3::date
         LIMIT 1) as today_status,
        (SELECT id FROM habit_marks 
         WHERE habit_id = h.id 
         AND date = $3::date
         LIMIT 1) as mark_id
       FROM habits h
       LEFT JOIN categories c ON h.category_id = c.id
       WHERE 
         h.user_id = $1 
         AND h.is_active = true
         AND $2 = ANY(h.schedule_days)
       ORDER BY h.created_at DESC`,
      [userId, dayOfWeek, date]
    );
    
    const habitsWithStatus = result.rows.map(h => ({
      ...h,
      today_status: h.today_status || 'pending'
    }));
    
    const completedCount = habitsWithStatus.filter(h => h.today_status === 'completed').length;
    
    console.log(`Found ${habitsWithStatus.length} habits for ${date}, completed: ${completedCount}`);
    
    res.json({
      success: true,
      habits: habitsWithStatus,
      stats: {
        completed: completedCount,
        total: habitsWithStatus.length
      }
    });
  } catch (error) {
    console.error('Get habits for date error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get habits for date'
    });
  }
});

// Отметки
router.post('/habits/:id/mark', markController.markHabit);
router.delete('/habits/:id/mark', markController.unmarkHabit);

module.exports = router;