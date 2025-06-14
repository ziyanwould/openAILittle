/**
 * @Author: Liu Jiarong
 * @Date: 2024-06-24 19:48:52
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-04-14 23:02:35
 * @FilePath: /openAILittle-1/index.js
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
const {
  prepareDataForHashing,
  isNaturalLanguage,
  readSensitivePatternsFromFile,
  detectSensitiveContent,
  isTimestamp,
  loadRestrictedUsersConfigFromFile
 } = require('./utils');
const modifyRequestBodyMiddleware  = require('./middleware/modifyRequestBodyMiddleware'); // 模型参数修正统一处理
const { sendNotification } = require('./notices/pushDeerNotifier'); // 引入 pushDeerNotifier.js 文件中的 sendNotification 函数
const { sendLarkNotification } = require('./notices/larkNotifier'); // 引入 pushDeerNotifier.js 文件中的 sendNotification 函数
const chatnioRateLimits = require('./modules/chatnioRateLimits'); // 引入 chatnio 限流配置
const modelRateLimits = require('./modules/modelRateLimits'); // 定义不同模型的多重限流配置 Doubao-Seaweed
const auxiliaryModels = require('./modules/auxiliaryModels'); // 定义辅助模型列表
const limitRequestBodyLength = require('./middleware/limitRequestBodyLength'); // 引入文本长度限制中间件
const loggingMiddleware = require('./middleware/loggingMiddleware'); // 引入日志中间件

const chatnioRateLimiters = {}; // 用于存储 chatnio 的限流器
// 在文件开头引入 dotenv
require('dotenv').config();

// 解析 FREELYAI_WHITELIST 环境变量，支持等号分割取左边
let freelyaiModelWhitelist = [];
if (process.env.FREELYAI_WHITELIST) {
  freelyaiModelWhitelist = process.env.FREELYAI_WHITELIST.split(',')
    .map(item => item.split('=')[0].trim())
    .filter(Boolean);
}

// 解析 ROBOT_WHITELIST 环境变量，支持等号分割取左边
let robotModelWhitelist = [];
if (process.env.ROBOT_WHITELIST) {
  robotModelWhitelist = process.env.ROBOT_WHITELIST.split(',')
    .map(item => item.split('=')[0].trim())
    .filter(Boolean);
}

// Node.js 18 以上版本支持原生的 fetch API
const app = express();

app.use(bodyParser.json({ limit: '100mb' }));

// 为辅助模型设置限流配置
auxiliaryModels.forEach(model => {
  modelRateLimits[model] = {
    limits: [{ windowMs: 10 * 60 * 1000, max: 10 }],
    dailyLimit: 500,
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

// 定义白名单文件路径
const whitelistFilePath = 'whitelist.json';
// 初始化白名单 (用户ID和IP地址)
let whitelistedUserIds = [];
let whitelistedIPs = [];

// 初次加载白名单
loadWhitelistFromFile(whitelistFilePath);
console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Next Whitelist loaded: ${whitelistedUserIds.toString()} user IDs, ${whitelistedIPs.toString()} IPs`);
// 应用文本长度限制中间件到 "/" 和 "/google" 路由
const defaultLengthLimiter = limitRequestBodyLength(15000, '请求文本过长，请缩短后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度', whitelistedUserIds, whitelistedIPs);

// 通知类迁移到 notices
async function notices(data, requestBody, ntfyTopic = 'robot') {

  let pushkey = 'PDU33066TepraNW9hJp3GP5NWPCVgVaGpoxtU3EMa';
  let webhookUrl = process.env.TARGET_SERVER_FEISHU + 'b99372d6-61f8-4fcc-bd6f-01689652fa08' // 默认，可以认为是 robot 通道

  switch (ntfyTopic) {
    case 'gemini':
      pushkey = 'PDU33066TL6i6CtArA8KIH2u7Q9VwYEVCRfQQU9h2';
      webhookUrl = process.env.TARGET_SERVER_FEISHU + 'da771957-c1a4-4a91-88e4-08e6a6dfc73e'
      break;
    case 'chatnio':
      pushkey = 'PDU33066TEFmDgjEuuyFFCpJ8Iq13m0lZaT8eNywx';
      webhookUrl = process.env.TARGET_SERVER_FEISHU + '8097380c-fb36-4af6-8e19-570c75ce84a1'
      break; //** 缺少 break; 这里导致了 chatnio 执行后会继续执行 freelyai 的逻辑！**
    case 'freelyai':
      pushkey = 'PDU33066Te6j12xoa58EHg6MfQoepHcgWhM152xZ1';
      webhookUrl = process.env.TARGET_SERVER_FEISHU + '1a409aca-2336-4bd2-a143-6c1347570388'
      break;
  }

  sendNotification(data, requestBody, pushkey);
  sendLarkNotification(data, requestBody, webhookUrl);
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

        console.log(`请求过于频繁，请在 ${formattedDuration} 后再试。${modelName} 模型在 ${windowMs / 1000} 秒内的最大请求次数为 ${max} 次。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度`)
        return res.status(429).json({
          error: `4294 请求频繁，稍后重试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度`,
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
        error: `4295 请求频繁，稍后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度`
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
                              error: "4291 请求频繁，稍后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度",
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
app.use('/freelyai', freelyaiProxy);

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
      error: '4291 请求频繁，稍后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度',
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
}, chatnioProxy);

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
            error: '4292 请求频繁，稍后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度',
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
                                error: '4293 请求频繁，稍后再试。或者使用 https://chatnio.liujiarong.top 平台解锁更多额度',
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
}, openAIProxy);

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
const PORT = 20491;
app.listen(PORT, () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
});