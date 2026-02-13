// controllers/achievementController.js - Контроллер для работы с достижениями пакетов

const db = require('../config/database');

const achievementController = {
  /**
   * Получить все достижения пользователя по конкретному пакету
   * GET /api/achievements/pack/:pack_id
   */
  async getPackAchievements(req, res) {
    try {
      const { pack_id } = req.params;
      const userId = req.user.id;

      console.log('🏆 Getting pack achievements:', { pack_id, userId });

      // Проверяем, что пользователь владеет пакетом
      const purchaseCheck = await db.query(
        `SELECT id FROM pack_purchases 
         WHERE user_id = $1 AND pack_id = $2 AND status = 'ACTIVE'`,
        [userId, pack_id]
      );

      if (purchaseCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Pack not purchased'
        });
      }

      const purchaseId = purchaseCheck.rows[0].id;

      // Получаем уровни достижений
      const achievementsResult = await db.query(
        `SELECT 
          pal.id,
          pal.title,
          pal.description,
          pal.required_completions,
          pal.sort_order,
          CASE WHEN upa.id IS NOT NULL THEN true ELSE false END as is_achieved,
          upa.achieved_at
         FROM pack_achievement_levels pal
         LEFT JOIN user_pack_achievements upa ON (
           pal.id = upa.level_id 
           AND upa.user_id = $1
         )
         WHERE pal.pack_id = $2 AND pal.is_active = true
         ORDER BY pal.sort_order ASC`,
        [userId, pack_id]
      );

      // Получаем текущий прогресс
      const progressResult = await db.query(
        `SELECT COUNT(*) as total_completions
         FROM habit_marks hm
         JOIN habits h ON hm.habit_id = h.id
         WHERE h.pack_purchase_id = $1 
           AND hm.status = 'completed'
           AND hm.user_id = $2`,
        [purchaseId, userId]
      );

      const totalCompletions = parseInt(progressResult.rows[0].total_completions);

      console.log(`✅ Found ${achievementsResult.rows.length} achievements, ${totalCompletions} completions`);

      res.json({
        success: true,
        data: {
          achievements: achievementsResult.rows,
          total_completions: totalCompletions
        }
      });
    } catch (error) {
      console.error('❌ Get pack achievements error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load achievements'
      });
    }
  },

  /**
   * Проверить и выдать новые достижения после выполнения привычки
   * POST /api/achievements/check
   */
  async checkAndGrantAchievements(req, res) {
    const client = await db.getClient();

    try {
      const userId = req.user.id;
      const { habit_id } = req.body;

      console.log('🔍 Checking achievements for habit:', { userId, habit_id });

      await client.query('BEGIN');

      // Проверяем, что это привычка из пакета
      const habitResult = await client.query(
        `SELECT h.pack_purchase_id, pp.pack_id
         FROM habits h
         JOIN pack_purchases pp ON h.pack_purchase_id = pp.id
         WHERE h.id = $1 AND h.user_id = $2 AND h.is_locked = true`,
        [habit_id, userId]
      );

      if (habitResult.rows.length === 0) {
        await client.query('COMMIT');
        return res.json({
          success: true,
          data: {
            new_achievements: [],
            message: 'Not a pack habit'
          }
        });
      }

      const { pack_purchase_id, pack_id } = habitResult.rows[0];

      // Подсчитываем общее количество выполнений по этому пакету
      const completionsResult = await client.query(
        `SELECT COUNT(*) as total_completions
         FROM habit_marks hm
         JOIN habits h ON hm.habit_id = h.id
         WHERE h.pack_purchase_id = $1 
           AND hm.status = 'completed'
           AND hm.user_id = $2`,
        [pack_purchase_id, userId]
      );

      const totalCompletions = parseInt(completionsResult.rows[0].total_completions);

      console.log(`📊 Total completions for pack: ${totalCompletions}`);

      // Получаем уровни достижений, которые ещё не получены
      const unachievedResult = await client.query(
        `SELECT pal.*
         FROM pack_achievement_levels pal
         WHERE pal.pack_id = $1 
           AND pal.is_active = true
           AND pal.required_completions <= $2
           AND NOT EXISTS (
             SELECT 1 FROM user_pack_achievements upa
             WHERE upa.level_id = pal.id AND upa.user_id = $3
           )
         ORDER BY pal.sort_order ASC`,
        [pack_id, totalCompletions, userId]
      );

      const newAchievements = [];

      // Выдаём новые достижения
      for (const level of unachievedResult.rows) {
        console.log(`🏆 Granting achievement: ${level.title}`);

        await client.query(
          `INSERT INTO user_pack_achievements (user_id, pack_id, level_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, level_id) DO NOTHING`,
          [userId, pack_id, level.id]
        );

        newAchievements.push({
          id: level.id,
          title: level.title,
          description: level.description,
          required_completions: level.required_completions
        });
      }

      await client.query('COMMIT');

      if (newAchievements.length > 0) {
        console.log(`🎉 Granted ${newAchievements.length} new achievement(s)`);
      } else {
        console.log('📝 No new achievements to grant');
      }

      res.json({
        success: true,
        data: {
          new_achievements: newAchievements,
          total_completions: totalCompletions
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Check achievements error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check achievements'
      });
    } finally {
      client.release();
    }
  },

  /**
   * Получить сводку по всем достижениям пользователя
   * GET /api/achievements/summary
   */
  async getUserAchievementsSummary(req, res) {
    try {
      const userId = req.user.id;

      console.log('📊 Getting achievements summary for user:', userId);

      // Получаем все пакеты пользователя с прогрессом
      const packsResult = await db.query(
        `SELECT 
          sp.id,
          sp.slug,
          sp.title,
          sp.cover_image_url,
          sp.count_achievements as total_achievements,
          COUNT(DISTINCT upa.id) as unlocked_achievements,
          pp.granted_at as purchased_at
         FROM pack_purchases pp
         JOIN store_packs sp ON pp.pack_id = sp.id
         LEFT JOIN user_pack_achievements upa ON (
           upa.pack_id = sp.id 
           AND upa.user_id = pp.user_id
         )
         WHERE pp.user_id = $1 AND pp.status = 'ACTIVE'
         GROUP BY sp.id, sp.slug, sp.title, sp.cover_image_url, 
                  sp.count_achievements, pp.granted_at
         ORDER BY pp.granted_at DESC`,
        [userId]
      );

      // Подсчитываем общую статистику
      const totalResult = await db.query(
        `SELECT 
          COUNT(DISTINCT pp.pack_id) as total_packs,
          COALESCE(SUM(sp.count_achievements), 0) as total_possible_achievements,
          COUNT(DISTINCT upa.id) as total_unlocked_achievements
         FROM pack_purchases pp
         JOIN store_packs sp ON pp.pack_id = sp.id
         LEFT JOIN user_pack_achievements upa ON (
           upa.user_id = pp.user_id
         )
         WHERE pp.user_id = $1 AND pp.status = 'ACTIVE'`,
        [userId]
      );

      const summary = totalResult.rows[0];

      console.log(`✅ Summary: ${summary.total_unlocked_achievements}/${summary.total_possible_achievements} achievements`);

      res.json({
        success: true,
        data: {
          summary: {
            total_packs: parseInt(summary.total_packs),
            total_possible_achievements: parseInt(summary.total_possible_achievements),
            total_unlocked_achievements: parseInt(summary.total_unlocked_achievements)
          },
          packs: packsResult.rows.map(pack => ({
            ...pack,
            total_achievements: parseInt(pack.total_achievements),
            unlocked_achievements: parseInt(pack.unlocked_achievements)
          }))
        }
      });
    } catch (error) {
      console.error('❌ Get achievements summary error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load achievements summary'
      });
    }
  },

  /**
   * Получить последние разблокированные достижения
   * GET /api/achievements/recent
   */
  async getRecentAchievements(req, res) {
    try {
      const userId = req.user.id;
      const limit = parseInt(req.query.limit) || 10;

      console.log('🕐 Getting recent achievements:', { userId, limit });

      const result = await db.query(
        `SELECT 
          upa.achieved_at,
          pal.title,
          pal.description,
          pal.required_completions,
          sp.title as pack_title,
          sp.slug as pack_slug,
          sp.cover_image_url as pack_cover
         FROM user_pack_achievements upa
         JOIN pack_achievement_levels pal ON upa.level_id = pal.id
         JOIN store_packs sp ON upa.pack_id = sp.id
         WHERE upa.user_id = $1
         ORDER BY upa.achieved_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      console.log(`✅ Found ${result.rows.length} recent achievements`);

      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      console.error('❌ Get recent achievements error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load recent achievements'
      });
    }
  }
};

module.exports = achievementController;