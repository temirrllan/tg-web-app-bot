const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const habitController = require('../controllers/habitController');
const categoryController = require('../controllers/categoryController');
const markController = require('../controllers/markController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkSubscriptionLimit } = require('../middleware/subscription');
const { createHabitLimiter } = require('../middleware/rateLimit');
const db = require('../config/database');
const SubscriptionService = require('../services/subscriptionService');
const { getToday, getAlmatyDate } = require('../utils/dateHelper');

// Применяем auth middleware к остальным роутам
router.use(authMiddleware);

// Категории (после auth — нужен req.user.language)
router.get('/categories', categoryController.getAll);

// Привычки
router.post('/habits', createHabitLimiter, checkSubscriptionLimit, habitController.create);
router.get('/habits', habitController.getAll);
router.get('/habits/today', habitController.getTodayHabits);

// 🆕 ОБНОВЛЁННЫЙ РОУТ РЕДАКТИРОВАНИЯ с проверкой владельца и уведомлениями
// В controllers/habitController.js замените роут PATCH на:

// В controllers/habitController.js замените роут PATCH на:

// Полная версия PATCH эндпоинта для routes/habitRoutes.js
// Замените весь существующий router.patch('/habits/:id', ...) на этот код
function calculateDayPeriod(reminderTime) {
  if (!reminderTime) {
    return 'morning';
  }
  
  const [hours] = reminderTime.split(':').map(Number);
  
  if (hours >= 6 && hours < 12) return 'morning';
  if (hours >= 12 && hours < 18) return 'afternoon';
  if (hours >= 18 && hours < 24) return 'evening';
  return 'night';
}
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
    // 🔥 НОВАЯ ЛОГИКА: Автоматический пересчёт day_period при изменении reminder_time
    if (updates.reminder_time !== undefined) {
      updates.day_period = calculateDayPeriod(updates.reminder_time);
      console.log(`📍 Auto-recalculated day_period: ${updates.day_period} (from time: ${updates.reminder_time || 'not set'})`);
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

    // 🔥 ПРОВЕРКА ПРАВ: creator_id с fallback на user_id
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

    // 🔔 УЛУЧШЕННЫЕ УВЕДОМЛЕНИЯ для участников
    let notificationCount = 0;
    
    try {
      const bot = require('../server').bot;
      
      if (!bot) {
        console.warn('⚠️ Bot not available, skipping notifications');
        // Не бросаем ошибку, просто продолжаем без уведомлений
        return res.json({
          success: true,
          habit: updatedHabit,
          membersNotified: false,
          notificationCount: 0
        });
      }
      
      // Получаем информацию о редакторе (создателе привычки)
      const editorResult = await db.query(
        'SELECT first_name, last_name, language FROM users WHERE id = $1',
        [userId]
      );
      
      const editorName = editorResult.rows.length > 0 
        ? `${editorResult.rows[0].first_name} ${editorResult.rows[0].last_name || ''}`.trim()
        : 'Creator';

      // Определяем, какая привычка является родительской
      const targetHabitId = habit.parent_habit_id || habit.id;

      // Получаем всех участников связанных привычек
      const membersResult = await db.query(
        `SELECT DISTINCT u.id, u.telegram_id, u.first_name, u.language, h.id as habit_id, h.title as old_title
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

      notificationCount = membersResult.rows.length;
      console.log(`📤 Sending edit notifications to ${notificationCount} members`);

      // 🔥 УЛУЧШЕННЫЕ СООБЩЕНИЯ: показываем, КТО редактировал и ЧТО изменилось
      for (const member of membersResult.rows) {
        try {
          const lang = member.language || 'en';
          
          // Формируем список изменений
          let changesText = '';
          
          if (updates.title && updates.title !== habit.title) {
            changesText += lang === 'ru' 
              ? `\n📝 Название: "${updates.title}"`
              : lang === 'kk' 
              ? `\n📝 Атауы: "${updates.title}"`
              : `\n📝 Title: "${updates.title}"`;
          }
          
          if (updates.goal && updates.goal !== habit.goal) {
            changesText += lang === 'ru' 
              ? `\n🎯 Цель: ${updates.goal}`
              : lang === 'kk' 
              ? `\n🎯 Мақсат: ${updates.goal}`
              : `\n🎯 Goal: ${updates.goal}`;
          }
          
          if (updates.schedule_days && JSON.stringify(updates.schedule_days) !== JSON.stringify(habit.schedule_days)) {
            const daysCount = updates.schedule_days.length;
            changesText += lang === 'ru' 
              ? `\n📅 График: ${daysCount} ${daysCount === 1 ? 'день' : daysCount < 5 ? 'дня' : 'дней'} в неделю`
              : lang === 'kk' 
              ? `\n📅 Кесте: аптасына ${daysCount} күн`
              : `\n📅 Schedule: ${daysCount} day${daysCount !== 1 ? 's' : ''} per week`;
          }
          
          if (updates.reminder_time !== undefined && updates.reminder_time !== habit.reminder_time) {
            if (updates.reminder_time) {
              changesText += lang === 'ru' 
                ? `\n⏰ Напоминание: ${updates.reminder_time}`
                : lang === 'kk' 
                ? `\n⏰ Еске салу: ${updates.reminder_time}`
                : `\n⏰ Reminder: ${updates.reminder_time}`;
            } else {
              changesText += lang === 'ru' 
                ? `\n⏰ Напоминание отключено`
                : lang === 'kk' 
                ? `\n⏰ Еске салу өшірілді`
                : `\n⏰ Reminder disabled`;
            }
          }

          // Если изменений нет в заголовке, добавляем общее сообщение
          if (!changesText) {
            changesText = lang === 'ru' 
              ? `\n\n✨ Настройки привычки обновлены`
              : lang === 'kk' 
              ? `\n\n✨ Әдет параметрлері жаңартылды`
              : `\n\n✨ Habit settings updated`;
          }
          
          // 🔥 ПОДРОБНОЕ УВЕДОМЛЕНИЕ с информацией о редакторе
          const messages = {
            en: `📝 <b>Habit Updated!</b>\n\n👤 <b>${editorName}</b> updated the shared habit:\n<b>"${updatedHabit.title}"</b>${changesText}\n\n💡 These changes have been applied to your habit as well.\n\nOpen the app to see the updates! 👇`,
            ru: `📝 <b>Привычка обновлена!</b>\n\n👤 <b>${editorName}</b> изменил(а) совместную привычку:\n<b>"${updatedHabit.title}"</b>${changesText}\n\n💡 Изменения применены и к вашей привычке.\n\nОткройте приложение, чтобы увидеть обновления! 👇`,
            kk: `📝 <b>Әдет жаңартылды!</b>\n\n👤 <b>${editorName}</b> ортақ әдетті өзгертті:\n<b>"${updatedHabit.title}"</b>${changesText}\n\n💡 Өзгерістер сіздің әдетіңізге де қолданылды.\n\nЖаңартуларды көру үшін қосымшаны ашыңыз! 👇`
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

          console.log(`✅ Detailed notification sent to ${member.first_name} (ID: ${member.id})`);

          // Обновляем привычку участника с новыми данными
          await db.query(
            `UPDATE habits 
             SET title = $1, 
                 goal = $2,
                 schedule_type = $3,
                 schedule_days = $4,
                 reminder_time = $5,
                 reminder_enabled = $6,
                 updated_at = CURRENT_TIMESTAMP
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

          console.log(`✅ Habit updated for member ${member.first_name} (habit_id: ${member.habit_id})`);

        } catch (notifError) {
          console.error(`❌ Failed to notify member ${member.first_name}:`, notifError.message);
          // Продолжаем отправку другим участникам
        }
      }

    } catch (notificationError) {
      console.error('❌ Notification error (non-critical):', notificationError.message);
      // Не прерываем выполнение - привычка уже обновлена
    }

    // ✅ УСПЕШНЫЙ ОТВЕТ
    res.json({
      success: true,
      habit: updatedHabit,
      membersNotified: notificationCount > 0,
      notificationCount: notificationCount
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

// ── Lightweight member-counts poll ──────────────────────────────────────────
// Returns [{id, members_count}] for all active habits of the user.
// Used by Today.jsx to dynamically refresh the "+N участников" badge.
router.get('/habits/member-counts', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      `SELECT
         h.id,
         CASE
           WHEN h.parent_habit_id IS NOT NULL THEN
             (SELECT COUNT(DISTINCT user_id) - 1
                FROM habit_members
               WHERE habit_id IN (
                 SELECT id FROM habits
                  WHERE parent_habit_id = h.parent_habit_id OR id = h.parent_habit_id
               ) AND is_active = true)
           ELSE
             (SELECT COUNT(DISTINCT user_id) - 1
                FROM habit_members
               WHERE habit_id IN (
                 SELECT id FROM habits
                  WHERE parent_habit_id = h.id OR id = h.id
               ) AND is_active = true)
         END AS members_count
       FROM habits h
       WHERE h.user_id = $1 AND h.is_active = true`,
      [userId]
    );
    res.json({ success: true, counts: result.rows });
  } catch (err) {
    console.error('member-counts error:', err.message);
    res.status(500).json({ success: false });
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
        h.day_period,
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
         AND (h.is_special = false OR h.is_special IS NULL)
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

    // Fetch streak_current and streak_best — habit must belong to this user
    const habitCheck = await db.query(
      `SELECT id, title, streak_current, streak_best
       FROM habits
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (habitCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Habit not found' });
    }

    const habit = habitCheck.rows[0];
    const now = new Date();

    // Week: Mon–Sun (ISO week)
    const dayOfWeek = now.getDay(); // 0=Sun,1=Mon...6=Sat
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diffToMon);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd   = new Date(now.getFullYear(), 11, 31);

    // Run all queries in parallel
    const [weekRows, monthRows, yearRows, weekDaysRows, totalRows] = await Promise.all([
      // Week count
      db.query(
        `SELECT COUNT(*) AS completed FROM habit_marks
         WHERE habit_id = $1 AND status = 'completed'
           AND date >= $2::date AND date <= $3::date`,
        [id, weekStart, weekEnd]
      ),
      // Month count
      db.query(
        `SELECT COUNT(*) AS completed FROM habit_marks
         WHERE habit_id = $1 AND status = 'completed'
           AND date >= $2::date AND date <= $3::date`,
        [id, monthStart, monthEnd]
      ),
      // Year count
      db.query(
        `SELECT COUNT(*) AS completed FROM habit_marks
         WHERE habit_id = $1 AND status = 'completed'
           AND date >= $2::date AND date <= $3::date`,
        [id, yearStart, yearEnd]
      ),
      // Which specific days of this week were completed (to build weeklyData array)
      db.query(
        `SELECT date FROM habit_marks
         WHERE habit_id = $1 AND status = 'completed'
           AND date >= $2::date AND date <= $3::date`,
        [id, weekStart, weekEnd]
      ),
      // Total completed marks ever
      db.query(
        `SELECT COUNT(*) AS total FROM habit_marks
         WHERE habit_id = $1 AND status = 'completed'`,
        [id]
      )
    ]);

    // Build weeklyData[0..6] where index 0 = Monday, 6 = Sunday
    const weeklyData = new Array(7).fill(false);
    weekDaysRows.rows.forEach(row => {
      const d = new Date(row.date);
      // getDay(): 0=Sun, 1=Mon ... 6=Sat  →  map to Mon=0..Sun=6
      const dow = d.getDay();
      const idx = dow === 0 ? 6 : dow - 1;
      weeklyData[idx] = true;
    });

    res.json({
      success: true,
      currentStreak:  habit.streak_current || 0,
      bestStreak:     habit.streak_best    || habit.streak_current || 0,
      weekCompleted:  parseInt(weekRows.rows[0].completed),
      monthCompleted: parseInt(monthRows.rows[0].completed),
      monthTotal:     monthEnd.getDate(),
      yearCompleted:  parseInt(yearRows.rows[0].completed),
      totalCompleted: parseInt(totalRows.rows[0].total),
      weeklyData
    });
  } catch (error) {
    console.error('Get habit statistics error:', error);
    res.status(500).json({ success: false, error: 'Failed to get statistics' });
  }
});

// Присоединиться к привычке по коду
router.post('/habits/join', authMiddleware, async (req, res) => {
  const client = await db.getClient();
  
  try {
    const { shareCode } = req.body;
    const userId = req.user.id;
    
    console.log('🎯 Join habit request:', { shareCode, userId });
    
    if (!shareCode) {
      return res.status(400).json({ 
        success: false, 
        error: 'Share code is required' 
      });
    }
    
    await client.query('BEGIN');
    
    // Получаем информацию о привычке
    const shareResult = await client.query(
      `SELECT 
        sh.share_code,
        sh.habit_id,
        sh.owner_user_id,
        h.*,
        u.first_name as owner_name
       FROM shared_habits sh
       JOIN habits h ON sh.habit_id = h.id
       JOIN users u ON sh.owner_user_id = u.id
       WHERE sh.share_code = $1`,
      [shareCode]
    );
    
    if (shareResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log('❌ Invalid share code:', shareCode);
      return res.status(404).json({ 
        success: false, 
        error: 'Invalid or expired share code' 
      });
    }
    
    const originalHabit = shareResult.rows[0];
    
    console.log('📋 Found habit:', {
      id: originalHabit.habit_id,
      title: originalHabit.title,
      owner: originalHabit.owner_name
    });
    
    // Проверяем, не является ли пользователь уже владельцем
    if (originalHabit.owner_user_id === userId) {
      await client.query('ROLLBACK');
      console.log('⚠️ User is the owner of this habit');
      return res.json({
        success: true,
        message: 'You are already the owner of this habit',
        habit: originalHabit,
        alreadyMember: true
      });
    }
    
    // Проверяем существующее членство
    const memberCheck = await client.query(
      `SELECT hm.*, h.id as user_habit_id, h.is_active as habit_active
       FROM habit_members hm
       LEFT JOIN habits h ON (h.user_id = $1 AND (h.parent_habit_id = $2 OR h.id = $2))
       WHERE hm.habit_id = $2 AND hm.user_id = $1`,
      [userId, originalHabit.habit_id]
    );
    
    if (memberCheck.rows.length > 0) {
      const membership = memberCheck.rows[0];
      
      if (membership.is_active && membership.habit_active) {
        await client.query('ROLLBACK');
        console.log('✅ User is already an active member');
        
        // Возвращаем существующую привычку
        const existingHabit = await client.query(
          `SELECT h.* FROM habits h
           WHERE h.user_id = $1 
           AND (h.parent_habit_id = $2 OR h.id = $2)
           AND h.is_active = true
           LIMIT 1`,
          [userId, originalHabit.habit_id]
        );
        
        return res.json({
          success: true,
          message: 'You are already a member of this habit',
          habit: existingHabit.rows[0] || originalHabit,
          alreadyMember: true
        });
      } else {
        // Реактивируем членство
        console.log('🔄 Reactivating membership');
        
        await client.query(
          'UPDATE habit_members SET is_active = true WHERE habit_id = $1 AND user_id = $2',
          [originalHabit.habit_id, userId]
        );
        
        if (membership.user_habit_id) {
          const reactivatedHabit = await client.query(
            'UPDATE habits SET is_active = true WHERE id = $1 RETURNING *',
            [membership.user_habit_id]
          );
          
          await client.query('COMMIT');
          
          console.log('✅ Habit reactivated');
          
          return res.json({ 
            success: true, 
            message: 'Successfully rejoined habit',
            habit: reactivatedHabit.rows[0]
          });
        }
      }
    }
    
    // 🔥 СОЗДАЁМ НОВУЮ ПРИВЫЧКУ ДЛЯ ПОЛЬЗОВАТЕЛЯ
    const creatorId = originalHabit.creator_id || originalHabit.user_id;
    
    console.log('➕ Creating new habit copy for user');
    
    const newHabitResult = await client.query(
      `INSERT INTO habits (
        user_id, 
        creator_id, 
        category_id, 
        title, 
        goal, 
        schedule_type, 
        schedule_days, 
        reminder_time, 
        reminder_enabled, 
        is_bad_habit,
        parent_habit_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        userId,                              // user_id - новый участник
        creatorId,                           // creator_id - оригинальный создатель
        originalHabit.category_id,
        originalHabit.title,
        originalHabit.goal,
        originalHabit.schedule_type,
        originalHabit.schedule_days,
        originalHabit.reminder_time,
        originalHabit.reminder_enabled,
        originalHabit.is_bad_habit,
        originalHabit.habit_id              // parent_habit_id
      ]
    );
    
    const newHabit = newHabitResult.rows[0];
    
    console.log('✅ New habit created:', {
      id: newHabit.id,
      userId: newHabit.user_id,
      creatorId: newHabit.creator_id,
      parentHabitId: newHabit.parent_habit_id
    });
    
    // Добавляем членство для оригинальной привычки
    await client.query(
      `INSERT INTO habit_members (habit_id, user_id, is_active) 
       VALUES ($1, $2, true)
       ON CONFLICT (habit_id, user_id) 
       DO UPDATE SET is_active = true`,
      [originalHabit.habit_id, userId]
    );
    
    // Добавляем владельца как члена новой привычки
    await client.query(
      `INSERT INTO habit_members (habit_id, user_id, is_active) 
       VALUES ($1, $2, true)
       ON CONFLICT (habit_id, user_id) 
       DO UPDATE SET is_active = true`,
      [newHabit.id, creatorId]
    );
    
    await client.query('COMMIT');
    
    console.log('✅ User successfully joined habit');
    
    // Отправляем уведомление владельцу
    try {
      const bot = require('../server').bot;
      
      const ownerResult = await db.query(
        'SELECT telegram_id, language FROM users WHERE id = $1',
        [creatorId]
      );
      
      if (ownerResult.rows.length > 0) {
        const owner = ownerResult.rows[0];
        const newMember = req.user;
        
        const messages = {
          en: `👥 <b>New Member!</b>\n\n${newMember.first_name} ${newMember.last_name || ''} joined your habit:\n<b>"${originalHabit.title}"</b>\n\nTrack together and motivate each other! 💪`,
          ru: `👥 <b>Новый участник!</b>\n\n${newMember.first_name} ${newMember.last_name || ''} присоединился к вашей привычке:\n<b>"${originalHabit.title}"</b>\n\nОтслеживайте вместе и мотивируйте друг друга! 💪`,
          kk: `👥 <b>Жаңа қатысушы!</b>\n\n${newMember.first_name} ${newMember.last_name || ''} сіздің әдетіңізге қосылды:\n<b>"${originalHabit.title}"</b>\n\nБірге қадағалаңыз және бірін-бірі ынталандырыңыз! 💪`
        };
        
        const lang = owner.language || 'en';
        const message = messages[lang] || messages['en'];
        
        await bot.sendMessage(owner.telegram_id, message, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              {
                text: lang === 'ru' ? '📱 Открыть приложение' : 
                      lang === 'kk' ? '📱 Қосымшаны ашу' : 
                      '📱 Open App',
                web_app: { 
                  url: process.env.WEBAPP_URL || process.env.FRONTEND_URL 
                }
              }
            ]]
          }
        });
        
        console.log('✅ Owner notified');
      }
    } catch (notifError) {
      console.error('⚠️ Failed to notify owner (non-critical):', notifError.message);
    }
    
    res.json({ 
      success: true, 
      habit: newHabit,
      message: 'Successfully joined habit',
      habitTitle: originalHabit.title,
      ownerName: originalHabit.owner_name
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('💥 Join habit error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to join habit',
      details: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  } finally {
    client.release();
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
       SET is_active = false, reminder_enabled = false
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
    
    const today = getToday();
    
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
// В habitRoutes.js ЗАМЕНИТЕ эндпоинт POST /habits/:id/share

// Фрагмент из routes/habitRoutes.js
// Эндпоинт для создания ссылки для шаринга

router.post('/habits/:id/share', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    console.log('🔗 Creating share link:', { habitId: id, userId });
    
    // Проверяем, что привычка принадлежит пользователю
    const habit = await db.query(
      'SELECT * FROM habits WHERE id = $1 AND user_id = $2 AND is_active = true',
      [id, userId]
    );
    
    if (habit.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Habit not found' 
      });
    }
    
    // Проверяем существующий share код
    let shareResult = await db.query(
      'SELECT share_code FROM shared_habits WHERE habit_id = $1',
      [id]
    );
    
    let shareCode;
    
    if (shareResult.rows.length === 0) {
      // 🔥 КРИТИЧНО: Создаём код С префиксом join_
      // Формат: join_{habitId}_{timestamp}_{random}
      shareCode = `join_${id}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      
      console.log('➕ Creating new share code:', shareCode);
      
      // Сохраняем в БД
      await db.query(
        'INSERT INTO shared_habits (habit_id, owner_user_id, share_code) VALUES ($1, $2, $3)',
        [id, userId, shareCode]
      );
      
      // Добавляем владельца как члена (если ещё не добавлен)
      await db.query(
        `INSERT INTO habit_members (habit_id, user_id, is_active) 
         VALUES ($1, $2, true) 
         ON CONFLICT (habit_id, user_id) 
         DO UPDATE SET is_active = true`,
        [id, userId]
      );
      
      console.log('✅ New share code created and saved');
    } else {
      shareCode = shareResult.rows[0].share_code;
      
      // 🔥 ВАЖНО: Если старый код без префикса - обновляем
      if (!shareCode.startsWith('join_')) {
        shareCode = `join_${shareCode}`;
        
        console.log('🔄 Updating old share code to include join_ prefix');
        
        await db.query(
          'UPDATE shared_habits SET share_code = $1 WHERE habit_id = $2',
          [shareCode, id]
        );
        
        console.log('✅ Share code updated with join_ prefix:', shareCode);
      } else {
        console.log('✅ Using existing share code:', shareCode);
      }
    }
    
    console.log('📤 Returning share code:', shareCode);
    
    res.json({ 
      success: true, 
      shareCode: shareCode,
      habitId: id,
      // Для удобства также возвращаем полную ссылку
      shareUrl: `https://t.me/CheckHabitlyBot?start=${shareCode}`
    });
  } catch (error) {
    console.error('❌ Share link error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create share link',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
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
    
    // 🆕 Получаем участников с их статусом на сегодня
    const today = getToday();
    
    // Monday of current week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));
    const weekStartStr  = getAlmatyDate(weekStart);
    // First day of current month
    const monthStartStr = getAlmatyDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

    const members = await db.query(
      `SELECT DISTINCT ON (u.id)
        u.id,
        u.first_name,
        u.last_name,
        u.username,
        u.photo_url,
        h.id            AS member_habit_id,
        h.streak_current,
        h.streak_best,
        COALESCE(hm_today.status, 'pending')  AS today_status,
        COALESCE(week_agg.count,  0)::int     AS week_completed,
        COALESCE(month_agg.count, 0)::int     AS month_completed
       FROM habit_members hmem
       JOIN users  u  ON hmem.user_id = u.id
       JOIN habits h  ON h.user_id = u.id
                     AND (h.parent_habit_id = $1 OR h.id = $1)
                     AND h.is_active = true
       LEFT JOIN habit_marks hm_today
              ON hm_today.habit_id = h.id
             AND hm_today.date = $3::date
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS count
           FROM habit_marks
          WHERE habit_id = h.id
            AND status   = 'completed'
            AND date    >= $4::date
            AND date    <= $3::date
       ) week_agg  ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS count
           FROM habit_marks
          WHERE habit_id = h.id
            AND status   = 'completed'
            AND date    >= $5::date
            AND date    <= $3::date
       ) month_agg ON true
       WHERE hmem.habit_id IN (
         SELECT id FROM habits WHERE parent_habit_id = $1 OR id = $1
       )
       AND hmem.is_active = true
       AND u.id != $2
       ORDER BY u.id, u.first_name`,
      [targetHabitId, userId, today, weekStartStr, monthStartStr]
    );

    console.log(`📊 Found ${members.rows.length} members with stats for ${today}`);
    
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
      'month': 'months',
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

    // Subscriptions
    const subsResult = await db.query(
      `SELECT
        'subscription'            AS purchase_type,
        s.id                      AS purchase_id,
        s.plan_type,
        s.plan_name               AS title,
        s.price_stars,
        s.started_at              AS created_at,
        s.expires_at,
        s.is_active,
        s.payment_method,
        NULL::text                AS pack_photo_url,
        NULL::text                AS pack_short_description
       FROM subscriptions s
       WHERE s.user_id = $1`,
      [userId]
    );

    // Pack purchases
    const packsResult = await db.query(
      `SELECT
        'pack'                             AS purchase_type,
        shp.id                             AS purchase_id,
        NULL::text                         AS plan_type,
        p.name                             AS title,
        shp.price_paid_stars               AS price_stars,
        shp.purchased_at                   AS created_at,
        NULL::timestamptz                  AS expires_at,
        (shp.payment_status = 'completed') AS is_active,
        'telegram_stars'                   AS payment_method,
        p.photo_url                        AS pack_photo_url,
        p.short_description                AS pack_short_description
       FROM special_habit_purchases shp
       JOIN special_habit_packs p ON p.id = shp.pack_id
       WHERE shp.user_id = $1 AND shp.payment_status = 'completed'`,
      [userId]
    );

    // Merge and sort by date desc
    const all = [...subsResult.rows, ...packsResult.rows]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 50);

    res.json({ success: true, history: all });
  } catch (error) {
    console.error('💥 Get history error:', error);
    res.status(500).json({ success: false, error: 'Failed to get purchase history' });
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