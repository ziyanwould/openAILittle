/**
 * 统一的LRU缓存管理器
 *
 * 功能:
 * - LRU (Least Recently Used) 驱逐策略
 * - 支持TTL过期时间
 * - 支持缓存统计（命中率、大小等）
 * - 线程安全的清理机制
 *
 * 使用场景:
 * - 响应缓存 (responseCache)
 * - 模型白名单缓存 (modelWhitelists)
 * - 简洁模式配置缓存 (conciseModeCache)
 * - 通知配置缓存 (notificationConfigCache)
 *
 * @Author: Performance Optimization
 * @Date: 2025-11-16
 */

class LRUCache {
  /**
   * @param {Object} options 缓存配置
   * @param {number} options.maxSize - 最大缓存条目数量（默认1000）
   * @param {number} options.ttl - 过期时间（毫秒，默认5分钟）
   * @param {string} options.name - 缓存名称（用于日志）
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.ttl = options.ttl || 5 * 60 * 1000; // 默认5分钟
    this.name = options.name || 'UnnamedCache';

    // 使用Map实现LRU（Map保持插入顺序）
    this.cache = new Map();

    // 统计信息
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0
    };

    // 定期清理过期项（每分钟一次）
    this.cleanupInterval = setInterval(() => this._cleanup(), 60 * 1000);
    this.cleanupInterval.unref(); // 不阻塞进程退出
  }

  /**
   * 设置缓存
   * @param {string} key - 缓存键
   * @param {*} value - 缓存值
   * @param {number} customTTL - 自定义过期时间（可选）
   */
  set(key, value, customTTL = null) {
    const ttl = customTTL || this.ttl;
    const expireAt = Date.now() + ttl;

    // 如果键已存在，先删除（移到末尾）
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // 检查缓存大小，超出则驱逐最旧的
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.stats.evictions++;
    }

    // 插入新值（插入到末尾）
    this.cache.set(key, {
      value,
      expireAt,
      createdAt: Date.now()
    });
  }

  /**
   * 获取缓存
   * @param {string} key - 缓存键
   * @returns {*} 缓存值，如果不存在或过期返回null
   */
  get(key) {
    const entry = this.cache.get(key);

    // 缓存未命中
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // 检查是否过期
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      this.stats.expirations++;
      this.stats.misses++;
      return null;
    }

    // 命中：移动到末尾（LRU更新）
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.stats.hits++;

    return entry.value;
  }

  /**
   * 检查键是否存在且未过期
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * 删除缓存
   * @param {string} key
   * @returns {boolean} 是否删除成功
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear();
    // 重置统计（保留历史统计可能有用，这里选择重置）
    console.log(`[${this.name}] 缓存已清空，历史统计: ${JSON.stringify(this.stats)}`);
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0
    };
  }

  /**
   * 获取缓存大小
   * @returns {number}
   */
  size() {
    return this.cache.size;
  }

  /**
   * 获取缓存命中率
   * @returns {number} 命中率（0-1之间）
   */
  hitRate() {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? 0 : this.stats.hits / total;
  }

  /**
   * 获取缓存统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      name: this.name,
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      hitRate: this.hitRate(),
      ...this.stats
    };
  }

  /**
   * 清理过期项（内部方法）
   * @private
   */
  _cleanup() {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expireAt) {
        this.cache.delete(key);
        expiredCount++;
        this.stats.expirations++;
      }
    }

    if (expiredCount > 0) {
      console.log(`[${this.name}] 清理过期项: ${expiredCount} 条，当前大小: ${this.cache.size}`);
    }
  }

  /**
   * 销毁缓存管理器（清理定时器）
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
    console.log(`[${this.name}] 缓存管理器已销毁`);
  }
}

/**
 * 创建预配置的缓存实例工厂
 */
class CacheFactory {
  static createResponseCache() {
    return new LRUCache({
      maxSize: 500,
      ttl: 5 * 60 * 1000, // 5分钟
      name: 'ResponseCache'
    });
  }

  static createModelWhitelistCache() {
    return new LRUCache({
      maxSize: 10,
      ttl: 60 * 1000, // 1分钟
      name: 'ModelWhitelistCache'
    });
  }

  static createConfigCache() {
    return new LRUCache({
      maxSize: 50,
      ttl: 5 * 60 * 1000, // 5分钟
      name: 'ConfigCache'
    });
  }

  static createNotificationCache() {
    return new LRUCache({
      maxSize: 100,
      ttl: 30 * 1000, // 30秒
      name: 'NotificationCache'
    });
  }
}

module.exports = {
  LRUCache,
  CacheFactory
};
