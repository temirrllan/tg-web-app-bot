const express = require('express');
const router = express.Router();
const habitController = require('../controllers/habitController');
const categoryController = require('../controllers/categoryController');
const markController = require('../controllers/markController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkSubscriptionLimit } = require('../middleware/subscription');
const { createHabitLimiter } = require('../middleware/rateLimit');
const db = require('../config/database');
const SubscriptionService = require('../services/subscriptionService');

// Категории
router.get('/categories', categoryController.getAll);

// Применяем auth middleware к остальным роутам
router.use(authMiddleware);

// Привычки
router.post('/habits', createHabitLimiter, checkSubscriptionLimit, habitController.create);
router.get('/habits', habitController.getAll);
router.get('/habits/today', habitController.getTodayHabits);

// 🆕 ОБНОВЛЁННЫЙ РОУТ РЕДАКТИРОВАНИЯ с проверкой владельца и уведомлениями
// В controllers/habitController.js замените роут PATCH на:

// В controllers/habitController.js замените роут PATCH на:

router.patch('/habits/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    console.log('🔧 Updating habit:', { habitId: id, userId, updates });

    // Валидация
    if (updates.title !== undefined && (!updates.title || updates.title.trim() === '')) {
      return res.status(400).json({
        success: false,
        error: 'Title cannot be empty'
      });
    }

    if (updates.goal !== undefined && (!updates.goal || updates.goal.trim() === '')) {
      return res.status(400).json({
        success: false,
        error: 'Goal cannot be empty'
      });
    }

    // Проверяем привычку
    const habitCheck = await db.query(
      'SELECT * FROM habits WHERE id = $1',
      [id]
    );

    if (habitCheck.rows.length === 0) {
  return res.status(404).json({
    success: false,
    error: 'Habit not found'
  });
}

    const habit = habitCheck.rows[0];

    // 🔥 ИСПРАВЛЕННАЯ ЛОГИКА: Проверяем creator_id, если его нет — fallback на user_id
    // КРИТИЧНО: Приводим к числу, т.к. creator_id может быть строкой из БД
const actualCreatorId = parseInt(habit.creator_id || habit.user_id);
    
    console.log('🔍 Permission check:', {
      habitId: id,
      habitUserId: habit.user_id,
      habitCreatorId: habit.creator_id,
      actualCreatorId: actualCreatorId,
      currentUserId: userId,
      typesMatch: typeof actualCreatorId === typeof userId,
      isCreator: actualCreatorId === userId
    });
console.log('🔍 Permission check:', {
  habitId: id,
  habitUserId: habit.user_id,
  habitCreatorId: habit.creator_id,
  actualCreatorId: actualCreatorId,
  currentUserId: userId,
  typesMatch: typeof actualCreatorId === typeof userId,
  isCreator: actualCreatorId === userId
});

// Проверка прав: только создатель может редактировать
if (actualCreatorId !== userId) {
  console.log('❌ User is not the creator of this habit');
  return res.status(403).json({
    success: false,
    error: 'Only the habit creator can edit this habit',
    isOwner: false
  });
}
    // Проверка прав: только создатель может редактировать
    if (actualCreatorId !== userId) {
      console.log('❌ User is not the creator of this habit');
      return res.status(403).json({
        success: false,
        error: 'Only the habit creator can edit this habit',
        isOwner: false
      });
    }

    console.log('✅ User is the creator, allowing edit');

    // Обновляем привычку
    const Habit = require('../models/Habit');
    const updatedHabit = await Habit.update(id, userId, updates);

    if (!updatedHabit) {
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }

    console.log('✅ Habit updated successfully:', updatedHabit.id);

    // 🔔 Отправляем уведомления всем участникам (кроме создателя)
    try {
      const bot = require('../server').bot;
      
      // Получаем владельца привычки
      const ownerResult = await db.query(
        'SELECT first_name, language FROM users WHERE id = $1',
        [userId]
      );
      
      const ownerName = ownerResult.rows.length > 0 
        ? ownerResult.rows[0].first_name 
        : 'Creator';

      // Определяем, какая привычка является родительской
      const targetHabitId = habit.parent_habit_id || habit.id;

      // Получаем всех участников связанных привычек
      const membersResult = await db.query(
        `SELECT DISTINCT u.id, u.telegram_id, u.first_name, u.language, h.id as habit_id
         FROM habit_members hm
         JOIN users u ON hm.user_id = u.id
         JOIN habits h ON h.user_id = u.id
         WHERE hm.habit_id IN (
           SELECT id FROM habits 
           WHERE parent_habit_id = $1 OR id = $1
         )
         AND hm.is_active = true
         AND u.id != $2
         AND h.parent_habit_id = $1`,
        [targetHabitId, userId]
      );

      console.log(`📤 Sending notifications to ${membersResult.rows.length} members`);

      // Отправляем уведомления каждому участнику
      for (const member of membersResult.rows) {
        try {
          const lang = member.language || 'en';
          
          // Подготавливаем текст уведомления на разных языках
          const messages = {
            en: `📝 <b>Habit Updated!</b>\n\n${ownerName} has updated the shared habit:\n<b>"${updatedHabit.title}"</b>\n\n${updates.goal ? `New goal: ${updates.goal}\n\n` : ''}The changes have been applied to your habit as well.`,
            ru: `📝 <b>Привычка обновлена!</b>\n\n${ownerName} изменил(а) совместную привычку:\n<b>"${updatedHabit.title}"</b>\n\n${updates.goal ? `Новая цель: ${updates.goal}\n\n` : ''}Изменения применены и к вашей привычке.`,
            kk: `📝 <b>Әдет жаңартылды!</b>\n\n${ownerName} ортақ әдетті өзгертті:\n<b>"${updatedHabit.title}"</b>\n\n${updates.goal ? `Жаңа мақсат: ${updates.goal}\n\n` : ''}Өзгерістер сіздің әдетіңізге де қолданылды.`
          };

          const message = messages[lang] || messages['en'];

          await bot.sendMessage(
            member.telegram_id,
            message,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[
                  {
                    text: lang === 'ru' ? '📱 Открыть приложение' : lang === 'kk' ? '📱 Қосымшаны ашу' : '📱 Open App',
                    web_app: { 
                      url: process.env.WEBAPP_URL || process.env.FRONTEND_URL 
                    }
                  }
                ]]
              }
            }
          );

          console.log(`✅ Notification sent to ${member.first_name} (ID: ${member.id})`);

          // Обновляем привычку участника
          await db.query(
            `UPDATE habits 
             SET title = $1, 
                 goal = $2,
                 schedule_type = $3,
                 schedule_days = $4,
                 reminder_time = $5,
                 reminder_enabled = $6
             WHERE id = $7`,
            [
              updates.title || habit.title,
              updates.goal || habit.goal,
              updates.schedule_type || habit.schedule_type,
              updates.schedule_days || habit.schedule_days,
              updates.reminder_time !== undefined ? updates.reminder_time : habit.reminder_time,
              updates.reminder_enabled !== undefined ? updates.reminder_enabled : habit.reminder_enabled,
              member.habit_id
            ]
          );

        } catch (notifError) {
          console.error(`❌ Failed to notify member ${member.first_name}:`, notifError.message);
        }
      }

    } catch (notificationError) {
      console.error('❌ Notification error (non-critical):', notificationError.message);
    }

    res.json({
      success: true,
      habit: updatedHabit,
      membersNotified: true
    });

  } catch (error) {
    console.error('💥 Update habit error:', error.message);
    console.error('Error stack:', error.stack);

    res.status(500).json({
      success: false,
      error: 'Failed to update habit',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

router.delete('/habits/:id', habitController.delete);

// Новый эндпоинт для получения отметок по дате
router.get('/habits/marks', async (req, res) => {
  try {
    const { date } = req.query;
    const userId = req.user.id;
    
    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Date parameter is required'
      });
    }
    
    console.log(`Getting marks for user ${userId} on date ${date}`);
    
    const result = await db.query(
      `SELECT 
        hm.habit_id,
        hm.status,
        hm.date,
        hm.marked_at
       FROM habit_marks hm
       JOIN habits h ON hm.habit_id = h.id
       WHERE h.user_id = $1 
       AND hm.date = $2::date`,
      [userId, date]
    );
    
    console.log(`Found ${result.rows.length} marks for ${date}:`, 
      result.rows.map(r => ({ habit_id: r.habit_id, status: r.status }))
    );
    
    res.json({
      success: true,
      marks: result.rows,
      date: date
    });
  } catch (error) {
    console.error('Get marks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get marks'
    });
  }
});

// Получение привычек для конкретной даты
router.get('/habits/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const userId = req.user.id;
    
    const [year, month, day] = date.split('-');
    const targetDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const dayOfWeek = targetDate.getDay() || 7;
    
    console.log(`Getting habits for user ${userId} on date ${date}, day of week: ${dayOfWeek}`);
    
    const result = await db.query(
      `SELECT 
        h.id,
        h.user_id,
        h.category_id,
        h.title,
        h.goal,
        h.schedule_type,
        h.schedule_days,
        h.reminder_time,
        h.reminder_enabled,
        h.is_bad_habit,
        h.streak_current,
        h.streak_best,
        h.is_active,
        h.parent_habit_id,
        h.created_at,
        h.updated_at,
        c.name_ru, 
        c.name_en, 
        c.icon as category_icon, 
        c.color,
        COALESCE(hm.status, 'pending') as today_status,
        hm.id as mark_id,
        hm.marked_at,
        CASE 
          WHEN h.parent_habit_id IS NOT NULL THEN
            (SELECT COUNT(DISTINCT user_id) - 1 FROM habit_members 
             WHERE habit_id IN (
               SELECT id FROM habits 
               WHERE parent_habit_id = h.parent_habit_id OR id = h.parent_habit_id
             ) AND is_active = true)
          ELSE
            (SELECT COUNT(DISTINCT user_id) - 1 FROM habit_members 
             WHERE habit_id IN (
               SELECT id FROM habits 
               WHERE parent_habit_id = h.id OR id = h.id
             ) AND is_active = true)
        END as members_count
       FROM habits h
       LEFT JOIN categories c ON h.category_id = c.id
       LEFT JOIN habit_marks hm ON (
         hm.habit_id = h.id 
         AND hm.date = $3::date
       )
       WHERE 
         h.user_id = $1 
         AND h.is_active = true
         AND $2 = ANY(h.schedule_days)
       ORDER BY h.created_at DESC`,
      [userId, dayOfWeek, date]
    );
    
    console.log(`Found ${result.rows.length} habits for ${date}:`);
    result.rows.forEach(h => {
      console.log(`- "${h.title}" (ID: ${h.id}): ${h.today_status}, Members: ${h.members_count}`);
    });
    
    const completedCount = result.rows.filter(h => h.today_status === 'completed').length;
    const failedCount = result.rows.filter(h => h.today_status === 'failed').length;
    const skippedCount = result.rows.filter(h => h.today_status === 'skipped').length;
    const pendingCount = result.rows.filter(h => h.today_status === 'pending').length;
    
    console.log(`Stats: completed=${completedCount}, failed=${failedCount}, skipped=${skippedCount}, pending=${pendingCount}`);
    
    res.json({
      success: true,
      habits: result.rows,
      stats: {
        completed: completedCount,
        total: result.rows.length,
        failed: failedCount,
        skipped: skippedCount,
        pending: pendingCount
      }
    });
  } catch (error) {
    console.error('Get habits for date error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get habits for date'
    });
  }
});

// Проверочный эндпоинт для отладки отметок
router.get('/habits/:id/marks', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const habitCheck = await db.query(
      'SELECT id, title FROM habits WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (habitCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }
    
    const marks = await db.query(
      `SELECT 
        id,
        habit_id,
        date,
        status,
        marked_at
       FROM habit_marks 
       WHERE habit_id = $1
       ORDER BY date DESC
       LIMIT 30`,
      [id]
    );
    
    console.log(`Found ${marks.rows.length} marks for habit ${id} (${habitCheck.rows[0].title})`);
    
    res.json({
      success: true,
      habit: habitCheck.rows[0],
      marks: marks.rows
    });
  } catch (error) {
    console.error('Get habit marks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get habit marks'
    });
  }
});

// Получение статистики привычки
router.get('/habits/:id/statistics', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const habitCheck = await db.query(
      'SELECT id, title, streak_current FROM habits WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (habitCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }
    
    const habit = habitCheck.rows[0];
    const now = new Date();
    
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear(), 11, 31);
    
    const weekStats = await db.query(
      `SELECT COUNT(*) as completed 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND status = 'completed'
       AND date >= $2::date 
       AND date <= $3::date`,
      [id, weekStart, weekEnd]
    );
    
    const monthStats = await db.query(
      `SELECT COUNT(*) as completed 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND status = 'completed'
       AND date >= $2::date 
       AND date <= $3::date`,
      [id, monthStart, monthEnd]
    );
    
    const yearStats = await db.query(
      `SELECT COUNT(*) as completed 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND status = 'completed'
       AND date >= $2::date 
       AND date <= $3::date`,
      [id, yearStart, yearEnd]
    );
    
    res.json({
      success: true,
      currentStreak: habit.streak_current || 0,
      weekCompleted: parseInt(weekStats.rows[0].completed),
      monthCompleted: parseInt(monthStats.rows[0].completed),
      monthTotal: monthEnd.getDate(),
      yearCompleted: parseInt(yearStats.rows[0].completed)
    });
  } catch (error) {
    console.error('Get habit statistics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get statistics'
    });
  }
});

// Присоединиться к привычке по коду
router.post('/habits/join', authMiddleware, async (req, res) => {
  try {
    const { shareCode } = req.body;
    const userId = req.user.id;
    
    if (!shareCode) {
      return res.status(400).json({ 
        success: false, 
        error: 'Share code is required' 
      });
    }
    
    const shareResult = await db.query(
      `SELECT sh.*, h.* 
       FROM shared_habits sh
       JOIN habits h ON sh.habit_id = h.id
       WHERE sh.share_code = $1`,
      [shareCode]
    );
    
    if (shareResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Invalid share code' 
      });
    }
    
    const originalHabit = shareResult.rows[0];
    
    const memberCheck = await db.query(
      'SELECT * FROM habit_members WHERE habit_id = $1 AND user_id = $2',
      [originalHabit.habit_id, userId]
    );
    
    if (memberCheck.rows.length > 0) {
      if (!memberCheck.rows[0].is_active) {
        await db.query(
          'UPDATE habit_members SET is_active = true WHERE habit_id = $1 AND user_id = $2',
          [originalHabit.habit_id, userId]
        );
        
        const userHabitCheck = await db.query(
          'SELECT * FROM habits WHERE user_id = $1 AND parent_habit_id = $2',
          [userId, originalHabit.habit_id]
        );
        
        if (userHabitCheck.rows.length > 0) {
          const reactivatedHabit = await db.query(
            'UPDATE habits SET is_active = true WHERE id = $1 RETURNING *',
            [userHabitCheck.rows[0].id]
          );
          
          await db.query(
            `INSERT INTO habit_members (habit_id, user_id) 
             VALUES ($1, $2) 
             ON CONFLICT (habit_id, user_id) 
             DO UPDATE SET is_active = true`,
            [userHabitCheck.rows[0].id, originalHabit.owner_user_id]
          );
          
          return res.json({ 
            success: true, 
            message: 'Successfully rejoined habit',
            habit: reactivatedHabit.rows[0]
          });
        }
      } else {
        return res.json({ 
          success: true, 
          message: 'Already a member',
          habitId: originalHabit.habit_id 
        });
      }
    }
    
    // 🆕 При создании копии привычки сохраняем creator_id оригинала
const newHabitResult = await db.query(
  `INSERT INTO habits (
    user_id, creator_id, category_id, title, goal, schedule_type, 
    schedule_days, reminder_time, reminder_enabled, is_bad_habit,
    parent_habit_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  RETURNING *`,
  [
    userId,
    originalHabit.user_id, // 🆕 creator_id = владелец оригинальной привычки
    originalHabit.category_id,
    originalHabit.title,
    originalHabit.goal,
    originalHabit.schedule_type,
    originalHabit.schedule_days,
    originalHabit.reminder_time,
    originalHabit.reminder_enabled,
    originalHabit.is_bad_habit,
    originalHabit.habit_id
  ]
);
    
    const newHabit = newHabitResult.rows[0];
    
    await db.query(
      'INSERT INTO habit_members (habit_id, user_id) VALUES ($1, $2)',
      [originalHabit.habit_id, userId]
    );
    
    await db.query(
      'INSERT INTO habit_members (habit_id, user_id) VALUES ($1, $2)',
      [newHabit.id, originalHabit.owner_user_id]
    );
    
    res.json({ 
      success: true, 
      habit: newHabit,
      message: 'Successfully joined habit' 
    });
  } catch (error) {
    console.error('Join habit error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to join habit' 
    });
  }
});

// Получить профиль пользователя
router.get('/user/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await db.query(
      'SELECT id, telegram_id, username, first_name, last_name, language, is_premium, photo_url FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user profile'
    });
  }
});

// Обновить язык пользователя
router.patch('/user/language', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { language } = req.body;
    
    const validLanguages = ['en', 'ru', 'kk'];
    if (!validLanguages.includes(language)) {
      return res.status(400).json({
        success: false,
        error: `Invalid language. Valid options: ${validLanguages.join(', ')}`
      });
    }
    
    console.log(`Updating language for user ${userId} to ${language}`);
    
    const result = await db.query(
      'UPDATE users SET language = $1 WHERE id = $2 RETURNING id, language',
      [language, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    console.log(`✅ Language updated to ${language} for user ${userId}`);
    
    res.json({
      success: true,
      language: result.rows[0].language,
      message: `Language updated to ${language}`
    });
  } catch (error) {
    console.error('Update language error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update language'
    });
  }
});

// Удалить участника из привычки
router.delete('/habits/:habitId/members/:memberId', authMiddleware, async (req, res) => {
  const client = await db.getClient();
  
  try {
    const { habitId, memberId } = req.params;
    const userId = req.user.id;
    
    console.log(`🗑️ Removing member ${memberId} from habit ${habitId} by user ${userId}`);
    
    await client.query('BEGIN');
    
    const habitCheck = await client.query(
      'SELECT id, parent_habit_id FROM habits WHERE id = $1 AND user_id = $2',
      [habitId, userId]
    );
    
    if (habitCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Habit not found or access denied'
      });
    }
    
    const habit = habitCheck.rows[0];
    const parentHabitId = habit.parent_habit_id || habit.id;
    
    await client.query(
      `UPDATE habit_members 
       SET is_active = false 
       WHERE user_id = $1 
       AND habit_id IN (
         SELECT id FROM habits 
         WHERE parent_habit_id = $2 OR id = $2
       )`,
      [memberId, parentHabitId]
    );
    
    await client.query(
      `UPDATE habits 
       SET is_active = false 
       WHERE user_id = $1 
       AND (parent_habit_id = $2 OR 
            parent_habit_id = (SELECT parent_habit_id FROM habits WHERE id = $2 AND parent_habit_id IS NOT NULL))`,
      [memberId, habitId]
    );
    
    await client.query('COMMIT');
    
    console.log(`✅ Member ${memberId} removed from habit ${habitId}`);
    
    res.json({
      success: true,
      message: 'Member removed successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Remove member error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove member'
    });
  } finally {
    client.release();
  }
});

router.post('/habits/:habitId/punch/:userId', authMiddleware, async (req, res) => {
  try {
    const { habitId, userId: targetUserId } = req.params;
    const fromUserId = req.user.id;
    
    console.log(`🥊 Punch request from user ${fromUserId} to user ${targetUserId} for habit ${habitId}`);
    
    const today = new Date().toISOString().split('T')[0];
    
    const targetHabitResult = await db.query(
      `SELECT h.id, h.title, h.parent_habit_id
       FROM habits h
       WHERE h.user_id = $1
       AND (
         h.parent_habit_id = (SELECT parent_habit_id FROM habits WHERE id = $2)
         OR h.parent_habit_id = $2
         OR h.id = (SELECT parent_habit_id FROM habits WHERE id = $2)
         OR (h.parent_habit_id IS NULL AND h.id = $2)
       )
       AND h.is_active = true
       LIMIT 1`,
      [targetUserId, habitId]
    );
    
    if (targetHabitResult.rows.length === 0) {
      console.log('❌ Target habit not found');
      return res.status(404).json({ 
        success: false, 
        error: 'Friend habit not found',
        showToast: true,
        toastMessage: 'Friend\'s habit not found 😕',
        toastType: 'error'
      });
    }
    
    const targetHabitId = targetHabitResult.rows[0].id;
    const habitTitle = targetHabitResult.rows[0].title;
    
    console.log(`📋 Found target habit: ${targetHabitId} - "${habitTitle}"`);
    
    const statusResult = await db.query(
      `SELECT status 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND date = $2::date`,
      [targetHabitId, today]
    );
    
    const friendResult = await db.query(
      'SELECT first_name, telegram_id FROM users WHERE id = $1',
      [targetUserId]
    );
    
    const friendName = friendResult.rows.length > 0 
      ? friendResult.rows[0].first_name 
      : 'Your friend';
    
    const friendTelegramId = friendResult.rows.length > 0 
      ? friendResult.rows[0].telegram_id 
      : null;
    
    const senderResult = await db.query(
      'SELECT first_name FROM users WHERE id = $1',
      [fromUserId]
    );
    
    const senderName = senderResult.rows.length > 0 
      ? senderResult.rows[0].first_name 
      : 'Your friend';
    
    if (statusResult.rows.length > 0 && statusResult.rows[0].status === 'completed') {
      console.log(`✅ Habit already completed by ${friendName}, not sending punch`);
      
      return res.json({ 
        success: false,
        alreadyCompleted: true,
        showToast: true,
        toastType: 'info',
        toastMessage: `У ${friendName} уже выполнено 👌`,
        friendName: friendName,
        habitTitle: habitTitle
      });
    }
    
    let messageText;
    let toastMessage;
    
    if (statusResult.rows.length > 0 && statusResult.rows[0].status === 'skipped') {
      console.log(`⏭ Habit skipped by ${friendName}, sending special punch`);
      
      messageText = `👊 <b>Напоминание от ${senderName}!</b>\n\n` +
        `Твой друг заметил, что ты пропустил привычку:\n` +
        `📝 <b>"${habitTitle}"</b>\n\n` +
        `Никогда не поздно начать снова! Давай, ты можешь! 💪\n` +
        `<i>Каждый день - это новый шанс!</i>`;
      
      toastMessage = `Панч отправлен ${friendName}! Привычка была пропущена 🔄`;
    } else {
      console.log(`📤 Sending regular punch to ${friendName}`);
      
      messageText = `👊 <b>Напоминание от ${senderName}!</b>\n\n` +
        `Твой друг хочет, чтобы ты выполнил:\n` +
        `📝 <b>"${habitTitle}"</b>\n\n` +
        `Не подведи его! Выполни сейчас! 💪`;
      
      toastMessage = `Панч отправлен ${friendName}! 👊`;
    }
    
    if (friendTelegramId) {
      console.log(`📱 Sending Telegram notification to ${friendTelegramId}`);
      
      const bot = require('../server').bot;
      
      try {
        await bot.sendMessage(
          friendTelegramId,
          messageText,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { 
                    text: '✅ Отметить выполненным', 
                    callback_data: `quick_done_${targetHabitId}_${today}` 
                  }
                ],
                [
                  {
                    text: '📱 Открыть приложение',
                    web_app: { url: process.env.WEBAPP_URL || process.env.FRONTEND_URL }
                  }
                ]
              ]
            }
          }
        );
        
        console.log('✅ Telegram notification sent successfully');
      } catch (botError) {
        console.error('❌ Failed to send Telegram notification:', botError.message);
      }
    }
    
    await db.query(
      'INSERT INTO habit_punches (habit_id, from_user_id, to_user_id) VALUES ($1, $2, $3)',
      [habitId, fromUserId, targetUserId]
    );
    
    console.log('✅ Punch saved to database');
    
    return res.json({ 
      success: true,
      showToast: true,
      toastType: 'success',
      toastMessage: toastMessage,
      friendName: friendName
    });
    
  } catch (error) {
    console.error('❌ Punch error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send punch',
      showToast: true,
      toastType: 'error',
      toastMessage: 'Не удалось отправить панч. Попробуйте ещё раз.'
    });
  }
});

// Создать ссылку для шаринга
router.post('/habits/:id/share', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const habit = await db.query(
      'SELECT * FROM habits WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (habit.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Habit not found' });
    }
    
    let shareResult = await db.query(
      'SELECT share_code FROM shared_habits WHERE habit_id = $1',
      [id]
    );
    
    let shareCode;
    if (shareResult.rows.length === 0) {
      shareCode = `${id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await db.query(
        'INSERT INTO shared_habits (habit_id, owner_user_id, share_code) VALUES ($1, $2, $3)',
        [id, userId, shareCode]
      );
      
      await db.query(
        'INSERT INTO habit_members (habit_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, userId]
      );
    } else {
      shareCode = shareResult.rows[0].share_code;
    }
    
    res.json({ success: true, shareCode });
  } catch (error) {
    console.error('Create share link error:', error);
    res.status(500).json({ success: false, error: 'Failed to create share link' });
  }
});

// Получить участников привычки
router.get('/habits/:id/members', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const habitInfo = await db.query(
      'SELECT parent_habit_id FROM habits WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (habitInfo.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Habit not found' 
      });
    }
    
    const parentHabitId = habitInfo.rows[0].parent_habit_id;
    const targetHabitId = parentHabitId || id;
    
    const members = await db.query(
      `SELECT DISTINCT u.id, u.first_name, u.last_name, u.username, u.photo_url
       FROM habit_members hm
       JOIN users u ON hm.user_id = u.id
       WHERE hm.habit_id IN (
         SELECT id FROM habits 
         WHERE parent_habit_id = $1 OR id = $1
       )
       AND hm.is_active = true
       AND u.id != $2`,
      [targetHabitId, userId]
    );
    
    res.json({ 
      success: true, 
      members: members.rows 
    });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get members' 
    });
  }
});

// Эндпоинт для активации премиум подписки
router.post('/subscription/activate', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { plan } = req.body;
    
    const planMapping = {
      'month': '6_months',
      'year': '1_year'
    };
    
    const planType = planMapping[plan] || plan;
    
    console.log(`💎 Activating subscription for user ${userId}, plan: ${planType}`);
    
    const result = await SubscriptionService.createSubscription(userId, planType);
    
    if (!result.success) {
      throw new Error('Failed to create subscription');
    }
    
    const verifyResult = await db.query(
      'SELECT is_premium, subscription_type, subscription_expires_at FROM users WHERE id = $1',
      [userId]
    );
    
    console.log('✅ Verification after activation:', verifyResult.rows[0]);
    
    res.json({
      success: true,
      message: result.message,
      subscription: result.subscription,
      user: result.user
    });
  } catch (error) {
    console.error('💥 Subscription activation error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to activate subscription'
    });
  }
});

// Эндпоинт для проверки статуса подписки
router.get('/subscription/check', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const status = await SubscriptionService.checkUserSubscription(userId);
    
    console.log(`📊 Subscription check result for user ${userId}:`, status);
    
    res.json({
      success: true,
      hasSubscription: status.isPremium,
      subscription: status.subscription,
      isPremium: status.isPremium,
      habitCount: status.habitCount,
      limit: status.limit,
      canCreateMore: status.canCreateMore
    });
  } catch (error) {
    console.error('💥 Subscription check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check subscription'
    });
  }
});

function getPlanName(planType) {
  const plans = {
    '6_months': 'Premium for 6 Months',
    '1_year': 'Premium for 1 Year',
    'lifetime': 'Lifetime Premium',
    'trial_7_days': 'Free Trial (7 days)'
  };
  return plans[planType] || 'Premium';
}

router.post('/subscription/cancel', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log(`🚫 Starting subscription cancellation for user ${userId}`);
    
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      const userResult = await client.query(
        'SELECT id, is_premium, subscription_type FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const user = userResult.rows[0];
      console.log(`Current user status:`, user);
      
      if (!user.is_premium) {
        await client.query('ROLLBACK');
        return res.json({
          success: false,
          error: 'No active subscription to cancel'
        });
      }
      
      await client.query(
        `UPDATE subscriptions 
         SET is_active = false, 
             cancelled_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      
      await client.query(
        `UPDATE users 
         SET is_premium = false,
             subscription_type = NULL,
             subscription_expires_at = NULL
         WHERE id = $1`,
        [userId]
      );
      
      try {
        await client.query(
          `INSERT INTO subscription_history (user_id, action, created_at) 
           VALUES ($1, 'cancelled', CURRENT_TIMESTAMP)`,
          [userId]
        );
      } catch (historyError) {
        console.log('History table not found, skipping');
      }
      
      await client.query('COMMIT');
      
      console.log(`✅ Subscription cancelled successfully for user ${userId}`);
      
      res.json({
        success: true,
        message: 'Subscription cancelled successfully'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('💥 Subscription cancellation error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel subscription'
    });
  }
});

// Эндпоинт для получения истории подписок
router.get('/subscription/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await db.query(
      `SELECT 
        s.id as subscription_id,
        s.plan_type,
        s.plan_name,
        s.price_stars,
        s.started_at as created_at,
        s.expires_at,
        s.is_active,
        s.payment_method,
        tp.telegram_payment_charge_id
       FROM subscriptions s
       LEFT JOIN telegram_payments tp ON tp.telegram_payment_charge_id = s.telegram_payment_charge_id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 20`,
      [userId]
    );
    
    console.log(`📜 Found ${result.rows.length} subscription history records for user ${userId}`);
    
    res.json({
      success: true,
      history: result.rows
    });
  } catch (error) {
    console.error('💥 Get history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get subscription history'
    });
  }
});

// Отладочный эндпоинт для проверки подписки
router.get('/subscription/debug', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const userResult = await db.query(
      `SELECT 
        id,
        telegram_id,
        is_premium,
        subscription_type,
        subscription_expires_at
       FROM users 
       WHERE id = $1`,
      [userId]
    );
    
    const subscriptionResult = await db.query(
      `SELECT 
        id,
        plan_type,
        plan_name,
        started_at,
        expires_at,
        is_active
       FROM subscriptions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 5`,
      [userId]
    );
    
    res.json({
      success: true,
      user: userResult.rows[0],
      subscriptions: subscriptionResult.rows,
      checkResult: await SubscriptionService.checkUserSubscription(userId)
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Проверка лимитов на добавление друзей
router.get('/habits/:id/check-friend-limit', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    console.log(`🔍 Checking friend limit for habit ${id}, user ${userId}`);
    
    const habitCheck = await db.query(
      'SELECT id, parent_habit_id FROM habits WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (habitCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }
    
    const habit = habitCheck.rows[0];
    const targetHabitId = habit.parent_habit_id || habit.id;
    
    const userResult = await db.query(
      'SELECT is_premium FROM users WHERE id = $1',
      [userId]
    );
    
    const isPremium = userResult.rows[0]?.is_premium || false;
    
    if (isPremium) {
      return res.json({
        success: true,
        canAddFriend: true,
        isPremium: true,
        currentFriendsCount: 0,
        limit: null
      });
    }
    
    const friendsCount = await db.query(
      `SELECT COUNT(DISTINCT hm.user_id) as count
       FROM habit_members hm
       WHERE hm.habit_id IN (
         SELECT id FROM habits 
         WHERE (parent_habit_id = $1 OR id = $1)
         AND is_active = true
       )
       AND hm.is_active = true
       AND hm.user_id != $2`,
      [targetHabitId, userId]
    );
    
    const currentCount = parseInt(friendsCount.rows[0].count);
    const limit = 1;
    
    console.log(`📊 Friend limit check: ${currentCount}/${limit} friends`);
    
    res.json({
      success: true,
      canAddFriend: currentCount < limit,
      isPremium: false,
      currentFriendsCount: currentCount,
      limit: limit,
      showPremiumModal: currentCount >= limit
    });
  } catch (error) {
    console.error('❌ Check friend limit error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check friend limit'
    });
  }
});

// Эндпоинт для получения доступных планов
router.get('/subscription/plans', async (req, res) => {
  try {
    const plans = SubscriptionService.PLANS;
    
    res.json({
      success: true,
      plans: Object.keys(plans).map(key => ({
        id: key,
        ...plans[key]
      }))
    });
  } catch (error) {
    console.error('💥 Get plans error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get subscription plans'
    });
  }
});
// 🆕 Получить информацию о владельце привычки
// 🆕 Получить информацию о владельце привычки (с поддержкой creator_id)
// В routes/habitRoutes.js замените эндпоинт на:

router.get('/habits/:id/owner', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🔍 Getting owner info for habit ${id}`);
    
    // Получаем информацию о привычке с creator_id
    const result = await db.query(
      `SELECT 
        h.id, 
        h.user_id,
        h.creator_id,
        h.parent_habit_id,
        u.first_name as creator_first_name,
        u.last_name as creator_last_name,
        u.username as creator_username,
        u.id as creator_user_db_id
       FROM habits h
       LEFT JOIN users u ON COALESCE(h.creator_id, h.user_id) = u.id
       WHERE h.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }
    
    const habitInfo = result.rows[0];
    
    // ВАЖНО: Используем creator_id, если есть, иначе user_id
    const actualCreatorId = habitInfo.creator_id || habitInfo.user_id;
    
    console.log('✅ Owner info found:', {
      habitId: habitInfo.id,
      creatorId: actualCreatorId,
      userId: habitInfo.user_id,
      parentHabitId: habitInfo.parent_habit_id,
      creatorName: habitInfo.creator_first_name,
      creatorUserDbId: habitInfo.creator_user_db_id
    });
    
    res.json({
      success: true,
      habit_id: habitInfo.id,
      creator_id: actualCreatorId, // ← КРИТИЧЕСКИ ВАЖНО
      user_id: habitInfo.user_id,
      parent_habit_id: habitInfo.parent_habit_id,
      creator_name: `${habitInfo.creator_first_name || ''} ${habitInfo.creator_last_name || ''}`.trim(),
      creator_username: habitInfo.creator_username,
      creator_user_db_id: habitInfo.creator_user_db_id
    });
  } catch (error) {
    console.error('Get owner info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get owner info'
    });
  }
});

// Отметки
router.post('/habits/:id/mark', markController.markHabit);
router.delete('/habits/:id/mark', markController.unmarkHabit);
// Отметки


module.exports = router;