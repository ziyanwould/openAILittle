const Koa = require('koa');
const { createProxyMiddleware } = require('http-proxy-middleware');
const k2c = require('koa2-connect');
const rateLimit = require('koa-ratelimit');

const app = new Koa();

// 日志中间件，打印请求信息
app.use(async (ctx, next) => {
  console.log(`[Request] ${ctx.method} ${ctx.url} from ${ctx.ip}`);
  await next();
  console.log(`[Response] ${ctx.method} ${ctx.url} - Status: ${ctx.status}`);
});

// 限流配置
const rateLimitConfig = {
  driver: 'memory',
  db: new Map(),
  duration: 60000, // 限流时间窗口为 1 分钟
  id: (ctx) => ctx.ip,
  errorMessage: '今天 API 访问次数已经达到上限，请稍后再试',
  max: 2, // 每个 IP 地址在限流时间窗口内最多允许发起 2 个请求
  headers: {
    remaining: 'Rate-Limit-Remaining',
    reset: 'Rate-Limit-Reset',
    total: 'Rate-Limit-Total'
  },
  disableHeader: false,
  whitelist: (ctx) => { 
    console.log('ctx', ctx)
    /* 白名单逻辑 */ 
  },
  blacklist: (ctx) => { 
    console.log('ctx_reeor', ctx)
    
    /* 黑名单逻辑 */ 
  }
};

// 创建限流中间件
const limiter = rateLimit(rateLimitConfig);

// 代理目标地址
const targetUrl = 'https://api.liujiarong.top';

// 创建代理中间件
const openAIProxy = createProxyMiddleware({
  target: targetUrl,
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[Proxy] 转发请求：${req.method} ${proxyReq.path} from ${req.ip}`);
    console.log(`[Proxy] 请求头：${JSON.stringify(req.headers)}`);
    // 打印请求体，需要根据实际情况处理
    // if (req.body) {
    //   console.log(`[Proxy] 请求体：${JSON.stringify(req.body)}`);
    // }
  },
  onError: (err, req, res) => {
    console.error(`[Proxy Error] 代理错误 from ${req.ip}: ${err}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '代理服务器错误' }));
  }
});

// 使用限流中间件
app.use(limiter);

// 使用 koa2-connect 将代理中间件转换为 Koa 中间件
app.use(async (ctx, next) => {
  await k2c(openAIProxy)(ctx, next);
});

// 监听端口
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
});