/*
 * @Author: liujiarong 448736378@qq.com
 * @Date: 2025-03-24 09:29:40
 * @LastEditors: liujiarong 448736378@qq.com
 * @LastEditTime: 2025-04-11 17:45:19
 * @FilePath: /openAILittle/lib/logger.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
// lib/logger.js
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

            const [result] = await connection.query(
              'INSERT INTO requests (user_id, ip, timestamp, model, token_prefix, token_suffix, route, content, is_restricted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [logData.user_id, logData.ip, logData.timestamp, logData.model, logData.token_prefix, logData.token_suffix, logData.route, logData.content, logData.is_restricted]
            );
            const requestId = result.insertId;

            // 插入 conversation_logs
            await connection.query(
              'INSERT INTO conversation_logs (request_id, messages) VALUES (?, ?)',
              [requestId, JSON.stringify(logData.messages)]
            );

            await connection.commit(); // 提交事务
            successCount++;
          } catch (err) {
            await connection.rollback(); // 回滚当前记录的事务
            console.error(`单条日志写入失败 (user_id: ${logData.user_id}, model: ${logData.model}):`, err.message);
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