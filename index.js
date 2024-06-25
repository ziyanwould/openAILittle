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
  'gpt-4-turbo': [
    { windowMs: 3 * 60 * 60 * 1000, max: 10 }, 
  ],
  'gpt-4o': [
    { windowMs: 60 * 1000, max: 1 }, // 每分钟 1 次
    { windowMs: 24 * 60 * 60 * 1000, max: 200 }, // 每天 200 次
  ],
  'claude-3-haiku-20240307': [
    { windowMs: 7 * 24 * 60 * 60 * 1000, max: 1 }, 
  ],
  'claude-2.1': [
    { windowMs: 1 * 24 * 60 * 60 * 1000, max: 2 }, 
  ],
  'gemini-1.5-pro-latest': [
    { windowMs: 30 * 60 * 1000, max: 30 }, 
  ],
  'gemini-1.5-flash-latest': [
    { windowMs: 30 * 60 * 1000, max: 30 }, 
  ],
  'Doubao-pro-4k': [
    { windowMs: 1 * 60 * 1000, max: 10 }, 
    { windowMs: 60 * 60 * 1000, max: 15 }, 
  ],
};

// 创建限流中间件实例，并存储在对象中
const rateLimiters = {};
for (const modelName in modelRateLimits) {
  rateLimiters[modelName] = modelRateLimits[modelName].map(({ windowMs, max }) => {
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
        next(err); 
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