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
// Получение привычек для конкретной даты с их актуальными статусами
router.get('/habits/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const userId = req.user.id;
    
    // Парсим дату для получения дня недели
    const [year, month, day] = date.split('-');
    const targetDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const dayOfWeek = targetDate.getDay() || 7;
    
    console.log(`Getting habits for user ${userId} on date ${date}, day of week: ${dayOfWeek}`);
    
    // Получаем привычки для этого дня недели со статусами
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
        h.created_at,
        h.updated_at,
        c.name_ru, 
        c.name_en, 
        c.icon as category_icon, 
        c.color,
        -- Получаем актуальный статус из habit_marks
        COALESCE(hm.status, 'pending') as today_status,
        hm.id as mark_id,
        hm.marked_at
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
      [userId, dayOfWeek, date]
    );
    
    // Логируем статусы для отладки
    console.log(`Found ${result.rows.length} habits for ${date}:`);
    result.rows.forEach(h => {
      console.log(`- "${h.title}" (ID: ${h.id}): ${h.today_status}`);
    });
    
    const completedCount = result.rows.filter(h => h.today_status === 'completed').length;
    const failedCount = result.rows.filter(h => h.today_status === 'failed').length;
    const skippedCount = result.rows.filter(h => h.today_status === 'skipped').length;
    const pendingCount = result.rows.filter(h => h.today_status === 'pending').length;
    
    console.log(`Stats: completed=${completedCount}, failed=${failedCount}, skipped=${skippedCount}, pending=${pendingCount}`);
    
    res.json({
      success: true,
      habits: result.rows,
      stats: {
        completed: completedCount,
        total: result.rows.length,
        failed: failedCount,
        skipped: skippedCount,
        pending: pendingCount
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

// Проверочный эндпоинт для отладки отметок
router.get('/habits/:id/marks', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Проверяем, что привычка принадлежит пользователю
    const habitCheck = await db.query(
      'SELECT id, title FROM habits WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (habitCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }
    
    // Получаем все отметки для этой привычки
    const marks = await db.query(
      `SELECT 
        id,
        habit_id,
        date,
        status,
        marked_at
       FROM habit_marks 
       WHERE habit_id = $1
       ORDER BY date DESC
       LIMIT 30`,
      [id]
    );
    
    console.log(`Found ${marks.rows.length} marks for habit ${id} (${habitCheck.rows[0].title})`);
    
    res.json({
      success: true,
      habit: habitCheck.rows[0],
      marks: marks.rows
    });
  } catch (error) {
    console.error('Get habit marks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get habit marks'
    });
  }
});
// Получение статистики привычки
router.get('/habits/:id/statistics', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Проверяем, что привычка принадлежит пользователю
    const habitCheck = await db.query(
      'SELECT id, title, streak_current FROM habits WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (habitCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }
    
    const habit = habitCheck.rows[0];
    const now = new Date();
    
    // Текущая неделя
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    // Текущий месяц
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    // Текущий год
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear(), 11, 31);
    
    // Получаем статистику
    const weekStats = await db.query(
      `SELECT COUNT(*) as completed 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND status = 'completed'
       AND date >= $2::date 
       AND date <= $3::date`,
      [id, weekStart, weekEnd]
    );
    
    const monthStats = await db.query(
      `SELECT COUNT(*) as completed 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND status = 'completed'
       AND date >= $2::date 
       AND date <= $3::date`,
      [id, monthStart, monthEnd]
    );
    
    const yearStats = await db.query(
      `SELECT COUNT(*) as completed 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND status = 'completed'
       AND date >= $2::date 
       AND date <= $3::date`,
      [id, yearStart, yearEnd]
    );
    
    res.json({
      success: true,
      currentStreak: habit.streak_current || 0,
      weekCompleted: parseInt(weekStats.rows[0].completed),
      monthCompleted: parseInt(monthStats.rows[0].completed),
      monthTotal: monthEnd.getDate(),
      yearCompleted: parseInt(yearStats.rows[0].completed)
    });
  } catch (error) {
    console.error('Get habit statistics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get statistics'
    });
  }
});
// Отметки
router.post('/habits/:id/mark', markController.markHabit);
router.delete('/habits/:id/mark', markController.unmarkHabit);

module.exports = router;