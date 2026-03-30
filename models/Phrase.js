const db = require('../config/database');

class Phrase {
  static async getRandomPhrase(language = 'en', completedCount = 0, totalCount = 0) {
    const langStr = String(language || 'en').toLowerCase();
    const lang = langStr === 'kk' || langStr.startsWith('kk') ? 'kk'
               : langStr === 'ru' || langStr.startsWith('ru') ? 'ru' : 'en';

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
        `SELECT phrase_${lang} AS text, emoji, type, background_color
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
          `SELECT phrase_${lang} AS text, emoji, type, background_color
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
          type: phrase.type || 'encouragement',
          backgroundColor: phrase.background_color || '#A7D96C'
        };
      }
    } catch (error) {
      console.error('getRandomPhrase error:', error);
    }
    
    // Запасные варианты для разных ситуаций с цветами
    const fallbacks = {
      ru: {
        noHabits:    { text: 'Создай свою первую привычку!', emoji: '🚀', type: 'encouragement', backgroundColor: '#FFE4B5' },
        noDone:      { text: 'Продолжай пробовать, друг!', emoji: '🍫', type: 'encouragement', backgroundColor: '#FFB3BA' },
        allDone:     { text: 'Ты всё сделал! Невероятно!', emoji: '🎉', type: 'perfect', backgroundColor: '#87CEEB' },
        inProgress:  { text: 'Продолжай в том же духе!', emoji: '✨', type: 'success', backgroundColor: '#B5E7A0' }
      },
      kk: {
        noHabits:    { text: 'Алғашқы әдетіңізді жасаңыз!', emoji: '🚀', type: 'encouragement', backgroundColor: '#FFE4B5' },
        noDone:      { text: 'Жалғастырыңыз, дос!', emoji: '🍫', type: 'encouragement', backgroundColor: '#FFB3BA' },
        allDone:     { text: 'Барлығы орындалды! Керемет!', emoji: '🎉', type: 'perfect', backgroundColor: '#87CEEB' },
        inProgress:  { text: 'Жалғастырыңыз!', emoji: '✨', type: 'success', backgroundColor: '#B5E7A0' }
      },
      en: {
        noHabits:    { text: 'Create your first habit!', emoji: '🚀', type: 'encouragement', backgroundColor: '#FFE4B5' },
        noDone:      { text: 'Keep trying buddy!', emoji: '🍫', type: 'encouragement', backgroundColor: '#FFB3BA' },
        allDone:     { text: 'All done! Amazing!', emoji: '🎉', type: 'perfect', backgroundColor: '#87CEEB' },
        inProgress:  { text: 'Keep going!', emoji: '✨', type: 'success', backgroundColor: '#B5E7A0' }
      }
    };
    const fb = fallbacks[langStr] || fallbacks[lang] || fallbacks.en;
    if (totalCount === 0) return fb.noHabits;
    if (completedCount === 0) return fb.noDone;
    if (completedCount === totalCount) return fb.allDone;
    return fb.inProgress;
  }

  // Метод для получения фразы при изменении статуса привычки
  static async getPhraseForStatusChange(language = 'en', completedCount = 0, totalCount = 0, wasCompleted = false) {
    const langStr = String(language || 'en').toLowerCase();
    const lang = langStr === 'kk' || langStr.startsWith('kk') ? 'kk'
               : langStr === 'ru' || langStr.startsWith('ru') ? 'ru' : 'en';
    
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
          `SELECT phrase_${lang} AS text, emoji, type, background_color
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
            type: phrase.type || phraseType,
            backgroundColor: phrase.background_color || '#A7D96C'
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