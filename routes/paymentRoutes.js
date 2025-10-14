const express = require('express');
const router = express.Router();
const telegramPaymentController = require('../controllers/telegramPaymentController');
const authMiddleware = require('../middleware/authMiddleware');

// Webhook от Telegram (без auth middleware!)
router.post('/webhook', telegramPaymentController.handleWebhook);

// Создать invoice (требует авторизации)
router.post('/create-invoice', authMiddleware, telegramPaymentController.createInvoice);

// Проверить статус платежа
router.get('/status/:paymentId', authMiddleware, telegramPaymentController.checkPaymentStatus);

module.exports = router;