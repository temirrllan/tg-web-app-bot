const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const authMiddleware = require('../middleware/authMiddleware');

// Все роуты требуют аутентификации
router.use(authMiddleware);

// Валидация промокода
router.post('/validate-promo', paymentController.validatePromoCode);

// Создание платежа
router.post('/create', paymentController.createPayment);

// Получить ссылку для покупки Stars
router.get('/buy-stars-link', paymentController.getBuyStarsLink);

// Webhook для обработки успешного платежа (без auth middleware)
router.post('/webhook', paymentController.handlePaymentWebhook);

module.exports = router;