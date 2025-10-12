/**
 * 对话会话管理模块
 *
 * 功能:
 * - 自动识别和管理对话会话
 * - 判断会话边界(新会话 vs 继续会话)
 * - 生成和分配会话UUID
 *
 * 状态: 生产环境使用
 * 版本: v1.0.0
 * 创建时间: 2025-10-12
 */

const crypto = require('crypto');
const { pool } = require('../db');

/**
 * 生成UUID v4 (使用Node.js内置crypto模块)
 */
function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
  );
}

// 会话超时时间: 30分钟 (用户30分钟无交互视为会话结束)
const SESSION_TIMEOUT = 30 * 60 * 1000;

/**
 * 判断是否应该开启新会话
 *
 * @param {Object} lastConversation - 上一个会话的信息
 * @param {Date} lastConversation.updated_at - 最后更新时间
 * @param {number} lastConversation.message_count - 上一个会话的消息数
 * @param {Object} currentRequest - 当前请求的信息
 * @param {Array} currentRequest.messages - 当前请求的消息列表
 * @param {boolean} currentRequest.reset_conversation - 是否重置会话(前端标志)
 * @returns {boolean} - true: 开启新会话; false: 继续现有会话
 */
function isNewSession(lastConversation, currentRequest) {
  if (!lastConversation) return true;

  // 条件1: 时间间隔超过30分钟 → 新会话
  const timeDiff = Date.now() - new Date(lastConversation.updated_at).getTime();
  if (timeDiff > SESSION_TIMEOUT) {
    console.log(`[ConversationManager] 会话超时 (${Math.round(timeDiff/1000/60)}分钟) → 新会话`);
    return true;
  }

  // 条件2: 前端显式传递 reset_conversation=true → 新会话
  // 注: 目前前端暂不支持,预留接口
  if (currentRequest.reset_conversation === true) {
    console.log(`[ConversationManager] 前端请求重置会话 → 新会话`);
    return true;
  }

  // 条件3: 消息长度被重置 (当前消息数 < 上次消息数) → 新会话
  // 说明: 前端清空了对话历史,应该开启新会话
  const currentMsgCount = currentRequest.messages?.length || 0;
  const lastMsgCount = lastConversation.message_count || 0;
  if (currentMsgCount < lastMsgCount) {
    console.log(`[ConversationManager] 消息数重置 (${lastMsgCount} → ${currentMsgCount}) → 新会话`);
    return true;
  }

  // 条件4 (可选): 路由/模型改变 → 新会话
  // 目前注释掉,因为用户可能在同一会话中切换模型
  // if (currentRequest.route !== lastConversation.route) {
  //   console.log(`[ConversationManager] 路由改变 → 新会话`);
  //   return true;
  // }

  return false;
}

/**
 * 获取或创建会话ID (核心函数)
 *
 * 优先级:
 * 1. 从请求头/请求体获取前端传递的 conversation_id (精确控制)
 * 2. 查询数据库,寻找该用户最近的活跃会话 (自动识别)
 * 3. 创建新会话UUID (首次对话或会话超时)
 *
 * @param {Object} req - Express请求对象
 * @param {Object} logData - 日志数据对象
 * @param {string} logData.user_id - 用户ID
 * @param {string} logData.ip - 用户IP
 * @param {Array} logData.messages - 消息列表
 * @param {string} logData.route - 路由名称
 * @returns {Promise<{conversationId: string, isNew: boolean}>}
 */
async function getOrCreateConversationId(req, logData) {
  const userId = logData.user_id;
  const userIp = logData.ip;

  try {
    // 优先级1: 从请求头或请求体获取前端传递的 conversation_id
    let conversationId = req.headers['x-conversation-id'] || req.body.conversation_id;

    if (conversationId) {
      // 前端显式指定会话ID,验证该会话是否存在
      const [rows] = await pool.query(
        'SELECT conversation_uuid FROM conversation_logs WHERE conversation_uuid = ? LIMIT 1',
        [conversationId]
      );

      if (rows.length > 0) {
        console.log(`[ConversationManager] 使用前端传递的会话ID: ${conversationId}`);
        return { conversationId, isNew: false };
      } else {
        console.log(`[ConversationManager] 前端传递的会话ID不存在,创建新会话: ${conversationId}`);
        return { conversationId, isNew: true };
      }
    }

    // 优先级2: 查询数据库,寻找该用户最近的活跃会话
    // 策略: 按用户ID或IP查询30分钟内的最新会话
    const [rows] = await pool.query(`
      SELECT conversation_uuid, updated_at, message_count, route
      FROM conversation_logs
      WHERE (user_id = ? OR ip = ?)
      AND updated_at >= ?
      ORDER BY updated_at DESC
      LIMIT 1
    `, [
      userId,
      userIp,
      new Date(Date.now() - SESSION_TIMEOUT)
    ]);

    if (rows.length > 0) {
      const lastConversation = rows[0];
      const currentRequest = {
        messages: logData.messages,
        reset_conversation: req.body.reset_conversation,
        route: logData.route
      };

      // 判断是否应该继续旧会话
      if (!isNewSession(lastConversation, currentRequest)) {
        console.log(`[ConversationManager] 继续现有会话: ${lastConversation.conversation_uuid} (user:${userId}, ip:${userIp})`);
        return { conversationId: lastConversation.conversation_uuid, isNew: false };
      }
    }

    // 优先级3: 创建新会话
    conversationId = uuidv4();
    console.log(`[ConversationManager] 创建新会话: ${conversationId} (user:${userId}, ip:${userIp})`);
    return { conversationId, isNew: true };

  } catch (error) {
    console.error('[ConversationManager] 获取会话ID失败,创建新会话:', error.message);
    // 降级处理: 创建新会话
    const conversationId = uuidv4();
    return { conversationId, isNew: true };
  }
}

module.exports = {
  getOrCreateConversationId,
  isNewSession,
  SESSION_TIMEOUT
};
