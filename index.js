/**
 * @Author: Liu Jiarong
 * @Date: 2024-06-24 19:48:52
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2024-06-24 22:59:25
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

const app = express();

app.use(bodyParser.json({ limit: '30mb' }));

// 定义不同模型的多重限流配置
const modelRateLimits = {
  'gpt-4-turbo': {
    limits: [
      { windowMs: 3 * 60 * 60 * 1000, max: 10 }, 
    ],
    dailyLimit: 500, // 例如，gpt-4-turbo 每天总限制 500 次
  },
  'gpt-4o': {
    limits: [
      { windowMs: 60 * 1000, max: 1 }, // 每分钟 1 次
      { windowMs: 24 * 60 * 60 * 1000, max: 200 }, // 每天 200 次
    ],
    dailyLimit: 300, // 例如，gpt-4o 每天总限制 300 次
  },
  'claude-3-haiku-20240307': {
    limits: [
      { windowMs: 7 * 24 * 60 * 60 * 1000, max: 1 }, 
    ],
    dailyLimit: 100, 
  },
  'claude-2.1': {
    limits: [
      { windowMs: 1 * 24 * 60 * 60 * 1000, max: 2 }, 
    ],
    dailyLimit: 50, 
  },
  'gemini-1.5-pro-latest': {
    limits: [
      { windowMs: 30 * 60 * 1000, max: 30 }, 
    ],
    dailyLimit: 200, 
  },
  'gemini-1.5-flash-latest': {
    limits: [
      { windowMs: 30 * 60 * 1000, max: 30 }, 
    ],
    dailyLimit: 200, 
  },
  'Doubao-pro-4k': {
    limits: [
      { windowMs: 1 * 60 * 1000, max: 6 }, 
      { windowMs: 2 * 60 * 1000, max: 10 }, 
    ],
    dailyLimit: 15, // Doubao-pro-4k 每天总限制 500 次
  },
  'Doubao-lite-4k': {
    limits: [
      { windowMs: 1 * 60 * 1000, max: 5 }, 
      { windowMs: 3 * 60 * 1000, max: 8 }, 
    ],
    dailyLimit: 17, // Doubao-pro-4k 每天总限制 500 次
  },
};

// 创建一个对象来存储每个模型每天的请求计数
const dailyRequestCounts = {};

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
        console.log(`Request for model ${modelName} from ${req.ip} has been rate limited.`);

        const duration = moment.duration(windowMs);
        const formattedDuration = [
          duration.days() > 0 ? `${duration.days()} 天` : '',
          duration.hours() > 0 ? `${duration.hours()} 小时` : '',
          duration.minutes() > 0 ? `${duration.minutes()} 分钟` : '',
          duration.seconds() > 0 ? `${duration.seconds()} 秒` : '',
        ].filter(Boolean).join(' '); 

        res.status(400).json({
          error: `请求过于频繁，请在 ${formattedDuration} 后再试。${modelName} 模型在 ${windowMs / 1000} 秒内的最大请求次数为 ${max} 次。如需更多需求，请访问 https://chatnio.liujiarong.top`
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
      return res.status(400).json({ // 添加 return 语句
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

// 中间件函数，根据请求参数应用不同的限流策略
app.use('/', (req, res, next) => {
  let modelName = null;
  console.log('user',req.body.user)

  if (req.body && req.body.model) {
    modelName = req.body.model;
  }

  // 获取该模型的所有限流中间件
  const rateLimitersForModel = rateLimiters[modelName];

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
    console.log(`No rate limiter for model: ${modelName || 'unknown'}`);
    next();
  }
}, openAIProxy);

// 监听端口
const PORT = 20491;
app.listen(PORT, () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
});