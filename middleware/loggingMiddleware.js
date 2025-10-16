// middleware/loggingMiddleware.js
/**
 * 日志记录中间件
 *
 * 功能:
 * - 提取请求数据
 * - 集成会话管理 (v1.10.0新增)
 * - 将日志数据加入队列
 *
 * 状态: 生产环境使用
 */
const logger = require('../lib/logger');
const { formatToken, isRestrictedModel, findOrCreateUser } = require('../db');
const { pool } = require('../db'); // 引入 pool
const { getOrCreateConversationId } = require('../utils/conversationManager');

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

  // 确定模型名称
  let modelName = req.body.model;

  // 对于 Cloudflare AI 请求，从 URL 路径中提取模型名称
  if (req.originalUrl.includes('/cloudflare/') && !modelName) {
    const urlParts = req.originalUrl.split('/');
    // 查找 @cf/ 开头的模型名称
    const cfModelIndex = urlParts.findIndex(part => part.startsWith('@cf/'));
    if (cfModelIndex !== -1) {
      modelName = urlParts[cfModelIndex];
    }
  }

  // 对于 SiliconFlow AI 请求，确保模型名称被正确提取
  if (req.originalUrl.includes('/siliconflow/')) {
    // SiliconFlow 的模型名称通常直接在请求体的 model 字段中
    // 如果没有 model 字段，尝试从 URL 路径提取
    if (!modelName && req.originalUrl.includes('/v1/images/generations')) {
      modelName = 'image-generation'; // 默认图像生成标识
    }
  }

  // 本地中间层图像/视频生成路由，保持与 SiliconFlow 一致的兜底逻辑
  if (req.originalUrl.includes('/image-middleware/')) {
    if (!modelName && req.originalUrl.includes('/v1/images/generations')) {
      modelName = 'image-generation';
    }
  }

  // 构建基础日志数据
  const baseLogData = {
    user_id: isTimestamp(userId) ? 'anonymous' : userId,
    ip:  req.headers['x-user-ip'] || req.body.user_ip || req.ip,
    timestamp: new Date(),
    model: modelName || 'unknown',
    token_prefix: prefix,
    token_suffix: suffix,
    route: req.originalUrl.split('/')[1],
    content,
    is_restricted: await isRestrictedModel(modelName),
    messages: req.body.messages || req.body.contents || (req.body.prompt ? [{ role: 'user', content: req.body.prompt }] : []), // 完整的消息
  };

  // 🆕 v1.10.0: 获取或创建会话ID
  try {
    const { conversationId, isNew } = await getOrCreateConversationId(req, baseLogData);

    return {
      ...baseLogData,
      conversation_id: conversationId,
      is_new_conversation: isNew
    };
  } catch (error) {
    // 降级处理: 如果会话管理失败,仍然记录日志但不包含会话信息
    console.error('[LoggingMiddleware] 获取会话ID失败:', error.message);
    return {
      ...baseLogData,
      conversation_id: null,
      is_new_conversation: false
    };
  }
}

// 判断是否为时间戳 (已存在，无需修改)
function isTimestamp(str) {
    return /^\d+$/.test(str) && str.length >= 10 && str.length <= 13;
}

module.exports = async function (req, res, next) {
  const userId = req.headers['x-user-id'] || req.body.user;
  const userIP = req.headers['x-user-ip'] || req.body.user_ip || req.ip;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1] || '';

  // 判断是否满足记录条件
  if (userId && userIP && token) {
    // 扩展请求对象
    req._logContext = { user: userId, ip: userIP, token };

    try {
      // 🆕 v1.10.0修复: 同步获取 conversation_id 并传递给后续中间件
      const logData = await prepareLogData(req);

      // 🔑 关键修复: 将会话ID附加到req对象，供 responseInterceptorMiddleware 使用
      req._conversationId = logData.conversation_id;
      req._isNewConversation = logData.is_new_conversation;

      // 异步写入数据库（不阻塞后续流程）
      findOrCreateUser(logData.user_id)
        .then(() => logger.enqueue(logData))
        .catch((err) => console.error('[LoggingMiddleware] 日志入库失败:', err));
    } catch (err) {
      console.error('[LoggingMiddleware] 日志预处理失败:', err);
      // 即使失败也继续处理请求
    }
  }

  next();
};
