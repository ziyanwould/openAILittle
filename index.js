/**
 * @Author: Liu Jiarong
 * @Date: 2024-06-24 19:48:52
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2024-06-24 20:59:21
 * @FilePath: /openAILittle/index.js
 * @Description: 
 * @
 * @Copyright (c) 2024 by ${git_name_email}, All Rights Reserved. 
 */

const express = require('express');
const { createProxyMiddleware, fixRequestBody} = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');

const app = express();

// 使用body-parser中间件来解析POST请求的参数
app.use(bodyParser.json());
// 限流配置
const rateLimitConfig = {
  windowMs: 60 * 1000, // 1 分钟时间窗口
  max: 2, // 允许 2 次请求
  keyGenerator: (req) => {
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    const forwardedFor = req.headers['x-forwarded-for'];
    const key = `${ip}-${userAgent}-${forwardedFor}`;
    console.log(`Rate limiting key: ${key}`);
    return key;
  },
  handler: (req, res) => {
    console.log(`Request from ${req.ip} has been rate limited.`);
    res.status(400).json({ error: '请求过于频繁，请稍后再试' });
  },
};

// 创建限流中间件实例
const rateLimiter = rateLimit(rateLimitConfig);

// 创建代理中间件
const openAIProxy = createProxyMiddleware({
  target: 'https://api.liujiarong.top',
  changeOrigin: true,
  on: {
    proxyReq: fixRequestBody,
  },
});

// 对 /v1/chat/completions 路径应用限流中间件
app.use('/', (req, res, next) => {
  console.log('Before rate limiter:', req.method, req.url); // 限流前打印日志
  rateLimiter(req, res, () => {
    console.log('After rate limiter:', req.method, req.url); // 限流后打印日志
    next();
  });
}, openAIProxy);



// 监听端口
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
});
