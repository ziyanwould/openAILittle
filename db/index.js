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

    // 内容审核记录表 (新增)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS moderation_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(36),
        ip VARCHAR(45) NOT NULL,
        content TEXT NOT NULL,
        content_hash VARCHAR(64),
        risk_level ENUM('PASS', 'REVIEW', 'REJECT') NOT NULL,
        risk_details JSON,
        route VARCHAR(50),
        model VARCHAR(50),
        api_response TEXT,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_moderation_user (user_id),
        INDEX idx_moderation_ip (ip),
        INDEX idx_moderation_risk (risk_level),
        INDEX idx_moderation_time (processed_at),
        INDEX idx_moderation_hash (content_hash),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ moderation_logs 表初始化完成');

    // 用户/IP标记管理表 (新增)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_ip_flags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(36) NULL,
        ip VARCHAR(45) NULL,
        flag_type ENUM('USER', 'IP') NOT NULL,
        violation_count INT DEFAULT 1,
        first_violation_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_violation_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_banned BOOLEAN DEFAULT FALSE,
        ban_until TIMESTAMP NULL,
        ban_reason TEXT,
        created_by VARCHAR(100) DEFAULT 'SYSTEM',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_flags_user (user_id),
        INDEX idx_flags_ip (ip),
        INDEX idx_flags_type (flag_type),
        INDEX idx_flags_banned (is_banned),
        INDEX idx_flags_ban_until (ban_until),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_flag (user_id, flag_type),
        UNIQUE KEY unique_ip_flag (ip, flag_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ user_ip_flags 表初始化完成');

    // 配置规则管理表 (新增)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS config_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        rule_type ENUM('BLACKLIST_USER', 'BLACKLIST_IP', 'WHITELIST_USER', 'WHITELIST_IP', 'SENSITIVE_WORD', 'SENSITIVE_PATTERN', 'MODEL_FILTER', 'USER_RESTRICTION') NOT NULL,
        rule_key VARCHAR(255) NOT NULL COMMENT '规则键名，如用户ID、IP、敏感词等',
        rule_value TEXT COMMENT '规则值，JSON格式存储复杂数据',
        description TEXT COMMENT '规则描述',
        is_from_file BOOLEAN DEFAULT FALSE COMMENT '是否来自配置文件（只读）',
        is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
        priority INT DEFAULT 100 COMMENT '优先级，数字越小优先级越高',
        created_by VARCHAR(100) DEFAULT 'SYSTEM' COMMENT '创建者',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_config_type (rule_type),
        INDEX idx_config_key (rule_key),
        INDEX idx_config_active (is_active),
        INDEX idx_config_priority (priority),
        UNIQUE KEY unique_rule (rule_type, rule_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ config_rules 表初始化完成');

    // 系统配置管理表 (用于管理系统级配置如限流、内容审核、辅助模型等)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS system_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        config_type ENUM('MODERATION', 'RATE_LIMIT', 'AUXILIARY_MODEL', 'CHATNIO_LIMIT', 'AUTOBAN', 'REQUEST_BODY_MODIFY') NOT NULL,
        config_key VARCHAR(255) NOT NULL COMMENT '配置键名，如模型名、路由名等',
        config_value JSON NOT NULL COMMENT '配置值，JSON格式存储',
        description TEXT COMMENT '配置描述',
        is_active BOOLEAN DEFAULT TRUE COMMENT '是否启用',
        is_default BOOLEAN DEFAULT FALSE COMMENT '是否为默认配置（重置时使用）',
        priority INT DEFAULT 100 COMMENT '优先级，数字越小优先级越高',
        created_by VARCHAR(100) DEFAULT 'SYSTEM' COMMENT '创建者',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_system_config_type (config_type),
        INDEX idx_system_config_key (config_key),
        INDEX idx_system_config_active (is_active),
        INDEX idx_system_config_default (is_default),
        UNIQUE KEY unique_system_config (config_type, config_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('✓ system_configs 表初始化完成');

    // ==================== 数据库兼容性更新 ====================
    console.log('[4/6] 执行数据库兼容性更新');

    // 更新 system_configs 表的 config_type ENUM 字段，添加新的类型
    try {
      // 检查当前 ENUM 值
      const [enumInfo] = await connection.query(`
        SELECT COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${dbConfig.database}'
        AND TABLE_NAME = 'system_configs'
        AND COLUMN_NAME = 'config_type'
      `);

      if (enumInfo.length > 0) {
        const currentEnum = enumInfo[0].COLUMN_TYPE;

        // 检查是否缺少新的枚举值
        const needsUpdate = !currentEnum.includes('AUTOBAN') || !currentEnum.includes('REQUEST_BODY_MODIFY');

        if (needsUpdate) {
          await connection.query(`
            ALTER TABLE system_configs
            MODIFY COLUMN config_type
            ENUM('MODERATION', 'RATE_LIMIT', 'AUXILIARY_MODEL', 'CHATNIO_LIMIT', 'AUTOBAN', 'REQUEST_BODY_MODIFY')
            NOT NULL
          `);
          console.log('✓ system_configs.config_type ENUM 字段更新完成');
        } else {
          console.log('⭕ system_configs.config_type ENUM 字段已经是最新版本');
        }
      }
    } catch (enumError) {
      console.error('⚠️ system_configs.config_type ENUM 更新失败:', enumError.message);
      // 不抛出错误，允许系统继续运行（新安装的数据库会有正确的ENUM值）
    }

    // ==================== 创建索引 ====================
    console.log('[5/6] 创建索引');
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
    console.log('[6/6] 初始化基础数据');
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

/**
 * 记录内容审核结果
 */
async function logModerationResult(params) {
  const { userId, ip, content, contentHash, riskLevel, riskDetails, route, model, apiResponse } = params;
  
  try {
    const [result] = await pool.query(`
      INSERT INTO moderation_logs 
      (user_id, ip, content, content_hash, risk_level, risk_details, route, model, api_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [userId, ip, content, contentHash, riskLevel, JSON.stringify(riskDetails), route, model, apiResponse]);
    
    return result.insertId;
  } catch (err) {
    console.error('记录审核日志失败:', err.message);
    return null;
  }
}

/**
 * 检查用户/IP是否被禁用
 */
async function checkUserIpBanStatus(userId, ip) {
  try {
    const [userResult] = await pool.query(`
      SELECT is_banned, ban_until FROM user_ip_flags 
      WHERE (user_id = ? OR ip = ?) AND is_banned = TRUE AND (ban_until IS NULL OR ban_until > NOW())
    `, [userId, ip]);
    
    if (userResult.length > 0) {
      const banInfo = userResult[0];
      return {
        isBanned: true,
        banUntil: banInfo.ban_until,
        isPermanent: !banInfo.ban_until
      };
    }
    
    return { isBanned: false };
  } catch (err) {
    console.error('检查禁用状态失败:', err.message);
    return { isBanned: false };
  }
}

/**
 * 获取自动禁封配置
 */
async function getAutoBanConfig() {
  try {
    const [configs] = await pool.query(`
      SELECT config_key, config_value
      FROM system_configs
      WHERE config_type = 'AUTOBAN' AND is_active = TRUE
    `);

    const configObj = {};
    configs.forEach(config => {
      let value = config.config_value;
      // 处理布尔值和数字类型转换
      if (config.config_key === 'enabled') {
        value = value === 'true' || value === true;
      } else if (!isNaN(value) && value !== '') {
        value = Number(value);
      }
      configObj[config.config_key] = value;
    });

    // 返回默认值（如果数据库中没有配置）
    return {
      violation_threshold: configObj.violation_threshold || 5,
      ban_duration_hours: configObj.ban_duration_hours || 24,
      enabled: configObj.enabled !== undefined ? configObj.enabled : true
    };
  } catch (error) {
    console.error('获取自动禁封配置失败:', error);
    // 返回默认值
    return {
      violation_threshold: 5,
      ban_duration_hours: 24,
      enabled: true
    };
  }
}

/**
 * 更新违规计数并自动标记
 */
async function updateViolationCount(userId, ip, riskLevel) {
  if (riskLevel === 'PASS') return;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 获取自动禁封配置
    const autoBanConfig = await getAutoBanConfig();

    // 如果自动禁封功能被禁用，只更新违规计数，不执行禁封
    if (!autoBanConfig.enabled) {
      // 处理用户违规
      if (userId) {
        await connection.query(`
          INSERT INTO user_ip_flags (user_id, flag_type, violation_count, first_violation_at, last_violation_at)
          VALUES (?, 'USER', 1, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            violation_count = violation_count + 1,
            last_violation_at = NOW()
        `, [userId]);
      }

      // 处理IP违规
      await connection.query(`
        INSERT INTO user_ip_flags (ip, flag_type, violation_count, first_violation_at, last_violation_at)
        VALUES (?, 'IP', 1, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          violation_count = violation_count + 1,
          last_violation_at = NOW()
      `, [ip]);

      await connection.commit();
      console.log(`[Violation Count] 违规计数已更新，但自动禁封功能已禁用`);
      return;
    }

    // 处理用户违规
    if (userId) {
      await connection.query(`
        INSERT INTO user_ip_flags (user_id, flag_type, violation_count, first_violation_at, last_violation_at)
        VALUES (?, 'USER', 1, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          violation_count = violation_count + 1,
          last_violation_at = NOW()
      `, [userId]);
    }

    // 处理IP违规
    await connection.query(`
      INSERT INTO user_ip_flags (ip, flag_type, violation_count, first_violation_at, last_violation_at)
      VALUES (?, 'IP', 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        violation_count = violation_count + 1,
        last_violation_at = NOW()
    `, [ip]);

    // 使用配置化的阈值检查是否需要自动禁用
    const autobanThreshold = autoBanConfig.violation_threshold;
    const banDurationHours = autoBanConfig.ban_duration_hours;

    const [violations] = await connection.query(`
      SELECT id, user_id, ip, violation_count, flag_type
      FROM user_ip_flags
      WHERE ((user_id = ? AND flag_type = 'USER') OR (ip = ? AND flag_type = 'IP'))
        AND violation_count >= ?
        AND is_banned = FALSE
    `, [userId, ip, autobanThreshold]);

    for (const violation of violations) {
      await connection.query(`
        UPDATE user_ip_flags
        SET is_banned = TRUE,
            ban_until = DATE_ADD(NOW(), INTERVAL ? HOUR),
            ban_reason = CONCAT('自动禁用：违规次数达到 ', violation_count, ' 次（配置阈值: ', ?, '）'),
            updated_at = NOW()
        WHERE id = ?
      `, [banDurationHours, autobanThreshold, violation.id]);

      console.log(`[Auto Ban] ${violation.flag_type} ${violation.user_id || violation.ip} 因违规${violation.violation_count}次被自动禁用${banDurationHours}小时 (阈值: ${autobanThreshold})`);
    }

    await connection.commit();
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('更新违规计数失败:', err.message);
  } finally {
    if (connection) connection.release();
  }
}

/**
 * 管理用户/IP禁用状态
 */
async function manageUserIpBan(params) {
  const { userId, ip, action, banDuration, banReason, operatorId } = params;
  
  try {
    if (action === 'BAN') {
      const banUntil = banDuration ? 
        `DATE_ADD(NOW(), INTERVAL ${banDuration} HOUR)` : null;
      
      if (userId) {
        await pool.query(`
          INSERT INTO user_ip_flags (user_id, flag_type, is_banned, ban_until, ban_reason, created_by)
          VALUES (?, 'USER', TRUE, ${banUntil || 'NULL'}, ?, ?)
          ON DUPLICATE KEY UPDATE 
            is_banned = TRUE,
            ban_until = ${banUntil || 'NULL'},
            ban_reason = VALUES(ban_reason),
            created_by = VALUES(created_by),
            updated_at = NOW()
        `, [userId, banReason, operatorId]);
      }
      
      if (ip) {
        await pool.query(`
          INSERT INTO user_ip_flags (ip, flag_type, is_banned, ban_until, ban_reason, created_by)
          VALUES (?, 'IP', TRUE, ${banUntil || 'NULL'}, ?, ?)
          ON DUPLICATE KEY UPDATE 
            is_banned = TRUE,
            ban_until = ${banUntil || 'NULL'},
            ban_reason = VALUES(ban_reason),
            created_by = VALUES(created_by),
            updated_at = NOW()
        `, [ip, banReason, operatorId]);
      }
    } else if (action === 'UNBAN') {
      const conditions = [];
      const values = [];
      
      if (userId) {
        conditions.push('(user_id = ? AND flag_type = "USER")');
        values.push(userId);
      }
      if (ip) {
        conditions.push('(ip = ? AND flag_type = "IP")');
        values.push(ip);
      }
      
      if (conditions.length > 0) {
        await pool.query(`
          UPDATE user_ip_flags 
          SET is_banned = FALSE, ban_until = NULL, updated_at = NOW()
          WHERE ${conditions.join(' OR ')}
        `, values);
      }
    }
    
    return true;
  } catch (err) {
    console.error('管理禁用状态失败:', err.message);
    return false;
  }
}

/**
 * 配置规则管理函数
 */

// 获取所有配置规则（文件+数据库）
async function getAllConfigRules(ruleType = null) {
  try {
    let query = `
      SELECT * FROM config_rules 
      WHERE is_active = TRUE
    `;
    const params = [];
    
    if (ruleType) {
      query += ' AND rule_type = ?';
      params.push(ruleType);
    }
    
    query += ' ORDER BY priority ASC, created_at ASC';
    
    const [rows] = await pool.query(query, params);
    return rows;
  } catch (err) {
    console.error('获取配置规则失败:', err.message);
    return [];
  }
}

// 添加配置规则
async function addConfigRule(params) {
  const { ruleType, ruleKey, ruleValue, description, createdBy = 'ADMIN', priority = 100 } = params;
  
  try {
    const [result] = await pool.query(`
      INSERT INTO config_rules (rule_type, rule_key, rule_value, description, is_from_file, priority, created_by)
      VALUES (?, ?, ?, ?, FALSE, ?, ?)
    `, [ruleType, ruleKey, ruleValue, description, priority, createdBy]);
    
    return result;
  } catch (err) {
    console.error('添加配置规则失败:', err.message);
    throw err; // 抛出错误而不是返回null
  }
}

// 更新配置规则（只能更新非文件来源的规则）
async function updateConfigRule(id, params) {
  const { ruleValue, description, isActive, priority } = params;
  
  try {
    const [result] = await pool.query(`
      UPDATE config_rules 
      SET rule_value = ?, description = ?, is_active = ?, priority = ?, updated_at = NOW()
      WHERE id = ? AND is_from_file = FALSE
    `, [ruleValue, description, isActive, priority, id]);
    
    return result.affectedRows > 0;
  } catch (err) {
    console.error('更新配置规则失败:', err.message);
    return false;
  }
}

// 删除配置规则（只能删除非文件来源的规则）
async function deleteConfigRule(id) {
  try {
    const [result] = await pool.query(`
      DELETE FROM config_rules WHERE id = ? AND is_from_file = FALSE
    `, [id]);
    
    return result.affectedRows > 0;
  } catch (err) {
    console.error('删除配置规则失败:', err.message);
    return false;
  }
}

// 同步文件配置到数据库
async function syncFileConfigToDatabase() {
  try {
    // 先清理已存在的文件配置
    await pool.query('DELETE FROM config_rules WHERE is_from_file = TRUE');
    
    const fs = require('fs');
    const path = require('path');
    
    // 同步各种配置文件
    const configFiles = [
      { 
        file: 'config/BlacklistedUsers.txt', 
        type: 'BLACKLIST_USER',
        parser: (content) => content.split('\n').filter(line => line.trim())
      },
      { 
        file: 'config/BlacklistedIPs.txt', 
        type: 'BLACKLIST_IP',
        parser: (content) => content.split('\n').filter(line => line.trim())
      },
      { 
        file: 'config/Sensitive.txt', 
        type: 'SENSITIVE_WORD',
        parser: (content) => content.split('\n').filter(line => line.trim())
      },
      { 
        file: 'config/whitelist.json', 
        type: 'WHITELIST_USER',
        parser: (content) => {
          const data = JSON.parse(content);
          const rules = [];
          if (data.userIds) {
            data.userIds.forEach(userId => rules.push({ key: userId, type: 'WHITELIST_USER' }));
          }
          if (data.ips) {
            data.ips.forEach(ip => rules.push({ key: ip, type: 'WHITELIST_IP' }));
          }
          return rules;
        }
      },
      {
        file: 'config/restrictedUsers.json',
        type: 'USER_RESTRICTION',
        parser: (content) => {
          const data = JSON.parse(content);
          return Object.entries(data).map(([userId, config]) => ({
            key: userId,
            value: JSON.stringify(config)
          }));
        }
      },
      {
        file: 'config/sensitive_patterns.json',
        type: 'SENSITIVE_PATTERN',
        parser: (content) => {
          const patterns = JSON.parse(content);
          return patterns.map(pattern => ({
            key: pattern.pattern,
            value: JSON.stringify(pattern)
          }));
        }
      },
      {
        file: 'config/filterConfig.json',
        type: 'MODEL_FILTER',
        parser: (content) => {
          const data = JSON.parse(content);
          return Object.entries(data).map(([key, config]) => ({
            key: key,
            value: JSON.stringify(config)
          }));
        }
      }
    ];
    
    for (const configFile of configFiles) {
      const filePath = path.join(__dirname, '..', configFile.file);
      
      if (!fs.existsSync(filePath)) continue;
      
      try {
        const content = fs.readFileSync(filePath, 'utf8').trim();
        if (!content) continue;
        
        let rules = [];
        
        if (configFile.parser) {
          const parsed = configFile.parser(content);
          if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
            rules = parsed;
          } else if (Array.isArray(parsed)) {
            rules = parsed.map(item => ({ key: item, value: null }));
          }
        }
        
        // 插入规则到数据库
        for (const rule of rules) {
          const ruleType = rule.type || configFile.type;
          await pool.query(`
            INSERT IGNORE INTO config_rules (rule_type, rule_key, rule_value, description, is_from_file, priority, created_by)
            VALUES (?, ?, ?, ?, TRUE, 1, 'FILE_SYNC')
          `, [
            ruleType,
            rule.key,
            rule.value || null,
            `从文件 ${configFile.file} 同步`,
          ]);
        }
        
      } catch (fileErr) {
        console.error(`同步文件 ${configFile.file} 失败:`, fileErr.message);
      }
    }
    
    console.log('配置文件同步到数据库完成');
    return true;
  } catch (err) {
    console.error('同步配置文件失败:', err.message);
    return false;
  }
}

/**
 * 系统配置管理函数
 */

// 获取系统配置
async function getSystemConfigs(filters = {}, page = 1, pageSize = 20) {
  try {
    let whereConditions = ['1=1'];
    let params = [];
    
    // 配置类型筛选
    if (filters.configType && filters.configType.trim() !== '') {
      whereConditions.push('config_type = ?');
      params.push(filters.configType);
    }
    
    const whereClause = whereConditions.join(' AND ');
    
    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM system_configs WHERE ${whereClause}`;
    const [[{ total }]] = await pool.query(countQuery, params);
    
    // 查询数据
    const offset = (page - 1) * pageSize;
    const dataQuery = `
      SELECT * FROM system_configs 
      WHERE ${whereClause}
      ORDER BY config_type ASC, priority ASC, created_at ASC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(dataQuery, [...params, pageSize, offset]);
    
    return {
      data: rows,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    };
  } catch (err) {
    console.error('获取系统配置失败:', err.message);
    return {
      data: [],
      total: 0,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    };
  }
}

// 添加系统配置
async function addSystemConfig(params) {
  const { configType, configKey, configValue, description, createdBy = 'ADMIN', priority = 100, isDefault = false } = params;
  
  try {
    const [result] = await pool.query(`
      INSERT INTO system_configs (config_type, config_key, config_value, description, priority, created_by, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [configType, configKey, JSON.stringify(configValue), description, priority, createdBy, isDefault]);
    
    return result;
  } catch (err) {
    console.error('添加系统配置失败:', err.message);
    throw err;
  }
}

// 更新系统配置
async function updateSystemConfig(id, params) {
  const { configValue, description, isActive, priority } = params;
  
  try {
    const [result] = await pool.query(`
      UPDATE system_configs 
      SET config_value = ?, description = ?, is_active = ?, priority = ?, updated_at = NOW()
      WHERE id = ?
    `, [JSON.stringify(configValue), description, isActive, priority, id]);
    
    return result.affectedRows > 0;
  } catch (err) {
    console.error('更新系统配置失败:', err.message);
    return false;
  }
}

// 删除系统配置
async function deleteSystemConfig(id) {
  try {
    const [result] = await pool.query(`
      DELETE FROM system_configs WHERE id = ?
    `, [id]);
    
    return result.affectedRows > 0;
  } catch (err) {
    console.error('删除系统配置失败:', err.message);
    return false;
  }
}

// 重置系统配置到默认值
async function resetSystemConfigsToDefaults(configType) {
  try {
    // 先删除所有非默认配置
    await pool.query(`
      DELETE FROM system_configs 
      WHERE config_type = ? AND is_default = FALSE
    `, [configType]);
    
    // 激活所有默认配置
    await pool.query(`
      UPDATE system_configs 
      SET is_active = TRUE, updated_at = NOW()
      WHERE config_type = ? AND is_default = TRUE
    `, [configType]);
    
    return true;
  } catch (err) {
    console.error('重置系统配置失败:', err.message);
    return false;
  }
}

// 初始化系统配置（从文件加载）
async function initializeSystemConfigs() {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // 检查是否已经初始化过
    const [existing] = await pool.query('SELECT COUNT(*) as count FROM system_configs WHERE is_default = TRUE');
    if (existing[0].count > 0) {
      console.log('系统配置已初始化，跳过文件加载');
      return;
    }
    
    // 加载 auxiliaryModels.js
    try {
      const auxiliaryModels = require('../modules/auxiliaryModels');
      for (const model of auxiliaryModels) {
        await addSystemConfig({
          configType: 'AUXILIARY_MODEL',
          configKey: model,
          configValue: { enabled: true },
          description: `辅助模型: ${model}`,
          createdBy: 'SYSTEM_INIT',
          priority: 100,
          isDefault: true
        });
      }
      console.log(`✓ 已初始化 ${auxiliaryModels.length} 个辅助模型配置`);
    } catch (err) {
      console.error('加载辅助模型配置失败:', err.message);
    }
    
    // 加载 moderationConfig.js
    try {
      const moderationConfig = require('../modules/moderationConfig');
      
      // 全局配置
      await addSystemConfig({
        configType: 'MODERATION',
        configKey: 'global',
        configValue: moderationConfig.global,
        description: '内容审核全局配置',
        createdBy: 'SYSTEM_INIT',
        priority: 1,
        isDefault: true
      });
      
      // 路由配置
      for (const [route, config] of Object.entries(moderationConfig.routes)) {
        await addSystemConfig({
          configType: 'MODERATION',
          configKey: route,
          configValue: config,
          description: `内容审核路由配置: ${route}`,
          createdBy: 'SYSTEM_INIT',
          priority: 10,
          isDefault: true
        });
      }
      
      console.log(`✓ 已初始化内容审核配置`);
    } catch (err) {
      console.error('加载内容审核配置失败:', err.message);
    }
    
    // 加载 chatnioRateLimits.js
    try {
      const chatnioRateLimits = require('../modules/chatnioRateLimits');
      
      // 公共限制配置
      await addSystemConfig({
        configType: 'CHATNIO_LIMIT',
        configKey: 'commonLimits',
        configValue: chatnioRateLimits.commonLimits,
        description: 'ChatNio 公共限制配置',
        createdBy: 'SYSTEM_INIT',
        priority: 10,
        isDefault: true
      });
      
      // 自定义用户限制配置
      for (const [userIdOrIp, config] of Object.entries(chatnioRateLimits.customLimits)) {
        await addSystemConfig({
          configType: 'CHATNIO_LIMIT',
          configKey: `custom_${userIdOrIp}`,
          configValue: config,
          description: `ChatNio 自定义限制: ${userIdOrIp}`,
          createdBy: 'SYSTEM_INIT',
          priority: 20,
          isDefault: true
        });
      }
      
      console.log(`✓ 已初始化 ChatNio 限制配置`);
    } catch (err) {
      console.error('加载 ChatNio 限制配置失败:', err.message);
    }
    
    // 加载 modelRateLimits.js
    try {
      const modelRateLimits = require('../modules/modelRateLimits');
      
      for (const [modelName, config] of Object.entries(modelRateLimits)) {
        await addSystemConfig({
          configType: 'RATE_LIMIT',
          configKey: modelName,
          configValue: config,
          description: `模型限制配置: ${modelName}`,
          createdBy: 'SYSTEM_INIT',
          priority: 10,
          isDefault: true
        });
      }
      
      console.log(`✓ 已初始化模型限制配置`);
    } catch (err) {
      console.error('加载模型限制配置失败:', err.message);
    }
    
    console.log('系统配置初始化完成');
  } catch (err) {
    console.error('初始化系统配置失败:', err.message);
  }
}

// 获取请求体修改规则
async function getRequestBodyModifyRules() {
  try {
    const [rules] = await pool.query(`
      SELECT *
      FROM system_configs
      WHERE config_type = 'REQUEST_BODY_MODIFY'
        AND is_active = TRUE
      ORDER BY JSON_EXTRACT(config_value, '$.priority') ASC, id ASC
    `);

    return rules.map(rule => {
      const config = JSON.parse(rule.config_value);
      return {
        id: rule.id,
        rule_name: config.rule_name,
        model_pattern: config.model_pattern,
        condition_type: config.condition_type,
        condition_config: config.condition_config,
        action_type: config.action_type,
        action_config: config.action_config,
        priority: config.priority,
        is_active: rule.is_active
      };
    });
  } catch (error) {
    console.error('获取请求体修改规则失败:', error);
    throw error;
  }
}

// 导出功能模块
module.exports = {
  pool,
  formatToken,
  isRestrictedModel,
  findOrCreateUser,
  logModerationResult,
  checkUserIpBanStatus,
  updateViolationCount,
  getAutoBanConfig,
  manageUserIpBan,
  getAllConfigRules,
  addConfigRule,
  updateConfigRule,
  deleteConfigRule,
  syncFileConfigToDatabase,
  // 系统配置管理功能
  getSystemConfigs,
  addSystemConfig,
  updateSystemConfig,
  deleteSystemConfig,
  resetSystemConfigsToDefaults,
  initializeSystemConfigs,
  // 请求体修改规则
  getRequestBodyModifyRules
};
