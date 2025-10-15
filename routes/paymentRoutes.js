const express = require('express');
const router = express.Router();
const telegramPaymentController = require('../controllers/telegramPaymentController');
const authMiddleware = require('../middleware/authMiddleware');

// Webhook от Telegram (без auth middleware!)
// ВАЖНО: этот роут должен быть БЕЗ authMiddleware
router.post('/webhook', telegramPaymentController.handleWebhook);

// Отправить invoice кнопку (требует авторизации)
router.post('/request-invoice-button', authMiddleware, telegramPaymentController.requestInvoiceButton);

// Проверить статус платежа по payload (требует авторизации)
router.get('/check-status', authMiddleware, telegramPaymentController.checkPaymentStatusByPayload);

module.exports = router;