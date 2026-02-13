// routes/achievementRoutes.js - Роуты для работы с достижениями

const express = require('express');
const router = express.Router();
const achievementController = require('../controllers/achievementController');
const authMiddleware = require('../middleware/authMiddleware');

// Все роуты требуют аутентификации
router.use(authMiddleware);

// Получить достижения по конкретному пакету
router.get('/pack/:pack_id', achievementController.getPackAchievements);

// Проверить и выдать новые достижения (вызывается после выполнения привычки)
router.post('/check', achievementController.checkAndGrantAchievements);

// Получить общую сводку по достижениям
router.get('/summary', achievementController.getUserAchievementsSummary);

// Получить последние разблокированные достижения
router.get('/recent', achievementController.getRecentAchievements);

module.exports = router;