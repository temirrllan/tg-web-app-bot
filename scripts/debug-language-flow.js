    // scripts/debug-language-flow.js
// Запустите: node scripts/debug-language-flow.js

const db = require('../config/database');

async function debugLanguageFlow() {
  console.log('\n🔍 ДИАГНОСТИКА ОПРЕДЕЛЕНИЯ ЯЗЫКА\n');
  console.log('=' .repeat(60));
  
  try {
    // 1. Проверяем всех пользователей и их языки
    console.log('\n📊 1. ТЕКУЩИЕ ПОЛЬЗОВАТЕЛИ В БД:\n');
    const users = await db.query(`
      SELECT 
        id,
        telegram_id,
        username,
        first_name,
        language,
        created_at,
        updated_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (users.rows.length === 0) {
      console.log('❌ Нет пользователей в базе данных');
    } else {
      users.rows.forEach(user => {
        console.log(`User ID: ${user.id}`);
        console.log(`  Telegram ID: ${user.telegram_id}`);
        console.log(`  Name: ${user.first_name} (@${user.username || 'no username'})`);
        console.log(`  Language: ${user.language} ${getLanguageEmoji(user.language)}`);
        console.log(`  Created: ${user.created_at}`);
        console.log('');
      });
    }
    
    // 2. Проверяем колонку language
    console.log('\n📊 2. ПРОВЕРКА СТРУКТУРЫ ТАБЛИЦЫ:\n');
    const columnInfo = await db.query(`
      SELECT 
        column_name,
        data_type,
        column_default,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = 'users' 
      AND column_name = 'language'
    `);
    
    if (columnInfo.rows.length > 0) {
      const col = columnInfo.rows[0];
      console.log(`Column 'language' info:`);
      console.log(`  Type: ${col.data_type}`);
      console.log(`  Default: ${col.column_default || 'NULL'}`);
      console.log(`  Nullable: ${col.is_nullable}`);
      
      if (col.column_default && col.column_default.includes('ru')) {
        console.log('\n⚠️  ПРОБЛЕМА НАЙДЕНА: Колонка language имеет DEFAULT значение "ru"!');
        console.log('  Это нужно исправить!');
      }
    }
    
    // 3. Проверяем статистику языков
    console.log('\n📊 3. СТАТИСТИКА ЯЗЫКОВ:\n');
    const stats = await db.query(`
      SELECT 
        language,
        COUNT(*) as count
      FROM users
      GROUP BY language
      ORDER BY count DESC
    `);
    
    stats.rows.forEach(stat => {
      console.log(`  ${stat.language}: ${stat.count} users ${getLanguageEmoji(stat.language)}`);
    });
    
    // 4. Проверяем последние авторизации
    console.log('\n📊 4. ПОСЛЕДНИЕ СОЗДАННЫЕ ПОЛЬЗОВАТЕЛИ:\n');
    const lastUsers = await db.query(`
      SELECT 
        telegram_id,
        first_name,
        language,
        created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    lastUsers.rows.forEach(user => {
      const created = new Date(user.created_at);
      const now = new Date();
      const diffMinutes = Math.floor((now - created) / 60000);
      
      console.log(`${user.first_name} (${user.telegram_id})`);
      console.log(`  Language: ${user.language} ${getLanguageEmoji(user.language)}`);
      console.log(`  Created: ${diffMinutes} minutes ago`);
      console.log('');
    });
    
    // 5. Проверяем DEFAULT значение в схеме БД
    console.log('\n📊 5. ПРОВЕРКА DEFAULT ЗНАЧЕНИЙ:\n');
    const constraints = await db.query(`
      SELECT 
        conname,
        pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = 'users'::regclass
      AND contype = 'd'
    `);
    
    if (constraints.rows.length > 0) {
      console.log('Default constraints:');
      constraints.rows.forEach(c => {
        console.log(`  ${c.conname}: ${c.definition}`);
        if (c.definition.includes("'ru'")) {
          console.log('  ⚠️ НАЙДЕН DEFAULT "ru"!');
        }
      });
    } else {
      console.log('No default constraints found');
    }
    
    console.log('\n' + '=' .repeat(60));
    console.log('\n🔧 РЕКОМЕНДАЦИИ:\n');
    
    // Даем рекомендации
    console.log('1. Выполните SQL для проверки/исправления DEFAULT:');
    console.log(`   ALTER TABLE users ALTER COLUMN language SET DEFAULT 'en';`);
    console.log('');
    console.log('2. Проверьте логи сервера при создании нового пользователя');
    console.log('');
    console.log('3. Проверьте, что на фронтенде нет жестко заданного языка');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

function getLanguageEmoji(lang) {
  const emojis = {
    'en': '🇬🇧',
    'ru': '🇷🇺',
    'kk': '🇰🇿'
  };
  return emojis[lang] || '❓';
}

debugLanguageFlow();