const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const habitController = require('../controllers/habitController');
const userController = require('../controllers/userController');
const subscriptionController = require('../controllers/subscriptionController');

// ================= HABITS =================

// Создание привычки
router.post('/habits', authMiddleware, habitController.createHabit);

// Получение всех привычек пользователя
router.get('/habits', authMiddleware, habitController.getAllHabits);

// Получение привычки по ID
router.get('/habits/:id', authMiddleware, habitController.getHabitById);

// Обновление привычки
router.put('/habits/:id', authMiddleware, habitController.updateHabit);

// Удаление привычки
router.delete('/habits/:id', authMiddleware, habitController.deleteHabit);

// Отметки привычек
router.post('/habits/:habitId/marks', authMiddleware, habitController.createMark);
router.get('/habits/:habitId/marks', authMiddleware, habitController.getMarks);

// Проверка привычек по дате
router.get('/habits/date/:date', authMiddleware, habitController.getHabitsByDate);

// Punch привычки друзьям (убрал дубли)
router.post('/habits/:habitId/punch/:userId', authMiddleware, habitController.punchFriend);

// Шаринг привычек
router.post('/habits/:id/share', authMiddleware, habitController.shareHabit);
router.get('/habits/:id/members', authMiddleware, habitController.getHabitMembers);

// ================= USER =================

// Профиль пользователя
router.get('/user/profile', authMiddleware, userController.getProfile);
router.put('/user/profile', authMiddleware, userController.updateProfile);

// Язык пользователя
router.get('/user/language', authMiddleware, userController.getLanguage);
router.put('/user/language', authMiddleware, userController.updateLanguage);

// ================= SUBSCRIPTION =================

// Получение подписок пользователя
router.get('/subscription', authMiddleware, subscriptionController.getUserSubscriptions);

// Создание подписки
router.post('/subscription', authMiddleware, subscriptionController.createSubscription);

// Обновление подписки
router.put('/subscription/:id', authMiddleware, subscriptionController.updateSubscription);

// Отмена подписки
router.delete('/subscription/:id', authMiddleware, subscriptionController.cancelSubscription);

module.exports = router;
