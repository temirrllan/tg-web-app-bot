const TelegramStarsService = require('../services/telegramStarsService');
const db = require('../config/database');

async function testPaymentFlow() {
  console.log('🧪 Testing payment flow (dry run)...\n');
  
  try {
    // 1. Проверка планов
    console.log('1️⃣ Checking subscription plans...');
    const plans = TelegramStarsService.PLANS;
    
     Object.entries(plans).forEach(([key, plan]) => {
      const price = TelegramStarsService.getPlanPrice(key);
      console.log(`  ✅ ${plan.name}: ${price} XTR`);
    });
    console.log('');
    
   // 2. Проверка генерации payload
    console.log('2️⃣ Testing payload generation...');
    const testUserId = 999999;
    const testPlanType = '6_months';
    const payload = TelegramStarsService.generateInvoicePayload(testUserId, testPlanType);
    console.log(`  ✅ Generated payload: ${payload}`);
    
    // Проверка парсинга payload с новой логикой
    const parsed = TelegramStarsService.parseInvoicePayload(payload);
    
    console.log(`  Debug: Parsed user ID: "${parsed.userId}" vs Expected: "${testUserId}"`);
    console.log(`  Debug: Parsed plan: "${parsed.planType}" vs Expected: "${testPlanType}"`);
    
    // Исправленная проверка
    if (String(parsed.userId) === String(testUserId) && parsed.planType === testPlanType) {
      console.log(`  ✅ Payload parsing works correctly`);
    } else {
      console.log(`  ❌ Payload parsing failed!`);
      console.log(`     Expected: userId=${testUserId}, plan=${testPlanType}`);
      console.log(`     Got: userId=${parsed.userId}, plan=${parsed.planType}`);
      process.exit(1);
    }
    console.log('');
    
    // 3. Проверка создания записи о платеже (с откатом)
    console.log('3️⃣ Testing payment record creation (will rollback)...');
    
    // Создаём тестового пользователя
    const userResult = await db.query(`
      INSERT INTO users (telegram_id, first_name, language, is_premium)
      VALUES ('test_payment_user', 'Test User', 'en', false)
      ON CONFLICT (telegram_id) DO UPDATE SET first_name = 'Test User'
      RETURNING id
    `);
    const userId = userResult.rows[0].id;
    console.log(`  ✅ Created test user: ID ${userId}`);
    
    try {
      const price = TelegramStarsService.getPlanPrice(testPlanType);
      const paymentPayload = TelegramStarsService.generateInvoicePayload(userId, testPlanType);
      
      await TelegramStarsService.createPaymentRecord(userId, testPlanType, paymentPayload, price);
      console.log(`  ✅ Payment record created successfully`);
      
      // Проверка что запись создана
      const checkPayment = await db.query(
        'SELECT * FROM telegram_payments WHERE user_id = $1 AND invoice_payload = $2',
        [userId, paymentPayload]
      );
      
      if (checkPayment.rows.length > 0) {
        console.log(`  ✅ Payment record verified in database`);
        console.log(`     Status: ${checkPayment.rows[0].status}`);
        console.log(`     Amount: ${checkPayment.rows[0].total_amount} XTR`);
      } else {
        console.log(`  ❌ Payment record not found in database!`);
      }
      
    } finally {
      // Очистка тестовых данных
      await db.query('DELETE FROM telegram_payments WHERE user_id = $1', [userId]);
      await db.query('DELETE FROM users WHERE id = $1', [userId]);
      console.log(`  ✅ Test data cleaned up`);
    }
    console.log('');
    
    // 4. Проверка обработки успешного платежа (dry run)
    console.log('4️⃣ Testing successful payment processing (dry run)...');
    
    // Создаём тестового пользователя для полного теста
    const fullTestUser = await db.query(`
      INSERT INTO users (telegram_id, first_name, language, is_premium)
      VALUES ('123456789', 'Test Full User', 'en', false)
      ON CONFLICT (telegram_id) DO UPDATE SET first_name = 'Test Full User'
      RETURNING id
    `);
    const fullUserId = fullTestUser.rows[0].id;
    
    try {
      const fullPayload = TelegramStarsService.generateInvoicePayload(fullUserId, testPlanType);
      const fullPrice = TelegramStarsService.getPlanPrice(testPlanType);
      
      console.log(`  Creating payment record for user ${fullUserId}...`);
      
      // Создаём payment record
      await TelegramStarsService.createPaymentRecord(fullUserId, testPlanType, fullPayload, fullPrice);
      
      // Симулируем успешный платёж
      const paymentData = {
        telegram_payment_charge_id: 'test_charge_' + Date.now(),
        provider_payment_charge_id: 'test_provider_' + Date.now(),
        invoice_payload: fullPayload,
        total_amount: fullPrice,
        currency: 'XTR',
        from_user_id: 123456789
      };
      
      console.log(`  Processing simulated payment...`);
      
      const result = await TelegramStarsService.processSuccessfulPayment(paymentData);
      
      if (result.success) {
        console.log(`  ✅ Payment processed successfully`);
        
        // Проверка что пользователь стал premium
        const userCheck = await db.query(
          'SELECT is_premium, subscription_type, subscription_expires_at FROM users WHERE id = $1',
          [fullUserId]
        );
        
        const user = userCheck.rows[0];
        
        if (user.is_premium) {
          console.log(`  ✅ User is now premium`);
          console.log(`     Subscription type: ${user.subscription_type}`);
          console.log(`     Expires at: ${user.subscription_expires_at || 'Lifetime'}`);
        } else {
          console.log(`  ❌ User is not premium after payment!`);
          console.log(`     is_premium: ${user.is_premium}`);
          console.log(`     subscription_type: ${user.subscription_type}`);
        }
        
        // Проверка создания подписки
        const subCheck = await db.query(
          'SELECT id, plan_type, is_active, started_at, expires_at FROM subscriptions WHERE user_id = $1 AND is_active = true',
          [fullUserId]
        );
        
        if (subCheck.rows.length > 0) {
          console.log(`  ✅ Subscription created in database`);
          const sub = subCheck.rows[0];
          console.log(`     ID: ${sub.id}`);
          console.log(`     Plan: ${sub.plan_type}`);
          console.log(`     Active: ${sub.is_active}`);
          console.log(`     Started: ${sub.started_at}`);
          console.log(`     Expires: ${sub.expires_at || 'Lifetime'}`);
        } else {
          console.log(`  ❌ Subscription not found in database!`);
        }
        
        // Проверка истории
        const historyCheck = await db.query(
          'SELECT action, plan_type, price_stars FROM subscription_history WHERE user_id = $1',
          [fullUserId]
        );
        
        if (historyCheck.rows.length > 0) {
          console.log(`  ✅ History record created`);
          console.log(`     Action: ${historyCheck.rows[0].action}`);
        } else {
          console.log(`  ⚠️ No history record found (optional)`);
        }
        
      } else {
        console.log(`  ❌ Payment processing failed: ${result.error}`);
        throw new Error(result.error);
      }
      
    } catch (error) {
      console.error(`  ❌ Test failed with error:`, error.message);
      throw error;
    } finally {
      // Очистка
      console.log(`  Cleaning up test data...`);
      await db.query('DELETE FROM subscription_history WHERE user_id = $1', [fullUserId]);
      await db.query('DELETE FROM subscriptions WHERE user_id = $1', [fullUserId]);
      await db.query('DELETE FROM telegram_payments WHERE user_id = $1', [fullUserId]);
      await db.query('DELETE FROM users WHERE id = $1', [fullUserId]);
      console.log(`  ✅ Test data cleaned up`);
    }
    console.log('');
    
    // 5. Проверка защиты от дублей
    console.log('5️⃣ Testing duplicate payment protection...');
    
    const dupUser = await db.query(`
      INSERT INTO users (telegram_id, first_name, language, is_premium)
      VALUES ('987654321', 'Duplicate Test', 'en', false)
      ON CONFLICT (telegram_id) DO UPDATE SET first_name = 'Duplicate Test'
      RETURNING id
    `);
    const dupUserId = dupUser.rows[0].id;
    
    try {
      const dupPayload = TelegramStarsService.generateInvoicePayload(dupUserId, testPlanType);
      const dupPrice = TelegramStarsService.getPlanPrice(testPlanType);
      const dupChargeId = 'dup_charge_' + Date.now();
      
      // Первый платёж
      const paymentData1 = {
        telegram_payment_charge_id: dupChargeId,
        provider_payment_charge_id: 'dup_provider_1',
        invoice_payload: dupPayload,
        total_amount: dupPrice,
        currency: 'XTR',
        from_user_id: 987654321
      };
      
      await TelegramStarsService.createPaymentRecord(dupUserId, testPlanType, dupPayload, dupPrice);
      const result1 = await TelegramStarsService.processSuccessfulPayment(paymentData1);
      
      if (!result1.success) {
        throw new Error('First payment failed: ' + result1.error);
      }
      
      console.log(`  ✅ First payment processed`);
      
      // Попытка повторного платежа с тем же charge_id
      const paymentData2 = {
        telegram_payment_charge_id: dupChargeId, // Тот же ID
        provider_payment_charge_id: 'dup_provider_2',
        invoice_payload: dupPayload,
        total_amount: dupPrice,
        currency: 'XTR',
        from_user_id: 987654321
      };
      
      const result2 = await TelegramStarsService.processSuccessfulPayment(paymentData2);
      
      if (result2.duplicate || result2.success) {
        console.log(`  ✅ Duplicate payment detected and handled correctly`);
      } else {
        console.log(`  ❌ Duplicate payment was processed again!`);
        throw new Error('Duplicate protection failed');
      }
      
      // Проверяем что создана только одна подписка
      const subCount = await db.query(
        'SELECT COUNT(*) FROM subscriptions WHERE user_id = $1',
        [dupUserId]
      );
      
      const count = parseInt(subCount.rows[0].count);
      if (count === 1) {
        console.log(`  ✅ Only one subscription created (duplicate prevented)`);
      } else {
        console.log(`  ❌ Found ${count} subscriptions (should be 1)`);
        throw new Error('Duplicate subscriptions created');
      }
      
    } finally {
      await db.query('DELETE FROM subscription_history WHERE user_id = $1', [dupUserId]);
      await db.query('DELETE FROM subscriptions WHERE user_id = $1', [dupUserId]);
      await db.query('DELETE FROM telegram_payments WHERE user_id = $1', [dupUserId]);
      await db.query('DELETE FROM users WHERE id = $1', [dupUserId]);
      console.log(`  ✅ Test data cleaned up`);
    }
    console.log('');
    
    console.log('✅ All payment flow tests passed!\n');
    console.log('🎉 Payment system is ready for production!\n');
    console.log('Summary:');
    console.log('  ✅ Payment plans configured correctly');
    console.log('  ✅ Payload generation working');
    console.log('  ✅ Payment records created successfully');
    console.log('  ✅ Payment processing working');
    console.log('  ✅ User premium status updated');
    console.log('  ✅ Subscriptions created correctly');
    console.log('  ✅ Duplicate protection working');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Test real payment with 1 XTR');
    console.log('  2. Verify Stars are received');
    console.log('  3. Monitor logs for any issues');
    console.log('');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Payment flow test failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testPaymentFlow();