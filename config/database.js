const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

/**
 * SSL-режим:
 * - Если используете Render External Database URL → SSL требуется (по умолчанию включён).
 * - Если используете Render Internal Database URL → добавьте PGSSLMODE=disable в переменные окружения сервиса.
 */
function buildConfig() {
  const common = {
    max: parseInt(process.env.PGPOOL_MAX || '10', 10),
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '10000', 10),
  };

  // Если есть DATABASE_URL — используем его (прод/стейдж)
  if (process.env.DATABASE_URL) {
    const sslMode = (process.env.PGSSLMODE || process.env.DB_SSL || 'require').toLowerCase();
    const ssl =
      sslMode === 'disable' || sslMode === 'allow'
        ? false
        : { rejectUnauthorized: false };

    return {
      connectionString: process.env.DATABASE_URL,
      ssl,
      ...common,
    };
  }

  // Иначе — локальная разработка по отдельным полям
  const localSslMode = (process.env.PGSSLMODE || 'disable').toLowerCase();
  const localSsl =
    localSslMode === 'disable' || localSslMode === 'allow'
      ? false
      : { rejectUnauthorized: false };

  return {
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'habit_tracker',
    port: Number(process.env.DB_PORT || 5432),
    ssl: localSsl,
    ...common,
  };
}

const config = buildConfig();
const pool = new Pool(config);

// Проверяем подключение при запуске
(async () => {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query('select current_database() as db, version() as version');
      const row = res.rows[0] || {};
      console.log('✅ Database connected successfully');
      console.log('Database:', row.db || client.database);
      if (row.version) {
        console.log('PostgreSQL:', String(row.version).split(' on ')[0]);
      }
      console.log('SSL:', config.ssl ? 'enabled' : 'disabled');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('Config used:', process.env.DATABASE_URL ? 'DATABASE_URL' : 'Individual params');
    console.error('SSL:', config.ssl ? 'enabled' : 'disabled');
  }
})();

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
  pool,
};
