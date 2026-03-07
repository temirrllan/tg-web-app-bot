// controllers/userController.js

const pool = require('../config/database');

const userController = {
  /**
   * PATCH /api/users/preferences
   * Placeholder for future user preferences (hint columns removed).
   */
  async updatePreferences(req, res) {
    return res.status(200).json({ success: true, message: 'No preferences to update' });
  }
};


module.exports = userController;
