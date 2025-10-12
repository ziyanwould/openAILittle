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
 * 判断是否为时间戳格式的userId
 */
function isTimestamp(str) {
  return /^\d+$/.test(str) && str.length >= 10 && str.length <= 13;
}

/**
 * 标准化userId (与loggingMiddleware保持一致)
 */
function normalizeUserId(userId) {
  return isTimestamp(userId) ? 'anonymous' : userId;
}

/**
 * 生成请求唯一标识符
 */
function generateRequestKey(req) {
  const rawUserId = req.headers['x-user-id'] || req.body.user || 'anonymous';
  const userId = normalizeUserId(rawUserId);
  const userContent = extractUserMessage(req.body);

  // 对于匿名用户,使用IP地址作为标识的一部分
  const userIp = req.headers['x-user-ip'] || req.body.user_ip || req.ip;

  // 使用用户ID/IP和用户消息的哈希作为唯一键
  const crypto = require('crypto');
  const hash = crypto.createHash('md5')
    .update(userId + userIp + userContent)
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
  } else if (body.prompt) {
    // Cloudflare AI 格式 (文生图等)
    userMessage = body.prompt;
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
            } else if (route.startsWith('/cloudflare')) {
              // Cloudflare AI 流式格式处理 (如果有的话)
              // Cloudflare AI 图像生成通常不是流式的，但保留扩展性
              if (chunk.result && chunk.result.image) {
                fullContent = '[Generated Image]';
              } else if (chunk.content) {
                fullContent += chunk.content;
              }
            } else if (route.startsWith('/siliconflow')) {
              // SiliconFlow AI 流式格式处理 (如果有的话)
              // SiliconFlow 图像生成通常不是流式的，但保留扩展性
              if (chunk.images && chunk.images.length > 0) {
                fullContent = '[Generated Image]';
              } else if (chunk.data && chunk.data.length > 0) {
                fullContent = '[Generated Images: ' + chunk.data.length + ' items]';
              } else if (chunk.content) {
                fullContent += chunk.content;
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
      // 检查是否是二进制数据（图片等）
      if (data.startsWith('\uFFFD') || data.includes('JFIF') || data.includes('PNG')) {
        // 这是二进制图片数据，不是JSON
        return '[Generated Image: Binary data]';
      }

      let response;
      try {
        response = JSON.parse(data);
      } catch (error) {
        // 如果JSON解析失败，可能是二进制数据或其他格式
        console.log(`[ResponseInterceptor] Non-JSON response detected for route: ${route}`);
        return '[Generated Content: Non-JSON response]';
      }

      if (route.startsWith('/google') || route.startsWith('/freegemini')) {
        // Gemini 非流式格式
        if (response.candidates && response.candidates[0] && response.candidates[0].content) {
          const parts = response.candidates[0].content.parts;
          if (parts && parts[0] && parts[0].text) {
            return parts[0].text;
          }
        }
      } else if (route.startsWith('/cloudflare')) {
        // Cloudflare AI 非流式格式
        if (response.success && response.result) {
          if (response.result.image) {
            // 图像生成结果
            return '[Generated Image: Base64 data]';
          } else if (response.result.text) {
            // 文本生成结果
            return response.result.text;
          } else if (typeof response.result === 'string') {
            return response.result;
          }
        }
      } else if (route.startsWith('/siliconflow')) {
        // SiliconFlow AI 非流式格式
        if (response.images && response.images.length > 0) {
          // 图像生成结果（SiliconFlow格式）
          return `[Generated Images: ${response.images.length} items]`;
        } else if (response.data && response.data.length > 0) {
          // 图像生成结果（备用格式）
          return `[Generated Images: ${response.data.length} items]`;
        } else if (response.choices && response.choices[0] && response.choices[0].message) {
          // 文本生成结果（如果SiliconFlow也支持文本生成）
          return response.choices[0].message.content || '';
        } else if (response.text) {
          // 直接文本结果
          return response.text;
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
    console.log(`[ResponseInterceptor] 未找到请求缓存: ${requestKey}`);
    return;
  }

  try {
    // 构建完整的对话记录
    const fullConversation = [...cacheData.messages];

    // 添加AI的回答
    if (aiResponse && aiResponse.trim()) {
      const aiMessage = {
        role: 'assistant',
        content: aiResponse
      };
      fullConversation.push(aiMessage);
    }

    // 方案1: 通过user_id和时间范围查询(主要方案)
    let [rows] = await pool.query(
      `SELECT cl.conversation_id, cl.request_id FROM conversation_logs cl
       JOIN requests r ON cl.request_id = r.id
       WHERE r.user_id = ? AND r.timestamp >= ? AND r.timestamp <= ?
       ORDER BY cl.conversation_id DESC LIMIT 1`,
      [
        cacheData.userId,
        new Date(cacheData.timestamp - 10000),  // 请求前10秒
        new Date(cacheData.timestamp + 10000)   // 请求后10秒
      ]
    );

    // 方案2: 备份方案 - 如果主方案失败,通过IP和时间范围查询(适用于匿名用户)
    if (rows.length === 0 && cacheData.userIp) {
      console.log(`[ResponseInterceptor] 主查询失败,尝试通过IP查询: ${cacheData.userIp}`);
      [rows] = await pool.query(
        `SELECT cl.conversation_id, cl.request_id FROM conversation_logs cl
         JOIN requests r ON cl.request_id = r.id
         WHERE r.ip = ? AND r.timestamp >= ? AND r.timestamp <= ?
         ORDER BY cl.conversation_id DESC LIMIT 1`,
        [
          cacheData.userIp,
          new Date(cacheData.timestamp - 10000),  // 请求前10秒
          new Date(cacheData.timestamp + 10000)   // 请求后10秒
        ]
      );
    }

    // 方案3: 终极兜底 - 如果前两个方案都失败,直接查询该用户最新的记录(不考虑时间)
    if (rows.length === 0 && cacheData.userId !== 'anonymous') {
      console.log(`[ResponseInterceptor] IP查询也失败,使用终极兜底查询: user=${cacheData.userId}`);
      [rows] = await pool.query(
        `SELECT cl.conversation_id, cl.request_id, r.timestamp FROM conversation_logs cl
         JOIN requests r ON cl.request_id = r.id
         WHERE r.user_id = ?
         ORDER BY cl.conversation_id DESC LIMIT 1`,
        [cacheData.userId]
      );

      // 如果找到记录,检查时间差是否合理(不超过1分钟)
      if (rows.length > 0) {
        const timeDiff = Math.abs(new Date(rows[0].timestamp) - cacheData.timestamp);
        if (timeDiff > 60000) { // 超过1分钟
          console.log(`[ResponseInterceptor] ⚠️  终极兜底找到记录但时间差过大: ${Math.round(timeDiff/1000)}秒,放弃更新`);
          rows = []; // 清空结果,放弃更新
        }
      }
    }

    if (rows.length > 0) {
      const conversationId = rows[0].conversation_id;
      const requestId = rows[0].request_id;

      // 更新conversation_logs记录，添加AI回答
      await pool.query(
        'UPDATE conversation_logs SET messages = ? WHERE conversation_id = ?',
        [JSON.stringify(fullConversation), conversationId]
      );

      console.log(`[ResponseInterceptor] ✓ 已更新对话记录 ID:${conversationId} (request:${requestId}), AI回答: ${aiResponse.length}字符`);
    } else {
      console.log(`[ResponseInterceptor] ⚠️  未找到匹配的对话记录: ${requestKey} (user:${cacheData.userId}, ip:${cacheData.userIp})`);
    }

    // 清理缓存
    responseCache.delete(requestKey);
  } catch (error) {
    console.error('[ResponseInterceptor] 更新对话记录失败:', error);
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
                      route.startsWith('/freegemini/') ||
                      route.startsWith('/cloudflare/') ||
                      route.startsWith('/siliconflow/');

  if (!isAIRequest) {
    return next();
  }

  // 生成请求键并缓存请求数据
  const requestKey = generateRequestKey(req);
  const rawUserId = req.headers['x-user-id'] || req.body.user || 'anonymous';
  const userId = normalizeUserId(rawUserId);
  const userIp = req.headers['x-user-ip'] || req.body.user_ip || req.ip;

  const cacheData = {
    userId,
    userIp,
    messages: req.body.messages || req.body.contents || (req.body.prompt ? [{ role: 'user', content: req.body.prompt }] : []),
    timestamp: Date.now(),
    route
  };

  responseCache.set(requestKey, cacheData);
  console.log(`[ResponseInterceptor] 📝 缓存请求: key=${requestKey}, user=${userId}, ip=${userIp}, messages=${cacheData.messages.length}`);

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
        console.log(`[ResponseInterceptor] 🤖 解析AI响应: key=${requestKey}, 长度=${aiResponse.length}字符`);
        // 异步更新数据库，不阻塞响应
        setImmediate(() => {
          updateConversationWithResponse(requestKey, aiResponse);
        });
      } else {
        console.log(`[ResponseInterceptor] ⚠️  无法解析AI响应: key=${requestKey}, route=${route}, status=${res.statusCode}`);
      }
    } else {
      console.log(`[ResponseInterceptor] ❌ 请求失败: key=${requestKey}, status=${res.statusCode}`);
      // 请求失败时清理缓存
      responseCache.delete(requestKey);
    }

    return originalEnd.call(this, data, encoding);
  };

  next();
};