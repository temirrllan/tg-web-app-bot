const db = require('../config/database');

class Phrase {
  static async getRandomPhrase(language = 'en', completedCount = 0, totalCount = 0) {
    const lang = String(language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
    
    try {
      // Определяем тип фразы в зависимости от прогресса
      let phraseType = 'encouragement';
      let minCompleted = 0;
      
      if (totalCount === 0) {
        // Нет привычек
        phraseType = 'encouragement';
        minCompleted = 0;
      } else if (completedCount === 0) {
        // Ни одна не выполнена
        phraseType = 'encouragement';
        minCompleted = 0;
      } else if (completedCount === totalCount) {
        // Все выполнены
        phraseType = 'perfect';
        minCompleted = completedCount;
      } else if (completedCount >= totalCount * 0.7) {
        // Больше 70% выполнено
        phraseType = 'success';
        minCompleted = Math.floor(totalCount * 0.7);
      } else if (completedCount >= totalCount * 0.5) {
        // Больше 50% выполнено
        phraseType = 'streak';
        minCompleted = Math.floor(totalCount * 0.5);
      } else {
        // Меньше 50% выполнено
        phraseType = 'encouragement';
        minCompleted = completedCount;
      }
      
      // Сначала пытаемся получить фразу нужного типа
      let result = await db.query(
        `SELECT phrase_${lang} AS text, emoji, type
         FROM motivational_phrases
         WHERE type = $1
         AND min_completed <= $2
         ORDER BY RANDOM()
         LIMIT 1`,
        [phraseType, completedCount]
      );
      
      // Если не нашли фразу нужного типа, берем любую подходящую по min_completed
      if (result.rows.length === 0) {
        result = await db.query(
          `SELECT phrase_${lang} AS text, emoji, type
           FROM motivational_phrases
           WHERE min_completed <= $1
           ORDER BY RANDOM()
           LIMIT 1`,
          [completedCount]
        );
      }
      
      if (result.rows.length > 0) {
        const phrase = result.rows[0];
        return {
          text: phrase.text,
          emoji: phrase.emoji || '',
          type: phrase.type || 'encouragement'
        };
      }
    } catch (error) {
      console.error('getRandomPhrase error:', error);
    }
    
    // Запасные варианты для разных ситуаций
    if (lang === 'ru') {
      if (totalCount === 0) {
        return { text: 'Создай свою первую привычку!', emoji: '🚀', type: 'encouragement' };
      } else if (completedCount === 0) {
        return { text: 'Ты справишься!', emoji: '💪', type: 'encouragement' };
      } else if (completedCount === totalCount) {
        return { text: 'Ты всё сделал! Невероятно!', emoji: '🎉', type: 'perfect' };
      } else {
        return { text: 'Продолжай в том же духе!', emoji: '✨', type: 'success' };
      }
    } else {
      if (totalCount === 0) {
        return { text: 'Create your first habit!', emoji: '🚀', type: 'encouragement' };
      } else if (completedCount === 0) {
        return { text: 'You can do it!', emoji: '💪', type: 'encouragement' };
      } else if (completedCount === totalCount) {
        return { text: 'All done! Amazing!', emoji: '🎉', type: 'perfect' };
      } else {
        return { text: 'Keep going!', emoji: '✨', type: 'success' };
      }
    }
  }

  // Метод для получения фразы при изменении статуса привычки
  static async getPhraseForStatusChange(language = 'en', completedCount = 0, totalCount = 0, wasCompleted = false) {
    const lang = String(language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
    
    try {
      // Если привычка была отмечена как выполненная
      if (!wasCompleted && completedCount > 0) {
        // Определяем прогресс
        const progress = totalCount > 0 ? completedCount / totalCount : 0;
        let phraseType = 'success';
        
        if (progress === 1) {
          phraseType = 'perfect';
        } else if (progress >= 0.7) {
          phraseType = 'success';
        } else if (progress >= 0.5) {
          phraseType = 'streak';
        } else {
          phraseType = 'encouragement';
        }
        
        const result = await db.query(
          `SELECT phrase_${lang} AS text, emoji, type
           FROM motivational_phrases
           WHERE type = $1
           ORDER BY RANDOM()
           LIMIT 1`,
          [phraseType]
        );
        
        if (result.rows.length > 0) {
          const phrase = result.rows[0];
          return {
            text: phrase.text,
            emoji: phrase.emoji || '',
            type: phrase.type || phraseType
          };
        }
      }
      
      // Используем стандартный метод
      return await this.getRandomPhrase(language, completedCount, totalCount);
    } catch (error) {
      console.error('getPhraseForStatusChange error:', error);
      return await this.getRandomPhrase(language, completedCount, totalCount);
    }
  }
}

module.exports = Phrase;