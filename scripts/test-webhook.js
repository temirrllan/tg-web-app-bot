const axios = require('axios');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;

async function testWebhook() {
  console.log('🔍 Testing webhook configuration...\n');
  
  try {
    // Получаем информацию о webhook
    const response = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`
    );
    
    const info = response.data.result;
    
    console.log('📊 Webhook Information:');
    console.log(`  URL: ${info.url || 'NOT SET'}`);
    console.log(`  Has custom certificate: ${info.has_custom_certificate}`);
    console.log(`  Pending update count: ${info.pending_update_count}`);
    console.log(`  Max connections: ${info.max_connections || 40}`);
    console.log(`  Allowed updates: ${info.allowed_updates?.join(', ') || 'all'}`);
    console.log('');
    
    if (!info.url) {
      console.log('❌ Webhook is NOT configured!');
      console.log('Run: npm run setup-webhook\n');
      process.exit(1);
    }
    
    if (info.last_error_date) {
      console.log('⚠️ Last webhook error:');
      console.log(`  Date: ${new Date(info.last_error_date * 1000).toISOString()}`);
      console.log(`  Message: ${info.last_error_message}`);
      console.log('');
    }
    
    // Проверяем что URL корректный
    const expectedUrl = `${process.env.BACKEND_PUBLIC_URL}/api/telegram/webhook/${BOT_TOKEN}`;
    
    if (info.url === expectedUrl) {
      console.log('✅ Webhook URL is correct!');
    } else {
      console.log('⚠️ Webhook URL mismatch:');
      console.log(`  Expected: ${expectedUrl}`);
      console.log(`  Got: ${info.url}`);
      console.log('\nRun: npm run setup-webhook\n');
    }
    
    // Проверяем доступность webhook endpoint
    console.log('\n🔍 Testing webhook endpoint accessibility...');
    
    try {
      const testResponse = await axios.post(info.url, {
        update_id: 0,
        message: {
          message_id: 0,
          from: { id: 0, is_bot: false, first_name: 'Test' },
          chat: { id: 0, type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: '/test'
        }
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': process.env.BOT_SECRET
        },
        timeout: 5000
      });
      
      if (testResponse.status === 200) {
        console.log('✅ Webhook endpoint is accessible');
      }
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('⚠️ Webhook requires authentication (expected)');
      } else {
        console.log('❌ Webhook endpoint error:', error.message);
      }
    }
    
    console.log('\n✅ Webhook check complete!\n');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error checking webhook:', error.message);
    process.exit(1);
  }
}

testWebhook();