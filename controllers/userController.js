// controllers/userController.js

const pool = require('../config/database');

const userController = {
  /**
   * PATCH /api/users/preferences
   * Updates user preferences stored in the users table.
   * Currently supports: show_swipe_hint
   */
  async updatePreferences(req, res) {
    try {
      const telegramId = req.user?.telegram_id || String(req.user?.id);

      if (!telegramId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { swipe_hint_dismissed, friend_hint_dismissed } = req.body;

      // Build dynamic SET clause — only update fields that were sent
      const updates = [];
      const values = [];
      let idx = 1;

      if (typeof swipe_hint_dismissed === 'boolean') {
        updates.push(`swipe_hint_dismissed = $${idx++}`);
        values.push(swipe_hint_dismissed);
      }

      if (typeof friend_hint_dismissed === 'boolean') {
        updates.push(`friend_hint_dismissed = $${idx++}`);
        values.push(friend_hint_dismissed);
      }

      if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to update' });
      }

      values.push(telegramId); // last param = WHERE telegram_id = $N
      const query = `
        UPDATE users
        SET ${updates.join(', ')}
        WHERE telegram_id = $${idx}
        RETURNING id, swipe_hint_dismissed, friend_hint_dismissed
      `;

      const result = await pool.query(query, values);

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      console.log(`✅ Preferences updated for user ${telegramId}:`, result.rows[0]);

      res.json({ success: true, preferences: result.rows[0], updated: Object.fromEntries(updates.map((u, i) => [u.split(' ')[0], values[i]])) });

    } catch (error) {
      console.error('❌ updatePreferences error:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
};

module.exports = userController;
