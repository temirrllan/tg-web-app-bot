const db = require('../config/database');

class Phrase {
  static async getRandomPhrase(language = 'en', minCompleted = 0) {
    const lang = String(language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
    
    try {
      const { rows } = await db.query(
        `SELECT phrase_${lang} AS text, emoji, type
         FROM motivational_phrases
         WHERE min_completed <= $1
         ORDER BY RANDOM()
         LIMIT 1`,
        [minCompleted]
      );
      
      if (rows.length > 0) {
        const phrase = rows[0];
        return {
          text: phrase.text,
          emoji: phrase.emoji || '',
          type: phrase.type || 'encouragement'
        };
      }
    } catch (error) {
      console.error('getRandomPhrase error:', error);
    }
    
    // Запасной вариант
    return lang === 'ru'
      ? { text: 'Продолжай!', emoji: '💪', type: 'encouragement' }
      : { text: 'Keep going!', emoji: '💪', type: 'encouragement' };
  }
}

module.exports = Phrase;