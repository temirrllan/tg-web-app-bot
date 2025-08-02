const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

// Конфигурация для Railway (production) и локальной разработки
const config = process.env.DATABASE_URL 
  ? {
      // Production (Railway)
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    }
  : {
      // Development (local)
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'habit_tracker',
      port: process.env.DB_PORT || 5432,
    };

const pool = new Pool(config);

// Проверяем подключение при запуске
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('Config used:', process.env.DATABASE_URL ? 'DATABASE_URL' : 'Individual params');
  } else {
    console.log('✅ Database connected successfully');
    console.log('Database:', client.database);
    release();
  }
});

// Вспомогательная функция для выполнения запросов
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// Функция для транзакций
const getClient = () => pool.connect();

module.exports = {
  query,
  getClient,
  pool
};