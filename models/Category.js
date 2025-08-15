const db = require('../config/database');

class Category {
  static async findAll(language = 'en') {
    const nameField = language === 'ru' ? 'name_ru' : 'name_en';
    const result = await db.query(
      `SELECT id, ${nameField} AS name, icon, color, sort_order
       FROM categories
       ORDER BY sort_order ASC`
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await db.query(
      'SELECT * FROM categories WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }
}

module.exports = Category;
