const express = require('express');
const router = express.Router();
const packController = require('../controllers/packController');
const authMiddleware = require('../middleware/authMiddleware');

// Публичные роуты (для просмотра магазина)
router.get('/packs', packController.getStorePacks);
router.get('/packs/:slug', packController.getPackDetails);

// Защищённые роуты (требуют авторизации)
router.use(authMiddleware);

router.post('/packs/:packId/purchase', packController.purchasePack);
router.get('/packs/:packId/my-details', packController.getMyPackDetails);
router.get('/my-packs', packController.getMyPacks);

module.exports = router;