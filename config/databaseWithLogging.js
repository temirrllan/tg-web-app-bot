// config/databaseWithLogging.js - Замените обычный database.js на этот для отладки

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// 🔥 КРИТИЧЕСКИЙ ПЕРЕХВАТЧИК ЗАПРОСОВ
const originalQuery = pool.query.bind(pool);

pool.query = function(...args) {
  const query = args[0];
  const values = args[1];
  
  // Проверяем опасные UPDATE запросы на users
  if (typeof query === 'string' && query.toUpperCase().includes('UPDATE USERS')) {
    const upperQuery = query.toUpperCase();
    
    // 🚨 КРИТИЧЕСКАЯ ПРОВЕРКА: UPDATE без WHERE
    if (!upperQuery.includes('WHERE')) {
      console.error('\n' + '🚨'.repeat(40));
      console.error('🚨🚨🚨 CRITICAL ERROR: UPDATE USERS WITHOUT WHERE CLAUSE! 🚨🚨🚨');
      console.error('🚨 This would UPDATE ALL USERS!');
      console.error('🚨 Query:', query);
      console.error('🚨 Values:', values);
      console.error('🚨 Stack trace:');
      console.error(new Error().stack);
      console.error('🚨'.repeat(40) + '\n');
      
      // ⛔ БЛОКИРУЕМ ОПАСНЫЙ ЗАПРОС
      throw new Error('BLOCKED: UPDATE users without WHERE clause is not allowed!');
    }
    
    // Проверяем is_premium в запросе
    if (upperQuery.includes('IS_PREMIUM')) {
      console.log('\n' + '🔍'.repeat(40));
      console.log('🔍 UPDATE users with is_premium detected');
      console.log('Query:', query);
      console.log('Values:', values);
      console.log('Stack trace:', new Error().stack.split('\n').slice(2, 6).join('\n'));
      console.log('🔍'.repeat(40) + '\n');
      
      // Проверяем, что есть конкретный user_id в WHERE
      if (upperQuery.includes('WHERE ID = $1') || 
          upperQuery.includes('WHERE USER_ID = $1') ||
          upperQuery.includes('WHERE USERS.ID = $1')) {
        console.log('✅ Query has WHERE id = $1 - SAFE');
        
        if (values && values[0]) {
          console.log(`✅ Target user ID: ${values[0]}`);
        }
      } else {
        console.warn('⚠️ WARNING: UPDATE users without "WHERE id = $1" pattern!');
        console.warn('⚠️ This might update multiple users!');
      }
    }
  }
  
  // Проверяем UPDATE subscriptions
  if (typeof query === 'string' && query.toUpperCase().includes('UPDATE SUBSCRIPTIONS')) {
    const upperQuery = query.toUpperCase();
    
    if (!upperQuery.includes('WHERE')) {
      console.error('\n' + '🚨'.repeat(40));
      console.error('🚨 CRITICAL: UPDATE subscriptions WITHOUT WHERE!');
      console.error('🚨 Query:', query);
      console.error('🚨'.repeat(40) + '\n');
      
      throw new Error('BLOCKED: UPDATE subscriptions without WHERE clause!');
    }
  }
  
  return originalQuery(...args);
};

// Для getClient() тоже добавляем перехватчик
const originalGetClient = pool.connect.bind(pool);

pool.connect = async function() {
  const client = await originalGetClient();
  const originalClientQuery = client.query.bind(client);
  
  client.query = function(...args) {
    const query = args[0];
    const values = args[1];
    
    // Те же проверки для client.query
    if (typeof query === 'string' && query.toUpperCase().includes('UPDATE USERS')) {
      const upperQuery = query.toUpperCase();
      
      if (!upperQuery.includes('WHERE')) {
        console.error('\n' + '🚨'.repeat(40));
        console.error('🚨 CRITICAL ERROR: client.query UPDATE USERS WITHOUT WHERE!');
        console.error('🚨 Query:', query);
        console.error('🚨 Stack:', new Error().stack);
        console.error('🚨'.repeat(40) + '\n');
        
        throw new Error('BLOCKED: UPDATE users without WHERE clause!');
      }
      
      if (upperQuery.includes('IS_PREMIUM')) {
        console.log('🔍 client.query: UPDATE users with is_premium');
        console.log('Query:', query);
        console.log('Values:', values);
        
        if (values && values[0]) {
          console.log(`✅ Target user ID: ${values[0]}`);
        }
      }
    }
    
    if (typeof query === 'string' && query.toUpperCase().includes('UPDATE SUBSCRIPTIONS')) {
      const upperQuery = query.toUpperCase();
      
      if (!upperQuery.includes('WHERE')) {
        console.error('🚨 CRITICAL: client.query UPDATE subscriptions WITHOUT WHERE!');
        throw new Error('BLOCKED: UPDATE subscriptions without WHERE!');
      }
    }
    
    return originalClientQuery(...args);
  };
  
  return client;
};

pool.getClient = pool.connect;

module.exports = pool;