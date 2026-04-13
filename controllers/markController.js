const HabitMark = require("../models/HabitMark");
const Habit = require("../models/Habit");
const db = require("../config/database");

const markController = {
  async markHabit(req, res) {
    console.log("🎯 markController.markHabit called");

    try {
      const { id } = req.params;
      const { status = "completed", date } = req.body;
      const userId = req.user.id;

      console.log("Mark habit request:", {
        habitId: id,
        userId: userId,
        status: status,
        date: date,
        requestBody: req.body,
      });

      // ВАЖНО: Проверяем и форматируем дату
      let markDate;
      if (date) {
        // Если дата передана, используем её
        markDate = date;
      } else {
        // Если дата не указана, используем сегодня в локальном часовом поясе
        const today = new Date();
        markDate = `${today.getFullYear()}-${String(
          today.getMonth() + 1
        ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      }

      console.log("Using date for marking:", markDate);

      // Проверяем, что привычка принадлежит пользователю
      const habit = await Habit.findById(id, userId);
      if (!habit) {
        console.log("❌ Habit not found or access denied");
        return res.status(404).json({
          success: false,
          error: "Habit not found",
        });
      }

      console.log("Found habit:", {
        id: habit.id,
        title: habit.title,
        user_id: habit.user_id,
      });

      // Проверяем, можно ли отметить эту дату
      const canMark = await HabitMark.canMark(markDate);
      if (!canMark) {
        console.log("❌ Cannot mark this date:", markDate);
        return res.status(400).json({
          success: false,
          error: "Can only mark today or yesterday",
        });
      }

      console.log("✅ Date validation passed");

      // ВАЖНО: Проверяем, что отметка будет для правильной даты
      // ВАЖНО: Проверяем существующую отметку
      const existingMark = await HabitMark.getMarkForDate(id, markDate);
      console.log("Existing mark for this date:", existingMark);
      
      // 🆕 ЗАЩИТА: Если статус уже такой же - не дублируем
      if (existingMark && existingMark.status === status) {
        console.log(`⚠️ Habit ${id} already has status "${status}" for ${markDate}, skipping duplicate`);
        return res.json({
          success: true,
          mark: existingMark,
          duplicate: true,
          message: 'Status unchanged - already set'
        });
      }

      // Отмечаем привычку для конкретной даты
      const mark = await HabitMark.mark(id, markDate, status);
      console.log("✅ Habit marked successfully:", {
        habitId: id,
        date: markDate,
        status: status,
        markId: mark.id,
        returnedDate: mark.date,
      });

      // Если статус "completed", отправляем уведомления друзьям
      if (status === "completed") {
        await sendFriendNotifications(habit, userId, markDate);
      }

      res.json({
        success: true,
        mark: {
          ...mark,
          date: markDate,
        },
        wasUpdate: !!existingMark
      });
    } catch (error) {
      console.error("💥 Mark habit error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to mark habit",
        details: error.message,
      });
    }
  },

  async unmarkHabit(req, res) {
    console.log("🎯 markController.unmarkHabit called");

    try {
      const { id } = req.params;
      // Получаем дату из query параметров или body
      const date = req.query.date || req.body?.date;
      const userId = req.user.id;

      if (!date) {
        return res.status(400).json({
          success: false,
          error: "Date is required for unmarking",
        });
      }

      console.log("Unmark habit request:", {
        habitId: id,
        userId: userId,
        date: date,
      });

      // Проверяем, что привычка принадлежит пользователю
      const habit = await Habit.findById(id, userId);
      if (!habit) {
        console.log("❌ Habit not found or access denied");
        return res.status(404).json({
          success: false,
          error: "Habit not found",
        });
      }

      // Проверяем существование отметки перед удалением
      const existingMark = await HabitMark.getMarkForDate(id, date);
      console.log("Mark to delete:", existingMark);

      if (!existingMark) {
        console.log("❌ No mark found for this date - nothing to unmark");
        return res.json({
          success: true,
          deleted: false,
          date: date,
          message: 'No mark to delete - already pending'
        });
      }

      const deleted = await HabitMark.deleteMark(id, date);
      console.log(deleted ? "✅ Mark removed" : "❌ Mark not found");

      res.json({
        success: true,
        deleted,
        date: date,
      });
    } catch (error) {
      console.error("💥 Unmark habit error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to unmark habit",
        details: error.message,
      });
    }
  },
};

// Функция для отправки уведомлений друзьям
async function sendFriendNotifications(habit, userId, markDate) {
  try {
    const bot = require("../server").bot;

    // Получаем информацию о пользователе
    const userResult = await db.query(
      "SELECT first_name, username FROM users WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) return;

    const userName =
      userResult.rows[0].first_name ||
      userResult.rows[0].username ||
      "Your friend";

    // Определяем, какие привычки связаны
    const parentHabitId = habit.parent_habit_id || habit.id;

    // Получаем всех участников связанных привычек
    const membersResult = await db.query(
      `SELECT DISTINCT u.id, u.telegram_id, u.first_name, u.language
       FROM habit_members hm
       JOIN users u ON hm.user_id = u.id
       WHERE hm.habit_id IN (
         SELECT id FROM habits 
         WHERE (parent_habit_id = $1 OR id = $1)
         AND is_active = true
       )
       AND hm.is_active = true
       AND u.id != $2`,
      [parentHabitId, userId]
    );

    if (membersResult.rows.length === 0) return;

    console.log(
      `📨 Sending completion notifications to ${membersResult.rows.length} friends`
    );

    // Проверяем, сколько участников уже выполнили привычку сегодня
    const completedResult = await db.query(
      `SELECT COUNT(DISTINCT h.user_id) as completed_count
       FROM habits h
       JOIN habit_marks hm ON hm.habit_id = h.id
       WHERE (h.parent_habit_id = $1 OR h.id = $1)
       AND h.is_active = true
       AND hm.date = $2::date
       AND hm.status = 'completed'`,
      [parentHabitId, markDate]
    );

    const completedCount = parseInt(completedResult.rows[0].completed_count);
    const totalMembers = membersResult.rows.length + 1; // +1 для текущего пользователя

    console.log(`Progress: ${completedCount}/${totalMembers} completed`);

    // Если все выполнили - отправляем поздравление всем
    if (completedCount === totalMembers) {
      // Отправляем поздравление всем участникам
      for (const member of membersResult.rows) {
        const lang = member.language || "en";

        const message =
          lang === "ru"
            ? `🎉 <b>Поздравляем!</b>

Все участники выполнили привычку <b>"${habit.title}"</b> сегодня!

Вы молодцы! Продолжайте в том же духе! 💪✨`
            : `🎉 <b>Congratulations!</b>

All members completed the habit <b>"${habit.title}"</b> today!

Great job team! Keep up the amazing work! 💪✨`;

        try {
          await bot.sendMessage(member.telegram_id, message, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "📱 Open App",
                    web_app: {
                      url: process.env.WEBAPP_URL || process.env.FRONTEND_URL,
                    },
                  },
                ],
              ],
            },
          });
        } catch (err) {
          console.error(
            `Failed to send message to ${member.telegram_id}:`,
            err.message
          );
        }

        // Небольшая задержка между отправками
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Отправляем поздравление и самому пользователю
      const currentUserResult = await db.query(
        "SELECT telegram_id, language FROM users WHERE id = $1",
        [userId]
      );

      if (currentUserResult.rows.length > 0) {
        const currentUser = currentUserResult.rows[0];
        const lang = currentUser.language || "en";

        const selfMessage =
          lang === "ru"
            ? `🏆 <b>Отлично!</b>

Вы и все ваши друзья выполнили привычку <b>"${habit.title}"</b> сегодня!

Командная работа на высоте! 🚀`
            : `🏆 <b>Excellent!</b>

You and all your friends completed the habit <b>"${habit.title}"</b> today!

Teamwork makes the dream work! 🚀`;

        try {
          await bot.sendMessage(currentUser.telegram_id, selfMessage, {
            parse_mode: "HTML",
          });
        } catch (err) {
          console.error(`Failed to send self message:`, err.message);
        }
      }
    } else {
      // Получаем всех участников, которые уже выполнили привычку — одним запросом
      const completedMembersResult = await db.query(
        `SELECT DISTINCT h.user_id
         FROM habits h
         JOIN habit_marks hm ON hm.habit_id = h.id
         WHERE (h.parent_habit_id = $1 OR h.id = $1)
         AND h.is_active = true
         AND hm.date = $2::date
         AND hm.status = 'completed'`,
        [parentHabitId, markDate]
      );
      const completedUserIds = new Set(completedMembersResult.rows.map(r => r.user_id));

      // Отправляем уведомление о выполнении остальным участникам
      for (const member of membersResult.rows) {
        // Если друг уже выполнил - не отправляем ему уведомление
        if (completedUserIds.has(member.id)) continue;

        const lang = member.language || "en";

        const message =
          lang === "ru"
            ? `💪 <b>${userName} выполнил(а) привычку!</b>

Привычка: <b>"${habit.title}"</b>

Теперь ваша очередь! Не отставайте от друзей! 🔥

<i>Прогресс: ${completedCount}/${totalMembers} выполнили</i>`
            : `💪 <b>${userName} completed the habit!</b>

Habit: <b>"${habit.title}"</b>

Now it's your turn! Don't let your friends down! 🔥

<i>Progress: ${completedCount}/${totalMembers} completed</i>`;

        try {
          await bot.sendMessage(member.telegram_id, message, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ Mark as Done",
                    callback_data: `quick_done_${habit.id}_${markDate}`,
                  },
                ],
                [
                  {
                    text: "📱 Open App",
                    web_app: {
                      url: process.env.WEBAPP_URL || process.env.FRONTEND_URL,
                    },
                  },
                ],
              ],
            },
          });

          console.log(
            `✅ Notification sent to ${member.first_name} (${member.telegram_id})`
          );
        } catch (err) {
          console.error(
            `Failed to send message to ${member.telegram_id}:`,
            err.message
          );
        }

        // Небольшая задержка между отправками
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } catch (error) {
    console.error("Error sending friend notifications:", error);
  }
}

module.exports = markController;
module.exports.sendFriendNotifications = sendFriendNotifications;
