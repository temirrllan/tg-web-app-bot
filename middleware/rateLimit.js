const rateLimit = require('express-rate-limit');

const createHabitLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 минута
  max: 10, // максимум 10 запросов
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  }
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 минута
  max: 60, // максимум 60 запросов
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  }
});

module.exports = {
  createHabitLimiter,
  generalLimiter
};