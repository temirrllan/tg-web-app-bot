// routes/achievements.js - API для работы с достижениями

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ============================================
// ПОЛУЧИТЬ ДОСТИЖЕНИЯ ПО ПАКЕТУ
// ============================================
router.get('/pack/:pack_id', authenticateToken, async (req, res) => {
  try {
    const { pack_id } = req.params;
    const userId = req.user.id;

    // Проверяем, куплен ли пакет
    const { rows: purchaseRows } = await db.query(`
      SELECT id FROM pack_purchases
      WHERE user_id = $1 AND pack_id = $2 AND status = 'ACTIVE'
    `, [userId, pack_id]);

    if (purchaseRows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Pack not purchased',
      });
    }

    // Получаем уровни достижений
    const { rows: levels } = await db.query(`
      SELECT 
        pal.id,
        pal.title,
        pal.description,
        pal.required_completions,
        pal.sort_order,
        upa.achieved_at,
        CASE WHEN upa.id IS NOT NULL THEN true ELSE false END as is_achieved
      FROM pack_achievement_levels pal
      LEFT JOIN user_pack_achievements upa 
        ON upa.level_id = pal.id AND upa.user_id = $1
      WHERE pal.pack_id = $2 AND pal.is_active = true
      ORDER BY pal.sort_order ASC
    `, [userId, pack_id]);

    // Получаем текущий прогресс
    const { rows: progressRows } = await db.query(`
      SELECT COUNT(DISTINCT hm.id) as completed_count
      FROM pack_purchases pp
      JOIN habits h ON h.pack_purchase_id = pp.id
      LEFT JOIN habit_marks hm ON hm.habit_id = h.id
      WHERE pp.pack_id = $1 
        AND pp.user_id = $2 
        AND pp.status = 'ACTIVE'
    `, [pack_id, userId]);

    const completedCount = parseInt(progressRows[0].completed_count);

    res.json({
      success: true,
      data: {
        completed_count: completedCount,
        levels,
      },
    });
  } catch (error) {
    console.error('Error fetching achievements:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch achievements',
    });
  }
});

// ============================================
// ПРОВЕРИТЬ И РАЗБЛОКИРОВАТЬ ДОСТИЖЕНИЯ
// (вызывается после создания habit_mark)
// ============================================
async function checkAndUnlockAchievements(client, userId, habitId) {
  // Получаем pack_id через habit
  const { rows: habitRows } = await client.query(`
    SELECT pp.pack_id
    FROM habits h
    JOIN pack_purchases pp ON h.pack_purchase_id = pp.id
    WHERE h.id = $1 AND h.is_locked = true
  `, [habitId]);

  if (habitRows.length === 0) {
    return; // Не привычка из пакета
  }

  const packId = habitRows[0].pack_id;

  // Считаем выполненные отметки
  const { rows: countRows } = await client.query(`
    SELECT COUNT(DISTINCT hm.id) as completed_count
    FROM pack_purchases pp
    JOIN habits h ON h.pack_purchase_id = pp.id
    LEFT JOIN habit_marks hm ON hm.habit_id = h.id
    WHERE pp.pack_id = $1 
      AND pp.user_id = $2 
      AND pp.status = 'ACTIVE'
  `, [packId, userId]);

  const completedCount = parseInt(countRows[0].completed_count);

  // Получаем уровни, которые должны быть разблокированы
  const { rows: levelsToUnlock } = await client.query(`
    SELECT pal.id
    FROM pack_achievement_levels pal
    WHERE pal.pack_id = $1
      AND pal.required_completions <= $2
      AND pal.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM user_pack_achievements upa
        WHERE upa.level_id = pal.id AND upa.user_id = $3
      )
  `, [packId, completedCount, userId]);

  // Разблокируем новые уровни
  for (const level of levelsToUnlock) {
    await client.query(`
      INSERT INTO user_pack_achievements (user_id, pack_id, level_id, achieved_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT DO NOTHING
    `, [userId, packId, level.id]);
  }
}

module.exports = { router, checkAndUnlockAchievements };