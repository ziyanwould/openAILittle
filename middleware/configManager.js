/**
 * @Author: Liu Jiarong
 * @Date: 2025-09-13
 * @Description: 配置管理模块 - 统一管理文件配置和数据库配置
 */

const fs = require('fs');
const path = require('path');
const { getAllConfigRules, syncFileConfigToDatabase } = require('../db/index');

class ConfigManager {
  constructor() {
    this.configCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5分钟缓存
    this.lastCacheTime = 0;
    this.isInitialized = false;
  }

  /**
   * 初始化配置管理器
   */
  async initialize() {
    try {
      // 首次启动时同步文件配置到数据库
      await syncFileConfigToDatabase();
      this.isInitialized = true;
      console.log('✓ 配置管理器初始化完成');
    } catch (error) {
      console.error('配置管理器初始化失败:', error);
    }
  }

  /**
   * 获取所有配置规则（带缓存）
   */
  async getAllRules(ruleType = null, forceRefresh = false) {
    const cacheKey = ruleType || 'ALL';
    const now = Date.now();
    
    // 检查缓存
    if (!forceRefresh && this.configCache.has(cacheKey) && 
        (now - this.lastCacheTime) < this.cacheExpiry) {
      return this.configCache.get(cacheKey);
    }
    
    try {
      const rules = await getAllConfigRules(ruleType);
      
      // 更新缓存
      this.configCache.set(cacheKey, rules);
      this.lastCacheTime = now;
      
      return rules;
    } catch (error) {
      console.error('获取配置规则失败:', error);
      return this.configCache.get(cacheKey) || [];
    }
  }

  /**
   * 获取黑名单用户列表
   */
  async getBlacklistedUsers() {
    const rules = await this.getAllRules('BLACKLIST_USER');
    return rules.map(rule => rule.rule_key);
  }

  /**
   * 获取黑名单IP列表
   */
  async getBlacklistedIPs() {
    const rules = await this.getAllRules('BLACKLIST_IP');
    return rules.map(rule => rule.rule_key);
  }

  /**
   * 获取白名单配置
   */
  async getWhitelistConfig() {
    const userRules = await this.getAllRules('WHITELIST_USER');
    const ipRules = await this.getAllRules('WHITELIST_IP');
    
    return {
      userIds: userRules.map(rule => rule.rule_key),
      ips: ipRules.map(rule => rule.rule_key)
    };
  }

  /**
   * 获取敏感词列表
   */
  async getSensitiveWords() {
    const rules = await this.getAllRules('SENSITIVE_WORD');
    return rules.map(rule => rule.rule_key);
  }

  /**
   * 获取敏感正则表达式列表
   */
  async getSensitivePatterns() {
    const rules = await this.getAllRules('SENSITIVE_PATTERN');
    return rules.map(rule => {
      try {
        return JSON.parse(rule.rule_value || '{}');
      } catch (e) {
        return { pattern: rule.rule_key, description: rule.description };
      }
    }).filter(pattern => pattern.pattern);
  }

  /**
   * 获取用户限制配置
   */
  async getUserRestrictions() {
    const rules = await this.getAllRules('USER_RESTRICTION');
    const restrictions = {};
    
    rules.forEach(rule => {
      try {
        restrictions[rule.rule_key] = JSON.parse(rule.rule_value || '{}');
      } catch (e) {
        console.error(`解析用户限制配置失败: ${rule.rule_key}`, e);
      }
    });
    
    return restrictions;
  }

  /**
   * 获取模型过滤配置
   */
  async getModelFilters() {
    const rules = await this.getAllRules('MODEL_FILTER');
    const filters = {};
    
    rules.forEach(rule => {
      try {
        filters[rule.rule_key] = JSON.parse(rule.rule_value || '{}');
      } catch (e) {
        console.error(`解析模型过滤配置失败: ${rule.rule_key}`, e);
      }
    });
    
    return filters;
  }

  /**
   * 检查用户是否在黑名单
   */
  async isUserBlacklisted(userId) {
    const blacklistedUsers = await this.getBlacklistedUsers();
    return blacklistedUsers.includes(userId);
  }

  /**
   * 检查IP是否在黑名单
   */
  async isIPBlacklisted(ip) {
    const blacklistedIPs = await this.getBlacklistedIPs();
    return blacklistedIPs.includes(ip);
  }

  /**
   * 检查用户或IP是否在白名单
   */
  async isWhitelisted(userId, ip) {
    const whitelist = await this.getWhitelistConfig();
    return whitelist.userIds.includes(userId) || whitelist.ips.includes(ip);
  }

  /**
   * 检查内容是否包含敏感词
   */
  async checkSensitiveWords(content) {
    const sensitiveWords = await this.getSensitiveWords();
    const lowerContent = content.toLowerCase();
    
    for (const word of sensitiveWords) {
      if (lowerContent.includes(word.toLowerCase())) {
        return { found: true, word: word };
      }
    }
    
    return { found: false };
  }

  /**
   * 检查内容是否匹配敏感正则
   */
  async checkSensitivePatterns(content) {
    const patterns = await this.getSensitivePatterns();
    
    for (const patternConfig of patterns) {
      try {
        const regex = new RegExp(patternConfig.pattern, 'i');
        if (regex.test(content)) {
          return { 
            found: true, 
            pattern: patternConfig.pattern,
            description: patternConfig.description 
          };
        }
      } catch (e) {
        console.error(`无效的正则表达式: ${patternConfig.pattern}`, e);
      }
    }
    
    return { found: false };
  }

  /**
   * 获取用户的模型限制
   */
  async getUserModelRestrictions(userId) {
    const restrictions = await this.getUserRestrictions();
    return restrictions[userId] || null;
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.configCache.clear();
    this.lastCacheTime = 0;
  }

  /**
   * 重新加载配置（清除缓存并重新同步文件）
   */
  async reloadConfig() {
    try {
      this.clearCache();
      await syncFileConfigToDatabase();
      console.log('配置重新加载完成');
      return true;
    } catch (error) {
      console.error('配置重新加载失败:', error);
      return false;
    }
  }
}

// 创建单例实例
const configManager = new ConfigManager();

module.exports = configManager;