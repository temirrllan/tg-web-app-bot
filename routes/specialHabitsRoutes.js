// routes/specialHabitsRoutes.js
const express = require('express');
const router  = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const specialHabitsController = require('../controllers/specialHabitsController');

// All routes require authentication
router.use(authMiddleware);

// Pack store
router.get('/packs',               specialHabitsController.getPacks);
router.get('/packs/:id',           specialHabitsController.getPackDetails);
router.post('/packs/:id/purchase',         specialHabitsController.purchasePack);
router.post('/packs/:id/confirm-payment',  specialHabitsController.confirmPayment);

// User's purchased packs
router.get('/my-packs',            specialHabitsController.getMyPacks);

// Hide/restore pack from Special tab (toggle)
router.post('/packs/:id/toggle-visibility', specialHabitsController.togglePackVisibility);

// Achievement progress
router.get('/packs/:id/progress',  specialHabitsController.getPackProgress);

// Mark a special habit (updates achievement counter)
router.post('/habit/:habitId/mark', specialHabitsController.markSpecialHabit);

// Fetch special habits for a date (used by Today "Special" tab)
router.get('/habits',              specialHabitsController.getSpecialHabitsForDate);

module.exports = router;
