/**
 * @Author: Liu Jiarong
 * @Date: 2024-06-24 19:48:52
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2024-06-27 20:42:46
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

// Node.js 18 以上版本支持原生的 fetch API
const app = express();

app.use(bodyParser.json({ limit: '30mb' }));

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
      { windowMs: 2 * 1000, max: 1 }, 
      { windowMs: 60 * 1000, max: 4 }, 
      { windowMs: 30 * 60 * 1000, max: 20 }, 
      { windowMs: 3 * 60 * 60 * 1000, max: 100 }
    ],
    dailyLimit: 800, 
  },
  'gemini-1.5-flash-latest': {
    limits: [
      { windowMs: 2 * 1000, max: 1 }, 
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
  target: 'https://api.liujiarong.top', // 替换为你的目标服务器地址
  changeOrigin: true,
  on: {
    proxyReq: fixRequestBody,
  },
});

// 创建 /chatnio 路径的代理中间件
const chatnioProxy = createProxyMiddleware({
  target: 'https://api.liujiarong.top',
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
            )} User ${userId} requested more than 2 models within 1.5 second.`
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
  const requestContent = req.body.messages && req.body.messages[0] && req.body.messages[0].content;

  if (requestContent) {
    // 使用 SHA-256 生成更独特的哈希值
    const requestContentHash = crypto.createHash('sha256').update(requestContent).digest('hex');

    const currentTime = Date.now();

    if (recentRequestContentHashes.has(requestContentHash)) {
      const lastRequestTime = recentRequestContentHashes.get(requestContentHash);
      const timeDifference = currentTime - lastRequestTime;

      if (timeDifference <= 3000) {
        // 3 秒内出现相同请求内容
        console.log(
          `${moment().format(
            'YYYY-MM-DD HH:mm:ss'
          )} Similar request detected and blocked.`
        );
        return res.status(429).json({
          error: '请求过于频繁，请稍后再试。',
        });
      }
    }

    // 更新缓存
    recentRequestContentHashes.set(requestContentHash, currentTime);

    // 定期清理缓存，例如每分钟清理一次
    setInterval(() => {
      recentRequestContentHashes.clear();
    }, 60 * 1000);
  }

  next();
});

// 中间件函数，根据请求参数应用不同的限流策略和过滤重复请求
app.use('/', (req, res, next) => {
  let modelName = null;

  if (req.body && req.body.model) {
    modelName = req.body.model;
  }

  // 获取该模型的所有限流中间件
  const rateLimitersForModel = rateLimiters[modelName];

  // 格式化用户请求内容
  const formattedRequestBody = JSON.stringify(req.body, null, 2);

  // 发送飞书通知，包含格式化的用户请求内容
  larkTweet({
    modelName,
    ip: req.body.user,
    time: moment().format('YYYY-MM-DD HH:mm:ss'),
  }, formattedRequestBody);

  // 检查是否为 gemini-1.5-pro-latest 模型的请求
  if (modelName === 'gemini-1.5-pro-latest') {
    const requestContent = req.body.messages && req.body.messages[0] && req.body.messages[0].content;

    // 检查请求内容是否包含特定字符串
    if (requestContent && requestContent.includes('Переведи гороскоп на русский')) {
      // 生成缓存键，可以使用用户 ID 或 IP 地址
      const cacheKey = `${modelName}-${req.body.user}`;

      // 检查缓存中是否存在相同的请求内容
      if (recentRequestsCache.has(cacheKey)) {
        console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')} Duplicate request detected and blocked for model: ${modelName}, user: ${req.body.user}`);
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
    console.log(`${moment().format('YYYY-MM-DD HH:mm:ss')}  No rate limiter for model: ${modelName || 'unknown'}`);
    next();
  }
}, openAIProxy);

// 监听端口
const PORT = 20491;
app.listen(PORT, () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
});