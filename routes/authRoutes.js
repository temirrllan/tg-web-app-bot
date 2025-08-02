

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { validateTelegramWebAppData } = require('../middleware/telegramAuth');

// Удаляем весь блок с тестовым эндпоинтом
router.post('/telegram', validateTelegramWebAppData, authController.telegramAuth);

module.exports = router;