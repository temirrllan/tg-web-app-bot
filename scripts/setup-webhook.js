const axios = require('axios');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL;
const WEBHOOK_URL = `${BACKEND_PUBLIC_URL}/api/telegram/webhook/${BOT_TOKEN}`;
const BOT_SECRET = process.env.BOT_SECRET;

async function setupWebhook() {
  try {
    console.log('🔧 Setting up Telegram webhook...');
    console.log(`📍 Webhook URL: ${WEBHOOK_URL}`);
    console.log(`🔐 Secret token: ${BOT_SECRET ? '✅ Set' : '❌ Not set'}`);
    
    if (!BOT_TOKEN) {
      console.error('❌ BOT_TOKEN not found in environment');
      process.exit(1);
    }
    
    if (!BACKEND_PUBLIC_URL) {
      console.error('❌ BACKEND_PUBLIC_URL not found in environment');
      process.exit(1);
    }
    
    if (!BOT_SECRET) {
      console.error('❌ BOT_SECRET not found in environment');
      process.exit(1);
    }
    
    // Удаляем старый webhook
    console.log('\n🗑️ Deleting old webhook...');
    const deleteResponse = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`
    );
    console.log('Result:', deleteResponse.data);
    
    // Ждём немного
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Устанавливаем новый webhook
    console.log('\n📡 Setting new webhook...');
    const setResponse = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
      {
        url: WEBHOOK_URL,
        secret_token: BOT_SECRET,
        allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
        drop_pending_updates: true
      }
    );
    
    console.log('Result:', setResponse.data);
    
    if (!setResponse.data.ok) {
      console.error('❌ Failed to set webhook:', setResponse.data.description);
      process.exit(1);
    }
    
    // Проверяем webhook
    console.log('\n🔍 Checking webhook info...');
    const infoResponse = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`
    );
    
    console.log('\n📊 Webhook Info:');
    console.log(JSON.stringify(infoResponse.data.result, null, 2));
    
    const webhookInfo = infoResponse.data.result;
    
    if (webhookInfo.url === WEBHOOK_URL) {
      console.log('\n✅ Webhook configured successfully!');
      console.log(`📍 URL: ${webhookInfo.url}`);
      console.log(`🔐 Has secret: ${webhookInfo.has_custom_certificate ? 'Yes' : 'No'}`);
      console.log(`📥 Pending updates: ${webhookInfo.pending_update_count || 0}`);
      
      if (webhookInfo.last_error_date) {
        console.log('\n⚠️ Last error:');
        console.log(`   Date: ${new Date(webhookInfo.last_error_date * 1000).toISOString()}`);
        console.log(`   Message: ${webhookInfo.last_error_message}`);
      }
    } else {
      console.log('\n⚠️ Webhook URL mismatch!');
      console.log('Expected:', WEBHOOK_URL);
      console.log('Got:', webhookInfo.url);
    }
    
    console.log('\n✅ Setup complete!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error setting webhook:', error.response?.data || error.message);
    process.exit(1);
  }
}

setupWebhook();