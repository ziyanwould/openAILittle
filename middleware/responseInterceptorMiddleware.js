// middleware/responseInterceptorMiddleware.js
/**
 * 响应拦截中间件
 *
 * 功能:
 * - 拦截AI响应内容
 * - 解析不同格式的AI回复 (OpenAI/Gemini/Cloudflare/SiliconFlow)
 * - 更新 conversation_logs 添加AI回答
 * - v1.10.0优化: 使用 conversation_id 直接定位,简化查询逻辑
 *
 * 状态: 生产环境使用
 */
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
 * 生成请求唯一标识符 (v1.10.0优化: 优先使用 conversation_id)
 */
function generateRequestKey(req) {
  // 🆕 v1.10.0修复: 优先级1 - 从前置中间件获取 (loggingMiddleware传递)
  const conversationId = req._conversationId
    || req.headers['x-conversation-id']  // 优先级2 - 前端传递header
    || req.body.conversation_id;         // 优先级3 - 前端传递body

  if (conversationId) {
    return conversationId;
  }

  // 兜底: 使用旧的哈希方案
  const rawUserId = req.headers['x-user-id'] || req.body.user || 'anonymous';
  const userId = normalizeUserId(rawUserId);
  const userContent = extractUserMessage(req.body);
  const userIp = req.headers['x-user-ip'] || req.body.user_ip || req.ip;

  const crypto = require('crypto');
  const hash = crypto.createHash('md5')
    .update(userId + userIp + userContent + Date.now())
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

function normalizeGeneratedImages(items = []) {
  if (!Array.isArray(items)) {
    items = [items];
  }

  return items
    .map((item, index) => {
      if (!item) {
        return null;
      }

      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (!trimmed) {
          return null;
        }
        if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
          return { url: trimmed, index };
        }
        return { url: `data:image/png;base64,${trimmed}`, index, mime: 'image/png' };
      }

      if (item.url) {
        return { url: item.url, index, mime: item.mime_type || item.mime || null };
      }

      if (item.image_url) {
        if (typeof item.image_url === 'string') {
          return { url: item.image_url, index, mime: item.mime_type || null };
        }

        if (item.image_url.url) {
          return {
            url: item.image_url.url,
            index,
            mime: item.image_url.mime_type || item.image_url.mime || null
          };
        }
      }

      const base64 = item.b64_json || item.base64 || item.image_base64;
      if (base64) {
        const mime = item.mime_type || item.mime || 'image/png';
        return { url: `data:${mime};base64,${base64}`, index, mime };
      }

      if (item.data) {
        if (typeof item.data === 'string') {
          return { url: item.data, index };
        }

        if (item.data.url) {
          return { url: item.data.url, index };
        }

        if (item.data.b64_json) {
          const mime = item.data.mime_type || 'image/png';
          return { url: `data:${mime};base64,${item.data.b64_json}`, index, mime };
        }
      }

      return null;
    })
    .filter(Boolean);
}

/**
 * 解析AI响应内容
 */
function parseAIResponse(data, route) {
  try {
    const isStreamPayload = data.includes('data: ') && data.includes('\n');

    if (isStreamPayload) {
      const lines = data.split('\n').filter(line => line.trim());
      const textSegments = [];
      const imageSegments = [];

      for (const line of lines) {
        if (!line.startsWith('data: ') || line.includes('[DONE]')) {
          continue;
        }

        try {
          const chunk = JSON.parse(line.substring(6));

          if (route.startsWith('/google') || route.startsWith('/freegemini')) {
            const candidate = chunk.candidates && chunk.candidates[0];
            const parts = candidate && candidate.content && candidate.content.parts;
            if (parts && parts[0] && parts[0].text) {
              textSegments.push(parts[0].text);
            }
          } else if (chunk.choices && Array.isArray(chunk.choices)) {
            for (const choice of chunk.choices) {
              if (choice.delta && choice.delta.content) {
                textSegments.push(choice.delta.content);
              }
            }
          }

          if (chunk.data && Array.isArray(chunk.data) && chunk.data.length > 0) {
            imageSegments.push(...chunk.data);
          } else if (chunk.images && Array.isArray(chunk.images)) {
            imageSegments.push(...chunk.images);
          } else if (chunk.output && Array.isArray(chunk.output)) {
            imageSegments.push(...chunk.output);
          }
        } catch (err) {
          console.error('解析流式响应失败:', err);
        }
      }

      if (imageSegments.length > 0) {
        return {
          type: 'images',
          items: normalizeGeneratedImages(imageSegments)
        };
      }

      if (textSegments.length > 0) {
        return textSegments.join('');
      }

      return '';
    }

    // 非流式响应: 尝试判定是否为二进制数据
    if (data.startsWith('\uFFFD') || data.includes('JFIF') || data.includes('PNG')) {
      return '[Generated Image: Binary data]';
    }

    let response;
    try {
      response = JSON.parse(data);
    } catch (error) {
      console.log(`[ResponseInterceptor] Non-JSON response detected for route: ${route}`);
      return data.trim() ? data.trim() : '[Generated Content: Non-JSON response]';
    }

    const imageSources = [];
    const collectImages = source => {
      if (!source) return;
      if (Array.isArray(source)) {
        imageSources.push(...source);
      } else {
        imageSources.push(source);
      }
    };

    collectImages(response.images);
    collectImages(response.data);
    collectImages(response.output);
    collectImages(response.artifacts);

    if (response.result) {
      collectImages(response.result.images);
      collectImages(response.result.data);
      collectImages(response.result.image);
      collectImages(response.result.image_base64);
      collectImages(response.result.output);
    }

    collectImages(response.image);
    collectImages(response.image_url);
    collectImages(response.image_base64);
    collectImages(response.url);

    const normalizedImages = normalizeGeneratedImages(imageSources);
    if (normalizedImages.length > 0) {
      return {
        type: 'images',
        items: normalizedImages
      };
    }

    if (route.startsWith('/google') || route.startsWith('/freegemini')) {
      if (response.candidates && response.candidates[0] && response.candidates[0].content) {
        const parts = response.candidates[0].content.parts;
        if (parts && parts[0]) {
          if (parts[0].text) {
            return parts[0].text;
          }
          if (Array.isArray(parts[0].content)) {
            const textPart = parts[0].content.find(part => part.text);
            if (textPart) {
              return textPart.text;
            }
          }
        }
      }
    }

    if (response.choices && response.choices[0]) {
      const choice = response.choices[0];
      if (choice.message && choice.message.content) {
        return choice.message.content;
      }
      if (choice.text) {
        return choice.text;
      }
    }

    if (response.text) {
      return response.text;
    }

    if (typeof response.result === 'string') {
      return response.result;
    }

    if (response.result && response.result.text) {
      return response.result.text;
    }

    return '';
  } catch (error) {
    console.error('解析AI响应失败:', error);
    return '';
  }
}

/**
 * 更新数据库中的对话记录，添加AI回答 (v1.10.0优化: 使用 conversation_id 直接定位)
 */
async function updateConversationWithResponse(requestKey, aiResponse) {
  const cacheData = responseCache.get(requestKey);
  if (!cacheData) {
    console.log(`[ResponseInterceptor] 未找到请求缓存: ${requestKey}`);
    return;
  }

  try {
    const baseConversation = Array.isArray(cacheData.messages)
      ? cacheData.messages
      : (cacheData.messages ? [cacheData.messages] : []);
    const fullConversation = [...baseConversation];

    let messageAppended = false;

    let responseSummary = '结构化数据';

    if (typeof aiResponse === 'string') {
      const trimmed = aiResponse.trim();
      if (trimmed) {
        fullConversation.push({
          role: 'assistant',
          content: trimmed
        });
        messageAppended = true;
        responseSummary = `${trimmed.length}字符`;
      }
    } else if (aiResponse && aiResponse.type === 'images') {
      const items = Array.isArray(aiResponse.items) ? aiResponse.items : [];
      if (items.length > 0) {
        const validItems = items.filter(item => item && item.url);
        if (validItems.length > 0) {
          const contentParts = validItems.map(item => ({
            type: 'image_url',
            image_url: {
              url: item.url,
              detail: 'auto'
            }
          }));

          fullConversation.push({
            role: 'assistant',
            content: contentParts,
            metadata: {
              response_type: 'images',
              image_count: validItems.length,
              images: validItems
            }
          });
          messageAppended = true;
          responseSummary = `${validItems.length}张图`;
        }
      }
    }

    if (!messageAppended) {
      console.log(`[ResponseInterceptor] ⚠️  AI响应为空或未解析到有效内容: ${requestKey}`);
      responseCache.delete(requestKey);
      return;
    }

    // 🆕 v1.10.0: 优先使用 conversation_id 直接更新 (精准、高效)
    if (cacheData.conversation_id) {
      const [result] = await pool.query(
        'UPDATE conversation_logs SET messages = ?, message_count = ?, updated_at = CURRENT_TIMESTAMP WHERE conversation_uuid = ?',
        [JSON.stringify(fullConversation), fullConversation.length, cacheData.conversation_id]
      );

      if (result.affectedRows > 0) {
        console.log(`[ResponseInterceptor] ✓ 已更新对话 ${cacheData.conversation_id}, AI回答: ${responseSummary}`);
      } else {
        console.log(`[ResponseInterceptor] ⚠️  未找到会话: ${cacheData.conversation_id}`);
      }

      // 清理缓存
      responseCache.delete(requestKey);
      return;
    }

    // 兜底: 如果没有 conversation_id, 使用旧的三层查询逻辑 (保留兼容性)
    console.log(`[ResponseInterceptor] ⚠️  缺少conversation_id,使用兜底查询`);

    // 方案1: 通过user_id和时间范围查询
    let [rows] = await pool.query(
      `SELECT cl.conversation_uuid, cl.request_id FROM conversation_logs cl
       JOIN requests r ON cl.request_id = r.id
       WHERE r.user_id = ? AND r.timestamp >= ? AND r.timestamp <= ?
       ORDER BY cl.updated_at DESC LIMIT 1`,
      [
        cacheData.userId,
        new Date(cacheData.timestamp - 10000),
        new Date(cacheData.timestamp + 10000)
      ]
    );

    // 方案2: 通过IP和时间范围查询
    if (rows.length === 0 && cacheData.userIp) {
      console.log(`[ResponseInterceptor] 主查询失败,尝试通过IP查询: ${cacheData.userIp}`);
      [rows] = await pool.query(
        `SELECT cl.conversation_uuid, cl.request_id FROM conversation_logs cl
         JOIN requests r ON cl.request_id = r.id
         WHERE r.ip = ? AND r.timestamp >= ? AND r.timestamp <= ?
         ORDER BY cl.updated_at DESC LIMIT 1`,
        [
          cacheData.userIp,
          new Date(cacheData.timestamp - 10000),
          new Date(cacheData.timestamp + 10000)
        ]
      );
    }

    // 方案3: 终极兜底 - 查询该用户最新记录
    if (rows.length === 0 && cacheData.userId !== 'anonymous') {
      console.log(`[ResponseInterceptor] IP查询也失败,使用终极兜底查询: user=${cacheData.userId}`);
      [rows] = await pool.query(
        `SELECT cl.conversation_uuid, cl.request_id, r.timestamp FROM conversation_logs cl
         JOIN requests r ON cl.request_id = r.id
         WHERE r.user_id = ?
         ORDER BY cl.updated_at DESC LIMIT 1`,
        [cacheData.userId]
      );

      if (rows.length > 0) {
        const timeDiff = Math.abs(new Date(rows[0].timestamp) - cacheData.timestamp);
        if (timeDiff > 60000) {
          console.log(`[ResponseInterceptor] ⚠️  终极兜底找到记录但时间差过大: ${Math.round(timeDiff/1000)}秒,放弃更新`);
          rows = [];
        }
      }
    }

    if (rows.length > 0) {
      const conversationUuid = rows[0].conversation_uuid;
      const requestId = rows[0].request_id;

      await pool.query(
        'UPDATE conversation_logs SET messages = ?, message_count = ?, updated_at = CURRENT_TIMESTAMP WHERE conversation_uuid = ?',
        [JSON.stringify(fullConversation), fullConversation.length, conversationUuid]
      );

      console.log(`[ResponseInterceptor] ✓ 已更新对话记录 UUID:${conversationUuid} (request:${requestId}), AI回答: ${responseSummary}`);
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

  // 🆕 v1.10.0修复: 获取 conversation_id (优先从前置中间件获取)
  const conversationId = req._conversationId  // 优先级1 - loggingMiddleware传递
    || req.headers['x-conversation-id']       // 优先级2 - 前端传递header
    || req.body.conversation_id;              // 优先级3 - 前端传递body

  const cacheData = {
    userId,
    userIp,
    messages: req.body.messages || req.body.contents || (req.body.prompt ? [{ role: 'user', content: req.body.prompt }] : []),
    timestamp: Date.now(),
    route,
    conversation_id: conversationId  // 🆕 缓存会话ID
  };

  responseCache.set(requestKey, cacheData);
  console.log(`[ResponseInterceptor] 📝 缓存请求: key=${requestKey}, user=${userId}, ip=${userIp}, conversation_id=${conversationId || 'N/A'}, messages=${cacheData.messages.length}`);

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
        const responseSummary = typeof aiResponse === 'string'
          ? `${aiResponse.length}字符`
          : aiResponse.type === 'images'
            ? `${(aiResponse.items || []).length}张图`
            : '结构化数据';
        console.log(`[ResponseInterceptor] 🤖 解析AI响应: key=${requestKey}, ${responseSummary}`);
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
