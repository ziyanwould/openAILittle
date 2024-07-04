/**
 * @Author: Liu Jiarong
 * @Date: 2024-06-24 19:48:52
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2024-07-04 12:56:56
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

// Node.js 18 以上版本支持原生的 fetch API
const app = express();

app.use(bodyParser.json({ limit: '100mb' }));

// 定义不同模型的多重限流配置
const modelRateLimits = {
  'gpt-4-turbo': {
    limits: [
      { windowMs: 1 * 60 * 1000, max: 1 }, 
      { windowMs: 3 * 60 * 60 * 1000, max: 10 }, 
    ],
    dailyLimit: 120, // 例如，gpt-4-turbo 每天总限制 500 次
  },
  'gpt-4o': {
    limits: [
      { windowMs: 1 * 60 * 1000, max: 1 }, 
      { windowMs: 3 * 60 * 60 * 1000, max: 15 }, // 每分钟 1 次
    ],
    dailyLimit: 500, // 例如，gpt-4o 每天总限制 300 次
  },
  'claude-3-haiku-20240307': {
    limits: [
      { windowMs: 5 * 60 * 1000, max: 1 }, 
      { windowMs: 7 * 24 * 60 * 60 * 1000, max: 3 }, 
    ],
    dailyLimit: 20, 
  },
  'gemini-1.5-pro-latest': {
    limits: [
      { windowMs: 3 * 1000, max: 1 }, 
      { windowMs: 60 * 1000, max: 4 }, 
      { windowMs: 30 * 60 * 1000, max: 20 }, 
      { windowMs: 3 * 60 * 60 * 1000, max: 100 }
    ],
    dailyLimit: 800, 
  },
  'gemini-1.5-flash-latest': {
    limits: [
      { windowMs: 2.5 * 1000, max: 1 }, 
      { windowMs: 60 * 1000, max: 4 }, 
      { windowMs: 30 * 60 * 1000, max: 25 }, 
      { windowMs: 3 * 60 * 60 * 1000, max: 100 }
    ],
    dailyLimit: 800, 
  },
  'Doubao-pro-4k': {
    limits: [
      { windowMs: 1 * 60 * 1000, max: 4 }, 
      { windowMs: 30 * 60 * 1000, max: 30 }, 
    ],
    dailyLimit: 1500, // Doubao-pro-4k 每天总限制 500 次
  },
  'Doubao-pro-128k': {
    limits: [
      { windowMs: 1 * 60 * 1000, max: 4 }, 
      { windowMs: 30 * 60 * 1000, max: 30 }, 
    ],
    dailyLimit: 1500, // Doubao-pro-4k 每天总限制 500 次
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
    limits: [{ windowMs: 10 * 60 * 1000, max: 5 }],
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
  }
  next();
};

// 飞书通知函数
async function larkTweet(data, requestBody) {
  const webhookUrl = "https://open.feishu.cn/open-apis/bot/v2/hook/b99372d6-61f8-4fcc-bd6f-01689652fa08"; 

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msg_type: "post", 
        content: {
          post: {
            zh_cn: {
              title: "OpenAI 代理服务器转发请求", 
              content: [
                [
                  {
                    "tag": "text",
                    "text": `模型：${data.modelName}`
                  }
                ],
                [
                  {
                    "tag": "text",
                    "text": `IP 地址：${data.ip}`
                  }
                ],
                [
                  {
                    "tag": "text",
                    "text": `用户 ID：${data.userId}`
                  }
                ],
                [
                  {
                    "tag": "text",
                    "text": `时间：${data.time}`
                  }
                ],
                [
                  {
                    "tag": "text",
                    "text": "用户请求内容："
                  }
                ],
                [
                  {
                    "tag": "text",
                    "text": `${requestBody}`
                  }
                ]
              ]
            }
          }
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message to Lark: ${response.status} ${response.statusText}`);
    }

  } catch (error) {
    console.error('Failed to send rate limit notification to Lark:', error);
  }
}

//钉钉
async function sendDingTalkMessage(message) {
  const webhookUrl = "https://oapi.dingtalk.com/robot/send?access_token=b24974e8baeb66e98b0325505e67a239860eade045056d541793e8a7daf3d2c6"; 

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msgtype: "text",
        text: {
          content: 'chatnio：'+message
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message to DingTalk: ${response.status} ${response.statusText}`);
    }

    console.log("Message sent successfully to DingTalk");
  } catch (error) {
    console.error('Failed to send message to DingTalk:', error);
  }
}

// 定义敏感词和黑名单文件路径
const sensitiveWordsFilePath = 'Sensitive.txt'; // 可以是 .txt 或 .json
const blacklistedUserIdsFilePath = 'BlacklistedUsers.txt'; // 可以是 .txt 或 .json

// 初始化敏感词和黑名单
let sensitiveWords = loadWordsFromFile(sensitiveWordsFilePath);
let blacklistedUserIds = loadWordsFromFile(blacklistedUserIdsFilePath);

// 定义配置文件路径
const filterConfigFilePath = 'filterConfig.json'; 

// 初始化过滤配置
let filterConfig = loadFilterConfigFromFile(filterConfigFilePath);

// 每 30 秒同步一次敏感词和黑名单
setInterval(() => {
  sensitiveWords = loadWordsFromFile(sensitiveWordsFilePath);
  blacklistedUserIds = loadWordsFromFile(blacklistedUserIdsFilePath);
  console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Sensitive words and blacklisted user IDs updated.`);
  filterConfig = loadFilterConfigFromFile(filterConfigFilePath);
  console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Filter config updated.`);
}, 60 * 1000);

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
        const ip = req.ip;
        const userAgent = req.headers['user-agent'];
        const userId = req.body.user;
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

        // 发送飞书通知，包含格式化的用户请求内容
        larkTweet({
          modelName,
          ip: req.body.user,
          time: moment().format('YYYY-MM-DD HH:mm:ss'),
          duration: formattedDuration,
          windowMs,
          max
        }, formattedRequestBody);

        console.log(`请求过于频繁，请在 ${formattedDuration} 后再试。${modelName} 模型在 ${windowMs / 1000} 秒内的最大请求次数为 ${max} 次。`)
        return res.status(429).json({
          error: '请求过于频繁，请稍后再试。',
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

      // 发送飞书通知，包含格式化的用户请求内容
      larkTweet({
        modelName,
        ip: req.body.user,
        time: moment().format('YYYY-MM-DD HH:mm:ss'),
        duration: '24 小时', // 每日限制，所以持续时间为 24 小时
        windowMs: 24 * 60 * 60 * 1000, // 24 小时对应的毫秒数
        max: dailyLimit
      }, formattedRequestBody);

      return res.status(400).json({ 
        error: `今天${modelName} 模型总的请求次数已达上限，请明天再试。`
      });
    }

    dailyRequestCounts[key]++;
    next();
  });
}

// 创建代理中间件
const openAIProxy = createProxyMiddleware({
  target: 'http://192.168.31.135:10243', // 替换为你的目标服务器地址
  changeOrigin: true,
  on: {
    proxyReq: fixRequestBody,
  },
});

// 创建 /chatnio 路径的代理中间件
const chatnioProxy = createProxyMiddleware({
  target: 'http://192.168.31.135:10243',
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

          await sendDingTalkMessage(moment().format('YYYY-MM-DD HH:mm:ss')+'：'+formattedRequestBody);
        } catch (error) {
          console.error('Failed to send notification to Lark:', error);
        }
      })();
    },
  },
});

// 中间件函数，用于检查敏感词和黑名单用户
app.use('/', (req, res, next) => {
  const userId = req.body.user;
  const messages = req.body.messages || [];

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

    // 如果已经触发拦截逻辑，则跳出循环
    if (res.headersSent) {
      break;
    }
  }

  next();
});


// 应用 modifyRequestBodyMiddleware 中间件
app.use(modifyRequestBodyMiddleware); 

// 应用 /chatnio 代理中间件
app.use('/chatnio', chatnioProxy);

// 中间件函数，用于限制同一用户短时间内请求多个模型
app.use('/', (req, res, next) => {
  const userId = req.body.user;
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
            error: '请求过于频繁，请稍后再试。',
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

      // ... (使用转换后的 requestContent 字符串进行相似度检测)
      // 从请求内容中移除用于生成标题的部分
      const titlePromptRegExp = /你是一名擅长会话的助理，你需要将用户的会话总结为 10 个字以内的标题/g;
      const contentWithoutTitlePrompt = requestContent.replace(titlePromptRegExp, '').trim();

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
          if (timeDifference <= 5000) {
            console.log(
              `${moment().format('YYYY-MM-DD HH:mm:ss')} 短时间内发送相同内容请求.`
            );
            return res.status(403).json({
              error: '请求过于频繁，请稍后再试。',
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
        const cacheKey = `${filterModelName}-${req.body.user}`;

        // 检查缓存中是否存在相同的请求内容
        if (recentRequestsCache.has(cacheKey)) {
          console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Duplicate request detected and blocked for model: ${filterModelName}, user: ${req.body.user}`);
          return res.status(401).json({
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
        return res.status(401).json({
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
      return res.status(400).json({
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

    // 发送飞书通知，包含格式化的用户请求内容
    if(modelName){
      larkTweet({
        modelName,
        ip: req.ip,
        userId: req.body.user,
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
    if (data.type && data.type.startsWith('image/') && typeof data.data === 'string') {
      return Buffer.from(data.data, 'base64');
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

  // 如果没有匹配到任何语言，则认为不是自然语言
  return false;
}

// 监听端口
const PORT = 20491;
app.listen(PORT, () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
});