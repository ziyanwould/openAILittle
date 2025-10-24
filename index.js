/**
 * @Author: Liu Jiarong
 * @Date: 2024-06-24 19:48:52
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-10-20 23:15:17
 * @FilePath: /openAILittle/index.js
 * @Description: 
 * @
 * @Copyright (c) 2024 by ${git_name_email}, All Rights Reserved. 
 */

const logCollector = require('./lib/logCollector');
logCollector.setSource('main-service');

const express = require('express');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const moment = require('moment');
const crypto = require('crypto'); // 引入 crypto 模块
const fs = require('fs');
const url = require('url'); // 引入 url 模块
const {
  prepareDataForHashing,
  isNaturalLanguage,
  readSensitivePatternsFromFile,
  detectSensitiveContent,
  isTimestamp,
  loadRestrictedUsersConfigFromFile
 } = require('./utils');
const modifyRequestBodyMiddleware  = require('./modules/modifyRequestBodyMiddleware'); // 模型参数修正统一处理
const { sendNotification } = require('./notices/pushDeerNotifier'); // 引入 pushDeerNotifier.js 文件中的 sendNotification 函数
const { sendLarkNotification } = require('./notices/larkNotifier'); // 引入 larkNotifier.js 文件中的 sendLarkNotification 函数
const { sendDingTalkNotification } = require('./notices/dingTalkNotifier'); // 引入 dingTalkNotifier.js 文件中的 sendDingTalkNotification 函数
const { sendNTFYNotification } = require('./notices/ntfyNotifier'); // 引入 ntfyNotifier.js 文件中的 sendNTFYNotification 函数
const chatnioRateLimits = require('./modules/chatnioRateLimits'); // 引入 chatnio 限流配置
const modelRateLimits = require('./modules/modelRateLimits'); // 定义不同模型的多重限流配置 Doubao-Seaweed
const auxiliaryModels = require('./modules/auxiliaryModels'); // 定义辅助模型列表
const limitRequestBodyLength = require('./middleware/limitRequestBodyLength'); // 引入文本长度限制中间件
const loggingMiddleware = require('./middleware/loggingMiddleware'); // 引入日志中间件
const contentModerationMiddleware = require('./middleware/contentModerationMiddleware'); // 引入内容审查中间件
const responseInterceptorMiddleware = require('./middleware/responseInterceptorMiddleware'); // 引入响应拦截中间件
const configManager = require('./middleware/configManager'); // 引入配置管理器
const { initializeSystemConfigs, getNotificationConfigs, pool, getConciseModeConfig, getConciseModeUpdatedAt } = require('./db'); // 引入系统配置初始化与数据库连接池

const chatnioRateLimiters = {}; // 用于存储 chatnio 的限流器
// 在文件开头引入 dotenv
require('dotenv').config();

// 统一管理提示信息
const UPGRADE_MESSAGE = process.env.UPGRADE_MESSAGE || '';

// 模型白名单（从数据库加载，文件为默认回退）
let robotModelWhitelist = [];
let freelyaiModelWhitelist = [];
let lastModelWhitelistLoad = 0;
const MODEL_WL_TTL_MS = 60 * 1000; // 60秒刷新一次
const { getModelWhitelists } = require('./db');

async function loadModelWhitelists(force = false) {
  const now = Date.now();
  if (!force && (now - lastModelWhitelistLoad) < MODEL_WL_TTL_MS && robotModelWhitelist.length && freelyaiModelWhitelist.length) return;
  try {
    const data = await getModelWhitelists();
    robotModelWhitelist = Array.isArray(data?.ROBOT) ? data.ROBOT : [];
    freelyaiModelWhitelist = Array.isArray(data?.FREELYAI) ? data.FREELYAI : [];
    lastModelWhitelistLoad = now;
  } catch (e) {
    console.error('加载模型白名单失败:', e.message);
  }
}

// Node.js 18 以上版本支持原生的 fetch API
const app = express();

app.use(bodyParser.json({ limit: '100mb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'main',
    time: new Date().toISOString()
  });
});

// 为辅助模型设置限流配置
auxiliaryModels.forEach(model => {
  modelRateLimits[model] = {
    limits: [{ windowMs: 10 * 60 * 1000, max: 10 }],
    dailyLimit: 500,
  };
});

// 创建一个对象来存储每个模型每天的请求计数
const dailyRequestCounts = {};

// ==================== 通知内容提取与简洁处理工具 ====================
function safeJsonParse(str) {
  if (typeof str !== 'string') return null;
  try { return JSON.parse(str); } catch (_) { return null; }
}

function getLastUserTextFromMessages(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const role = m.role || m.author || m.sender; // 兼容字段
    if (role && String(role).toLowerCase() !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') return c;
    // OpenAI 新格式: content 为数组
    if (Array.isArray(c)) {
      for (let j = c.length - 1; j >= 0; j--) {
        const part = c[j];
        if (!part) continue;
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        if (part.type === 'text' && typeof part.text === 'string') return part.text;
      }
    }
    // 某些平台将消息放在 message 或 value 字段
    if (typeof m.message === 'string') return m.message;
    if (typeof m.value === 'string') return m.value;
  }
  return null;
}

function getLastUserTextFromContents(contents) {
  // Gemini: contents: [{ role: 'user'|'model', parts: [{text: '...'}, ...] }, ...]
  if (!Array.isArray(contents)) return null;
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i];
    if (!c) continue;
    const role = c.role || c.author;
    if (role && String(role).toLowerCase() !== 'user') continue;
    const parts = c.parts;
    if (Array.isArray(parts)) {
      for (let j = parts.length - 1; j >= 0; j--) {
        const p = parts[j];
        if (!p) continue;
        if (typeof p === 'string') return p;
        if (typeof p.text === 'string') return p.text;
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
      }
    }
  }
  return null;
}

function extractLastUserTextFromBodyStr(bodyStr) {
  const obj = safeJsonParse(bodyStr);
  if (!obj || typeof obj !== 'object') return null;

  // OpenAI/通用聊天
  if (obj.messages) {
    const text = getLastUserTextFromMessages(obj.messages);
    if (text) return text;
  }
  // Gemini
  if (obj.contents) {
    const text = getLastUserTextFromContents(obj.contents);
    if (text) return text;
  }
  // 纯文本输入
  if (typeof obj.input === 'string') return obj.input;
  if (typeof obj.prompt === 'string') return obj.prompt;
  if (typeof obj.text === 'string') return obj.text;

  return null;
}

// 创建一个缓存来存储最近的请求内容
const recentRequestsCache = new Map();

// 设置缓存过期时间（例如，5 分钟）
const cacheExpirationTimeMs = 5 * 60 * 1000;

// 用于存储每个用户的最近请求时间和模型
const userRequestHistory = new Map();

// 用于存储最近请求内容的哈希值和时间戳
const recentRequestContentHashes = new Map();

// 定义白名单文件路径（保留兼容性）
const whitelistFilePath = 'config/whitelist.json';
// 初始化白名单 (用户ID和IP地址) - 现在从配置管理器获取
let whitelistedUserIds = [];
let whitelistedIPs = [];

// 初次加载白名单 - 使用配置管理器
async function loadWhitelistFromConfigManager() {
  try {
    const whitelist = await configManager.getWhitelistConfig();
    whitelistedUserIds = whitelist.userIds;
    whitelistedIPs = whitelist.ips;
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Config Manager Whitelist loaded: ${whitelistedUserIds.length} user IDs, ${whitelistedIPs.length} IPs`);
  } catch (error) {
    console.error('加载白名单配置失败，使用文件备份:', error);
    loadWhitelistFromFile(whitelistFilePath);
  }
}

// 应用文本长度限制中间件到 "/" 和 "/google" 路由
const defaultLengthLimiter = limitRequestBodyLength(15000, `请求文本过长，请缩短后再试。${UPGRADE_MESSAGE}`, whitelistedUserIds, whitelistedIPs);

// 通知类迁移到 notices
// 通知配置缓存和加载
let notificationConfigCache = [];
let lastNotificationConfigLoad = 0;
const NOTIFICATION_CONFIG_CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

// 加载配置文件规则
function loadPredefinedRules() {
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, 'config', 'notificationRules.json');

    if (fs.existsSync(configPath)) {
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return configData.predefined_rules || [];
    }
    return [];
  } catch (error) {
    console.error('[预设规则] 加载失败:', error.message);
    return [];
  }
}

// 加载通知配置（包含数据库配置和预设规则）
async function loadNotificationConfigs() {
  try {
    const now = Date.now();
    if (now - lastNotificationConfigLoad < NOTIFICATION_CONFIG_CACHE_DURATION) {
      return notificationConfigCache;
    }

    // 加载数据库配置
    const dbConfigs = await getNotificationConfigs();

    // 加载预设规则
    const predefinedRules = loadPredefinedRules();

    // 合并配置，数据库配置优先级更高
    notificationConfigCache = [...dbConfigs, ...predefinedRules.map(rule => ({
      id: rule.id,
      config_key: rule.topic,
      config_value: {
        notification_type: rule.type,
        enabled: rule.enabled,
        ...rule.config,
        webhook_url: rule.config.webhook_url ? process.env.TARGET_SERVER_FEISHU + rule.config.webhook_url : undefined,
        api_key: rule.config.pushkey || rule.config.api_key
      },
      description: rule.name,
      is_active: rule.enabled,
      priority: rule.priority || 1000,
      readonly: rule.readonly || false
    }))];

    lastNotificationConfigLoad = now;
    console.log(`[通知配置] 已加载 ${dbConfigs.length} 个数据库配置 + ${predefinedRules.length} 个预设规则`);
    return notificationConfigCache;
  } catch (error) {
    console.error('[通知配置] 加载失败:', error.message);
    return [];
  }
}

// 简洁模式缓存
let conciseModeCache = null;
let lastConciseModeLoad = 0;
const CONCISE_CACHE_TTL_MS = 5 * 60 * 1000; // 5分钟兜底
const CONCISE_REFRESH_INTERVAL_MS = 3000;   // 每3秒主动拉取一次配置，确保迅速生效

// 新的数据库驱动通知函数
async function notices(data, requestBody, ntfyTopic = 'robot') {
  try {
    const configs = await loadNotificationConfigs();

    // 获取简洁转发模式配置（带缓存）
    const now = Date.now();
    // 每3秒直接拉取一次配置（覆盖本地缓存），另外保留5分钟兜底
    if (!conciseModeCache || (now - lastConciseModeLoad) > CONCISE_REFRESH_INTERVAL_MS || (now - lastConciseModeLoad) > CONCISE_CACHE_TTL_MS) {
      try {
        const cfg = await getConciseModeConfig();
        conciseModeCache = cfg;
        lastConciseModeLoad = now;
      } catch (error) {
        console.error('[通知] 获取简洁模式配置失败:', error.message);
        conciseModeCache = { enabled: false, tail_len: 100 };
        lastConciseModeLoad = now;
      }
    }
    const conciseModeEnabled = !!(conciseModeCache && conciseModeCache.enabled);
    const tailLen = Math.max(1, parseInt((conciseModeCache && conciseModeCache.tail_len) || 100, 10));

    // 过滤启用的通知配置，支持主题匹配
    const activeConfigs = configs.filter(config =>
      config.is_active &&
      config.config_value.enabled &&
      (config.config_key === ntfyTopic || config.config_key === 'global')
    );

    if (activeConfigs.length === 0) {
      console.log(`[通知] 未找到主题 "${ntfyTopic}" 的启用配置`);
      return;
    }

    // 根据简洁模式配置处理请求内容（按"最新一条用户消息"的最后100字裁剪）
    let processedRequestBody = requestBody;
    if (conciseModeEnabled && requestBody) {
      let lastUserText = extractLastUserTextFromBodyStr(requestBody);
      if (typeof lastUserText === 'string' && lastUserText.length > 0) {
        // 简洁模式启用时，始终优先使用提取的用户消息（简洁转发的核心目的）
        if (lastUserText.length > tailLen) {
          processedRequestBody = '...' + lastUserText.slice(-tailLen);
          console.log(`[通知] 简洁模式：用户消息截取至最后${tailLen}字符`);
        } else {
          processedRequestBody = lastUserText;
          console.log(`[通知] 简洁模式：显示完整用户消息（${lastUserText.length}字符）`);
        }
      } else if (requestBody.length > tailLen) {
        processedRequestBody = '...' + requestBody.slice(-tailLen);
        console.log(`[通知] 简洁模式：提取失败，退回整体内容的最后${tailLen}字符`);
      }
    }

    // 构建通知消息内容
    const message = `模型：${data.modelName}\nIP 地址：${data.ip}\n用户 ID：${data.userId}\n时间：${data.time}\n用户请求内容：\n${processedRequestBody}`;

    // 并发发送所有启用的通知
    const notifications = activeConfigs.map(async (config) => {
      try {
        const { notification_type, webhook_url, api_key, topic } = config.config_value;

        switch (notification_type) {
          case 'pushdeer':
            if (api_key) {
              await sendNotification(data, processedRequestBody, api_key);
              console.log(`[通知] PushDeer 通知发送成功 (${config.config_key})`);
            }
            break;
          case 'lark':
            if (webhook_url) {
              await sendLarkNotification(data, processedRequestBody, webhook_url);
              console.log(`[通知] Lark 通知发送成功 (${config.config_key})`);
            }
            break;
          case 'dingtalk':
            if (webhook_url) {
              await sendDingTalkNotification(message, webhook_url);
              console.log(`[通知] DingTalk 通知发送成功 (${config.config_key})`);
            }
            break;
          case 'ntfy':
            if (topic && api_key) {
              await sendNTFYNotification(data, processedRequestBody, topic, api_key);
              console.log(`[通知] Ntfy 通知发送成功 (${config.config_key})`);
            }
            break;
          default:
            console.warn(`[通知] 不支持的通知类型: ${notification_type}`);
        }
      } catch (error) {
        console.error(`[通知] ${config.config_key} 发送失败:`, error.message);
      }
    });

    await Promise.allSettled(notifications);
  } catch (error) {
    console.error('[通知] 系统发送失败:', error.message);
  }
}

// 内部接口：刷新简洁模式缓存（供统计服务调用以立即生效）
app.get('/internal/cache/refresh-concise', async (req, res) => {
  try {
    conciseModeCache = null;
    lastConciseModeLoad = 0;
    res.json({ success: true, message: 'concise cache cleared' });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// 内部接口：刷新模型白名单缓存
app.get('/internal/cache/refresh-model-whitelists', async (req, res) => {
  try {
    lastModelWhitelistLoad = 0;
    await loadModelWhitelists(true);
    res.json({ success: true, message: 'model whitelists cache refreshed' });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// 定义敏感词和黑名单文件路径（保留兼容性）
const sensitiveWordsFilePath = 'config/Sensitive.txt'; // 可以是 .txt 或 .json
const blacklistedUserIdsFilePath = 'config/BlacklistedUsers.txt'; // 可以是 .txt 或 .json
const blacklistedIPsFilePath = 'config/BlacklistedIPs.txt'; // 新增 IP 黑名单文件路径

// 初始化敏感词和黑名单 - 现在从配置管理器获取
let sensitiveWords = [];
let blacklistedUserIds = [];
let blacklistedIPs = [];

// 定义配置文件路径（保留兼容性）
const filterConfigFilePath = 'config/filterConfig.json';

// 初始化过滤配置 - 现在从配置管理器获取
let filterConfig = {};

// 定义受限用户配置文件路径（保留兼容性）
const restrictedUsersConfigFilePath = 'config/restrictedUsers.json';
// 加载受限用户配置 - 现在从配置管理器获取
let restrictedUsersConfig = {};
// 敏感形态的初始读取 - 现在从配置管理器获取
let sensitivePatternsFile = 'config/sensitive_patterns.json';
let sensitivePatterns = [];

// 从配置管理器加载所有配置
async function loadAllConfigFromManager() {
  try {
    sensitiveWords = await configManager.getSensitiveWords();
    blacklistedUserIds = await configManager.getBlacklistedUsers();
    blacklistedIPs = await configManager.getBlacklistedIPs();
    filterConfig = await configManager.getModelFilters();
    restrictedUsersConfig = await configManager.getUserRestrictions();
    sensitivePatterns = await configManager.getSensitivePatterns();
    
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Config Manager 配置加载完成:`, {
      sensitiveWords: sensitiveWords.length,
      blacklistedUsers: blacklistedUserIds.length,
      blacklistedIPs: blacklistedIPs.length,
      filterConfigs: Object.keys(filterConfig).length,
      restrictedUsers: Object.keys(restrictedUsersConfig).length,
      sensitivePatterns: sensitivePatterns.length
    });
  } catch (error) {
    console.error('配置管理器加载失败，使用文件备份:', error);
    // 如果配置管理器失败，回退到文件加载
    sensitiveWords = loadWordsFromFile(sensitiveWordsFilePath);
    blacklistedUserIds = loadWordsFromFile(blacklistedUserIdsFilePath);
    blacklistedIPs = loadWordsFromFile(blacklistedIPsFilePath);
    filterConfig = loadFilterConfigFromFile(filterConfigFilePath);
    restrictedUsersConfig = loadRestrictedUsersConfigFromFile(restrictedUsersConfigFilePath);
    sensitivePatterns = readSensitivePatternsFromFile(sensitivePatternsFile);
  }
}

// 每 5 分钟同步一次配置 - 使用配置管理器
setInterval(async () => {
  try {
    // 清除配置管理器缓存并重新加载
    configManager.clearCache();
    
    // 重新加载所有配置
    await loadAllConfigFromManager();
    await loadWhitelistFromConfigManager();
    
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 配置同步完成 - Config Manager模式`);
  } catch (error) {
    console.error('配置同步失败，使用文件备份模式:', error);
    // 回退到文件模式
    sensitiveWords = loadWordsFromFile(sensitiveWordsFilePath);
    blacklistedUserIds = loadWordsFromFile(blacklistedUserIdsFilePath);
    blacklistedIPs = loadWordsFromFile(blacklistedIPsFilePath);
    loadWhitelistFromFile(whitelistFilePath);
    filterConfig = loadFilterConfigFromFile(filterConfigFilePath);
    restrictedUsersConfig = loadRestrictedUsersConfigFromFile(restrictedUsersConfigFilePath);
    sensitivePatterns = readSensitivePatternsFromFile(sensitivePatternsFile);
    
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 配置同步完成 - 文件备份模式`);
  }
}, 5 * 60 * 1000);

// 定期清理缓存
setInterval(() => {
  recentRequestContentHashes.clear();
}, 30 * 60 * 1000);

// 从文件中加载敏感词或黑名单
function loadWordsFromFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    // 根据文件类型解析内容
    if (filePath.endsWith('.json')) {
      return JSON.parse(fileContent);
    } else { // 默认处理为 .txt，每行一个词，允许多个词用逗号分隔
      return fileContent.split('\n').flatMap(line => line.split(',').map(word => word.trim()));
    }
  } catch (err) {
    console.error(`Failed to load words from ${filePath}:`, err);
    return [];
  }
}

// 从文件中加载过滤配置
function loadFilterConfigFromFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (err) {
    console.error(`Failed to load filter config from ${filePath}:`, err);
    return {};
  }
}

// 创建限流中间件实例，并存储在对象中
const rateLimiters = {};
for (const modelName in modelRateLimits) {
  const { limits, dailyLimit } = modelRateLimits[modelName];

  rateLimiters[modelName] = limits.map(({ windowMs, max }) => {
    return rateLimit({
      windowMs,
      max,
      keyGenerator: (req) => {
        const ip = req.headers['x-user-ip'] || req.ip;
        const userAgent = req.headers['user-agent'];
        const userId = req.headers['x-user-id'] || req.body.user;
        const key = `${modelName}-${ip}-${userAgent}-${userId}`;
        console.log(`Rate limiting key: ${key}`);
        return key;
      },
      handler: (req, res) => {
        const ip = req.body.user_ip || req.headers['x-user-ip'] || req.ip;
        const userId = req.body.user || req.headers['x-user-id'];

        // 检查是否在白名单中
        if (whitelistedUserIds.includes(userId) || whitelistedIPs.includes(ip)) {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Whitelisted user ${userId} or IP ${ip} bypassed rate limit for model ${modelName}.`);
          return; // 白名单用户或IP直接通过，不返回错误
        }

        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request for model ${modelName} from ${req.ip} has been rate limited.`);

        const duration = moment.duration(windowMs);
        const formattedDuration = [
          duration.days() > 0 ? `${duration.days()} 天` : '',
          duration.hours() > 0 ? `${duration.hours()} 小时` : '',
          duration.minutes() > 0 ? `${duration.minutes()} 分钟` : '',
          duration.seconds() > 0 ? `${duration.seconds()} 秒` : '',
        ].filter(Boolean).join(' ');

        // 格式化用户请求内容
        const formattedRequestBody = JSON.stringify(req.body, null, 2);

        // 发送通知，包含格式化的用户请求内容
        notices({
          modelName,
          ip: req.headers['x-user-ip'] || req.ip,
          time: moment().format('YYYY-MM-DD HH:mm:ss'),
          userId: req.headers['x-user-id'] || req.userId,
          duration: formattedDuration,
          windowMs,
          max
        }, formattedRequestBody);

        console.log(`请求过于频繁，请在 ${formattedDuration} 后再试。${modelName} 模型在 ${windowMs / 1000} 秒内的最大请求次数为 ${max} 次。${UPGRADE_MESSAGE}`)
        return res.status(429).json({
          error: `4294 请求频繁，稍后重试。${UPGRADE_MESSAGE}`,
        });
      },
    });
  });

  // 添加每日总请求次数限制中间件
  rateLimiters[modelName].push((req, res, next) => {
    const ip = req.body.user_ip || req.headers['x-user-ip'] || req.ip;
    const userId = req.body.user || req.headers['x-user-id'];

    // 检查是否在白名单中
    if (whitelistedUserIds.includes(userId) || whitelistedIPs.includes(ip)) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Whitelisted user ${userId} or IP ${ip} bypassed daily limit for model ${modelName}.`);
      return next(); // 白名单用户或IP直接通过，不检查每日限制
    }

    const now = moment().startOf('day'); // 获取今天零点时刻
    const key = `${modelName}-${now.format('YYYY-MM-DD')}`; // 当天请求计数的 key

    // 初始化计数器
    dailyRequestCounts[key] = dailyRequestCounts[key] || 0;

    if (dailyRequestCounts[key] >= dailyLimit) {
      console.log(`Daily request limit reached for model ${modelName}`);

      // 格式化用户请求内容
      const formattedRequestBody = JSON.stringify(req.body, null, 2);

      // 发送通知，包含格式化的用户请求内容
      notices({
        modelName,
        ip: req.headers['x-user-ip'] || req.ip,
        userId: req.headers['x-user-id'] || req.userId,
        time: moment().format('YYYY-MM-DD HH:mm:ss'),
        duration: '24 小时', // 每日限制，所以持续时间为 24 小时
        windowMs: 24 * 60 * 60 * 1000, // 24 小时对应的毫秒数
        max: dailyLimit
      }, formattedRequestBody);
      console.log(`4295 今天${modelName} 模型总的请求次数已达上限`)
      return res.status(400).json({
        error: `4295 请求频繁，稍后再试。${UPGRADE_MESSAGE}`
      });
    }

    dailyRequestCounts[key]++;
    next();
  });
}
// 限制名单中间件
function restrictGeminiModelAccess(req, res, next) {
  let requestedModel = null;

  if (req.originalUrl.startsWith('/google/v1beta/models/')) {
    const parsedUrl = new URL(req.originalUrl, `http://${req.headers.host}`);  // 使用 req.headers.host 构建完整的 URL
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 4) {
      requestedModel = pathParts[3].split(':')[0];
    }
  } else {
    requestedModel = req.body.model;
  }

  const userId = req.headers['x-user-id'] || req.body.user;
  const userIP = req.headers['x-user-ip'] || req.body.user_ip || req.ip;

  const restrictedUser = restrictedUsersConfig[userId] || restrictedUsersConfig[userIP];

  if (restrictedUser && requestedModel) { // 只在用户受限且模型名称有效时进行检查
    const allowedModels = restrictedUser.allowedModels;

    if (!allowedModels.includes(requestedModel)) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Restricted user ${userId || userIP} attempted to access disallowed model ${requestedModel}.`);
      return res.status(403).json({ error: '错误码4003，请联系管理员。' });
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Restricted user ${userId || userIP} accessed allowed model ${requestedModel}.`);
    }
  }
    console.log('x-user-ip',req.headers['x-user-ip'])
        console.log('req.ip,',req.ip)
        console.log('req.body',req.body.user_ip)
  next();
}

// 创建代理中间件
const openAIProxy = createProxyMiddleware({
  target: process.env.TARGET_SERVER, // 从环境变量中读取目标服务器地址 
  changeOrigin: true,
  on: {
    proxyReq: fixRequestBody,
  },
});

const cacheGeminiTimeMs = 1000 * 6; // 缓存时间设置为 30 秒
const googleProxy = createProxyMiddleware({
  target: process.env.TARGET_SERVER_GEMIN,
  changeOrigin: true,
  pathRewrite: {
      '^/google': '/',
  },
  on: {
      proxyReq: (proxyReq, req, res) => {
   

          fixRequestBody(proxyReq, req, res);
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 转发请求到 Google Proxy: ${req.method} ${proxyReq.path}`);
          const userId = req.headers['x-user-id'] || 'unknow';
          const userIP = req.headers['x-user-ip'] || req.ip;
          console.log('userId', userId);

          // 黑名单 IP 检查
          if (userIP && blacklistedIPs.includes(userIP)) {
              console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 请求被阻止，因为 IP 在黑名单中: ${userIP}`);
              return res.status(403).json({
                  error: '错误码4034，请联系管理员。',
              });
          }
          

          // 获取最后一次用户输入
          let lastUserContent = "";
          if (req.body.contents && Array.isArray(req.body.contents)) {
              const lastContentItem = req.body.contents[req.body.contents.length - 1];
              if (lastContentItem.role === 'user' && lastContentItem.parts && Array.isArray(lastContentItem.parts)) {
                  const lastPart = lastContentItem.parts[lastContentItem.parts.length - 1];
                  if (lastPart.text) {
                      lastUserContent = lastPart.text;
                  }
              }
          }

          // 重复请求检测
          if (lastUserContent !== "") {
              const dataToHash = prepareDataForHashing(lastUserContent);
              const requestContentHash = crypto.createHash("sha256").update(dataToHash).digest("hex");
              const currentTime = Date.now();

              if (recentRequestContentHashes.has(requestContentHash)) {
              const existingRequest = recentRequestContentHashes.get(requestContentHash);
              const timeDifference = currentTime - existingRequest.timestamp;

                  if (timeDifference <= cacheGeminiTimeMs) {
                      existingRequest.count++;
                      if (existingRequest.count > 1) {
                          console.log(`google路由：${moment().format("YYYY-MM-DD HH:mm:ss")} 15秒内相同内容请求超过4次.`);
                          return res.status(400).json({
                              error: `4291 请求频繁，稍后再试。${UPGRADE_MESSAGE}`,
                          });
                      }
                  } else {
                      // 超时，重置计数和时间戳，清除旧定时器
                      existingRequest.timestamp = currentTime;
                      existingRequest.count = 1;
                      clearTimeout(existingRequest.timer);
                  }
              }  else {
                  // 创建新记录
                  recentRequestContentHashes.set(requestContentHash, {
                      timestamp: currentTime,
                      count: 1,
                      timer: null, // 初始 timer 为 null
                  });
              }

                // 设置/更新定时器
              const existingRequest = recentRequestContentHashes.get(requestContentHash);
              clearTimeout(existingRequest.timer);
              existingRequest.timer = setTimeout(() => {
                  recentRequestContentHashes.delete(requestContentHash);
                   console.log(`${moment().format("YYYY-MM-DD HH:mm:ss")} 从缓存中删除哈希值:`, requestContentHash);
              }, cacheGeminiTimeMs);
          }

          // ... (黑名单用户 ID、敏感词、正则表达式、飞书通知等代码) ...
          // 3. 黑名单用户ID检查 (与之前相同)
          if (userId && blacklistedUserIds.includes(userId)) {
              console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Gemini 请求被阻止，因为用户 ID 在黑名单中: ${userId}`);
              return res.status(403).json({
                  error: '错误码4031，请稍后再试。',
              });
          }

          // 4. 敏感词检查 (遍历所有文本部分)
          if (req.body.contents && Array.isArray(req.body.contents)) {
              for (const contentItem of req.body.contents) {
                  if (contentItem.parts && Array.isArray(contentItem.parts)) {
                      for (const part of contentItem.parts) {
                          if (part.text) {
                              if (sensitiveWords.some(word => part.text.includes(word))) {
                                  console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Gemini 请求被阻止，因为包含敏感词: ${part.text}`);
                                  return res.status(400).json({
                                      error: '错误码4032，请稍后再试。',
                                  });
                              }
                          }
                      }
                  }
              }
          }

          // 5. 正则表达式匹配 (遍历所有文本部分)
          if (req.body.contents && Array.isArray(req.body.contents)) {
              for (const contentItem of req.body.contents) {
                  if (contentItem.parts && Array.isArray(contentItem.parts)) {
                      for (const part of contentItem.parts) {
                          if (part.text) {
                              if (detectSensitiveContent(part.text, sensitivePatterns)) {
                                  console.log(moment().format('YYYY-MM-DD HH:mm:ss') + ":Google 检测到敏感内容:", part.text);
                                  return res.status(400).json({
                                      error: '错误码4033，请稍后再试。',
                                  });
                              }
                          }
                      }
                  }
              }
          }
           // 6. 飞书通知 (仅在请求未被拦截时发送)
          if (!res.headersSent) {
              // 检查响应头是否已发送 (如果已发送，说明前面的逻辑已经返回了响应)
              try {
                  const formattedRequestBody = JSON.stringify(req.body, null, 2); // 格式化请求体
                  const geminiWebhookUrl = 'gemini'; // 替换为你的 notices webhook key
                  notices({
                      modelName: 'Gemini',  // 模型名称
                      ip: req.headers['x-user-ip'] || req.ip, // 用户 IP
                      userId: req.headers['x-user-id'] || req.userId,  // 用户 ID
                      time: moment().format('YYYY-MM-DD HH:mm:ss'),    // 时间
                  }, formattedRequestBody, geminiWebhookUrl); // 发送通知 (假设 notices 函数已定义)
              } catch (error) {
                  console.error('发送飞书通知失败:', error);
              }
          }
      },
  },
});



// 创建 /chatnio 路径的代理中间件
const chatnioProxy = createProxyMiddleware({
  target: process.env.TARGET_SERVER, // 从环境变量中读取目标服务器地址
  changeOrigin: true,
  pathRewrite: {
    '^/chatnio': '/', // 移除 /chatnio 前缀
  },
  on: {
    proxyReq: fixRequestBody,
    proxyRes: (proxyRes, req, res) => {
      // 异步发送飞书通知
      (async () => {
        try {
          // 格式化用户请求内容
          const formattedRequestBody = JSON.stringify(req.body, null, 2);

          await notices({ // 使用 notices 函数发送通知
            modelName: 'chatnio',
            ip: req.body.user_ip || req.headers['x-user-ip'] || req.ip,
            userId: req.body.user || req.headers['x-user-id'],
            time: moment().format('YYYY-MM-DD HH:mm:ss'),
          }, formattedRequestBody, 'chatnio');
        } catch (error) {
          console.error('Failed to send notification to Lark:', error);
        }
      })();
    },
  },
});

// freelyaiProxy 白名单校验中间件
app.use('/freelyai', (req, res, next) => {
  const method = req.method.toUpperCase();
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const modelName = req.body && req.body.model;
    // 刷新模型白名单（异步，不阻塞）
    loadModelWhitelists().catch(()=>{});
    if (!modelName || !freelyaiModelWhitelist.includes(modelName)) {
      return res.status(403).json({ error: '禁止请求该模型，未在白名单内。' });
    }
  }
  next();
});

// 创建 /freelyai 路径的代理中间件
const freelyaiProxy = createProxyMiddleware({
  target: process.env.TARGET_SERVER, // 从环境变量中读取目标服务器地址
  changeOrigin: true,
  pathRewrite: {
    '^/freelyai': '/', // 移除 /freelyai 前缀
  },
  on: {
    proxyReq: fixRequestBody,
    proxyRes: (proxyRes, req, res) => {
      // 异步发送飞书通知
      (async () => {
        try {
          // 格式化用户请求内容
          const formattedRequestBody = JSON.stringify(req.body, null, 2);

          await notices({ // 使用 notices 函数发送通知
            modelName: 'freelyai',
            ip: req.body.user_ip || req.headers['x-user-ip'] || req.ip,
            userId: req.body.user || req.headers['x-user-id'],
            time: moment().format('YYYY-MM-DD HH:mm:ss'),
          }, formattedRequestBody, 'freelyai');
        } catch (error) {
          console.error('Failed to send notification to Lark:', error);
        }
      })();
    },
  },
});
// 对 FreelyAI 路由：先审核再转发
app.use('/freelyai', contentModerationMiddleware, freelyaiProxy);

//  googleProxy 中间件添加限流
const googleRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 分钟时间窗口
  max: 20, // 允许 20 次请求
  keyGenerator: (req) => req.headers['x-user-ip'] || req.ip, // 使用 IP 地址作为限流键
  handler: (req, res) => {
    const ip = req.body.user_ip || req.headers['x-user-ip'] || req.ip;
    const userId = req.body.user || req.headers['x-user-id'];

    // 检查是否在白名单中
    if (whitelistedUserIds.includes(userId) || whitelistedIPs.includes(ip)) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Whitelisted user ${userId} or IP ${ip} bypassed Google rate limit.`);
      return; // 白名单用户或IP直接通过
    }

    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 4291 Gemini request from ${req.ip} has been rate limited.`);
    res.status(429).json({
      error: `4291 请求频繁，稍后再试。${UPGRADE_MESSAGE}`,
    });
  },
});

// 创建 /free/openai 路径的代理中间件，转发到 OpenAI，只发送飞书通知
const freeOpenAIProxy = createProxyMiddleware({
  target: process.env.TARGET_SERVER, // 从环境变量中读取目标服务器地址
  changeOrigin: true,
  pathRewrite: {
    '^/freeopenai': '/', // 移除 /free/openai 前缀
  },
  on: {
    proxyReq: fixRequestBody,
    proxyRes: (proxyRes, req, res) => {
      // 异步发送飞书通知
      (async () => {
        try {
          // 格式化用户请求内容
          const formattedRequestBody = JSON.stringify(req.body, null, 2);
          await notices({
            modelName: 'Free OpenAI',
            ip: req.headers['x-user-ip'] || req.ip,
            userId: req.headers['x-user-id'] || req.body.user,
            time: moment().format('YYYY-MM-DD HH:mm:ss'),
          }, formattedRequestBody);
        } catch (error) {
          console.error('Failed to send notification to Lark:', error);
        }
      })();
    },
  },
});

// 创建 /free/gemini 路径的代理中间件，转发到 Gemini，只发送飞书通知
const freeGeminiProxy = createProxyMiddleware({
  target: process.env.TARGET_SERVER_GEMIN, // 替换为你的 Gemini 代理目标地址
  changeOrigin: true,
  pathRewrite: {
    '^/freegemini': '/', // 移除 /free/gemini 前缀
  },
  on: {
    proxyReq: fixRequestBody,
    proxyRes: (proxyRes, req, res) => {
      // 异步发送飞书通知
      (async () => {
        try {
          // 格式化用户请求内容
          const formattedRequestBody = JSON.stringify(req.body, null, 2);

          // 使用 自建 notices webhook 地址
          const geminiWebhookUrl = 'gemini';
          await notices({
            modelName: 'Free Gemini',
            ip: req.headers['x-user-ip'] || req.ip,
            userId: req.headers['x-user-id'] || req.body.user,
            time: moment().format('YYYY-MM-DD HH:mm:ss'),
          }, formattedRequestBody, geminiWebhookUrl);
        } catch (error) {
          console.error('Failed to send notification to Lark:', error);
        }
      })();
    },
  },
});

// 创建 /cloudflare 路径的代理中间件，支持文生图、图生图、局部重绘等功能
const cloudflareProxy = createProxyMiddleware({
  target: 'https://api.cloudflare.com', // Cloudflare AI API
  changeOrigin: true,
  pathRewrite: {
    '^/cloudflare': '', // 去掉 /cloudflare 前缀
  },
  timeout: 60000, // 60秒超时
  on: {
    proxyReq: fixRequestBody,
    proxyRes: (proxyRes, req, res) => {
      // 发送通知
      notices({
        title: '🎨 Cloudflare AI 图像生成',
        message: `Prompt: ${req.body.prompt || 'No prompt'}`
      }, req.body, 'cloudflare').catch(() => {});
    },
  },
});

// 创建 /siliconflow 路径的代理中间件，支持文生图、图生图等功能
const siliconflowProxy = createProxyMiddleware({
  target: 'https://api.siliconflow.cn', // SiliconFlow AI API
  changeOrigin: true,
  pathRewrite: {
    '^/siliconflow': '', // 去掉 /siliconflow 前缀
  },
  timeout: 60000, // 60秒超时
  on: {
    proxyReq: fixRequestBody,
    proxyRes: (proxyRes, req, res) => {
      // 发送通知
      notices({
        title: '🎨 SiliconFlow AI 图像生成',
        message: `Model: ${req.body.model || 'Unknown'} | Prompt: ${req.body.prompt || 'No prompt'}`
      }, req.body, 'siliconflow').catch(() => {});
    },
  },
});

// 创建 /image-middleware 路径的代理中间件，接入本地图像/视频生成服务
const imageMiddlewareTarget = process.env.IMAGE_MIDDLEWARE_TARGET || 'http://localhost:6053';
const imageMiddlewareProxy = createProxyMiddleware({
  target: imageMiddlewareTarget, // 本地 Image Generation Middleware 服务
  changeOrigin: true,
  pathRewrite: {
    '^/image-middleware': '', // 去掉 /image-middleware 前缀
  },
  timeout: 180000, // 允许更长生成时间
  on: {
    proxyReq: fixRequestBody,
    proxyRes: (proxyRes, req, res) => {
      // 发送通知
      notices({
        title: '🧩 本地图像/视频生成中间层',
        message: `Endpoint: ${req.originalUrl} | Model: ${req.body?.model || 'Unknown'}`
      }, req.body, 'image-middleware').catch(() => {});
    },
  },
});

// 构建 chatnioRateLimiters 对象
function buildChatnioRateLimiters() {
  const { commonLimits, customLimits } = chatnioRateLimits;

  // 首先处理公共限流
  for (const modelName in commonLimits.models) {
    const modelConfig = commonLimits.models[modelName];
    const limiters = modelConfig.limits.map(({ windowMs, max }) => {
      return rateLimit({
        windowMs,
        max,
        keyGenerator: (req) => {
          const userId = req.body.user || req.headers['x-user-id'];
          const userIP = req.body.user_ip || req.headers['x-user-ip'] || req.ip;
          return `chatnio-${modelName}-${userId}-${userIP}`; // 独立的 key
        },
        handler: (req, res) => {
          const userId = req.body.user || req.headers['x-user-id'];
          const userIP = req.body.user_ip || req.headers['x-user-ip'] || req.ip;
          // 构建更详细的消息，包含时间窗口和次数
          const duration = moment.duration(windowMs);
          const formattedDuration = [
            duration.days() > 0 ? `${duration.days()} 天` : '',
            duration.hours() > 0 ? `${duration.hours()} 小时` : '',
            duration.minutes() > 0 ? `${duration.minutes()} 分钟` : '',
            duration.seconds() > 0 ? `${duration.seconds()} 秒` : '',
          ].filter(Boolean).join(' ');

          const logMessage = `${moment().format('YYYY-MM-DD HH:mm:ss')} [ChatNio] ${userIP} / ${userId} 对模型 ${modelName} 的请求已被限制。原因：超过 ${formattedDuration} 内 ${max} 次的限制。`;

          console.log(logMessage);
          return res.status(429).json({  // 使用 429 Too Many Requests
            error: {
              message: `请求过于频繁，请在 ${formattedDuration} 后重试。`,
              type: "rate_limit_exceeded",
              param: null,
              code: "4296"  // 自定义错误码
            }
          });
        },
      });
    });

    // 添加每日限制 (使用独立的 key)
    limiters.push((req, res, next) => {
      const now = moment().startOf('day');
      const userId = req.body.user || req.headers['x-user-id'];
      const userIP = req.body.user_ip || req.headers['x-user-ip'] || req.ip;
      const key = `chatnio-${modelName}-${userId}-${userIP}-${now.format('YYYY-MM-DD')}`; // 独立的 key
      dailyRequestCounts[key] = dailyRequestCounts[key] || 0;

      if (dailyRequestCounts[key] >= modelConfig.dailyLimit) {
          const logMessage = `${moment().format('YYYY-MM-DD HH:mm:ss')} [ChatNio] ${userIP} 对模型 ${modelName} 的请求已达到每日 ${modelConfig.dailyLimit} 次的限制。`;
        console.log(logMessage);
        return res.status(429).json({  // 使用 429 Too Many Requests
          error: {
            message: `今天模型 ${modelName} 的请求次数已达上限，请明天再试。`,
            type: "daily_rate_limit_exceeded",
            param: null,
            code: "4297"  // 自定义错误码
          }
        });
      }

      dailyRequestCounts[key]++;
      next();
    });

    chatnioRateLimiters[modelName] = limiters;
  }

  // 处理自定义限流
  for (const identifier in customLimits) {
    const userLimits = customLimits[identifier];
    for (const modelName in userLimits) {
      const modelConfig = userLimits[modelName];
      if (modelConfig && modelConfig.limits) {
        const limiters = modelConfig.limits.map(({ windowMs, max }) => {
          return rateLimit({
            windowMs,
            max,
            keyGenerator: (req) => {
              // 使用 identifier (userId 或 IP) 作为 key 的一部分
              return `chatnio-${modelName}-${identifier}`;
            },
            handler: (req, res) => {
              // 构建更详细的消息，包含时间窗口和次数
              const duration = moment.duration(windowMs);
              const formattedDuration = [
                duration.days() > 0 ? `${duration.days()} 天` : '',
                duration.hours() > 0 ? `${duration.hours()} 小时` : '',
                duration.minutes() > 0 ? `${duration.minutes()} 分钟` : '',
                duration.seconds() > 0 ? `${duration.seconds()} 秒` : '',
              ].filter(Boolean).join(' ');

              const logMessage = `${moment().format('YYYY-MM-DD HH:mm:ss')} [ChatNio] 用户/IP ${identifier} 对模型 ${modelName} 的请求已被限制。原因：超过 ${formattedDuration} 内 ${max} 次的自定义限制。`;
              console.log(logMessage);
              return res.status(429).json({
                error: {
                  message: `您的请求过于频繁，请在 ${formattedDuration} 后重试。`,
                  type: "custom_rate_limit_exceeded",
                  param: null,
                  code: "4298" // 自定义错误码
                }
              });
            },
          });
        });
        // 添加每日限制
        limiters.push((req, res, next) => {
          const now = moment().startOf('day');
          const key = `chatnio-${modelName}-${identifier}-${now.format('YYYY-MM-DD')}`; // 独立的 key
          dailyRequestCounts[key] = dailyRequestCounts[key] || 0;

          if (dailyRequestCounts[key] >= modelConfig.dailyLimit) {

            const logMessage = `${moment().format('YYYY-MM-DD HH:mm:ss')} [ChatNio] 用户/IP ${identifier} 对模型 ${modelName} 的请求已达到每日 ${modelConfig.dailyLimit} 次的自定义限制。`;
            console.log(logMessage);
            return res.status(429).json({
              error: {
                message: `您今天对模型 ${modelName} 的请求次数已达上限，请明天再试。`,
                type: "custom_daily_rate_limit_exceeded",
                param: null,
                code: "4299"  // 自定义错误码
               }
            });
          }

          dailyRequestCounts[key]++;
          next();
        });
        // 如果自定义限制中已经有这个模型了，就合并；否则，直接赋值
        chatnioRateLimiters[modelName] = chatnioRateLimiters[modelName]
          ? [...chatnioRateLimiters[modelName], ...limiters]
          : limiters;
      }
    }
  }
}

buildChatnioRateLimiters(); // 构建 chatnioRateLimiters 对象

app.use(restrictGeminiModelAccess); // 应用 restrictGeminiModelAccess 中间件

app.use(loggingMiddleware);  // <-- 中间件已优化为异步无阻塞
app.use(responseInterceptorMiddleware); // 响应拦截中间件，用于记录AI回答

// 内容审核中间件已移至校验链末尾

// 应用 /free/gemini 代理中间件
// 将内容审核置于代理之前，避免响应已结束导致审核不生效
app.use('/freegemini', contentModerationMiddleware, freeGeminiProxy);

// 应用 /cloudflare 代理中间件，支持文生图、图生图、局部重绘等功能
// 对 Cloudflare 路由：先审核再转发
app.use('/cloudflare', contentModerationMiddleware, cloudflareProxy);

// 应用 /siliconflow 代理中间件，支持文生图、图生图等功能
// 对 SiliconFlow 路由：先审核再转发
app.use('/siliconflow', contentModerationMiddleware, siliconflowProxy);

// 应用 /image-middleware 代理中间件，接入本地图像/视频生成服务
// 对本地中间层路由：先审核再转发
app.use('/image-middleware', contentModerationMiddleware, imageMiddlewareProxy);

// 应用 googleRateLimiter 到 googleProxy
// 对 Google 路由：先审核再转发
app.use('/google', defaultLengthLimiter, googleRateLimiter, contentModerationMiddleware, googleProxy);

// 应用 modifyRequestBodyMiddleware 中间件
app.use(modifyRequestBodyMiddleware);

// 应用 /free/openai 代理中间件
// 对 Free OpenAI 路由：先审核再转发
app.use('/freeopenai', contentModerationMiddleware, freeOpenAIProxy);

// 中间件函数，用于检查敏感词和黑名单用户
app.use('/', (req, res, next) => {
  const userId = req.body.user || req.headers['x-user-id'];
  const messages = req.body.messages || [];
  // 获取用户 IP 地址
  const userIP = req.headers['x-user-ip'] || req.body.user_ip || req.ip;
  // 获取Authorization头部信息
  const authorizationHeader = req.headers.authorization;
  console.log('Authorization:', authorizationHeader);
  console.log('req.body.user', req.headers['x-user-id'] || req.body.user)

  // 检查用户 IP 是否在黑名单中
  if (userIP && blacklistedIPs.includes(userIP)) {
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked for blacklisted IP: ${userIP}`);
    return res.status(403).json({
      error: '错误码4034，请联系管理员。',
    });
  }

  for (const message of messages) {
    let requestContent = message.content;

    // 检查用户 ID 是否在黑名单中
    if (userId && blacklistedUserIds.includes(userId)) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked for blacklisted user ID: ${userId}`);
      return res.status(403).json({
        error: '错误码4031，请稍后再试。',
      });
    }

    // 检查并处理请求内容
    if (requestContent) {
      if (typeof requestContent !== 'string') {
        try {
          // 尝试将非字符串类型转换为字符串
          requestContent = String(requestContent);
        } catch (error) {
          // 转换失败，记录错误并拒绝请求
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked: Invalid request content. Cannot convert to string.`);
          return res.status(400).json({
            error: '错误码4035，请稍后再试。',
          });
        }
      }

      // 对转换后的字符串进行敏感词检查
      if (sensitiveWords.some(word => requestContent.includes(word))) {
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked for sensitive content: ${requestContent}`);
        return res.status(400).json({
          error: '错误码4032，请稍后再试。',
        });
      }
    } else {
      // 如果请求内容为空或其他无法处理的类型，拒绝请求
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked: Empty or invalid request content.`);
      //return res.status(400).json({
        //error: '错误码4036，请稍后再试。',
      //});
    }

    /**正则过滤 */
    const isSensitive = detectSensitiveContent(requestContent, sensitivePatterns);
    if (isSensitive) {
      console.log(moment().format('YYYY-MM-DD HH:mm:ss') + ":Common Sensitive content detected in text:", requestContent);
      return res.status(400).json({
        error: '错误码4033，请稍后再试。',
      });
      // Handle the sensitive content here (e.g., block or filter)
    }

    // 如果已经触发拦截逻辑，则跳出循环
    if (res.headersSent) {
      break;
    }
  }

  next();
});

// 应用文本长度限制中间件到 "/chatnio" 路由，根据用户 ID 动态设置最大长度
app.use('/chatnio', (req, res, next) => {
  const userId = req.body.user || req.headers['x-user-id'];
  // 检查用户 ID 是否为时间戳格式
  if (userId && isTimestamp(userId)) {
    // 时间戳格式的用户 ID，视为未登录用户
    limitRequestBodyLength(4096, '未登录用户的请求文本过长，请登录后再试。',whitelistedUserIds, whitelistedIPs)(req, res, next);
  } else {
    // 其他用户 ID，视为已登录用户
    limitRequestBodyLength(2000000, '请求文本过长，Token超出平台默认阈值，请缩短后再试。若有更高需求请联系网站管理员处理。',whitelistedUserIds, whitelistedIPs)(req, res, next);
  }
  const userIP = req.body.user_ip || req.headers['x-user-ip'] || req.ip;
  // 检查用户 IP 是否在黑名单中
  if (userIP && blacklistedIPs.includes(userIP)) {
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked for blacklisted IP: ${userIP}`);
    return res.status(400).json({
      "error": {
        "message": '错误码4034，请联系管理员。',
        "type": "invalid_request_error",
        "param": null,
        "code": null
      }
    });
  }
});

// 在 /chatnio 路由中使用限流中间件
app.use('/chatnio', (req, res, next) => {
  const userId = req.body.user || req.headers['x-user-id'];
  const userIP = req.body.user_ip || req.headers['x-user-ip'] || req.ip;
  const modelName = req.body.model;

  const { commonLimits, customLimits } = chatnioRateLimits;

  // 优先检查自定义限制
    let rateLimitersToApply = [];
  if(customLimits[userId] && customLimits[userId][modelName]){
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [ChatNio] 正在为用户 ${userId} 和模型 ${modelName} 应用自定义限流。`);
      rateLimitersToApply = chatnioRateLimiters[modelName] || [];
  }
  else if(customLimits[userIP] && customLimits[userIP][modelName]){
       console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [ChatNio] 正在为 IP ${userIP} 和模型 ${modelName} 应用自定义限流。`);
       rateLimitersToApply = chatnioRateLimiters[modelName] || [];
  }
  //否则检查是否在公共限制名单中
  else if (commonLimits.restrictedUserIds.includes(userId) || commonLimits.restrictedIPs.includes(userIP)) {
      if(chatnioRateLimiters[modelName])
      {
           console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [ChatNio] 正在为用户/IP ${userId}/${userIP} 和模型 ${modelName} 应用公共限流。`);
            rateLimitersToApply = chatnioRateLimiters[modelName];
      }
  }
  // 应用选定的限流器 (只应用 chatnioRateLimiters)
  if (rateLimitersToApply.length>0) {
      (async () => {
          try {
              await Promise.all(rateLimitersToApply.map(limiter =>
                  new Promise((resolve, reject) => {
                      limiter(req, res, (err) => {
                          if (err) {
                              reject(err);
                          } else {
                              resolve();
                          }
                      });
                  })
              ));
              next(); // 所有限流器都通过
          } catch (err) {
              // 限流器已处理错误
          }
      })();
  } else {
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} [ChatNio] 对 ${modelName} 模型的请求没有匹配的限流规则。`);
      next(); // 没有适用的 chatnio 限流器
  }
}, contentModerationMiddleware, chatnioProxy);

// 限制请求体长度
app.use('/', defaultLengthLimiter);

// 中间件函数，用于限制同一用户短时间内请求多个模型
app.use('/', (req, res, next) => {
  const userId = req.headers['x-user-id'] || req.body.user;
  const modelName = req.body.model;
  const currentTime = Date.now();

  if (userId && modelName) {
    if (!userRequestHistory.has(userId)) {
      userRequestHistory.set(userId, {
        lastRequestTime: currentTime,
        modelsRequested: new Set([modelName]),
      });
    } else {
      const userData = userRequestHistory.get(userId);
      const timeDifference = currentTime - userData.lastRequestTime;

      if (timeDifference <= 1500) {
        // 1 秒内
        userData.modelsRequested.add(modelName);

        if (userData.modelsRequested.size > 2) {
          console.log(
            `${moment().format(
              'YYYY-MM-DD HH:mm:ss'
            )} User ${userId} 4292 同一用户短时间内发送不同模型请求`
          );
          return res.status(429).json({
            error: `4292 请求频繁，稍后再试。${UPGRADE_MESSAGE}`,
          });
        }
      } else {
        // 超过 1.5 秒，重置数据
        userData.lastRequestTime = currentTime;
        userData.modelsRequested = new Set([modelName]);
      }
    }
  }

  next();
});

// 中间件函数，用于限制不同用户短时间内发送相似请求
const cacheTimeMs = 15 * 1000; // 缓存过期时间，15 秒
app.use('/', (req, res, next) => {
  const messages = req.body.messages || [];
  console.log(messages);

  // 只处理 messages 数组中的最后一个消息（即当前用户发送的消息）
  if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];

      if (lastMessage.role !== 'user') {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 最后一条消息不是用户发送的，跳过重复性检查。`);
          return next(); // 如果不是用户发送的，直接跳过
      }
      let requestContent = lastMessage.content;

      if (requestContent) {
          let contentWithoutTitlePrompt = null;

          // 从请求内容中移除用于生成标题的部分
          if (typeof requestContent === 'string') {
              const titlePromptRegExp = /你是一名擅长会话的助理，你需要将用户的会话总结为 10 个字以内的标题/g;
              contentWithoutTitlePrompt = requestContent.replace(titlePromptRegExp, '').trim();
              console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 移除标题提示后的内容:`, contentWithoutTitlePrompt);
          } else {
              contentWithoutTitlePrompt = requestContent;
              console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 请求内容不是字符串，直接使用:`, contentWithoutTitlePrompt);
          }

          if (contentWithoutTitlePrompt !== '') {
              const dataToHash = prepareDataForHashing(contentWithoutTitlePrompt);
              console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 用于哈希的数据:`, dataToHash);
              const requestContentHash = crypto.createHash('sha256').update(dataToHash).digest('hex');
              console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 请求内容的哈希值:`, requestContentHash);
              const currentTime = Date.now();

              if (recentRequestContentHashes.has(requestContentHash)) {
                  const existingRequest = recentRequestContentHashes.get(requestContentHash);
                  console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 缓存中存在相同哈希值，上次请求时间:`, existingRequest.timestamp);

                
                  const timeDifference = currentTime - existingRequest.timestamp;

                   if (timeDifference <= cacheTimeMs) {
                        existingRequest.count++;
                        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 更新计数: ${existingRequest.count}`);

                       if (existingRequest.count > 3) {
                          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 15秒内相同内容请求超过3次. 触发拦截！`);
                           return res.status(400).json({
                                error: `4293 请求频繁，稍后再试。${UPGRADE_MESSAGE}`,
                          });
                       }
                   }
                   else{
                      //超过15秒，重置
                       existingRequest.timestamp = currentTime;
                       existingRequest.count = 1;
                   }
                 
              } else {
                  console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 缓存中不存在该哈希值，创建新记录`);
                  recentRequestContentHashes.set(requestContentHash, {
                      timestamp: currentTime,
                      count: 1, // 初始计数为 1
                  });
              }

              // 为每个哈希值设置单独的定时器
              if (recentRequestContentHashes.has(requestContentHash)) {
                  const existingRequest = recentRequestContentHashes.get(requestContentHash);
                  //先清除之前的定时器，因为有新的请求
                  clearTimeout(existingRequest.timer);

                  existingRequest.timer = setTimeout(() => {
                      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 从缓存中删除哈希值:`, requestContentHash);
                      recentRequestContentHashes.delete(requestContentHash);
                  }, cacheTimeMs);
              }

          } else {
              console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 移除标题后的内容为空字符串，跳过哈希检查。`);
          }
      } else {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked: Empty or invalid request content.`);
          return res.status(400).json({
              error: '错误码4037，请稍后再试。',
          });
      }
  } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} messages 数组为空，跳过重复性检查。`);
  }

  console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} 请求处理完成，继续执行下一个中间件`);
  next();
});
// / 路由模型白名单校验中间件，必须在所有 / 路由相关中间件之前
app.use('/v1', (req, res, next) => {
  // 只校验POST/PUT/PATCH等有body的请求
  const method = req.method.toUpperCase();
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const modelName = req.body && req.body.model;
    loadModelWhitelists().catch(()=>{});
    if (!modelName || !robotModelWhitelist.includes(modelName)) {
      return res.status(403).json({ error: '禁止请求该模型，未在ROBOT_WHITELIST白名单内。' });
    }
  }
  next();
});
// 中间件函数，根据请求参数应用不同的限流策略和过滤重复请求
app.use('/', (req, res, next) => {
  let modelName = null;
  const messages = req.body.messages || []; // 获取 messages 数组，如果不存在则设为空数组

  if (req.body && req.body.model) {
    modelName = req.body.model;
  }

  // 获取该模型的所有限流中间件
  const rateLimitersForModel = rateLimiters[modelName];

  // 格式化用户请求内容
  const formattedRequestBody = JSON.stringify(req.body, null, 2);

  // 检查是否为特定模型的请求
  // 遍历过滤配置
  for (const config of Object.values(filterConfig)) {
    const { modelName: filterModelName, filterString } = config;

    // 遍历 messages 数组
    for (const message of messages) {
      const requestContent = message.content;

      if (requestContent && requestContent.includes(filterString)) {
        // 生成缓存键，可以使用用户 ID 或 IP 地址
        const cacheKey = `${filterModelName}-${req.body.user || req.headers['x-user-id']}`;

        // 检查缓存中是否存在相同的请求内容
        if (recentRequestsCache.has(cacheKey)) {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Duplicate request detected and blocked for model: ${filterModelName}, user: ${req.body.user}`);
          return res.status(403).json({
            error: '错误码4038，请稍后再试。',
          });
        }

        // 将请求内容添加到缓存中
        recentRequestsCache.set(cacheKey, true);

        // 设置定时器，在过期时间后从缓存中删除请求内容
        setTimeout(() => {
          recentRequestsCache.delete(cacheKey);
        }, cacheExpirationTimeMs);

        // 如果匹配到过滤配置，则直接返回错误
        return res.status(403).json({
          error: '错误码4039，请稍后再试。',
        });
      }

      // 如果已经触发拦截逻辑，则跳出循环
      if (res.headersSent) {
        break;
      }
    }
  }

  // 检查是否为辅助模型的请求，并进行自然语言判断
  if (auxiliaryModels.includes(modelName)) {
    // 只允许用户 ID 为 undefined 的请求访问辅助模型
    if (req.body.user) {
      console.log(
        `${moment().format('YYYY-MM-DD HH:mm:ss')}  Request blocked for model: ${modelName || 'unknown'}  ip ${req.ip}  user ID is not undefined`
      );
      return res.status(403).json({
        error: '错误码4002，请稍后再试。',
      });
    }

    // 检查 input 是否存在且为自然语言
    if (!req.body.input || !isNaturalLanguage(req.body.input)) {
      console.log(
        `${moment().format('YYYY-MM-DD HH:mm:ss')}  4001 Request blocked for model: ${modelName || 'unknown'}  ip ${req.ip}  input is not natural language`
      );
      return res.status(403).json({
        error: '错误码4001，请稍后再试。',
      });
    }
  }

  // 如果有针对该模型的限流配置，则依次应用所有限流中间件
  if (rateLimitersForModel) {
    console.log(`Applying rate limiters for model: ${modelName}`);

    // 使用 Promise.all 和 async/await 依次执行所有限流中间件
    (async () => {
      try {
        await Promise.all(rateLimitersForModel.map(limiter =>
          new Promise((resolve, reject) => {
            limiter(req, res, (err) => {
              if (err) {
                reject(err);
              } else {
                resolve();
              }
            });
          })
        ));
        // 所有限流中间件都执行成功，继续执行下一个中间件
        next();
      } catch (err) {
        // 捕获限流中间件抛出的错误
        // 这里不需要做任何处理，因为错误已经被处理过了
        // next(err); 
      }
    })();
  } else {
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')}  No rate limiter for model: ${modelName || 'unknown'}  ip ${req.ip}`);
    next();
  }

  // 发送通知，包含格式化的用户请求内容
  if (modelName) {
    notices({
      modelName,
      ip: req.headers['x-user-ip'] || req.ip,
      userId: req.headers['x-user-id'] || req.body.user,
      time: moment().format('YYYY-MM-DD HH:mm:ss'),
    }, formattedRequestBody);
  }
}, contentModerationMiddleware, openAIProxy);

// 从文件中加载白名单
function loadWhitelistFromFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const whitelist = JSON.parse(fileContent);
    whitelistedUserIds = whitelist.userIds || [];
    whitelistedIPs = whitelist.ips || [];
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Whitelist loaded: ${whitelistedUserIds.length} user IDs, ${whitelistedIPs.length} IPs`);
  } catch (err) {
    console.error(`Failed to load whitelist from ${filePath}:`, err);
    whitelistedUserIds = [];
    whitelistedIPs = [];
  }
}

// 监听端口
const PORT = process.env.MAIN_PORT || 20491;
app.listen(PORT, async () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
  
  // 初始化配置管理器
  try {
    await configManager.initialize();
    await loadAllConfigFromManager();
    await loadWhitelistFromConfigManager();
    await loadModelWhitelists(true);
    console.log('配置管理器初始化完成 - Config Manager模式');
    
    // 初始化系统配置（从文件加载到数据库）
    await initializeSystemConfigs();
    console.log('系统配置初始化完成 - System Config模式');
  } catch (error) {
    console.error('配置管理器初始化失败，使用文件模式:', error);
    // 回退到文件模式
    sensitiveWords = loadWordsFromFile(sensitiveWordsFilePath);
    blacklistedUserIds = loadWordsFromFile(blacklistedUserIdsFilePath);
    blacklistedIPs = loadWordsFromFile(blacklistedIPsFilePath);
    loadWhitelistFromFile(whitelistFilePath);
    filterConfig = loadFilterConfigFromFile(filterConfigFilePath);
    restrictedUsersConfig = loadRestrictedUsersConfigFromFile(restrictedUsersConfigFilePath);
    sensitivePatterns = readSensitivePatternsFromFile(sensitivePatternsFile);
    console.log('配置初始化完成 - 文件备份模式');
  }
});
