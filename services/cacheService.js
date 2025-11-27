// src/services/cacheService.js

class CacheService {
  constructor() {
    this.memoryCache = new Map();
    this.cacheVersion = '1.0.0';
    this.defaultTTL = 5 * 60 * 1000; // 5 минут по умолчанию
  }

  /**
   * Генерирует ключ кэша
   */
  generateKey(endpoint, params = {}) {
    const paramString = JSON.stringify(params);
    return `cache_${endpoint}_${paramString}`;
  }

  /**
   * Получить данные из кэша
   */
  get(key) {
    // Сначала проверяем memory cache
    if (this.memoryCache.has(key)) {
      const cached = this.memoryCache.get(key);
      
      if (this.isValid(cached)) {
        console.log('✅ Cache HIT (memory):', key);
        return cached.data;
      } else {
        console.log('⏰ Cache EXPIRED (memory):', key);
        this.memoryCache.delete(key);
      }
    }

    // Проверяем localStorage
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const cached = JSON.parse(stored);
        
        if (this.isValid(cached)) {
          console.log('✅ Cache HIT (localStorage):', key);
          // Восстанавливаем в memory cache
          this.memoryCache.set(key, cached);
          return cached.data;
        } else {
          console.log('⏰ Cache EXPIRED (localStorage):', key);
          localStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.error('Cache read error:', error);
    }

    console.log('❌ Cache MISS:', key);
    return null;
  }

  /**
   * Сохранить данные в кэш
   */
  set(key, data, ttl = this.defaultTTL) {
    const cached = {
      data,
      timestamp: Date.now(),
      ttl,
      version: this.cacheVersion
    };

    // Сохраняем в memory cache
    this.memoryCache.set(key, cached);

    // Сохраняем в localStorage (если возможно)
    try {
      localStorage.setItem(key, JSON.stringify(cached));
      console.log('💾 Cache SAVED:', key, `(TTL: ${ttl}ms)`);
    } catch (error) {
      // localStorage может быть заполнен
      console.warn('⚠️ localStorage full, using memory cache only:', error);
      this.cleanOldCache();
    }
  }

  /**
   * Проверить валидность кэша
   */
  isValid(cached) {
    if (!cached || !cached.timestamp || !cached.version) {
      return false;
    }

    // Проверяем версию
    if (cached.version !== this.cacheVersion) {
      return false;
    }

    // Проверяем TTL
    const age = Date.now() - cached.timestamp;
    return age < cached.ttl;
  }

  /**
   * Удалить из кэша
   */
  remove(key) {
    this.memoryCache.delete(key);
    try {
      localStorage.removeItem(key);
      console.log('🗑️ Cache REMOVED:', key);
    } catch (error) {
      console.error('Cache remove error:', error);
    }
  }

  /**
   * Инвалидировать кэш по паттерну
   */
  invalidate(pattern) {
    console.log('🔄 Invalidating cache:', pattern);
    
    // Очищаем memory cache
    for (const key of this.memoryCache.keys()) {
      if (key.includes(pattern)) {
        this.memoryCache.delete(key);
      }
    }

    // Очищаем localStorage
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.includes(pattern)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
  }

  /**
   * Очистить весь кэш
   */
  clear() {
    console.log('🧹 Clearing all cache');
    this.memoryCache.clear();
    
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith('cache_')) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }

  /**
   * Очистить старый кэш
   */
  cleanOldCache() {
    console.log('🧹 Cleaning old cache');
    
    // Очищаем memory cache
    for (const [key, cached] of this.memoryCache.entries()) {
      if (!this.isValid(cached)) {
        this.memoryCache.delete(key);
      }
    }

    // Очищаем localStorage
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith('cache_')) {
          try {
            const cached = JSON.parse(localStorage.getItem(key));
            if (!this.isValid(cached)) {
              localStorage.removeItem(key);
            }
          } catch (e) {
            // Удаляем поврежденный кэш
            localStorage.removeItem(key);
          }
        }
      });
    } catch (error) {
      console.error('Cache cleanup error:', error);
    }
  }

  /**
   * Получить статистику кэша
   */
  getStats() {
    return {
      memorySize: this.memoryCache.size,
      localStorageKeys: Object.keys(localStorage).filter(k => k.startsWith('cache_')).length
    };
  }
}

export default new CacheService();