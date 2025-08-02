const db = require('../config/database');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
  try {
    console.log('🚀 Initializing database...');

    // Опция для пересоздания таблиц
    const dropExisting = process.argv.includes('--drop');
    
    if (dropExisting) {
      console.log('⚠️  Dropping existing tables...');
      await dropTables();
    }

    // Читаем SQL файл
    const sqlPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Разбиваем на отдельные команды
    const commands = sql
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0);

    // Выполняем команды по одной
    for (const command of commands) {
      try {
        await db.query(command + ';');
      } catch (error) {
        if (error.code === '42P07') { // Таблица уже существует
          console.log(`⚠️  Table already exists, skipping...`);
        } else if (error.code === '23505') { // Дубликат уникального значения
          console.log(`⚠️  Duplicate value, skipping...`);
        } else {
          throw error;
        }
      }
    }

    console.log('✅ Database initialized successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

async function dropTables() {
  const tables = [
    'reminder_history',
    'habit_marks',
    'subscriptions',
    'habits',
    'motivational_phrases',
    'categories'
    // users не удаляем, так как она уже существует
  ];

  for (const table of tables) {
    try {
      await db.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      console.log(`  Dropped table: ${table}`);
    } catch (error) {
      console.error(`  Failed to drop ${table}:`, error.message);
    }
  }
}

initDatabase();