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
    const result = await db.query(
      `SELECT 
        hm.habit_id,
        hm.status,
        hm.date,
        hm.marked_at
       FROM habit_marks hm
       JOIN habits h ON hm.habit_id = h.id
       WHERE h.user_id = $1 AND hm.date = $2`,
      [userId, date]
    );
    
    console.log(`Found ${result.rows.length} marks for ${date}`);
    
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

// Отметки
router.post('/habits/:id/mark', markController.markHabit);
router.delete('/habits/:id/mark', markController.unmarkHabit);

module.exports = router;