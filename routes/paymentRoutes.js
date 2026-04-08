const express = require('express');
const router = express.Router();
const telegramPaymentController = require('../controllers/telegramPaymentController');
const authMiddleware = require('../middleware/authMiddleware');

// Webhook от Telegram (без auth middleware!)
router.post('/webhook', telegramPaymentController.handleWebhook);

// Создать invoice и получить URL (НОВЫЙ эндпоинт)
router.post('/create-invoice', authMiddleware, telegramPaymentController.createInvoice);

// Отправить invoice кнопку (старый метод, оставляем для совместимости)
router.post('/request-invoice-button', authMiddleware, telegramPaymentController.requestInvoiceButton);

// Валидация промокода
router.post('/validate-promo', authMiddleware, telegramPaymentController.validatePromo);

// Активация подписки с промокодом (бесплатная — 100% скидка)
router.post('/activate-promo', authMiddleware, telegramPaymentController.activateWithPromo);

// Проверить статус платежа по payload
router.get('/check-status', authMiddleware, telegramPaymentController.checkPaymentStatusByPayload);

// Получить активные планы подписок (публичный, без auth)
router.get('/plans', telegramPaymentController.getSubscriptionPlans);

module.exports = router;