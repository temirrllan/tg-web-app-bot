/**
 * Хелпер для работы с датами в Asia/Almaty (UTC+5)
 * Казахстан перешёл на единый часовой пояс UTC+5 с 1 марта 2024
 *
 * Используй эти функции ВМЕСТО toISOString().split('T')[0]
 * т.к. toISOString() возвращает UTC, а не локальное время
 */

const TIMEZONE = 'Asia/Almaty';

/**
 * Возвращает текущую дату в формате YYYY-MM-DD по Asia/Almaty
 * @param {Date} [date] - дата (по умолчанию сейчас)
 * @returns {string} YYYY-MM-DD
 */
function getAlmatyDate(date = new Date()) {
  return date.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
}

/**
 * Возвращает сегодня по Алматы
 * @returns {string} YYYY-MM-DD
 */
function getToday() {
  return getAlmatyDate();
}

/**
 * Возвращает вчера по Алматы
 * @returns {string} YYYY-MM-DD
 */
function getYesterday() {
  return getAlmatyDate(new Date(Date.now() - 86400000));
}

/**
 * День недели по календарной дате (1=Пн … 7=Вс).
 * Считается через UTC-парсинг — день недели у конкретной календарной даты
 * не зависит от таймзоны сервера.
 * @param {string} yyyymmdd - дата в формате YYYY-MM-DD
 * @returns {number} 1-7
 */
function dayOfWeekIso(yyyymmdd) {
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

/**
 * Вычитает один календарный день из YYYY-MM-DD.
 * @param {string} yyyymmdd
 * @returns {string} YYYY-MM-DD
 */
function minusOneDay(yyyymmdd) {
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  TIMEZONE,
  getAlmatyDate,
  getToday,
  getYesterday,
  dayOfWeekIso,
  minusOneDay,
};
