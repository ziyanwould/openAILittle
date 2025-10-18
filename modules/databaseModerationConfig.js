/**
 * @Author: Liu Jiarong
 * @Date: 2025-10-18 15:55:00
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-10-18 15:55:00
 * @FilePath: /openAILittle/modules/databaseModerationConfig.js
 * @Description: 基于数据库的动态内容审查配置管理
 */

const { pool } = require('../db');
const moderationConfig = require('./moderationConfig'); // 作为fallback

class DatabaseModerationConfig {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 2 * 60 * 1000; // 缓存2分钟
    this.lastCacheUpdate = 0;
    this.globalConfig = null;
    this.routeConfigs = new Map();
  }

  /**
   * 从数据库加载全局审核配置
   */
  async loadGlobalConfig() {
    try {
      const [rows] = await pool.query(`
        SELECT config_key, config_value
        FROM system_configs
        WHERE config_type = 'MODERATION'
        AND config_key = 'global'
        AND is_active = 1
        LIMIT 1
      `);

      if (rows.length > 0) {
        const configValue = typeof rows[0].config_value === 'string'
          ? JSON.parse(rows[0].config_value)
          : rows[0].config_value;

        return {
          enabled: configValue.enabled !== false,
          apiEndpoint: configValue.apiEndpoint || moderationConfig.global.apiEndpoint,
          timeout: configValue.timeout || moderationConfig.global.timeout
        };
      }
    } catch (error) {
      console.error('Failed to load global moderation config from database:', error);
    }

    return moderationConfig.global;
  }

  /**
   * 从数据库加载路由审核配置
   */
  async loadRouteConfigs() {
    try {
      const [rows] = await pool.query(`
        SELECT config_key, config_value
        FROM system_configs
        WHERE config_type = 'MODERATION'
        AND config_key != 'global'
        AND is_active = 1
        ORDER BY priority ASC
      `);

      const configs = new Map();

      for (const row of rows) {
        try {
          const configValue = typeof row.config_value === 'string'
            ? JSON.parse(row.config_value)
            : row.config_value;

          configs.set(row.config_key, {
            enabled: configValue.enabled !== false,
            description: configValue.description || '',
            models: configValue.models || { default: { enabled: false } }
          });
        } catch (parseError) {
          console.error(`Failed to parse moderation config for route ${row.config_key}:`, parseError);
        }
      }

      return configs;
    } catch (error) {
      console.error('Failed to load route moderation configs from database:', error);
    }

    return new Map(Object.entries(moderationConfig.routes || {}));
  }

  /**
   * 检查缓存是否过期
   */
  isCacheExpired() {
    return Date.now() - this.lastCacheUpdate > this.cacheExpiry;
  }

  /**
   * 更新配置缓存
   */
  async updateCache() {
    if (this.isCacheExpired()) {
      this.globalConfig = await this.loadGlobalConfig();
      this.routeConfigs = await this.loadRouteConfigs();
      this.lastCacheUpdate = Date.now();

      console.log('Moderation config updated from database');
    }
  }

  /**
   * 获取全局配置
   */
  async getGlobalConfig() {
    await this.updateCache();
    return this.globalConfig;
  }

  /**
   * 获取路由配置
   */
  async getRouteConfig(routePrefix) {
    await this.updateCache();
    return this.routeConfigs.get(routePrefix);
  }

  /**
   * 检查路由和模型是否需要内容审查
   */
  async shouldModerate(routePrefix, model) {
    const globalConfig = await this.getGlobalConfig();
    if (!globalConfig.enabled) {
      return false;
    }

    const routeConfig = await this.getRouteConfig(routePrefix);
    if (!routeConfig || !routeConfig.enabled) {
      return false;
    }

    const modelConfig = routeConfig.models[model] || routeConfig.models['default'];
    return modelConfig && modelConfig.enabled;
  }

  /**
   * 获取所有路由前缀
   */
  async getRoutePrefixes() {
    await this.updateCache();
    return Array.from(this.routeConfigs.keys());
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
    this.lastCacheUpdate = 0;
    console.log('Moderation config cache cleared');
  }

  /**
   * 重新加载配置
   */
  async reloadConfig() {
    this.clearCache();
    await this.updateCache();
  }
}

// 创建单例实例
const databaseModerationConfig = new DatabaseModerationConfig();

// 定期刷新配置
setInterval(() => {
  databaseModerationConfig.reloadConfig();
}, 1 * 60 * 1000); // 每分钟刷新一次

module.exports = databaseModerationConfig;