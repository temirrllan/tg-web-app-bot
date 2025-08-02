const HabitMark = require('../models/HabitMark');
const Habit = require('../models/Habit');

const markController = {
  async markHabit(req, res) {
    console.log('🎯 markController.markHabit called');
    
    try {
      const { id } = req.params;
      const { status = 'completed', date } = req.body;
      const userId = req.user.id;

      console.log('Mark habit request:', {
        habitId: id,
        userId: userId,
        status: status,
        date: date
      });

      // Если дата не указана, используем сегодня
      const markDate = date || new Date().toISOString().split('T')[0];
      console.log('Using date:', markDate);

      // Проверяем, что привычка принадлежит пользователю
      const habit = await Habit.findById(id, userId);
      if (!habit) {
        console.log('❌ Habit not found or access denied');
        return res.status(404).json({ 
          success: false, 
          error: 'Habit not found' 
        });
      }

      console.log('Found habit:', {
        id: habit.id,
        title: habit.title,
        user_id: habit.user_id
      });

      // Проверяем, можно ли отметить эту дату
      const canMark = await HabitMark.canMark(markDate);
      if (!canMark) {
        console.log('❌ Cannot mark this date:', markDate);
        return res.status(400).json({ 
          success: false, 
          error: 'Can only mark today or yesterday' 
        });
      }

      console.log('✅ Date validation passed');

      // Отмечаем привычку
      const mark = await HabitMark.mark(id, markDate, status);
      console.log('✅ Habit marked successfully:', mark);

      res.json({
        success: true,
        mark
      });
    } catch (error) {
      console.error('💥 Mark habit error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to mark habit' 
      });
    }
  },

  async unmarkHabit(req, res) {
    console.log('🎯 markController.unmarkHabit called');
    
    try {
      const { id } = req.params;
      // Получаем дату из query параметров или body
      const date = req.query.date || req.body?.date || new Date().toISOString().split('T')[0];
      const userId = req.user.id;

      console.log('Unmark habit request:', {
        habitId: id,
        userId: userId,
        date: date
      });

      // Проверяем, что привычка принадлежит пользователю
      const habit = await Habit.findById(id, userId);
      if (!habit) {
        console.log('❌ Habit not found or access denied');
        return res.status(404).json({ 
          success: false, 
          error: 'Habit not found' 
        });
      }

      const deleted = await HabitMark.deleteMark(id, date);
      console.log(deleted ? '✅ Mark removed' : '❌ Mark not found');

      res.json({
        success: true,
        deleted
      });
    } catch (error) {
      console.error('💥 Unmark habit error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to unmark habit' 
      });
    }
  }
};

module.exports = markController;