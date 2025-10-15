const axios = require('axios');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = `${process.env.BACKEND_PUBLIC_URL}/api/payment/webhook`;
const BOT_SECRET = process.env.BOT_SECRET;

async function setupWebhook() {
  try {
    console.log('🔧 Setting up Telegram webhook...');
    console.log(`📍 Webhook URL: ${WEBHOOK_URL}`);
    
    // Удаляем старый webhook
    const deleteResponse = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`
    );
    console.log('🗑️ Old webhook deleted:', deleteResponse.data);
    
    // Устанавливаем новый webhook
    const setResponse = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
      {
        url: WEBHOOK_URL,
        secret_token: BOT_SECRET,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true
      }
    );
    
    console.log('✅ Webhook set:', setResponse.data);
    
    // Проверяем webhook
    const infoResponse = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`
    );
    
    console.log('\n📊 Webhook Info:');
    console.log(JSON.stringify(infoResponse.data, null, 2));
    
    if (infoResponse.data.result.url === WEBHOOK_URL) {
      console.log('\n✅ Webhook configured successfully!');
    } else {
      console.log('\n⚠️ Webhook URL mismatch!');
      console.log('Expected:', WEBHOOK_URL);
      console.log('Got:', infoResponse.data.result.url);
    }
    
  } catch (error) {
    console.error('❌ Error setting webhook:', error.response?.data || error.message);
  }
}

setupWebhook();