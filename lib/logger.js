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
        try {
            await connection.beginTransaction(); // 开启事务

            for (const logData of batch) {
              const [result] = await connection.query(
                'INSERT INTO requests (user_id, ip, timestamp, model, token_prefix, token_suffix, route, content, is_restricted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [logData.user_id, logData.ip, logData.timestamp, logData.model, logData.token_prefix, logData.token_suffix, logData.route, logData.content, logData.is_restricted]
            );
            const requestId = result.insertId;
                // conversations id
              await connection.query(
                'INSERT INTO conversation_logs (request_id, messages) VALUES (?, ?)',
                [requestId, JSON.stringify(logData.messages)]
              );
            }

            await connection.commit(); // 提交事务
            console.log(`成功写入 ${batch.length} 条日志及对话`);

          } catch (err) {
              await connection.rollback(); // 回滚事务
              console.error('日志批量写入失败:', err.message);
              if (batch?.length) {
                this.queue.unshift(...batch); //塞回
              }
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