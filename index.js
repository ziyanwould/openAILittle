const Koa = require('koa');
const { createProxyMiddleware } = require('http-proxy-middleware');
const k2c = require('koa2-connect');

const app = new Koa();

// 代理目标地址
const targetUrl = 'https://api.liujiarong.top'; 

// 创建代理中间件
const openAIProxy = createProxyMiddleware({
  target: targetUrl,
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`Proxying request to: ${req.method} ${proxyReq.path} from ${req.ip}`);
  },
  onError: (err, req, res) => {
    console.error(`Proxy error from ${req.ip}: ${err}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '代理服务器错误' }));
  }
});

// 使用 koa2-connect 将代理中间件转换为 Koa 中间件
app.use(async (ctx, next) => {
  await k2c(openAIProxy)(ctx, next);
});

// 监听端口
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`代理服务器运行在 http://localhost:${PORT}`);
});