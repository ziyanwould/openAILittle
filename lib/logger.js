/*
 * @Author: liujiarong 448736378@qq.com
 * @Date: 2025-03-24 09:29:40
 * @LastEditors: liujiarong 448736378@qq.com
 * @LastEditTime: 2025-10-12 23:30:00
 * @FilePath: /openAILittle/lib/logger.js
 * @Description: 批量日志写入队列 + 会话管理 (v1.10.0)
 */
// lib/logger.js
/**
 * 日志写入队列模块
 *
 * 功能:
 * - 批量异步写入日志到数据库
 * - 支持会话管理 (v1.10.0新增)
 * - requests 表: 保留每次请求记录 (统计/审计需求)
 * - conversation_logs 表: 按会话维度存储 (优化查询/节省空间)
 *
 * 状态: 生产环境使用
 */
const { pool } = require('../db');
const MAX_BATCH_SIZE = 100;    // 每批最大记录数
const FLUSH_INTERVAL = 500;    // 批处理间隔（毫秒）

class LogQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;

    // 初始化定期刷写
    setInterval(() => this.flush(), FLUSH_INTERVAL).unref();

    // 程序退出时强制刷写
    process.on('SIGTERM', () => this.flush(true));
    process.on('SIGINT', () => this.flush(true));
  }

  // 加入队列
  enqueue(logData) {
    this.queue.push(logData);
  }

  // 刷写队列（支持强制刷写）
  async flush(force = false) {
    if (this.isProcessing || (!force && this.queue.length === 0)) return;
    this.isProcessing = true;
    let batch = null;

    try {
      batch = this.queue.splice(0, force ? this.queue.length : MAX_BATCH_SIZE);
      if (batch.length === 0) return;

      const connection = await pool.getConnection();
      let successCount = 0;
      let errorCount = 0;

      try {
        for (const logData of batch) {
          try {
            await connection.beginTransaction(); // 每条记录单独事务

            // 1. 插入 requests (保留每次请求记录,用于统计/审计)
            const [result] = await connection.query(
              'INSERT INTO requests (user_id, ip, timestamp, model, token_prefix, token_suffix, route, content, is_restricted, conversation_id, is_new_conversation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                logData.user_id,
                logData.ip,
                logData.timestamp,
                logData.model,
                logData.token_prefix,
                logData.token_suffix,
                logData.route,
                logData.content,
                logData.is_restricted,
                logData.conversation_id,      // 🆕 会话ID
                logData.is_new_conversation   // 🆕 是否新会话
              ]
            );
            const requestId = result.insertId;

            // 2. 插入或更新 conversation_logs (会话维度)
            if (logData.is_new_conversation) {
              // 新会话: 创建记录
              await connection.query(
                'INSERT INTO conversation_logs (conversation_uuid, request_id, last_request_id, user_id, ip, messages, message_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                  logData.conversation_id,
                  requestId,                           // 第一个请求ID
                  requestId,                           // 最后请求ID(初始相同)
                  logData.user_id,
                  logData.ip,
                  JSON.stringify(logData.messages),
                  logData.messages.length
                ]
              );
              console.log(`[Logger] ✓ 新会话创建: ${logData.conversation_id}, request_id: ${requestId}`);
            } else {
              // 继续会话: 仅更新 messages (覆盖为最新完整历史)
              const [updateResult] = await connection.query(
                'UPDATE conversation_logs SET messages = ?, message_count = ?, last_request_id = ?, updated_at = CURRENT_TIMESTAMP WHERE conversation_uuid = ?',
                [
                  JSON.stringify(logData.messages),
                  logData.messages.length,
                  requestId,
                  logData.conversation_id
                ]
              );

              if (updateResult.affectedRows === 0) {
                // 兜底: 如果更新失败(会话不存在),创建新记录
                console.log(`[Logger] ⚠️  会话不存在,创建新记录: ${logData.conversation_id}`);
                await connection.query(
                  'INSERT INTO conversation_logs (conversation_uuid, request_id, last_request_id, user_id, ip, messages, message_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
                  [
                    logData.conversation_id,
                    requestId,
                    requestId,
                    logData.user_id,
                    logData.ip,
                    JSON.stringify(logData.messages),
                    logData.messages.length
                  ]
                );
              } else {
                console.log(`[Logger] ✓ 会话更新: ${logData.conversation_id}, request_id: ${requestId}, messages: ${logData.messages.length}`);
              }
            }

            await connection.commit(); // 提交事务
            successCount++;
          } catch (err) {
            await connection.rollback(); // 回滚当前记录的事务
            console.error(`单条日志写入失败 (user_id: ${logData.user_id}, conversation_id: ${logData.conversation_id}):`, err.message);
            errorCount++;
          }
        }

        console.log(`批量写入完成: 成功 ${successCount} 条, 失败 ${errorCount} 条`);
      } finally {
        connection.release();
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

// 单例模式导出
module.exports = new LogQueue();