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

  // 刷写队列（支持强制刷写）- 优化版：使用批量INSERT减少数据库往返
  async flush(force = false) {
    if (this.isProcessing || (!force && this.queue.length === 0)) return;
    this.isProcessing = true;
    let batch = null;

    try {
      batch = this.queue.splice(0, force ? this.queue.length : MAX_BATCH_SIZE);
      if (batch.length === 0) return;

      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction(); // 整个批次使用一个事务

        // ========== 步骤1: 批量插入requests表 ==========
        const requestValues = batch.map(logData => [
          logData.user_id,
          logData.ip,
          logData.timestamp,
          logData.model,
          logData.token_prefix,
          logData.token_suffix,
          logData.route,
          logData.content,
          logData.is_restricted,
          logData.conversation_id,
          logData.is_new_conversation
        ]);

        const [requestResult] = await connection.query(
          'INSERT INTO requests (user_id, ip, timestamp, model, token_prefix, token_suffix, route, content, is_restricted, conversation_id, is_new_conversation) VALUES ?',
          [requestValues]
        );

        const firstInsertId = requestResult.insertId; // 第一条记录的ID

        // 为每条日志分配对应的request_id（MySQL批量INSERT返回第一个ID，后续递增）
        batch.forEach((logData, index) => {
          logData._requestId = firstInsertId + index;
        });

        // ========== 步骤2: 分组处理conversation_logs ==========
        const newConversations = batch.filter(log => log.is_new_conversation);
        const existingConversations = batch.filter(log => !log.is_new_conversation);

        // 2.1 批量插入新会话
        if (newConversations.length > 0) {
          const convValues = newConversations.map(logData => [
            logData.conversation_id,
            logData._requestId,           // 第一个请求ID
            logData._requestId,           // 最后请求ID(初始相同)
            logData.user_id,
            logData.ip,
            logData.route,
            JSON.stringify(logData.messages),
            logData.messages.length
          ]);

          await connection.query(
            'INSERT INTO conversation_logs (conversation_uuid, request_id, last_request_id, user_id, ip, route, messages, message_count) VALUES ?',
            [convValues]
          );
          console.log(`[Logger] ✓ 批量创建 ${newConversations.length} 个新会话`);
        }

        // 2.2 批量更新已存在的会话（使用CASE WHEN语句）
        if (existingConversations.length > 0) {
          // 构建批量更新SQL（使用CASE WHEN提高性能）
          let updateQuery = `
            UPDATE conversation_logs
            SET
              messages = CASE conversation_uuid
                ${existingConversations.map(log =>
                  `WHEN ? THEN ?`
                ).join(' ')}
              END,
              message_count = CASE conversation_uuid
                ${existingConversations.map(log =>
                  `WHEN ? THEN ?`
                ).join(' ')}
              END,
              last_request_id = CASE conversation_uuid
                ${existingConversations.map(log =>
                  `WHEN ? THEN ?`
                ).join(' ')}
              END,
              updated_at = CURRENT_TIMESTAMP
            WHERE conversation_uuid IN (${existingConversations.map(() => '?').join(',')})
          `;

          const updateParams = [
            ...existingConversations.flatMap(log => [log.conversation_id, JSON.stringify(log.messages)]),
            ...existingConversations.flatMap(log => [log.conversation_id, log.messages.length]),
            ...existingConversations.flatMap(log => [log.conversation_id, log._requestId]),
            ...existingConversations.map(log => log.conversation_id)
          ];

          const [updateResult] = await connection.query(updateQuery, updateParams);

          // 处理未匹配到的会话（可能不存在，需要创建）
          if (updateResult.affectedRows < existingConversations.length) {
            console.log(`[Logger] ⚠️ 检测到 ${existingConversations.length - updateResult.affectedRows} 个会话不存在，补充创建...`);

            // 找出未更新成功的会话并补充插入
            const [existingConvIds] = await connection.query(
              `SELECT conversation_uuid FROM conversation_logs WHERE conversation_uuid IN (?)`,
              [existingConversations.map(log => log.conversation_id)]
            );
            const existingSet = new Set(existingConvIds.map(row => row.conversation_uuid));
            const missingConvs = existingConversations.filter(log => !existingSet.has(log.conversation_id));

            if (missingConvs.length > 0) {
              const missingValues = missingConvs.map(logData => [
                logData.conversation_id,
                logData._requestId,
                logData._requestId,
                logData.user_id,
                logData.ip,
                logData.route,
                JSON.stringify(logData.messages),
                logData.messages.length
              ]);

              await connection.query(
                'INSERT INTO conversation_logs (conversation_uuid, request_id, last_request_id, user_id, ip, route, messages, message_count) VALUES ?',
                [missingValues]
              );
            }
          }

          console.log(`[Logger] ✓ 批量更新 ${existingConversations.length} 个会话`);
        }

        await connection.commit();
        console.log(`[Logger] 批量写入完成: 成功 ${batch.length} 条 (requests + conversations)`);

      } catch (err) {
        await connection.rollback();
        console.error(`[Logger] 批量写入失败，已回滚:`, err.message);
        console.error(err.stack);
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