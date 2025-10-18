/**
 * @Author: Liu Jiarong
 * @Date: 2025-01-14 22:00:00
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-01-14 22:00:00
 * @FilePath: /openAILittle/middleware/contentModerationMiddleware.js
 * @Description: 内容审查中间件 - 基于智谱AI内容审查API
 */

const moderationConfig = require('../modules/moderationConfig');
const databaseModerationConfig = require('../modules/databaseModerationConfig');
const moment = require('moment');
const crypto = require('crypto');
const { logModerationResult, checkUserIpBanStatus, updateViolationCount, findOrCreateUser } = require('../db/index');

const TEXT_KEYS = new Set([
  'text',
  'content',
  'value',
  'input',
  'prompt',
  'message',
  'messages',
  'body',
  'title',
  'description',
  'summary',
  'input_text',
  'raw_text'
]);

function collectTextSegments(value, options = {}) {
  const {
    maxDepth = 5,
    trim = true
  } = options;

  const segments = [];
  const visited = new WeakSet();

  const traverse = (node, depth) => {
    if (node === null || node === undefined) {
      return;
    }

    if (typeof node === 'string') {
      const text = trim ? node.trim() : node;
      if (text) {
        segments.push(text);
      }
      return;
    }

    if (depth >= maxDepth) {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(item => traverse(item, depth + 1));
      return;
    }

    if (typeof node === 'object') {
      if (visited.has(node)) {
        return;
      }
      visited.add(node);

      Object.entries(node).forEach(([key, val]) => {
        if (typeof val === 'string') {
          if (TEXT_KEYS.has(key) || depth === 0) {
            const text = trim ? val.trim() : val;
            if (text) {
              segments.push(text);
            }
          }
        } else if (Array.isArray(val) || (val && typeof val === 'object')) {
          traverse(val, depth + 1);
        }
      });
    }
  };

  traverse(value, 0);
  return segments;
}

class ContentModerationMiddleware {
  constructor() {
    // 优先使用数据库配置，fallback到文件配置
    this.useDatabaseConfig = true;
    this.config = moderationConfig;
    this.cache = new Map(); // 缓存审查结果
    this.cacheExpiry = 30 * 60 * 1000; // 缓存30分钟
  }

  /**
   * 从请求体中提取需要审查的文本内容
   */
  extractContentFromBody(body) {
    if (!body || typeof body !== 'object') {
      return '';
    }

    const segments = new Set();

    // 提取直接字段（字符串或复杂结构）
    this.config.contentExtraction.fields.forEach(field => {
      if (body[field] !== undefined) {
        collectTextSegments(body[field]).forEach(text => segments.add(text));
      }
    });

    // 提取嵌套字段（如 messages 数组中的 content 文本）
    Object.entries(this.config.contentExtraction.nestedFields).forEach(([parentField, childField]) => {
      const parentValue = body[parentField];
      if (Array.isArray(parentValue)) {
        parentValue.forEach(item => {
          if (!item) return;
          if (childField in item) {
            collectTextSegments(item[childField]).forEach(text => segments.add(text));
          }
        });
      } else if (parentValue && typeof parentValue === 'object') {
        // 支持嵌套对象（如 conversation: { messages: [...] })
        const nestedValue = parentValue[childField];
        if (nestedValue !== undefined) {
          collectTextSegments(nestedValue).forEach(text => segments.add(text));
        }
      }
    });

    const combinedContent = Array.from(segments)
      .join('\n')
      .slice(0, this.config.contentExtraction.maxLength);

    return combinedContent.trim();
  }

  /**
   * 生成内容哈希用于缓存
   */
  generateContentHash(content) {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * 从请求中提取用户ID（与主服务保持一致的方法）
   */
  extractUserId(req) {
    return req.body.user || req.headers['x-user-id'] || null;
  }

  /**
   * 获取客户端IP地址（与主服务保持一致的方法）
   */
  getClientIP(req) {
    return req.body.user_ip || req.headers['x-user-ip'] || req.ip || 'unknown';
  }

  /**
   * 获取当前配置（优先从数据库获取）
   */
  async getCurrentConfig() {
    if (this.useDatabaseConfig) {
      try {
        const globalConfig = await databaseModerationConfig.getGlobalConfig();
        return { global: globalConfig };
      } catch (error) {
        console.error('Failed to get config from database, using file config:', error);
      }
    }
    return this.config;
  }

  /**
   * 获取路由配置（优先从数据库获取）
   */
  async getRouteConfig(routePrefix) {
    if (this.useDatabaseConfig) {
      try {
        return await databaseModerationConfig.getRouteConfig(routePrefix);
      } catch (error) {
        console.error(`Failed to get route config for ${routePrefix} from database:`, error);
      }
    }
    return this.config.routes[routePrefix];
  }

  /**
   * 调用智谱AI内容审查API
   */
  async callModerationAPI(content) {
    try {
      const config = await this.getCurrentConfig();
      const response = await fetch(config.global.apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.ZHIPU_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'moderation', // 智谱AI内容安全API使用moderation模型
          input: content // 纯文本字符串，最大输入长度：2000 字符
        }),
        signal: AbortSignal.timeout(config.global.timeout)
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
   * 检查路由和模型是否需要内容审查（异步版本，支持数据库配置）
   */
  async shouldModerate(routePrefix, model) {
    if (this.useDatabaseConfig) {
      return await databaseModerationConfig.shouldModerate(routePrefix, model);
    }

    // 回退到文件配置
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
   * 检查路由和模型是否需要内容审查（同步版本，保持向后兼容）
   */
  shouldModerateSync(routePrefix, model) {
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
   * 获取路由前缀（用于从字符串路径提取）
   */
  async getRoutePrefix(path) {
    if (!path || typeof path !== 'string') return '';

    if (this.useDatabaseConfig) {
      try {
        const routePrefixes = await databaseModerationConfig.getRoutePrefixes();
        return routePrefixes.find(prefix => path.startsWith(prefix)) || '';
      } catch (error) {
        console.error('Failed to get route prefixes from database:', error);
      }
    }

    // 回退到文件配置
    const prefixes = Object.keys(this.config.routes);
    return prefixes.find(prefix => path.startsWith(prefix)) || '';
  }

  /**
   * 获取原始路由前缀（优先使用 baseUrl，其次 originalUrl，最后 path）
   * 目的：在被挂载的子路由（如 /chatnio、/freeopenai）下，不被 Express 截断成 /v1
   */
  getOriginalRoutePrefixFromReq(req) {
    // 优先使用 baseUrl（挂载点），它能保留原始一级路由
    if (req.baseUrl && this.config.routes[req.baseUrl]) {
      return req.baseUrl;
    }
    // 其次尝试 originalUrl（未被修改的完整路径）
    const fromOriginal = this.getRoutePrefix(req.originalUrl || '');
    if (fromOriginal) return fromOriginal;
    // 最后回退到当前 path
    return this.getRoutePrefix(req.path || '');
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
      let userId, clientIP, contentHash, moderationResult;
      
      try {
        // 计算用于配置匹配与日志展示的两个前缀（此处二者一致：原始前缀）
        const routePrefixOriginal = this.getOriginalRoutePrefixFromReq(req);
        const routePrefix = routePrefixOriginal; // 用于配置匹配
        const model = this.extractModelName(req.body);
        userId = this.extractUserId(req);
        clientIP = this.getClientIP(req);

        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Request path: ${req.path}, baseUrl: ${req.baseUrl || ''}, originalUrl: ${req.originalUrl || ''}, Route(prefix for config/log): ${routePrefix}, Model: ${model}, User: ${userId}, IP: ${clientIP}`);

        // 1. 检查用户/IP是否被禁用
        const banStatus = await checkUserIpBanStatus(userId, clientIP);
        if (banStatus.isBanned) {
          const banMessage = banStatus.isPermanent ? 
            '您的账户/IP已被永久禁用' : 
            `您的账户/IP已被禁用至 ${moment(banStatus.banUntil).format('YYYY-MM-DD HH:mm:ss')}`;
          
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] ❌ User/IP banned: ${userId || 'N/A'}/${clientIP}`);
          return res.status(403).json({
            error: {
              code: 4036,
              message: banMessage,
              details: '内容审核：用户/IP被禁用'
            }
          });
        }

        // 2. 检查是否需要审查（使用异步数据库配置）
        const shouldModerateResult = await this.shouldModerate(routePrefix, model);
        const globalConfig = await this.getCurrentConfig();
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Should moderate: ${shouldModerateResult}, Global enabled: ${globalConfig.global.enabled}`);

        if (routePrefix) {
          const routeConfig = await this.getRouteConfig(routePrefix);
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

        // 3. 提取内容
        const content = this.extractContentFromBody(req.body);
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Extracted content length: ${content.length}`);
        
        if (!content) {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] No content to moderate`);
          return next(); // 没有内容需要审查
        }

        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Starting moderation check for route: ${routePrefix}, model: ${model}`);

        // 4. 检查缓存
        contentHash = this.generateContentHash(content);
        const cached = this.cache.get(contentHash);
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Cache check - hash: ${contentHash}, cached: ${!!cached}`);
        
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Using cached result: ${JSON.stringify(cached.result)}`);
          
          // 即使使用缓存结果，也要记录到数据库
          moderationResult = cached.result;
          await this.recordModerationResult(userId, clientIP, content, contentHash, moderationResult, routePrefix, model, req);
          
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

        // 5. 调用审查API
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Calling moderation API for content: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
        moderationResult = await this.callModerationAPI(content);
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] API result: ${JSON.stringify(moderationResult)}`);
        
        // 6. 缓存结果
        this.cache.set(contentHash, {
          result: moderationResult,
          timestamp: Date.now()
        });

        // 7. 记录审核结果到数据库并更新违规计数
        await this.recordModerationResult(userId, clientIP, content, contentHash, moderationResult, routePrefix, model, req);

        // 清理过期缓存
        if (this.cache.size > 1000) {
          this.cleanExpiredCache();
        }

        // 8. 检查审查结果
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
        
        // 即使出错也尝试记录基本信息
        if (userId && clientIP && moderationResult) {
          try {
            await this.recordModerationResult(userId, clientIP, 'ERROR_CONTENT', contentHash || 'ERROR_HASH', 
              { safe: true, reason: 'ERROR', details: { error: error.message } }, 'ERROR_ROUTE', 'ERROR_MODEL', req);
          } catch (dbError) {
            console.error('Failed to record error to database:', dbError);
          }
        }
        
        // 发生错误时继续执行，不阻塞请求
        next();
      }
    };
  }

  /**
   * 记录审核结果到数据库
   */
  async recordModerationResult(userId, clientIP, content, contentHash, moderationResult, routePrefix, model, req) {
    try {
      // 确保用户存在（如果有用户ID）
      if (userId) {
        await findOrCreateUser(userId);
      }
      
      // 确定风险等级
      let riskLevel = 'PASS';
      if (!moderationResult.safe) {
        if (moderationResult.details && moderationResult.details.risk_level) {
          riskLevel = moderationResult.details.risk_level;
        } else if (moderationResult.reason.includes('REJECT')) {
          riskLevel = 'REJECT';
        } else if (moderationResult.reason.includes('REVIEW')) {
          riskLevel = 'REVIEW';
        } else {
          riskLevel = 'REJECT'; // 默认为严重违规
        }
      }
      
      // 记录审核日志
      // 补充一些元信息进 riskDetails，保留原 API 详情结构
      const riskDetails = moderationResult.details || {};
      try {
        riskDetails.meta = {
          baseUrl: req && req.baseUrl ? req.baseUrl : '',
          originalUrl: req && req.originalUrl ? req.originalUrl : '',
          path: req && req.path ? req.path : ''
        };
      } catch (_) {}

      const logId = await logModerationResult({
        userId: userId,
        ip: clientIP,
        content: content.substring(0, 1000), // 限制长度
        contentHash: contentHash,
        riskLevel: riskLevel,
        riskDetails: riskDetails,
        // 在数据库中 route 字段写入原始路由前缀（如 /chatnio），而非重写后的 /v1
        route: routePrefix,
        model: model,
        apiResponse: JSON.stringify(moderationResult)
      });
      
      // 更新违规计数
      await updateViolationCount(userId, clientIP, riskLevel);
      
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [Content Moderation] Recorded to database - Log ID: ${logId}, Risk: ${riskLevel}`);
      
    } catch (error) {
      console.error(`${moment().format('YYYY-MM-DD HH:mm:ss')} Failed to record moderation result:`, error);
    }
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
  async reloadConfig() {
    try {
      if (this.useDatabaseConfig) {
        await databaseModerationConfig.reloadConfig();
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Database moderation config reloaded`);
      } else {
        delete require.cache[require.resolve('../modules/moderationConfig')];
        this.config = require('../modules/moderationConfig');
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} File moderation config reloaded`);
      }
    } catch (error) {
      console.error(`${moment().format('YYYY-MM-DD HH:mm:ss')} Failed to reload moderation config:`, error.message);
    }
  }
}

// 创建单例实例
const moderationMiddleware = new ContentModerationMiddleware();

// 定期清理缓存和重新加载配置
setInterval(() => {
  moderationMiddleware.cleanExpiredCache();
}, 10 * 60 * 1000); // 每10分钟清理一次

setInterval(async () => {
  await moderationMiddleware.reloadConfig();
}, 5 * 60 * 1000); // 每5分钟重新加载配置

module.exports = moderationMiddleware.middleware();
