/**
 * @Author: Liu Jiarong
 * @Date: 2025-01-14 22:00:00
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-01-14 22:00:00
 * @FilePath: /openAILittle/middleware/contentModerationMiddleware.js
 * @Description: 内容审查中间件 - 基于智谱AI内容审查API
 */

const moderationConfig = require('../modules/moderationConfig');
const moment = require('moment');

class ContentModerationMiddleware {
  constructor() {
    this.config = moderationConfig;
    this.cache = new Map(); // 缓存审查结果
    this.cacheExpiry = 30 * 60 * 1000; // 缓存30分钟
  }

  /**
   * 从请求体中提取需要审查的文本内容
   */
  extractContentFromBody(body) {
    let contents = [];
    
    if (!body || typeof body !== 'object') {
      return contents;
    }

    // 提取直接字段
    this.config.contentExtraction.fields.forEach(field => {
      if (body[field] && typeof body[field] === 'string') {
        contents.push(body[field]);
      }
    });

    // 提取嵌套字段
    Object.entries(this.config.contentExtraction.nestedFields).forEach(([parentField, childField]) => {
      if (body[parentField] && Array.isArray(body[parentField])) {
        body[parentField].forEach(item => {
          if (item && item[childField] && typeof item[childField] === 'string') {
            contents.push(item[childField]);
          }
        });
      }
    });

    // 合并所有内容并限制长度
    const combinedContent = contents.join('\n').slice(0, this.config.contentExtraction.maxLength);
    return combinedContent.trim();
  }

  /**
   * 生成内容哈希用于缓存
   */
  generateContentHash(content) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * 调用智谱AI内容审查API
   */
  async callModerationAPI(content) {
    try {
      const response = await fetch(this.config.global.apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.ZHIPU_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'moderation', // 智谱AI内容安全API使用moderation模型
          input: content // 纯文本字符串，最大输入长度：2000 字符
        }),
        signal: AbortSignal.timeout(this.config.global.timeout)
      });

      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] API Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`${moment().format('YYYY-MM-DD HH:mm:ss')} Content moderation API error: ${response.status} ${response.statusText}, Body: ${errorText}`);
        return { safe: true, reason: 'API_ERROR' }; // API错误时默认通过
      }

      const result = await response.json();
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Raw API response: ${JSON.stringify(result)}`);
      
      // 根据智谱AI内容安全API官方响应格式解析结果
      // 官方响应格式: { result_list: [ { content_type: "text", risk_level: "PASS/REVIEW/REJECT", risk_type: [] } ] }
      
      if (result.result_list && result.result_list.length > 0) {
        const firstResult = result.result_list[0];
        const riskLevel = firstResult.risk_level;
        const riskTypes = firstResult.risk_type || [];
        
        // PASS: 正常内容, REVIEW: 可疑内容, REJECT: 违规内容
        // 只有PASS才认为是安全的，REVIEW和REJECT都需要拦截
        const isSafe = riskLevel === 'PASS';
        const reason = isSafe ? 'SAFE' : `${riskLevel}: ${riskTypes.length > 0 ? riskTypes.join(', ') : '内容安全检查'}`;
        
        return {
          safe: isSafe,
          reason: reason,
          details: {
            request_id: result.request_id,
            processed_time: result.processed_time,
            content_type: firstResult.content_type,
            risk_level: riskLevel,
            risk_type: riskTypes
          }
        };
      }

      // 兼容其他可能的响应格式
      if (result.hasOwnProperty('flagged')) {
        const flagged = result.flagged || false;
        return {
          safe: !flagged,
          reason: flagged ? 'FLAGGED' : 'SAFE',
          details: result
        };
      }

      // 默认情况：如果无法解析响应，默认通过
      console.warn(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Unknown response format, defaulting to safe`);
      return { safe: true, reason: 'UNKNOWN_FORMAT' };

    } catch (error) {
      console.error(`${moment().format('YYYY-MM-DD HH:mm:ss')} Content moderation error:`, error.message);
      return { safe: true, reason: 'ERROR' }; // 发生错误时默认通过
    }
  }

  /**
   * 检查路由和模型是否需要内容审查
   */
  shouldModerate(routePrefix, model) {
    if (!this.config.global.enabled) {
      return false;
    }

    const routeConfig = this.config.routes[routePrefix];
    if (!routeConfig || !routeConfig.enabled) {
      return false;
    }

    const modelConfig = routeConfig.models[model] || routeConfig.models['default'];
    return modelConfig && modelConfig.enabled;
  }

  /**
   * 获取路由前缀
   */
  getRoutePrefix(path) {
    const prefixes = Object.keys(this.config.routes);
    return prefixes.find(prefix => path.startsWith(prefix)) || '';
  }

  /**
   * 从请求体中提取模型名称
   */
  extractModelName(body) {
    if (!body) return '';
    return body.model || body.engine || '';
  }

  /**
   * 内容审查中间件主函数
   */
  middleware() {
    return async (req, res, next) => {
      try {
        const routePrefix = this.getRoutePrefix(req.path);
        const model = this.extractModelName(req.body);

        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Request path: ${req.path}, Route prefix: ${routePrefix}, Model: ${model}`);

        // 检查是否需要审查
        const shouldModerateResult = this.shouldModerate(routePrefix, model);
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Should moderate: ${shouldModerateResult}, Global enabled: ${this.config.global.enabled}`);
        
        if (routePrefix) {
          const routeConfig = this.config.routes[routePrefix];
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Route config enabled: ${routeConfig ? routeConfig.enabled : 'N/A'}`);
          if (routeConfig && routeConfig.models) {
            const modelConfig = routeConfig.models[model] || routeConfig.models['default'];
            console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Model config: ${JSON.stringify(modelConfig)}`);
          }
        }

        if (!shouldModerateResult) {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Skipping moderation - not configured for this route/model`);
          return next();
        }

        // 提取内容
        const content = this.extractContentFromBody(req.body);
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Extracted content length: ${content.length}`);
        
        if (!content) {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] No content to moderate`);
          return next(); // 没有内容需要审查
        }

        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Starting moderation check for route: ${routePrefix}, model: ${model}`);

        // 检查缓存
        const contentHash = this.generateContentHash(content);
        const cached = this.cache.get(contentHash);
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Cache check - hash: ${contentHash}, cached: ${!!cached}`);
        
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Using cached result: ${JSON.stringify(cached.result)}`);
          if (!cached.result.safe) {
            console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Content moderation failed (cached): ${cached.result.reason}`);
            return res.status(400).json({
              error: {
                code: this.config.errorResponse.code,
                message: this.config.errorResponse.message,
                details: this.config.errorResponse.details,
                reason: cached.result.reason
              }
            });
          }
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Cached result passed, continuing...`);
          return next();
        }

        // 调用审查API
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Calling moderation API for content: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
        const moderationResult = await this.callModerationAPI(content);
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] API result: ${JSON.stringify(moderationResult)}`);
        
        // 缓存结果
        this.cache.set(contentHash, {
          result: moderationResult,
          timestamp: Date.now()
        });

        // 清理过期缓存
        if (this.cache.size > 1000) {
          this.cleanExpiredCache();
        }

        // 检查审查结果
        if (!moderationResult.safe) {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] ❌ Content moderation FAILED: ${moderationResult.reason}`);
          return res.status(400).json({
            error: {
              code: this.config.errorResponse.code,
              message: this.config.errorResponse.message,
              details: this.config.errorResponse.details,
              reason: moderationResult.reason
            }
          });
        }

        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] ✅ Content moderation PASSED for route: ${routePrefix}, model: ${model}`);
        next();

      } catch (error) {
        console.error(`${moment().format('YYYY-MM-DD HH:mm:ss')} Content moderation middleware error:`, error);
        // 发生错误时继续执行，不阻塞请求
        next();
      }
    };
  }

  /**
   * 清理过期缓存
   */
  cleanExpiredCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheExpiry) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 重新加载配置
   */
  reloadConfig() {
    try {
      delete require.cache[require.resolve('../modules/moderationConfig')];
      this.config = require('../modules/moderationConfig');
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Content moderation config reloaded`);
    } catch (error) {
      console.error(`${moment().format('YYYY-MM-DD HH:mm:ss')} Failed to reload moderation config:`, error);
    }
  }
}

// 创建单例实例
const moderationMiddleware = new ContentModerationMiddleware();

// 定期清理缓存和重新加载配置
setInterval(() => {
  moderationMiddleware.cleanExpiredCache();
}, 10 * 60 * 1000); // 每10分钟清理一次

setInterval(() => {
  moderationMiddleware.reloadConfig();
}, 5 * 60 * 1000); // 每5分钟重新加载配置

module.exports = moderationMiddleware.middleware();