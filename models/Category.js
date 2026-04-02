const db = require('../config/database');

class Category {
  static async findAll(language = 'en') {
    const lang = String(language || 'en').toLowerCase();
    const nameField = lang === 'ru' ? 'name_ru' : lang === 'kk' ? 'name_kk' : 'name_en';
    const result = await db.query(
      `SELECT id, ${nameField} AS name, name_en, icon, color, sort_order
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
