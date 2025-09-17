// middleware/loggingMiddleware.js
const logger = require('../lib/logger');
const { formatToken, isRestrictedModel, findOrCreateUser } = require('../db');
const { pool } = require('../db'); // 引入 pool

async function prepareLogData(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1] || '';
  const userId = req.headers['x-user-id'] || req.body.user || 'anonymous';
  const { prefix, suffix } = await formatToken(token);

  let content = '';
  if (req.body.messages) {
      // OpenAI 格式
      content = req.body.messages.slice(-1)[0]?.content || '';
      // 处理 content 为数组的情况（图片）
      if (Array.isArray(content)) {
          content = content.map(item => {
              if (item.type === 'text') {
                  return item.text;
              } else if (item.type === 'image_url') {
                  return item.image_url.url;  // 只记录图片的 URL
              }
              return ''; // 其他类型，返回空字符串
          }).join('; '); // 用分号和空格连接
      }
  } else if (req.body.contents) {
      // Gemini 格式
      const lastContentItem = req.body.contents[req.body.contents.length - 1];
      if (lastContentItem && lastContentItem.role === 'user' && lastContentItem.parts && Array.isArray(lastContentItem.parts)) {
          content = lastContentItem.parts.map(part => {
              if (part.text) {
                  return part.text;
              } else if (part.inlineData) {
                  // 处理 Gemini 图片
                  return `[Image: ${part.inlineData.mimeType}]`; // 或者你可以保存 base64 数据，但建议只保存描述
              }
              return '';
          }).join('; '); // 用分号和空格连接
      }
  } else if (req.body.prompt) {
      // Cloudflare AI 格式 (文生图等)
      content = req.body.prompt;
  }

  return {
    user_id: isTimestamp(userId) ? 'anonymous' : userId,
    ip:  req.headers['x-user-ip'] || req.body.user_ip || req.ip,
    timestamp: new Date(),
    model: req.body.model,
    token_prefix: prefix,
    token_suffix: suffix,
    route: req.originalUrl.split('/')[1],
    content,
    is_restricted: await isRestrictedModel(req.body.model),
    messages: req.body.messages || req.body.contents || (req.body.prompt ? [{ role: 'user', content: req.body.prompt }] : []), // 完整的消息
  };
}

// 判断是否为时间戳 (已存在，无需修改)
function isTimestamp(str) {
    return /^\d+$/.test(str) && str.length >= 10 && str.length <= 13;
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
      .then(async (logData) => {
        //   try{
            await findOrCreateUser(logData.user_id);
            logger.enqueue(logData); //仍然使用lib/logger.js
      })
      .catch((err) => {
        console.error('日志预处理失败:', err);
      });
  }

  next();
};