const db = require('../config/database');

async function testRejoinScenario() {
  console.log('🧪 Testing habit rejoin scenario...\n');
  
  try {
    // Получаем тестовых пользователей
    const users = await db.query(
      'SELECT id, username, first_name FROM users LIMIT 2'
    );
    
    if (users.rows.length < 2) {
      console.log('❌ Need at least 2 users for testing');
      process.exit(1);
    }
    
    const owner = users.rows[0];
    const member = users.rows[1];
    
    console.log(`Owner: ${owner.first_name} (ID: ${owner.id})`);
    console.log(`Member: ${member.first_name} (ID: ${member.id})\n`);
    
    // Проверяем совместные привычки
    const sharedHabits = await db.query(`
      SELECT DISTINCT h.id, h.title, h.parent_habit_id
      FROM habits h
      WHERE h.user_id = $1
      AND EXISTS (
        SELECT 1 FROM habit_members hm 
        WHERE hm.habit_id = h.id 
        AND hm.user_id = $2
      )
    `, [owner.id, member.id]);
    
    if (sharedHabits.rows.length === 0) {
      console.log('❌ No shared habits found between these users');
      process.exit(1);
    }
    
    const habit = sharedHabits.rows[0];
    console.log(`Testing with habit: "${habit.title}" (ID: ${habit.id})\n`);
    
    // Шаг 1: Проверяем текущее состояние
    console.log('📊 Step 1: Current state');
    const currentMembers = await db.query(`
      SELECT COUNT(*) as count 
      FROM habit_members 
      WHERE habit_id = $1 
      AND is_active = true
    `, [habit.id]);
    console.log(`Active members: ${currentMembers.rows[0].count}`);
    
    // Шаг 2: Удаляем участника
    console.log('\n🗑️ Step 2: Removing member...');
    await db.query(
      'UPDATE habit_members SET is_active = false WHERE habit_id = $1 AND user_id = $2',
      [habit.id, member.id]
    );
    
    await db.query(
      'UPDATE habits SET is_active = false WHERE user_id = $1 AND parent_habit_id = $2',
      [member.id, habit.parent_habit_id || habit.id]
    );
    
    const afterRemove = await db.query(`
      SELECT COUNT(*) as count 
      FROM habit_members 
      WHERE habit_id = $1 
      AND is_active = true
    `, [habit.id]);
    console.log(`Active members after removal: ${afterRemove.rows[0].count}`);
    
    // Шаг 3: Восстанавливаем участника
    console.log('\n♻️ Step 3: Restoring member...');
    await db.query(
      'UPDATE habit_members SET is_active = true WHERE habit_id = $1 AND user_id = $2',
      [habit.id, member.id]
    );
    
    const memberHabit = await db.query(
      'SELECT id FROM habits WHERE user_id = $1 AND parent_habit_id = $2',
      [member.id, habit.parent_habit_id || habit.id]
    );
    
    if (memberHabit.rows.length > 0) {
      await db.query(
        'UPDATE habits SET is_active = true WHERE id = $1',
        [memberHabit.rows[0].id]
      );
      
      await db.query(
        `INSERT INTO habit_members (habit_id, user_id) 
         VALUES ($1, $2) 
         ON CONFLICT (habit_id, user_id) 
         DO UPDATE SET is_active = true`,
        [memberHabit.rows[0].id, owner.id]
      );
    }
    
    const afterRestore = await db.query(`
      SELECT COUNT(*) as count 
      FROM habit_members 
      WHERE habit_id = $1 
      AND is_active = true
    `, [habit.id]);
    console.log(`Active members after restore: ${afterRestore.rows[0].count}`);
    
    // Шаг 4: Проверяем финальное состояние
    console.log('\n✅ Step 4: Final verification');
    const finalCheck = await db.query(`
      SELECT 
        hm.user_id,
        u.first_name,
        hm.is_active,
        h.title
      FROM habit_members hm
      JOIN users u ON hm.user_id = u.id
      JOIN habits h ON hm.habit_id = h.id
      WHERE hm.habit_id = $1
      ORDER BY hm.is_active DESC, u.first_name
    `, [habit.id]);
    
    console.log('Final member states:');
    finalCheck.rows.forEach(row => {
      const status = row.is_active ? '✅ Active' : '❌ Inactive';
      console.log(`  ${status}: ${row.first_name}`);
    });
    
    console.log('\n🎉 Test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testRejoinScenario();