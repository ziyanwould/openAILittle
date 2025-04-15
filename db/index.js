//db/index.js
const mysql = require('mysql2/promise');
const modelRateLimits = require('../modules/modelRateLimits');
const auxiliaryModels = require('../modules/auxiliaryModels'); // 定义辅助模型列表
require('dotenv').config();

// 环境变量解析
const dbConfig = {
  host: process.env.DB_HOST,          // 数据库地址
  user: process.env.DB_USER,          // 用户名
  password: process.env.DB_PASSWORD,  // 密码
  database: process.env.DB_NAME,      // 数据库名
  port: parseInt(process.env.DB_PORT) || 3306,  // 处理端口转换
  waitForConnections: true,           // 连接池行为
  connectionLimit: 10,                // 最大连接数
  connectTimeout: 10000               // 连接超时时间（10秒）
};

// 打印环境变量配置用于调试
console.log('Database Configuration:', JSON.stringify(dbConfig, null, 2));

// 创建连接池
const pool = mysql.createPool(dbConfig);

/**
 * 初始化数据库结构
 */
async function initializeDatabase() {
  let connection;
  try {
    console.log('[1/5] 尝试连接数据库...');
    connection = await pool.getConnection();
    console.log(`[2/5] 成功连接到数据库 ${dbConfig.database}`);

    // ==================== 创建表结构 ====================
    console.log('[3/5] 开始初始化表结构');

    // 用户表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        is_anonymous BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ users 表初始化完成');

    // API请求记录表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(36),
        ip VARCHAR(45) NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        model VARCHAR(50) NOT NULL,
        token_prefix VARCHAR(5),
        token_suffix VARCHAR(3),
        route VARCHAR(50) NOT NULL,
        content LONGTEXT,
        is_restricted BOOLEAN DEFAULT FALSE,
        INDEX idx_timestamp (timestamp),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ requests 表初始化完成');

    // 检查并更新 content 字段类型为 LONGTEXT
    const [columns] = await connection.query(
      `SHOW COLUMNS FROM requests WHERE Field = 'content'`
    );
    if (columns.length > 0 && columns[0].Type.toLowerCase() !== 'longtext') {
      await connection.query(`
        ALTER TABLE requests MODIFY COLUMN content LONGTEXT;
      `);
      console.log('✓ content 字段已更新为 LONGTEXT 类型');
    } else {
      console.log('⭕ content 字段已经是 LONGTEXT 类型，无需更新');
    }

    // 受限模型表
    await connection.query(`
      CREATE TABLE IF NOT EXISTS restricted_models (
        model_name VARCHAR(50) PRIMARY KEY,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ restricted_models 表初始化完成');

    // 审计日志表（第四张表）
    await connection.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        log_id INT AUTO_INCREMENT PRIMARY KEY,
        action_type ENUM('CREATE','UPDATE','DELETE') NOT NULL,
        user_id VARCHAR(36),
        target_id INT,
        description TEXT,
        log_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ audit_logs 表初始化完成');

    // 对话历史记录表 (新增)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS conversation_logs (
        conversation_id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT,
        messages JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ conversation_logs 表初始化完成');

    // ==================== 创建索引 ====================
    console.log('[4/5] 创建索引');
    const indexConfig = [
      { name: 'idx_requests_user', table: 'requests', columns: 'user_id' },
      { name: 'idx_requests_ip', table: 'requests', columns: 'ip' },
      { name: 'idx_requests_model', table: 'requests', columns: 'model' },
      { name: 'idx_requests_route', table: 'requests', columns: 'route' }
    ];

    for (const index of indexConfig) {
      try {
        const [existing] = await connection.query(
          `SHOW INDEX FROM ${index.table} WHERE Key_name = ?`,
          [index.name]
        );

        if (existing.length === 0) {
          await connection.query(
            `CREATE INDEX ${index.name} ON ${index.table}(${index.columns})`
          );
          console.log(`✓ 索引 ${index.name} 创建成功`);
        } else {
          console.log(`⭕ 索引 ${index.name} 已存在`);
        }
      } catch (indexErr) {
        console.error(`索引 ${index.name} 创建失败:`, indexErr.message);
        throw indexErr; // 严重错误抛出中断初始化
      }
    }

    // ==================== 基础数据初始化 ====================
    console.log('[5/5] 初始化基础数据');
    await connection.query(
      `INSERT IGNORE INTO restricted_models (model_name) VALUES
      ('gpt-4'), ('dall-e-3'), ('text-moderation')`
    );

    // 获取所有需要同步的模型
    const restrictedModels = [
        ...Object.keys(modelRateLimits),
        ...auxiliaryModels // 如果 auxiliaryModels 需要单独处理
    ];

    // 去重并同步到数据库
    const uniqueModels = [...new Set(restrictedModels)];
    await syncRestrictedModels(uniqueModels);

    console.log('🎉 数据库初始化完成');
  } catch (err) {
    // 错误分类处理
    switch (err.code) {
      case 'ER_ACCESS_DENIED_ERROR':
        console.error('❌ 数据库认证失败，请检查用户名/密码');
        break;
      case 'ER_BAD_DB_ERROR':
        console.error('❌ 数据库不存在，请检查 DB_NAME 配置');
        break;
      case 'ECONNREFUSED':
        console.error(`❌ 连接被拒绝，请检查数据库是否运行在 ${dbConfig.host}:${dbConfig.port}`);
        break;
      default:
        console.error('❌ 未知数据库错误:', err.message);
    }
    throw err; // 重抛错误让上层处理
  } finally {
    if (connection) connection.release();
  }
}

/**
 * 格式化JWT令牌
 */
async function formatToken(token) {
  if (!token) return { prefix: '', suffix: '' };
  return {
    prefix: token.slice(0, 5).padEnd(5, '*'), // 前五位，不足补星号
    suffix: token.slice(-3).padStart(3, '*')  // 后三位，不足补星号
  };
}

/**
 * 检查模型是否受限
 */
async function isRestrictedModel(model) {
  const [rows] = await pool.query(
    'SELECT 1 FROM restricted_models WHERE model_name = ?',
    [model]
  );
  return rows.length > 0;
}

/**
 * 查找或创建用户
 */
async function findOrCreateUser(userId) {
  if (!userId) return null;

  try {
    // 匿名用户检测逻辑
    const isAnonymous = /^\d{13}$/.test(userId); // 简化示例

    await pool.query(
      `INSERT INTO users (id, username, is_anonymous)
      VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id=id`,
      [userId, isAnonymous ? 'Anonymous' : userId, isAnonymous]
    );

    return userId;
  } catch (userErr) {
    console.error('用户操作失败:', userErr.message);
    return null;
  }
}

// db.js 新增函数
async function syncRestrictedModels(modelList) {
    let connection;
    try {
      connection = await pool.getConnection();

      // 批量插入去重模型名
      if (modelList.length > 0) {
        const values = modelList.map(name => [name]);
        await connection.query(
          'INSERT IGNORE INTO restricted_models (model_name) VALUES ?',
          [values]
        );
        console.log(`已同步 ${modelList.length} 个受限模型到数据库`);
      }
    } catch (err) {
      console.error('同步受限模型失败:', err);
      throw err;
    } finally {
      if (connection) connection.release();
    }
  }

// 程序启动时自动初始化
(async () => {
  try {
    await initializeDatabase();
  } catch (initErr) {
    console.error('🛑 数据库初始化失败，服务终止');
    process.exit(1); // 不可恢复错误退出进程
  }
})();

// 导出功能模块
module.exports = {
  pool,
  formatToken,
  isRestrictedModel,
  findOrCreateUser
};