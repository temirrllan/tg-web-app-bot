// Read-only PostgreSQL pool for the AI tool layer.
// Uses the `ai_readonly` role created by scripts/setup-ai-readonly.sql.
//
// This pool MUST NOT be used for anything except AI tool calls — it is
// the security boundary that prevents the AI from mutating data even if
// prompt injection bypasses our SQL string filters.

const { Pool } = require('pg');

function buildAiConfig() {
  const password = process.env.AI_DB_PASSWORD;
  if (!password) {
    return null;
  }

  const common = {
    user: 'ai_readonly',
    password,
    max: parseInt(process.env.AI_PG_POOL_MAX || '3', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 7_000,
  };

  if (process.env.DATABASE_URL) {
    let host, port, database;
    try {
      const u = new URL(process.env.DATABASE_URL);
      host = u.hostname;
      port = Number(u.port || 5432);
      database = u.pathname.replace(/^\//, '') || 'postgres';
    } catch {
      host = 'localhost';
      port = 5432;
      database = 'postgres';
    }

    const sslMode = (process.env.PGSSLMODE || process.env.DB_SSL || 'require').toLowerCase();
    const ssl =
      sslMode === 'disable' || sslMode === 'allow'
        ? false
        : { rejectUnauthorized: false };

    return { ...common, host, port, database, ssl };
  }

  return {
    ...common,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'habit_tracker',
    ssl: false,
  };
}

let aiPool = null;
const cfg = buildAiConfig();

if (cfg) {
  aiPool = new Pool(cfg);

  aiPool.on('connect', (client) => {
    client.query("SET timezone = 'Asia/Almaty'");
  });

  aiPool.on('error', (err) => {
    console.error('[aiDatabase] pool error:', err.message);
  });

  (async () => {
    try {
      const r = await aiPool.query("SELECT current_user AS u, current_database() AS db");
      console.log(`✅ AI DB connected as ${r.rows[0].u} on ${r.rows[0].db}`);
    } catch (err) {
      console.error('❌ AI DB connection failed:', err.message);
      console.error('   Run: scripts/setup-ai-readonly.sh after migration 016');
    }
  })();
} else {
  console.warn('⚠️  AI_DB_PASSWORD not set — AI tools will be disabled');
}

async function aiQuery(text, params, { timeoutMs = 5000 } = {}) {
  if (!aiPool) {
    throw new Error('AI database pool not configured (AI_DB_PASSWORD missing)');
  }

  const client = await aiPool.connect();
  try {
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    const start = Date.now();
    const res = await client.query(text, params);
    return {
      rows: res.rows,
      rowCount: res.rowCount,
      fields: res.fields?.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      durationMs: Date.now() - start,
    };
  } finally {
    client.release();
  }
}

function isAiPoolReady() {
  return aiPool !== null;
}

module.exports = { aiQuery, isAiPoolReady, aiPool };
