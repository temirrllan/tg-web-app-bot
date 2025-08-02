
const db = require('../config/database');

class Phrase {
  static async getRandom(completedCount, language = 'en') {
    const phraseField = language === 'ru' ? 'phrase_ru' : 'phrase_en';
    
    const result = await db.query(
      `SELECT ${phraseField} as text, emoji 
       FROM motivational_phrases 
       WHERE min_completed <= $1 
       ORDER BY RANDOM() 
       LIMIT 1`,
      [completedCount]
    );

    if (result.rows.length === 0) {
      // Фраза по умолчанию
      return {
        text: language === 'ru' ? 'Продолжай в том же духе!' : 'Keep going!',
        emoji: '💪'
      };
    }

    return result.rows[0];
  }
}

module.exports = Phrase;