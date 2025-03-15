/**
 * @Author: Liu Jiarong
 * @Date: 2025-03-16 00:38:20
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-03-16 00:38:28
 * @FilePath: /openAILittle/lib/logger.js
 * @Description: 
 * @
 * @Copyright (c) 2025 by ${git_name_email}, All Rights Reserved. 
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
    this.queue.push([
      logData.user_id,
      logData.ip,
      logData.timestamp,
      logData.model,
      logData.token_prefix,
      logData.token_suffix,
      logData.route,
      logData.content,
      logData.is_restricted
    ]);
  }

  // 刷写队列（支持强制刷写）
  async flush(force = false) {
    if (this.isProcessing || (!force && this.queue.length === 0)) return;
    this.isProcessing = true;
    
    try {
      const batch = this.queue.splice(0, force ? this.queue.length : MAX_BATCH_SIZE);
      if (batch.length === 0) return;
      
      const values = batch.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
      const query = `
        INSERT INTO requests 
        (user_id, ip, timestamp, model, token_prefix, token_suffix, route, content, is_restricted)
        VALUES ${values}
      `;
      
      const connection = await pool.getConnection();
      await connection.query(query, batch.flat());
      connection.release();
      
      console.log(`成功写入 ${batch.length} 条日志`);
    } catch (err) {
      console.error('日志批量写入失败:', err.message);
      // 如果失败重新塞回队列（头部）
      if (batch?.length) this.queue.unshift(...batch);
    } finally {
      this.isProcessing = false;
    }
  }
}

// 单例模式导出
module.exports = new LogQueue();