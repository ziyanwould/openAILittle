/**
 * @Author: Liu Jiarong
 * @Date: 2024-06-24 19:48:52
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-02-15 15:19:13
 * @FilePath: /openAILittle/index.js
 * @Description: 
 * @
 * @Copyright (c) 2024 by ${git_name_email}, All Rights Reserved. 
 */

const express = require('express');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const moment = require('moment');
const crypto = require('crypto'); // 引入 crypto 模块
const fs = require('fs');
const url = require('url'); // 引入 url 模块
const { sendNotification } = require('./notices/pushDeerNotifier'); // 引入 pushDeerNotifier.js 文件中的 sendNotification 函数
const { sendLarkNotification } = require('./notices/larkNotifier'); // 引入 pushDeerNotifier.js 文件中的 sendNotification 函数

// Node.js 18 以上版本支持原生的 fetch API
const app = express();

app.use(bodyParser.json({ limit: '100mb' }));

// 定义不同模型的多重限流配置
const modelRateLimits = {
  'gpt-4o-mini': {
    limits: [
      { windowMs: 2 * 60 * 1000, max: 5 },
      { windowMs: 30 * 60 * 1000, max: 30 },
      { windowMs: 3 * 60 * 60 * 1000, max: 200 },
    ],
    dailyLimit: 1000, // 例如，gpt-4-turbo 每天总限制 500 次
  },
  'cogvideox-flash': {
    limits: [
      { windowMs: 2 * 60 * 1000, max: 2 },
      { windowMs: 3 * 60 * 60 * 1000, max: 12 },
    ],
    dailyLimit: 50, // 例如，gpt-4-turbo 每天总限制 500 次
  },
  'cogview-3-flash': {
    limits: [
      { windowMs: 2 * 60 * 1000, max: 2 },
      { windowMs: 3 * 60 * 60 * 1000, max: 12 },
    ],
    dailyLimit: 50, // 例如，gpt-4-turbo 每天总限制 500 次
  },
  'o1-mini': {
    limits: [
      { windowMs: 2 * 60 * 1000, max: 2 },
      { windowMs: 3 * 60 * 60 * 1000, max: 12 },
    ],
    dailyLimit: 50, // 例如，gpt-4-turbo 每天总限制 500 次
  },
  'o1-preview': {
    limits: [
      { windowMs: 2 * 60 * 1000, max: 2 },
      { windowMs: 3 * 60 * 60 * 1000, max: 12 },
    ],
    dailyLimit: 50, // 例如，gpt-4-turbo 每天总限制 500 次
  },
  'gpt-4-turbo': {
    limits: [
      { windowMs: 2 * 60 * 1000, max: 5 },
      { windowMs: 3 * 60 * 60 * 1000, max: 15 },
    ],
    dailyLimit: 300, // 例如，gpt-4-turbo 每天总限制 500 次
  },
  'gpt-4o': {
    limits: [
      { windowMs: 2 * 60 * 1000, max: 5 },
      { windowMs: 3 * 60 * 60 * 1000, max: 30 }, // 每分钟 1 次
    ],
    dailyLimit: 300, // 例如，gpt-4o 每天总限制 300 次
  },
  'claude-3-haiku-20240307': {
    limits: [
      { windowMs: 5 * 60 * 1000, max: 2 },
      { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
    ],
    dailyLimit: 5,
  },
  'claude-3-opus-20240229': {
    limits: [
      { windowMs: 5 * 60 * 1000, max: 2 },
      { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
    ],
    dailyLimit: 5,
  },
  'claude-3-sonnet-20240229': {
    limits: [
      { windowMs: 5 * 60 * 1000, max: 2 },
      { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
    ],
    dailyLimit: 5,
  },
  'claude-3-5-sonnet-20240620': {
    limits: [
      { windowMs: 5 * 60 * 1000, max: 2 },
      { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
    ],
    dailyLimit: 5,
  },
  'claude-instant-1.2': {
    limits: [
      { windowMs: 5 * 60 * 1000, max: 2 },
      { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
    ],
    dailyLimit: 15,
  },
  'claude-2': {
    limits: [
      { windowMs: 5 * 60 * 1000, max: 2 },
      { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
    ],
    dailyLimit: 15,
  },
  'claude-2.0': {
    limits: [
      { windowMs: 5 * 60 * 1000, max: 2 },
      { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
    ],
    dailyLimit: 15,
  },
  'claude-2.1': {
    limits: [
      { windowMs: 5 * 60 * 1000, max: 2 },
      { windowMs: 7 * 24 * 60 * 60 * 1000, max: 5 },
    ],
    dailyLimit: 15,
  },
  'gemini-1.5-pro-latest': {
    limits: [
      { windowMs: 3 * 1000, max: 1 },
      { windowMs: 60 * 1000, max: 4 },
      { windowMs: 30 * 60 * 1000, max: 20 },
      { windowMs: 3 * 60 * 60 * 1000, max: 100 }
    ],
    dailyLimit: 520,
  },
  'gemini-1.5-flash-latest': {
    limits: [
      { windowMs: 2.5 * 1000, max: 1 },
      { windowMs: 60 * 1000, max: 4 },
      { windowMs: 30 * 60 * 1000, max: 25 },
      { windowMs: 3 * 60 * 60 * 1000, max: 100 }
    ],
    dailyLimit: 520,
  },
  'gemini-2.0-flash-exp': {
    limits: [
      { windowMs: 5 * 1000, max: 1 },
      { windowMs: 90 * 1000, max: 4 },
      { windowMs: 30 * 60 * 1000, max: 25 },
      { windowMs: 3 * 60 * 60 * 1000, max: 100 }
    ],
    dailyLimit: 520,
  },
  'gemini-2.0-flash-thinking-exp': {
    limits: [
      { windowMs: 5 * 1000, max: 1 },
      { windowMs: 90 * 1000, max: 4 },
      { windowMs: 30 * 60 * 1000, max: 25 },
      { windowMs: 3 * 60 * 60 * 1000, max: 100 }
    ],
    dailyLimit: 520,
  },
  'gemini-exp-1206': {
    limits: [
      { windowMs: 5 * 1000, max: 1 },
      { windowMs: 90 * 1000, max: 4 },
      { windowMs: 30 * 60 * 1000, max: 25 },
      { windowMs: 3 * 60 * 60 * 1000, max: 100 }
    ],
    dailyLimit: 520,
  },
  'Doubao-pro-4k': {
    limits: [
      { windowMs: 1 * 60 * 1000, max: 4 },
      { windowMs: 30 * 60 * 1000, max: 30 },
    ],
    dailyLimit: 1200, // Doubao-pro-4k 每天总限制 120 次
  },
  'Doubao-pro-128k': {
    limits: [
      { windowMs: 1 * 60 * 1000, max: 4 },
      { windowMs: 30 * 60 * 1000, max: 30 },
    ],
    dailyLimit: 1200, // Doubao-pro-4k 每天总限制 120 次
  },
};

// 定义辅助模型列表
const auxiliaryModels = [
  'text-embedding-ada-002',
  'text-embedding-3-small',
  'text-embedding-3-large',
  'text-curie-001',
  'text-babbage-001',
  'text-ada-001',
  'text-davinci-002',
  'text-davinci-003',
  'text-moderation-latest',
  'text-moderation-stable',
  'text-davinci-edit-001',
  'text-embedding-v1',
  'davinci-002',
  'babbage-002',
  'whisper-1',
  'tts-1',
  'tts-1-1106',
  'tts-1-hd',
  'tts-1-hd-1106',
];

// 为辅助模型设置限流配置
auxiliaryModels.forEach(model => {
  modelRateLimits[model] = {
    limits: [{ windowMs: 10 * 60 * 1000, max: 8 }],
    dailyLimit: 200,
  };
});

// 创建一个对象来存储每个模型每天的请求计数
const dailyRequestCounts = {};

// 创建一个缓存来存储最近的请求内容
const recentRequestsCache = new Map();

// 设置缓存过期时间（例如，5 分钟）
const cacheExpirationTimeMs = 5 * 60 * 1000;

// 用于存储每个用户的最近请求时间和模型
const userRequestHistory = new Map();

// 用于存储最近请求内容的哈希值和时间戳
const recentRequestContentHashes = new Map();

// 封装修改 req.body 的中间件函数
const modifyRequestBodyMiddleware = (req, res, next) => {
  if (req.body && req.body.model) {
    // 匹配 "huggingface/" 开头的模型，区分大小写
    if (req.body.model.startsWith("huggingface/")) {
      if (req.body.top_p !== undefined && req.body.top_p < 1) {
        req.body.top_p = 0.5;
      }
    }
    // 匹配 "Baichuan" 开头的模型，区分大小写
    else if (req.body.model.startsWith("Baichuan")) {
      req.body.frequency_penalty = 1;
    }
    // 匹配包含 "glm-4v" 的模型
    else if (req.body.model.includes("glm-4v")) {
      req.body.max_tokens = 1024;
    }
    // 匹配 "deepseek-" 开头的模型
    else if (req.body.model.startsWith("deepseek-")) {
      // 检查 max_completion_tokens 是否在2到4096之间
      if (req.body.max_completion_tokens === undefined || req.body.max_completion_tokens < 2 || req.body.max_completion_tokens > 4096) {
       // req.body.max_completion_tokens = 4096;
      }
    }
  }
  next();
};
// 定义白名单文件路径
const whitelistFilePath = 'whitelist.json';
// 初始化白名单 (用户ID和IP地址)
let whitelistedUserIds = [];
let whitelistedIPs = [];
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
// 初次加载白名单
loadWhitelistFromFile(whitelistFilePath);
console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Next Whitelist loaded: ${whitelistedUserIds.toString()} user IDs, ${whitelistedIPs.toString()} IPs`);
// 中间件函数，用于限制 req.body 文本长度
const limitRequestBodyLength = (maxLength = 20000, errorMessage = '请求文本过长，请缩短后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度') => {
  return (req, res, next) => {
    const userId = req.headers['x-user-id'] || req.body.user;
    const userIP = req.headers['x-user-ip'] || req.body.user_ip || req.ip;

    // 检查用户 ID 或 IP 是否在白名单中
    if (whitelistedUserIds.includes(userId) || whitelistedIPs.includes(userIP)) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request from whitelisted user ${userId || userIP} - skipping length check.`);
      next();
      return;
    }

    let totalLength = 0;

    // Gemini 格式
    if (req.body.contents && Array.isArray(req.body.contents)) {
      for (const contentItem of req.body.contents) {
        if (contentItem.parts && Array.isArray(contentItem.parts)) {
          for (const part of contentItem.parts) {
            if (part.text) {
              totalLength += String(part.text).length;
            }
          }
        }
      }
    }
    // 三方模型和 OpenAI 格式
    else if (req.body.messages && Array.isArray(req.body.messages)) {
      for (const message of req.body.messages) {
        if (message.content) {
          if (typeof message.content === 'string') {
            totalLength += message.content.length;
          } else if (Array.isArray(message.content)) {
            for (const contentItem of message.content) {
              if (contentItem.text) {
                totalLength += String(contentItem.text).length;
              }
            }
          } else if (typeof message.content === 'object' && message.content !== null && message.content.text) {
            // 针对 content 为单个对象的情况
            totalLength += String(message.content.text).length;
          }
        }
      }
    }

    if (totalLength > maxLength) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked: Text length exceeds limit (${totalLength} > ${maxLength}).`);
      return res.status(400).json({
        "error": {
          "message": errorMessage,
          "type": "invalid_request_error"
        }
      });
    }

    next();
  };
};
// 应用文本长度限制中间件到 "/" 和 "/google" 路由
const defaultLengthLimiter = limitRequestBodyLength();

// 定义飞书通知函数 【已经迁移抽取到larkNotifier】
// 定义 PushDeer 通知函数【已经迁移抽取到pushDeerNotifier】
// 定义 NTFY 通知函数 【已经迁移抽取到ntfyNotifier】
//钉钉 通知函数 【已经迁移抽取到dingtalkNotifier】

async function notices(data, requestBody, ntfyTopic = 'robot') {

  let pushkey = 'PDU33066TepraNW9hJp3GP5NWPCVgVaGpoxtU3EMa';
  let webhookUrl = 'https://open.feishu.cn/open-apis/bot/v2/hook/b99372d6-61f8-4fcc-bd6f-01689652fa08' // 默认，可以认为是 robot 通道

  switch (ntfyTopic) {
    case 'gemini':
      pushkey = 'PDU33066TL6i6CtArA8KIH2u7Q9VwYEVCRfQQU9h2';
      webhookUrl = 'https://open.feishu.cn/open-apis/bot/v2/hook/da771957-c1a4-4a91-88e4-08e6a6dfc73e'
      break;
    case 'chatnio':
      pushkey = 'PDU33066TEFmDgjEuuyFFCpJ8Iq13m0lZaT8eNywx';
      webhookUrl = 'https://open.feishu.cn/open-apis/bot/v2/hook/8097380c-fb36-4af6-8e19-570c75ce84a1'
      break; //** 缺少 break; 这里导致了 chatnio 执行后会继续执行 freelyai 的逻辑！**
    case 'freelyai':
      pushkey = 'PDU33066Te6j12xoa58EHg6MfQoepHcgWhM152xZ1';
      webhookUrl = 'https://open.feishu.cn/open-apis/bot/v2/hook/1a409aca-2336-4bd2-a143-6c1347570388'
      break;
  }

  sendNotification(data, requestBody, pushkey);
  sendLarkNotification(data, requestBody, webhookUrl);
}

// 从文件中加载受限用户配置
function loadRestrictedUsersConfigFromFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (err) {
    console.error(`Failed to load restricted users config from ${filePath}:`, err);
    return {};
  }
}

// 定义敏感词和黑名单文件路径
const sensitiveWordsFilePath = 'Sensitive.txt'; // 可以是 .txt 或 .json
const blacklistedUserIdsFilePath = 'BlacklistedUsers.txt'; // 可以是 .txt 或 .json
const blacklistedIPsFilePath = 'BlacklistedIPs.txt'; // 新增 IP 黑名单文件路径

// 初始化敏感词和黑名单
let sensitiveWords = loadWordsFromFile(sensitiveWordsFilePath);
let blacklistedUserIds = loadWordsFromFile(blacklistedUserIdsFilePath);
let blacklistedIPs = loadWordsFromFile(blacklistedIPsFilePath); // 加载 IP 黑名单

// 定义配置文件路径
const filterConfigFilePath = 'filterConfig.json';

// 初始化过滤配置
let filterConfig = loadFilterConfigFromFile(filterConfigFilePath);

// 定义受限用户配置文件路径
const restrictedUsersConfigFilePath = 'restrictedUsers.json';
// 加载受限用户配置
let restrictedUsersConfig = loadRestrictedUsersConfigFromFile(restrictedUsersConfigFilePath);
// 敏感形态的初始读取
// 调用函数时，使用新的文件名
let sensitivePatternsFile = 'sensitive_patterns.json';
let sensitivePatterns = readSensitivePatternsFromFile(sensitivePatternsFile);

// 每 120 秒同步一次敏感词和黑名单
setInterval(() => {
  sensitiveWords = loadWordsFromFile(sensitiveWordsFilePath);
  blacklistedUserIds = loadWordsFromFile(blacklistedUserIdsFilePath);
  blacklistedIPs = loadWordsFromFile(blacklistedIPsFilePath); // 更新 IP 黑名单
  restrictedUsersConfig = loadRestrictedUsersConfigFromFile(restrictedUsersConfigFilePath); // 更新受限用户配置
  loadWhitelistFromFile(whitelistFilePath); // 更新白名单
  console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Sensitive words and blacklisted user IDs updated.`);
  filterConfig = loadFilterConfigFromFile(filterConfigFilePath);
  console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Filter config updated.`);
  sensitivePatterns = readSensitivePatternsFromFile(sensitivePatternsFile);
  console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')}  Reloading sensitive patterns...`);
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

        console.log(`请求过于频繁，请在 ${formattedDuration} 后再试。${modelName} 模型在 ${windowMs / 1000} 秒内的最大请求次数为 ${max} 次。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度`)
        return res.status(429).json({
          error: `请求过于频繁，请在 ${formattedDuration} 后再试。${modelName} 模型在 ${windowMs / 1000} 秒内的最大请求次数为 ${max} 次。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度`,
        });
      },
    });
  });

  // 添加每日总请求次数限制中间件
  rateLimiters[modelName].push((req, res, next) => {
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

      return res.status(400).json({
        error: `今天${modelName} 模型总的请求次数已达上限，请明天再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度`
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
      return res.status(403).json({ error: '您没有权限访问此模型。' });
    } else {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Restricted user ${userId || userIP} accessed allowed model ${requestedModel}.`);
    }
  }

  next();
}

// 创建代理中间件
const openAIProxy = createProxyMiddleware({
  target: 'http://192.168.31.249:6039', // 替换为你的目标服务器地址
  changeOrigin: true,
  on: {
    proxyReq: fixRequestBody,
  },
});

const googleProxy = createProxyMiddleware({
  target: 'https://proxy.liujiarong.online/google',
  changeOrigin: true,
  pathRewrite: {
    '^/google': '/', // 正确的 pathRewrite 配置，移除 /google 前缀
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      // 合并 proxyReq 处理逻辑
      fixRequestBody(proxyReq, req, res); // 确保 fixRequestBody 生效
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Forwarding request to Google Proxy: ${req.method} ${proxyReq.path}`);
      const userId = req.headers['x-user-id'] || 'unknow';
      // 获取用户 IP 地址
      const userIP = req.headers['x-user-ip'] || req.ip;
      console.log('userId', userId)
      // 检查用户 IP 是否在黑名单中
      if (userIP && blacklistedIPs.includes(userIP)) {
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked for blacklisted IP: ${userIP}`);
        return res.status(403).json({
          error: '非法请求，请联系管理员。',
        });
      }
      let requestContent = '';

      // 从 req.body.contents 中提取用户发送的内容
      if (req.body.contents && Array.isArray(req.body.contents)) {
        for (const contentItem of req.body.contents) {
          if (contentItem.role === 'user' && contentItem.parts && Array.isArray(contentItem.parts)) {
            for (const part of contentItem.parts) {
              if (part.text) {

                // 检查请求内容是否与最近的请求相似
                if (part.text !== "") {

                  const dataToHash = prepareDataForHashing(part.text);
                  const requestContentHash = crypto
                    .createHash("sha256")
                    .update(dataToHash)
                    .digest("hex");
                  const currentTime = Date.now();

                  // 检查缓存中是否存在相同的请求内容哈希值
                  if (recentRequestContentHashes.has(requestContentHash)) {
                    const existingRequest =
                      recentRequestContentHashes.get(requestContentHash);

                    // 检查请求时间差是否在阈值内
                    const timeDifference = currentTime - existingRequest.timestamp;

                    // 根据实际情况调整时间窗口
                    if (timeDifference <= 3000) {
                      console.log(
                        `google路由：${moment().format(
                          "YYYY-MM-DD HH:mm:ss"
                        )} 短时间内发送相同内容请求.`
                      );
                      return res.status(403).json({
                        error: "请求过于频繁，请稍后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度",
                      });
                    } else {
                      // 更新 existingRequest 的时间戳
                      existingRequest.timestamp = currentTime;
                    }
                  } else {
                    // 如果缓存中不存在该哈希值，则创建新的记录
                    recentRequestContentHashes.set(requestContentHash, {
                      timestamp: currentTime,
                    });
                  }
                } else {
                  setTimeout(() => {
                    recentRequestContentHashes.delete(requestContentHash);
                  }, cacheExpirationTimeMs);
                }
                if (res.headersSent) {
                  break;
                  return false;
                }

                requestContent += part.text;
              }
            }
          }
        }
      }

      // 检查用户 ID 是否在黑名单中
      if (userId && blacklistedUserIds.includes(userId)) {
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Gemini request blocked for blacklisted user ID: ${userId}`);
        return res.status(403).json({
          error: '非法请求，请稍后再试。',
        });
      }

      // 检查请求内容是否包含敏感词
      if (sensitiveWords.some(word => requestContent.includes(word))) {
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Gemini request blocked for sensitive content: ${requestContent}`);
        return res.status(400).json({
          error: '非法请求，请稍后再试。',
        });
      }

      /**正则过滤 */
      const isSensitive = detectSensitiveContent(requestContent, sensitivePatterns);
      if (isSensitive) {
        console.log(moment().format('YYYY-MM-DD HH:mm:ss') + ":Google Sensitive content detected in text:", requestContent);
        return res.status(400).json({
          error: '非法请求，请稍后再试。',
        });
        // Handle the sensitive content here (e.g., block or filter)
      }

      // 仅当请求未被拦截时才发送飞书通知
      if (!res.headersSent) {
        try {
          const formattedRequestBody = JSON.stringify(req.body, null, 2);
          const geminiWebhookUrl = 'gemini'; // 替换为你的 notices webhook key
          notices({
            modelName: 'Gemini',
            ip: req.headers['x-user-ip'] || req.ip,
            userId: req.headers['x-user-id'] || req.userId,
            time: moment().format('YYYY-MM-DD HH:mm:ss'),
          }, formattedRequestBody, geminiWebhookUrl);
        } catch (error) {
          console.error('Failed to send notification to Lark:', error);
        }
      }
    },
  },
});

// 创建 /chatnio 路径的代理中间件
const chatnioProxy = createProxyMiddleware({
  target: 'http://192.168.31.249:6039',
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

// 创建 /freelyai 路径的代理中间件
const freelyaiProxy = createProxyMiddleware({
  target: 'http://192.168.31.249:6039',
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

//  googleProxy 中间件添加限流
const googleRateLimiter = rateLimit({
  windowMs: 2 * 60 * 60 * 1000, // 10 秒时间窗口
  max: 20, // 允许 1 次请求
  keyGenerator: (req) => req.headers['x-user-ip'] || req.ip, // 使用 IP 地址作为限流键
  handler: (req, res) => {
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Gemini request from ${req.ip} has been rate limited.`);
    res.status(429).json({
      error: '请求频繁，请稍后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度',
    });
  },
});

// 创建 /free/openai 路径的代理中间件，转发到 OpenAI，只发送飞书通知
const freeOpenAIProxy = createProxyMiddleware({
  target: 'http://192.168.31.249:6039',
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
  target: 'https://proxy.liujiarong.online/google', // 替换为你的 Gemini 代理目标地址
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

app.use(restrictGeminiModelAccess); // 应用 restrictGeminiModelAccess 中间件

// 应用 /free/gemini 代理中间件
app.use('/freegemini', freeGeminiProxy);

// 应用 googleRateLimiter 到 googleProxy
app.use('/google', defaultLengthLimiter, googleRateLimiter, googleProxy);

// 应用 modifyRequestBodyMiddleware 中间件
app.use(modifyRequestBodyMiddleware);

// 应用 /free/openai 代理中间件
app.use('/freeopenai', freeOpenAIProxy);

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
      error: '非法请求，请联系管理员。',
    });
  }

  for (const message of messages) {
    let requestContent = message.content;

    // 检查用户 ID 是否在黑名单中
    if (userId && blacklistedUserIds.includes(userId)) {
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked for blacklisted user ID: ${userId}`);
      return res.status(403).json({
        error: '非法请求，请稍后再试。',
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
            error: '非法请求，请稍后再试。',
          });
        }
      }

      // 对转换后的字符串进行敏感词检查
      if (sensitiveWords.some(word => requestContent.includes(word))) {
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked for sensitive content: ${requestContent}`);
        return res.status(400).json({
          error: '非法请求，请稍后再试。',
        });
      }
    } else {
      // 如果请求内容为空或其他无法处理的类型，拒绝请求
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked: Empty or invalid request content.`);
      return res.status(400).json({
        error: '非法请求，请稍后再试。',
      });
    }

    /**正则过滤 */
    const isSensitive = detectSensitiveContent(requestContent, sensitivePatterns);
    if (isSensitive) {
      console.log(moment().format('YYYY-MM-DD HH:mm:ss') + ":Common Sensitive content detected in text:", requestContent);
      return res.status(400).json({
        error: '非法请求，请稍后再试。',
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
    limitRequestBodyLength(4096, '未登录用户的请求文本过长，请登录后再试。')(req, res, next);
  } else {
    // 其他用户 ID，视为已登录用户
    limitRequestBodyLength(2000000, '请求文本过长，Token超出平台默认阈值，请缩短后再试。若有更高需求请联系网站管理员处理。')(req, res, next);
  }
  const userIP = req.body.user_ip || req.headers['x-user-ip'] || req.ip;
  // 检查用户 IP 是否在黑名单中
  if (userIP && blacklistedIPs.includes(userIP)) {
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked for blacklisted IP: ${userIP}`);
    return res.status(400).json({
      "error": {
        "message": '非法请求，请联系管理员。',
        "type": "invalid_request_error",
        "param": null,
        "code": null
      }
    });
  }
});

// 应用 /chatnio 代理中间件
app.use('/chatnio', chatnioProxy);

// freelyaiProxy
app.use('/freelyai', freelyaiProxy);

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
            )} User ${userId} 同一用户短时间内发送不同模型请求`
          );
          return res.status(429).json({
            error: '请求过于频繁，请稍后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度',
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
app.use('/', (req, res, next) => {
  const messages = req.body.messages || [];

  for (const message of messages) {
    let requestContent = message.content;

    if (requestContent) {
      // if (typeof requestContent !== 'string') {
      //   try {
      //     // 尝试将非字符串类型转换为字符串
      //     requestContent = String(requestContent);
      //   } catch (error) {
      //     // 转换失败，记录错误并拒绝请求
      //     console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked: Invalid request content. Cannot convert to string.`);
      //     return res.status(400).json({
      //       error: '非法请求，请稍后再试。',
      //     });
      //   }
      // }
      let contentWithoutTitlePrompt = null
      // ... (使用转换后的 requestContent 字符串进行相似度检测)
      // 从请求内容中移除用于生成标题的部分
      if (typeof requestContent === 'string') {
        const titlePromptRegExp = /你是一名擅长会话的助理，你需要将用户的会话总结为 10 个字以内的标题/g;
        contentWithoutTitlePrompt = requestContent.replace(titlePromptRegExp, '').trim();
      } else {
        contentWithoutTitlePrompt = requestContent;
      }


      if (contentWithoutTitlePrompt !== '') {
        const dataToHash = prepareDataForHashing(contentWithoutTitlePrompt);
        const requestContentHash = crypto.createHash('sha256').update(dataToHash).digest('hex');
        const currentTime = Date.now();

        // 检查缓存中是否存在相同的请求内容哈希值
        if (recentRequestContentHashes.has(requestContentHash)) {
          const existingRequest = recentRequestContentHashes.get(requestContentHash);

          // 检查请求时间差是否在阈值内
          const timeDifference = currentTime - existingRequest.timestamp;

          // 根据实际情况调整时间窗口
          if (timeDifference <= 3000) {
            console.log(
              `主路由：${moment().format('YYYY-MM-DD HH:mm:ss')} 短时间内发送相同内容请求.`
            );
            return res.status(403).json({
              error: '请求过于频繁，请稍后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度',
            });
          } else {
            // 更新 existingRequest 的时间戳
            existingRequest.timestamp = currentTime;
          }
        } else {
          // 如果缓存中不存在该哈希值，则创建新的记录
          recentRequestContentHashes.set(requestContentHash, {
            timestamp: currentTime,
          });
        }

        // 设置定时器，在过期时间后从缓存中删除请求内容哈希值
        setTimeout(() => {
          recentRequestContentHashes.delete(requestContentHash);
        }, cacheExpirationTimeMs);
      }
    } else {
      // 如果请求内容为空或其他无法处理的类型，拒绝请求
      console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Request blocked: Empty or invalid request content.`);
      return res.status(400).json({
        error: '非法请求，请稍后再试。',
      });
    }

    // 如果已经触发拦截逻辑，则跳出循环
    if (res.headersSent) {
      break;
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
            error: '非法请求，请稍后再试。',
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
          error: '非法请求，请稍后再试。',
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
    if (req.body.user !== undefined) {
      console.log(
        `${moment().format('YYYY-MM-DD HH:mm:ss')}  Request blocked for model: ${modelName || 'unknown'}  ip ${req.ip}  user ID is not undefined`
      );
      return res.status(403).json({
        error: '非法请求，请稍后再试。',
      });
    }

    // 检查 input 是否存在且为自然语言
    if (!req.body.input || !isNaturalLanguage(req.body.input)) {
      console.log(
        `${moment().format('YYYY-MM-DD HH:mm:ss')}  Request blocked for model: ${modelName || 'unknown'}  ip ${req.ip}  input is not natural language`
      );
      return res.status(403).json({
        error: '非法请求，请稍后再试。',
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
}, openAIProxy);


// 辅助函数，用于准备数据进行哈希计算
function prepareDataForHashing(data) {
  if (typeof data === 'string') {
    return data;
  } else if (Buffer.isBuffer(data)) {
    return data;
  } else if (Array.isArray(data)) {
    // 递归处理嵌套数组
    return data.map(prepareDataForHashing).join('');
  } else if (typeof data === 'object' && data !== null) {
    // 处理其他对象类型，例如包含 base64 编码图片数据的对象
    // 你需要根据实际情况修改这部分代码
    if (data.type && data.type.startsWith('image') && typeof data.image_url.url === 'string') {
      const str = data.image_url.url;
      const base64Image = str.replace(/^data:image\/\w+;base64,/, '');
      return base64Image;
    } else {
      return JSON.stringify(data);
    }
  } else {
    // 处理其他数据类型
    return String(data);
  }
}

// 简单判断是否为自然语言
// 使用最多的8种语言做判断，特别是中文和英文，判断其语句是否完整，是否是自然语言。
function isNaturalLanguage(text) {
  // 定义支持的语言及其对应的正则表达式
  const languageRegexMap = {
    'english': /^[A-Za-z0-9,.!?\s]+$/, // 英文：字母、数字、标点符号和空格
    'chinese': /^[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef0-9,.!?\s]+$/, // 中文：汉字、标点符号和空格
    'chinese-english': /^[A-Za-z0-9\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef,.!?\s]+$/, // 中英文混合：字母、数字、汉字、标点符号和空格
    'spanish': /^[A-Za-z0-9áéíóúüñÁÉÍÓÚÜÑ,.!?\s]+$/, // 西班牙语：字母、数字、标点符号、特殊字符和空格
    'french': /^[A-Za-z0-9àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ,.!?\s]+$/, // 法语：字母、数字、标点符号、特殊字符和空格
    'german': /^[A-Za-z0-9äöüßÄÖÜẞ,.!?\s]+$/, // 德语：字母、数字、标点符号、特殊字符和空格
    'russian': /^[А-Яа-я0-9,.!?\s]+$/, // 俄语：西里尔字母、数字、标点符号和空格
    'portuguese': /^[A-Za-z0-9áàâãçéèêíìîóòôõúùûüÁÀÂÃÇÉÈÊÍÌÎÓÒÔÕÚÙÛÜ,.!?\s]+$/, // 葡萄牙语：字母、数字、标点符号、特殊字符和空格
    'arabic': /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s]+$/, // 阿拉伯语：阿拉伯字符和空格
  };

  // 遍历支持的语言，检查文本是否匹配
  for (const [language, regex] of Object.entries(languageRegexMap)) {
    if (regex.test(text)) {
      console.log(`Detected language: ${language}`);
      return true;
    }
  }

  // 如果不匹配任何一种语言，则判断是否为Markdown格式
  // 这里只是一个简单的Markdown判断，可以根据需要进行更复杂的判断
  if (text.includes('**') || text.includes('##') || text.includes('[link](url)')) {
    return true;
  }

  // 如果没有匹配到任何语言，则认为不是自然语言
  return false;
}

// 从文件中读取敏感模式的函数
function readSensitivePatternsFromFile(filename) {
  try {
    const data = fs.readFileSync(filename, 'utf8');
    const patterns = JSON.parse(data).map(item => ({
      pattern: new RegExp(item.pattern, 'g'),
      description: item.description
    }));
    return patterns;
  } catch (err) {
    console.error(`Error reading file ${filename}:`, err);
    return [];
  }
}

// 使用模式检测敏感内容的功能
function detectSensitiveContent(text, patterns) {
  for (let i = 0; i < patterns.length; i++) {
    if (text.search(patterns[i].pattern) !== -1) {
      return true;
    }
  }
  return false;
}

// 辅助函数，用于检查字符串是否为时间戳格式，并允许一定的误差
function isTimestamp(str, allowedErrorMs = 10 * 60 * 1000) {
  const timestamp = parseInt(str, 10) * 1000; //  毫秒级时间戳
  if (isNaN(timestamp)) {
    return false;
  }
  // 增加时间范围的校验，需要用户传过来的就是当前时间附近的时间戳
  const currentTime = Date.now();
  return Math.abs(currentTime - timestamp) <= allowedErrorMs;
}


// 监听端口
const PORT = 20491;
app.listen(PORT, () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
});