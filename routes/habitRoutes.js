const express = require('express');
const router = express.Router();
const habitController = require('../controllers/habitController');
const categoryController = require('../controllers/categoryController');
const markController = require('../controllers/markController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkSubscriptionLimit } = require('../middleware/subscription');
const { createHabitLimiter } = require('../middleware/rateLimit');
const db = require('../config/database');

// Категории
router.get('/categories', categoryController.getAll);

// Применяем auth middleware к остальным роутам
router.use(authMiddleware);

// Привычки
router.post('/habits', createHabitLimiter, checkSubscriptionLimit, habitController.create);
router.get('/habits', habitController.getAll);
router.get('/habits/today', habitController.getTodayHabits);
router.patch('/habits/:id', habitController.update);
router.delete('/habits/:id', habitController.delete);

// Новый эндпоинт для получения отметок по дате
// Получение отметок привычек для конкретной даты
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
    
    // Получаем все отметки пользователя для указанной даты
    // ВАЖНО: Возвращаем только отметки для конкретной даты
    const result = await db.query(
      `SELECT 
        hm.habit_id,
        hm.status,
        hm.date,
        hm.marked_at
       FROM habit_marks hm
       JOIN habits h ON hm.habit_id = h.id
       WHERE h.user_id = $1 
       AND hm.date = $2::date`, // Явно приводим к типу date
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
// Получение привычек для конкретной даты с их актуальными статусами
router.get('/habits/date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const userId = req.user.id;
    
    // Парсим дату для получения дня недели
    const [year, month, day] = date.split('-');
    const targetDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const dayOfWeek = targetDate.getDay() || 7;
    
    console.log(`Getting habits for user ${userId} on date ${date}, day of week: ${dayOfWeek}`);
    
    // Получаем привычки для этого дня недели со статусами и количеством участников
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
        -- Получаем актуальный статус из habit_marks
        COALESCE(hm.status, 'pending') as today_status,
        hm.id as mark_id,
        hm.marked_at,
        -- Подсчитываем участников для связанных привычек
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
    
    // Логируем статусы для отладки
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
    
    // Проверяем, что привычка принадлежит пользователю
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
    
    // Получаем все отметки для этой привычки
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
    
    // Проверяем, что привычка принадлежит пользователю
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
    
    // Текущая неделя
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    // Текущий месяц
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    // Текущий год
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear(), 11, 31);
    
    // Получаем статистику
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
    
    // Получаем информацию о привычке по коду
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
    
    // Проверяем, не является ли пользователь уже участником (включая неактивных)
    const memberCheck = await db.query(
      'SELECT * FROM habit_members WHERE habit_id = $1 AND user_id = $2',
      [originalHabit.habit_id, userId]
    );
    
    if (memberCheck.rows.length > 0) {
      // Если запись существует но неактивна - реактивируем
      if (!memberCheck.rows[0].is_active) {
        await db.query(
          'UPDATE habit_members SET is_active = true WHERE habit_id = $1 AND user_id = $2',
          [originalHabit.habit_id, userId]
        );
        
        // Проверяем привычку пользователя
        const userHabitCheck = await db.query(
          'SELECT * FROM habits WHERE user_id = $1 AND parent_habit_id = $2',
          [userId, originalHabit.habit_id]
        );
        
        if (userHabitCheck.rows.length > 0) {
          // Реактивируем привычку
          const reactivatedHabit = await db.query(
            'UPDATE habits SET is_active = true WHERE id = $1 RETURNING *',
            [userHabitCheck.rows[0].id]
          );
          
          // Восстанавливаем связь владельца с привычкой пользователя
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
        // Если привычки нет - продолжаем создание новой (код ниже выполнится)
      } else {
        // Пользователь уже активный участник
        return res.json({ 
          success: true, 
          message: 'Already a member',
          habitId: originalHabit.habit_id 
        });
      }
    }
    
    // Создаем копию привычки для нового пользователя
    const newHabitResult = await db.query(
      `INSERT INTO habits (
        user_id, category_id, title, goal, schedule_type, 
        schedule_days, reminder_time, reminder_enabled, is_bad_habit,
        parent_habit_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        userId,
        originalHabit.category_id,
        originalHabit.title,
        originalHabit.goal,
        originalHabit.schedule_type,
        originalHabit.schedule_days,
        originalHabit.reminder_time,
        originalHabit.reminder_enabled,
        originalHabit.is_bad_habit,
        originalHabit.habit_id // Ссылка на оригинальную привычку
      ]
    );
    
    const newHabit = newHabitResult.rows[0];
    
    // Добавляем пользователя как участника оригинальной привычки
    await db.query(
      'INSERT INTO habit_members (habit_id, user_id) VALUES ($1, $2)',
      [originalHabit.habit_id, userId]
    );
    
    // Добавляем владельца оригинальной привычки как участника новой привычки
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

// Удалить участника из привычки
// Удалить участника из привычки
// Найдите в файле routes/habitRoutes.js эндпоинт router.post('/habits/:habitId/punch/:userId' и замените его полностью:

router.post('/habits/:habitId/punch/:userId', authMiddleware, async (req, res) => {
  try {
    const { habitId, userId: targetUserId } = req.params;
    const fromUserId = req.user.id;
    
    console.log(`🥊 Punch request from user ${fromUserId} to user ${targetUserId} for habit ${habitId}`);
    
    // Сначала проверяем, выполнена ли привычка у друга сегодня
    const today = new Date().toISOString().split('T')[0];
    
    // Находим привычку друга, связанную с этой группой привычек
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
    
    // Проверяем статус выполнения привычки друга на сегодня
    const statusResult = await db.query(
      `SELECT status 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND date = $2::date`,
      [targetHabitId, today]
    );
    
    // Получаем имя друга для персонализированных сообщений
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
    
    // Получаем имя отправителя
    const senderResult = await db.query(
      'SELECT first_name FROM users WHERE id = $1',
      [fromUserId]
    );
    
    const senderName = senderResult.rows.length > 0 
      ? senderResult.rows[0].first_name 
      : 'Your friend';
    
    // Если привычка уже выполнена - НЕ отправляем punch
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
    
    // Если привычка пропущена (skipped) - ОТПРАВЛЯЕМ punch с особым сообщением
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
      // Обычный punch для pending статуса
      console.log(`📤 Sending regular punch to ${friendName}`);
      
      messageText = `👊 <b>Напоминание от ${senderName}!</b>\n\n` +
        `Твой друг хочет, чтобы ты выполнил:\n` +
        `📝 <b>"${habitTitle}"</b>\n\n` +
        `Не подведи его! Выполни сейчас! 💪`;
      
      toastMessage = `Панч отправлен ${friendName}! 👊`;
    }
    
    // Отправляем уведомление через бота
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
        // Продолжаем выполнение даже если не удалось отправить уведомление
      }
    }
    
    // Сохраняем в историю
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

// Обновляем эндпоинт для punch с отправкой уведомления
// Найдите в файле routes/habitRoutes.js эндпоинт router.post('/habits/:habitId/punch/:userId' и замените его полностью:

// Найдите в файле routes/habitRoutes.js эндпоинт router.post('/habits/:habitId/punch/:userId' и замените его полностью:

router.post('/habits/:habitId/punch/:userId', authMiddleware, async (req, res) => {
  try {
    const { habitId, userId: targetUserId } = req.params;
    const fromUserId = req.user.id;
    
    console.log(`🥊 Punch request from user ${fromUserId} to user ${targetUserId} for habit ${habitId}`);
    
    // Сначала проверяем, выполнена ли привычка у друга сегодня
    const today = new Date().toISOString().split('T')[0];
    
    // Находим привычку друга, связанную с этой группой привычек
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
    
    // Проверяем статус выполнения привычки друга на сегодня
    const statusResult = await db.query(
      `SELECT status 
       FROM habit_marks 
       WHERE habit_id = $1 
       AND date = $2::date`,
      [targetHabitId, today]
    );
    
    // Получаем имя друга для персонализированных сообщений
    const friendResult = await db.query(
      'SELECT first_name FROM users WHERE id = $1',
      [targetUserId]
    );
    
    const friendName = friendResult.rows.length > 0 
      ? friendResult.rows[0].first_name 
      : 'Your friend';
    
    // Если привычка уже выполнена - НЕ отправляем punch
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
    
    // Если привычка пропущена (skipped)
    if (statusResult.rows.length > 0 && statusResult.rows[0].status === 'skipped') {
      console.log(`⏭ Habit skipped by ${friendName}`);
      
      return res.json({ 
        success: false,
        isSkipped: true,
        showToast: true,
        toastType: 'warning',
        toastMessage: `${friendName} пропустил эту привычку сегодня 😔`,
        friendName: friendName,
        habitTitle: habitTitle
      });
    }
    
    console.log(`📤 Sending punch to ${friendName}`);
    
    // Если привычка еще не выполнена - отправляем punch
    // Получаем информацию для уведомления
    const userData = await db.query(
      `SELECT u.telegram_id, u2.first_name as from_name
       FROM users u
       JOIN users u2 ON u2.id = $2
       WHERE u.id = $1`,
      [targetUserId, fromUserId]
    );
    
    if (userData.rows.length > 0) {
      const { telegram_id, from_name } = userData.rows[0];
      
      console.log(`📱 Sending Telegram notification to ${telegram_id}`);
      
      // Отправляем уведомление через бота
      const bot = require('../server').bot;
      
      try {
        await bot.sendMessage(
          telegram_id,
          `👊 <b>Напоминание от ${from_name}!</b>\n\n` +
          `Твой друг хочет, чтобы ты выполнил:\n` +
          `📝 <b>"${habitTitle}"</b>\n\n` +
          `Не подведи его! Выполни сейчас! 💪`,
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
        // Продолжаем выполнение даже если не удалось отправить уведомление
      }
      
      // Сохраняем в историю
      await db.query(
        'INSERT INTO habit_punches (habit_id, from_user_id, to_user_id) VALUES ($1, $2, $3)',
        [habitId, fromUserId, targetUserId]
      );
      
      console.log('✅ Punch saved to database');
      
      return res.json({ 
        success: true,
        showToast: true,
        toastType: 'success',
        toastMessage: `Панч отправлен ${friendName}! 👊`,
        friendName: friendName
      });
    }
    
    // Fallback если не нашли пользователя
    return res.json({ 
      success: true,
      showToast: true,
      toastType: 'success',
      toastMessage: 'Панч отправлен! 👊'
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
    
    // Проверяем владельца
    const habit = await db.query(
      'SELECT * FROM habits WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    
    if (habit.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Habit not found' });
    }
    
    // Проверяем существующий share code
    let shareResult = await db.query(
      'SELECT share_code FROM shared_habits WHERE habit_id = $1',
      [id]
    );
    
    let shareCode;
    if (shareResult.rows.length === 0) {
      // Генерируем уникальный код
      shareCode = `${id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await db.query(
        'INSERT INTO shared_habits (habit_id, owner_user_id, share_code) VALUES ($1, $2, $3)',
        [id, userId, shareCode]
      );
      
      // Добавляем владельца как первого участника
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
// Получить участников привычки (включая связанные привычки)
router.get('/habits/:id/members', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Получаем информацию о привычке и её связях
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
    
    // Определяем, какую привычку использовать для получения участников
    const targetHabitId = parentHabitId || id;
    
    // Получаем всех участников связанной группы привычек
    const members = await db.query(
      `SELECT DISTINCT u.id, u.first_name, u.last_name, u.username, u.photo_url
       FROM habit_members hm
       JOIN users u ON hm.user_id = u.id
       WHERE hm.habit_id IN (
         SELECT id FROM habits 
         WHERE parent_habit_id = $1 OR id = $1
       )
       AND hm.is_active = true
       AND u.id != $2`,  // Исключаем текущего пользователя из списка
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
// Punch друга
router.post('/habits/:habitId/punch/:userId', authMiddleware, async (req, res) => {
  try {
    const { habitId, userId: targetUserId } = req.params;
    const fromUserId = req.user.id;
    
    // Сохраняем punch
    await db.query(
      'INSERT INTO habit_punches (habit_id, from_user_id, to_user_id) VALUES ($1, $2, $3)',
      [habitId, fromUserId, targetUserId]
    );
    
    // Отправляем уведомление через бота
    const targetUser = await db.query(
      'SELECT telegram_id FROM users WHERE id = $1',
      [targetUserId]
    );
    
    if (targetUser.rows.length > 0) {
      // Здесь вызываем метод бота для отправки уведомления
      // bot.sendMessage(targetUser.rows[0].telegram_id, '👊 Your friend reminded you to complete your habit!');
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Punch error:', error);
    res.status(500).json({ success: false, error: 'Failed to send punch' });
  }
});
// Отметки
router.post('/habits/:id/mark', markController.markHabit);
router.delete('/habits/:id/mark', markController.unmarkHabit);

module.exports = router;