// middleware/loggingMiddleware.js
const logger = require('../lib/logger');
const { formatToken, isRestrictedModel, findOrCreateUser } = require('../db');

async function prepareLogData(req) {
  const { user, ip, token } = req._logContext; // 使用扩展字段

  return {
    user_id: user,
    ip: ip,
    timestamp: new Date(),
    model: req.body.model,
    token_prefix: token.slice(0, 5),
    token_suffix: token.slice(-3),
    route: req.originalUrl.split('/')[1],
    content: req.body.messages?.slice(-1)[0]?.content || '',
    is_restricted: await isRestrictedModel(req.body.model),
  };
}

module.exports = function (req, res, next) {
  const userId = req.headers['x-user-id'] || req.body.user;
  const userIP = req.headers['x-user-ip'] || req.body.user_ip || req.ip;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1] || '';

  // 判断是否满足记录条件
  if (userId && userIP && token) {
    // 扩展请求对象
    req._logContext = { user: userId, ip: userIP, token };

    prepareLogData(req) // 异步处理
      .then((logData) => {
        findOrCreateUser(logData.user_id).catch(() => {});
        logger.enqueue(logData);
      })
      .catch((err) => {
        console.error('日志预处理失败:', err);
      });
  }

  next();
};