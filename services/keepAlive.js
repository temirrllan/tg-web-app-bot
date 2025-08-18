const axios = require('axios');

class KeepAliveService {
  constructor() {
    this.interval = null;
    this.healthUrl = process.env.BACKEND_PUBLIC_URL 
      ? `${process.env.BACKEND_PUBLIC_URL}/health`
      : null;
  }

  start() {
    // Не запускаем в development mode
    if (process.env.NODE_ENV !== 'production' || !this.healthUrl) {
      console.log('⏰ Keep-alive service: skipped (not in production)');
      return;
    }

    // Пингуем каждые 14 минут (чуть меньше 15 минут timeout)
    this.interval = setInterval(async () => {
      try {
        const response = await axios.get(this.healthUrl, { timeout: 5000 });
        console.log(`✅ Keep-alive ping successful: ${new Date().toISOString()}`);
      } catch (error) {
        console.error(`❌ Keep-alive ping failed: ${error.message}`);
      }
    }, 14 * 60 * 1000); // 14 минут

    console.log('⏰ Keep-alive service started (ping every 14 minutes)');
    
    // Первый пинг через 30 секунд после запуска
    setTimeout(() => this.ping(), 30000);
  }

  async ping() {
    if (!this.healthUrl) return;
    
    try {
      await axios.get(this.healthUrl, { timeout: 5000 });
      console.log(`✅ Initial keep-alive ping successful`);
    } catch (error) {
      console.error(`❌ Initial keep-alive ping failed: ${error.message}`);
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('⏰ Keep-alive service stopped');
    }
  }
}

module.exports = new KeepAliveService();