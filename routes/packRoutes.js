// routes/packRoutes.js - Роуты для работы с пакетами

const express = require('express');
const router = express.Router();
const packController = require('../controllers/packController');
const authMiddleware = require('../middleware/authMiddleware');

// Публичные роуты (требуют аутентификации)
router.use(authMiddleware);

// Получить список всех пакетов в магазине
router.get('/store', packController.getStorePacks);

// Получить детали конкретного пакета
router.get('/store/:slug', packController.getPackDetail);

// Создать заказ на покупку пакета
router.post('/orders/create', packController.createOrder);

// Завершить заказ (webhook)
router.post('/orders/complete', packController.completeOrder);

module.exports = router;