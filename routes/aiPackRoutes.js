// routes/aiPackRoutes.js
const express = require('express');
const router  = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const aiPackController = require('../controllers/aiPackController');

router.use(authMiddleware);

// Опции опроса + цена + остаток бесплатных генераций + доступность ИИ
router.get('/options', aiPackController.getOptions);

// Создать запрос (free → право на генерацию, paid → инвойс)
router.post('/requests', aiPackController.createRequest);

// Статус запроса (поллинг) / превью если готово
router.get('/requests/:id', aiPackController.getRequestStatus);

// Генерация (после оплаты/free)
router.post('/requests/:id/generate', aiPackController.generatePack);

// Бесплатная переделка (1 раз, до активации)
router.post('/requests/:id/redo', aiPackController.redoPack);

// Активация — создаёт привычки
router.post('/requests/:id/activate', aiPackController.activatePack);

// Мои AI-паки
router.get('/my', aiPackController.getMyAiPacks);

module.exports = router;
