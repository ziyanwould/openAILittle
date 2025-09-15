// middleware/responseInterceptorMiddleware.js
const { pool } = require('../db');

// 响应数据缓存，用于存储对话数据
const responseCache = new Map();

// 清理过期缓存（防止内存泄漏）
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of responseCache.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) { // 5分钟过期
      responseCache.delete(key);
    }
  }
}, 60 * 1000); // 每分钟清理一次

/**
 * 生成请求唯一标识符
 */
function generateRequestKey(req) {
  const userId = req.headers['x-user-id'] || req.body.user || 'anonymous';
  const timestamp = Date.now();
  const userContent = extractUserMessage(req.body);

  // 使用用户ID、时间戳和用户消息的哈希作为唯一键
  const crypto = require('crypto');
  const hash = crypto.createHash('md5')
    .update(userId + timestamp + userContent)
    .digest('hex')
    .substring(0, 8);

  return `${userId}_${hash}`;
}

/**
 * 提取用户消息内容
 */
function extractUserMessage(body) {
  let userMessage = '';

  if (body.messages && Array.isArray(body.messages)) {
    // OpenAI 格式
    const lastMessage = body.messages[body.messages.length - 1];
    if (lastMessage && lastMessage.role === 'user') {
      if (typeof lastMessage.content === 'string') {
        userMessage = lastMessage.content;
      } else if (Array.isArray(lastMessage.content)) {
        userMessage = lastMessage.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join(' ');
      }
    }
  } else if (body.contents && Array.isArray(body.contents)) {
    // Gemini 格式
    const lastContent = body.contents[body.contents.length - 1];
    if (lastContent && lastContent.role === 'user' && lastContent.parts) {
      userMessage = lastContent.parts
        .filter(part => part.text)
        .map(part => part.text)
        .join(' ');
    }
  }

  return userMessage;
}

/**
 * 解析AI响应内容
 */
function parseAIResponse(data, route) {
  try {
    // 处理流式响应
    if (data.includes('data: ') && data.includes('\n')) {
      const lines = data.split('\n').filter(line => line.trim());
      let fullContent = '';

      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const jsonStr = line.substring(6); // 去除 'data: ' 前缀
            const chunk = JSON.parse(jsonStr);

            if (route.startsWith('/google') || route.startsWith('/freegemini')) {
              // Gemini 流式格式
              if (chunk.candidates && chunk.candidates[0] && chunk.candidates[0].content) {
                const parts = chunk.candidates[0].content.parts;
                if (parts && parts[0] && parts[0].text) {
                  fullContent += parts[0].text;
                }
              }
            } else {
              // OpenAI 流式格式
              if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
                const delta = chunk.choices[0].delta;
                if (delta.content) {
                  fullContent += delta.content;
                }
              }
            }
          } catch (e) {
            // 忽略解析错误的行
          }
        }
      }

      return fullContent.trim();
    } else {
      // 处理非流式响应
      const response = JSON.parse(data);

      if (route.startsWith('/google') || route.startsWith('/freegemini')) {
        // Gemini 非流式格式
        if (response.candidates && response.candidates[0] && response.candidates[0].content) {
          const parts = response.candidates[0].content.parts;
          if (parts && parts[0] && parts[0].text) {
            return parts[0].text;
          }
        }
      } else {
        // OpenAI 非流式格式
        if (response.choices && response.choices[0] && response.choices[0].message) {
          return response.choices[0].message.content || '';
        }
      }
    }
  } catch (error) {
    console.error('解析AI响应失败:', error);
  }

  return '';
}

/**
 * 更新数据库中的对话记录，添加AI回答
 */
async function updateConversationWithResponse(requestKey, aiResponse) {
  const cacheData = responseCache.get(requestKey);
  if (!cacheData) {
    console.log(`未找到请求缓存: ${requestKey}`);
    return;
  }

  try {
    // 构建完整的对话记录
    const fullConversation = [...cacheData.messages];

    // 添加AI的回答
    if (aiResponse && aiResponse.trim()) {
      const aiMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: aiResponse }]
      };
      fullConversation.push(aiMessage);
    }

    // 查询最新的与该请求相关的conversation_logs记录
    const [rows] = await pool.query(
      `SELECT cl.conversation_id FROM conversation_logs cl
       JOIN requests r ON cl.request_id = r.id
       WHERE r.user_id = ? AND r.timestamp >= ?
       ORDER BY cl.conversation_id DESC LIMIT 1`,
      [cacheData.userId, new Date(cacheData.timestamp - 10000)] // 允许10秒误差
    );

    if (rows.length > 0) {
      const conversationId = rows[0].conversation_id;

      // 更新conversation_logs记录，添加AI回答
      await pool.query(
        'UPDATE conversation_logs SET messages = ? WHERE conversation_id = ?',
        [JSON.stringify(fullConversation), conversationId]
      );

      console.log(`✓ 已更新对话记录 ID:${conversationId}，添加AI回答 (${aiResponse.length}字符)`);
    } else {
      console.log(`未找到匹配的对话记录: ${requestKey}`);
    }

    // 清理缓存
    responseCache.delete(requestKey);
  } catch (error) {
    console.error('更新对话记录失败:', error);
  }
}

/**
 * 响应拦截中间件
 */
module.exports = function responseInterceptorMiddleware(req, res, next) {
  // 只处理POST请求到AI接口
  if (req.method !== 'POST') {
    return next();
  }

  const route = req.originalUrl || req.url;
  const isAIRequest = route.startsWith('/v1/') ||
                      route.startsWith('/google/') ||
                      route.startsWith('/chatnio/') ||
                      route.startsWith('/freelyai/') ||
                      route.startsWith('/freeopenai/') ||
                      route.startsWith('/freegemini/');

  if (!isAIRequest) {
    return next();
  }

  // 生成请求键并缓存请求数据
  const requestKey = generateRequestKey(req);
  const userId = req.headers['x-user-id'] || req.body.user || 'anonymous';

  responseCache.set(requestKey, {
    userId,
    messages: req.body.messages || req.body.contents || [],
    timestamp: Date.now(),
    route
  });

  // 拦截响应
  const originalWrite = res.write;
  const originalEnd = res.end;
  let responseData = '';

  res.write = function(data, encoding) {
    if (data) {
      responseData += data.toString();
    }
    return originalWrite.call(this, data, encoding);
  };

  res.end = function(data, encoding) {
    if (data) {
      responseData += data.toString();
    }

    // 解析AI响应并更新数据库
    if (responseData && res.statusCode === 200) {
      const aiResponse = parseAIResponse(responseData, route);
      if (aiResponse) {
        // 异步更新数据库，不阻塞响应
        setImmediate(() => {
          updateConversationWithResponse(requestKey, aiResponse);
        });
      }
    } else {
      // 请求失败时清理缓存
      responseCache.delete(requestKey);
    }

    return originalEnd.call(this, data, encoding);
  };

  next();
};