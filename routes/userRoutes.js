// routes/userRoutes.js

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { validateTelegramWebAppData } = require('../middleware/telegramAuth');

// PATCH /api/users/preferences
router.patch('/preferences', validateTelegramWebAppData, userController.updatePreferences);

module.exports = router;
