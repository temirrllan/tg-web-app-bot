// middleware/packHabitProtection.js - Защита привычек из пакетов от редактирования

const db = require('../config/database');

/**
 * Middleware для защиты заблокированных привычек от UPDATE
 * Использовать ПЕРЕД обновлением привычки
 */
const protectLockedHabitUpdate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log('🔒 Checking if habit is locked for update:', { habitId: id, userId });

    // Проверяем, заблокирована ли привычка
    const result = await db.query(
      `SELECT is_locked, pack_purchase_id, title, template_id
       FROM habits 
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      console.log('❌ Habit not found');
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }

    const habit = result.rows[0];

    if (habit.is_locked) {
      console.log('🚫 Attempt to update locked habit blocked:', {
        habitId: id,
        title: habit.title,
        packPurchaseId: habit.pack_purchase_id
      });

      return res.status(403).json({
        success: false,
        error: 'Cannot edit habit from pack',
        code: 'HABIT_LOCKED',
        message: 'This habit is part of a purchased pack and cannot be edited. You can only mark it as completed or delete it.',
        is_locked: true
      });
    }

    console.log('✅ Habit is not locked, proceeding with update');
    next();
  } catch (error) {
    console.error('❌ Error in protectLockedHabitUpdate middleware:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

/**
 * Middleware для защиты заблокированных привычек от DELETE
 * ОПЦИОНАЛЬНО: можно разрешить удаление, но с предупреждением
 */
const protectLockedHabitDelete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const forceDelete = req.query.force === 'true' || req.body?.force === true;

    console.log('🔒 Checking if habit is locked for delete:', { 
      habitId: id, 
      userId,
      forceDelete 
    });

    // Проверяем, заблокирована ли привычка
    const result = await db.query(
      `SELECT is_locked, pack_purchase_id, title, template_id
       FROM habits 
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      console.log('❌ Habit not found');
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }

    const habit = result.rows[0];

    if (habit.is_locked && !forceDelete) {
      console.log('⚠️ Attempt to delete locked habit without force flag:', {
        habitId: id,
        title: habit.title,
        packPurchaseId: habit.pack_purchase_id
      });

      // Получаем информацию о пакете
      const packResult = await db.query(
        `SELECT sp.title as pack_title, sp.slug
         FROM pack_purchases pp
         JOIN store_packs sp ON pp.pack_id = sp.id
         WHERE pp.id = $1`,
        [habit.pack_purchase_id]
      );

      const packInfo = packResult.rows[0] || {};

      return res.status(403).json({
        success: false,
        error: 'Habit from pack requires confirmation',
        code: 'HABIT_LOCKED_CONFIRM_DELETE',
        message: `This habit is part of the "${packInfo.pack_title || 'purchased pack'}". Deleting it will remove it from your list permanently. Are you sure?`,
        is_locked: true,
        pack_title: packInfo.pack_title,
        pack_slug: packInfo.pack_slug,
        requires_force: true
      });
    }

    if (habit.is_locked && forceDelete) {
      console.log('⚠️ Force deleting locked habit:', {
        habitId: id,
        title: habit.title
      });
    }

    console.log('✅ Delete permission granted');
    next();
  } catch (error) {
    console.error('❌ Error in protectLockedHabitDelete middleware:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

/**
 * Проверка прав доступа к привычке (общая)
 * Использовать для любых операций с привычкой
 */
const checkHabitOwnership = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log('👤 Checking habit ownership:', { habitId: id, userId });

    const result = await db.query(
      'SELECT id, user_id FROM habits WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      console.log('❌ Habit not found');
      return res.status(404).json({
        success: false,
        error: 'Habit not found'
      });
    }

    const habit = result.rows[0];

    if (habit.user_id !== userId) {
      console.log('🚫 Access denied: habit belongs to different user');
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    console.log('✅ Ownership verified');
    next();
  } catch (error) {
    console.error('❌ Error in checkHabitOwnership middleware:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

/**
 * Middleware для логирования действий с привычками (опционально)
 */
const logHabitAction = (action) => {
  return async (req, res, next) => {
    const { id } = req.params;
    const userId = req.user?.id;

    console.log(`📝 Habit action: ${action}`, {
      habitId: id,
      userId: userId,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    next();
  };
};

module.exports = {
  protectLockedHabitUpdate,
  protectLockedHabitDelete,
  checkHabitOwnership,
  logHabitAction
};