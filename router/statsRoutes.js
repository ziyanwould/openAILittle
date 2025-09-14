// statsRoutes.js
const router = require('express').Router();
const {
  pool,
  manageUserIpBan,
  getSystemConfigs,
  addSystemConfig,
  updateSystemConfig,
  deleteSystemConfig,
  resetSystemConfigsToDefaults,
  getNotificationConfigs
} = require('../db');

// 基础查询构建器 (添加分页参数)
function buildFilterQuery(params, forCount = false) {
  let query = forCount ? 'SELECT COUNT(*) as total FROM requests WHERE 1=1' : 'SELECT * FROM requests WHERE 1=1';
  const filters = [];
  
  if (params.user) filters.push(`user_id = '${params.user}'`);
  if (params.ip) filters.push(`ip = '${params.ip}'`);
  if (params.model) filters.push(`model = '${params.model}'`);
  if (params.route) filters.push(`route = '${params.route}'`);
  // 注意：MySQL 的布尔值存储为 0/1
  if (params.is_restricted !== undefined && params.is_restricted !== '') {
    filters.push(`is_restricted = ${params.is_restricted === 'true' ? 1 : 0}`);
  }
  if (params.start) filters.push(`timestamp >= '${params.start}'`);
  if (params.end) filters.push(`timestamp <= '${params.end}'`);

  let filterCondition = filters.length ? ` AND ${filters.join(' AND ')}` : '';

  query += filterCondition;

  if (!forCount) {
    query += ' ORDER BY timestamp DESC'; 
  }

  return query;
}

// 使用统计接口 (支持分页)
router.get('/stats/usage', async (req, res) => {
    const { page = 1, pageSize = 10, ...otherParams } = req.query;
    const offset = (page - 1) * pageSize;

    try {
        const countQuery = buildFilterQuery(otherParams, true);  // 先查询符合条件的总数，true表示查询数量
        const [[{ total }]] = await pool.query(countQuery);   // 使用解构赋值获取total

        // 再进行分页数据查询
        let dataQuery = buildFilterQuery(otherParams);   //查询具体数据
        dataQuery += ` LIMIT ${pageSize} OFFSET ${offset}`;  // 添加分页

        const [rows] = await pool.query(dataQuery);

        res.json({
            data: rows,    // 当前页数据
            total: total,  // 符合条件的总数
            page: parseInt(page),
            pageSize: parseInt(pageSize)
        });
    } catch (error) {
        console.error('获取使用统计信息失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 用户活跃统计 (支持分页)
router.get('/stats/active-users', async (req, res) => {
  const { period, page = 1, pageSize = 10 } = req.query;
  const offset = (page - 1) * pageSize;
  let interval = '';

  switch (period) {
    case 'day': interval = '1 DAY'; break;
    case 'week': interval = '1 WEEK'; break;
    case 'month': interval = '1 MONTH'; break;
    default:
      return res.status(400).json({ error: '无效的 period 参数' });
  }

  try {
    // 先查询总数（此部分保持不变）
    const countQuery = `
      SELECT COUNT(DISTINCT user_id) as total
      FROM requests
      WHERE timestamp >= NOW() - INTERVAL ${interval}
    `;
    const [[{ total }]] = await pool.query(countQuery);

    // 修改数据查询，添加排序规则
    const query = `
      SELECT 
        user_id, 
        GROUP_CONCAT(DISTINCT model) AS models,
        COUNT(*) AS request_count,
        MIN(timestamp) AS first_active, 
        MAX(timestamp) AS last_active
      FROM requests
      WHERE timestamp >= NOW() - INTERVAL ${interval}
      GROUP BY user_id
      ORDER BY request_count DESC, last_active DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const [rows] = await pool.query(query);
    res.json({
      data: rows,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取活跃用户统计失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 受限模型统计 (支持分页)
router.get('/stats/restricted-usage', async (req, res) => {
    const { page = 1, pageSize = 10 } = req.query;  // 增加分页参数
    const offset = (page - 1) * pageSize;

    try {
        //  查询总数 (修正方法)
        const countQuery = `
            SELECT COUNT(DISTINCT model) as total  
            FROM requests
            WHERE is_restricted = true`;

        const [[{ total }]] = await pool.query(countQuery); //获取total

        // 数据查询 (保持分组，但调整排序)
        const dataQuery = `
            SELECT model, COUNT(*) AS count
            FROM requests
            WHERE is_restricted = true
            GROUP BY model
            ORDER BY count DESC
            LIMIT ${pageSize} OFFSET ${offset}
        `;  // 修改 LIMIT

        const [rows] = await pool.query(dataQuery);

        res.json({
            data: rows,
            total: total,
            page: parseInt(page),
            pageSize: parseInt(pageSize)
        });
    } catch (error) {
        console.error('获取受限模型使用统计失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 新增：获取对话历史
router.get('/request/:id/conversation-logs', async (req, res) => {
  try {
    const query = `
      SELECT cl.*, r.content 
      FROM conversation_logs cl
      LEFT JOIN requests r ON cl.request_id = r.id
      WHERE cl.request_id = ?
    `;
    const [rows] = await pool.query(query, [req.params.id]);
    res.json({ data: rows });
  } catch (error) {
    console.error('获取对话历史失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 辅助函数：构建基础查询
function buildBaseQuery(dimension) {
  let baseQuery = '';
  switch (dimension) {
    case 'model':
      baseQuery = `
        SELECT 
          r.model,
          COUNT(*) as total_count,
          GROUP_CONCAT(DISTINCT r.user_id) as user_ids,
          GROUP_CONCAT(DISTINCT r.ip) as ips
        FROM requests r
        WHERE r.is_restricted = true
        GROUP BY r.model
      `;
      break;
    case 'user':
      baseQuery = `
        SELECT 
          r.user_id,
          COUNT(DISTINCT r.model) as distinct_model_count,
          COUNT(*) as total_count
        FROM requests r
        WHERE r.is_restricted = true
        GROUP BY r.user_id
      `;
      break;
    case 'ip':
      baseQuery = `
        SELECT 
          r.ip,
          COUNT(DISTINCT r.model) as distinct_model_count,
          COUNT(*) as total_count
        FROM requests r
        WHERE r.is_restricted = true
        GROUP BY r.ip
      `;
      break;
  }
  return baseQuery;
}

// 模型维度统计
router.get('/stats/restricted-usage/by-model', async (req, res) => {
    const { page = 1, pageSize = 10 } = req.query;
    const offset = (page - 1) * pageSize;

    try {
        const countQuery = `SELECT COUNT(DISTINCT model) as total FROM requests WHERE is_restricted = true`;
        const [[{ total }]] = await pool.query(countQuery);

        let dataQuery = buildBaseQuery('model');
        dataQuery += ` ORDER BY total_count DESC LIMIT ${pageSize} OFFSET ${offset}`;
        const [rows] = await pool.query(dataQuery);

      const detailedRows = await Promise.all(rows.map(async row => {
            const user_ids = row.user_ids.split(',');
            
            const userDetailsQuery = `
            SELECT user_id, GROUP_CONCAT(DISTINCT ip) as ips, COUNT(*) AS user_model_count
            FROM requests
            WHERE model = ? AND user_id IN (?)
            GROUP BY user_id;
          `;
        const [userDetails] = await pool.query(userDetailsQuery, [row.model, user_ids]);

        return {
          ...row,
          users : userDetails, //这里返回一个数组，给前端的嵌套表格提供数据
        }
      }));

        res.json({
            data: detailedRows, // 返回包含用户详情的数据
            total,
            page: parseInt(page),
            pageSize: parseInt(pageSize)
        });
    } catch (error) {
        console.error('获取模型维度统计失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 用户维度统计
router.get('/stats/restricted-usage/by-user', async (req, res) => {
    // ... (类似地实现用户维度的查询，包括分页和 details 查询)
    const { page = 1, pageSize = 10 } = req.query;
    const offset = (page - 1) * pageSize;

    try {
        const countQuery = `SELECT COUNT(DISTINCT user_id) as total FROM requests WHERE is_restricted = true`;
        const [[{ total }]] = await pool.query(countQuery);

        let dataQuery = buildBaseQuery('user');
        dataQuery += ` ORDER BY total_count DESC LIMIT ${pageSize} OFFSET ${offset}`;
        const [rows] = await pool.query(dataQuery);

  const detailedRows = await Promise.all(
    rows.map(async (row) => {
  const modelsDetailQuery = `
            SELECT model, COUNT(*) AS model_count
            FROM requests
            WHERE user_id = ? AND is_restricted = true
            GROUP BY model;
            `;
      const[modelDetails] = await pool.query(modelsDetailQuery, [row.user_id]);
    
        return {
          ...row,
          models: modelDetails, // 返回模型详情的数组
        };
      })
    );
      res.json({
        data: detailedRows,
        total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
      });
     } catch (error) {
        console.error('获取用户维度统计失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// IP 维度统计
router.get('/stats/restricted-usage/by-ip', async (req, res) => {
    // ... (类似地实现 IP 维度的查询，包括分页和 details 查询)
     const { page = 1, pageSize = 10 } = req.query;
    const offset = (page - 1) * pageSize;

    try {
        const countQuery = `SELECT COUNT(DISTINCT ip) as total FROM requests WHERE is_restricted = true`;
        const [[{ total }]] = await pool.query(countQuery);

        let dataQuery = buildBaseQuery('ip');
        dataQuery += ` ORDER BY total_count DESC LIMIT ${pageSize} OFFSET ${offset}`;
      const [rows] = await pool.query(dataQuery);
        const detailedRows = await Promise.all(
            rows.map(async (row) => {
        const modelsDetailQuery = `
                SELECT model, COUNT(*) AS model_count
                FROM requests
                WHERE ip = ? AND is_restricted = true
                GROUP BY model;
                `;
        const [modelDetails] = await pool.query(modelsDetailQuery, [row.ip]);
        
            return {
              ...row,
              models: modelDetails, // 返回模型详情的数组
            };
          })
        );

      res.json({
        data: detailedRows,
        total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
      });

    } catch (error) {
        console.error('获取IP维度统计失败:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// ==================== 内容审核管理 API ====================

// 获取内容审核记录
router.get('/stats/moderation-logs', async (req, res) => {
  const { page = 1, pageSize = 10, risk_level, user_id, ip, start_date, end_date } = req.query;
  const offset = (page - 1) * pageSize;

  try {
    let whereConditions = [];
    let params = [];

    // 构建查询条件
    if (risk_level && risk_level !== 'ALL') {
      whereConditions.push('risk_level = ?');
      params.push(risk_level);
    }
    if (user_id) {
      whereConditions.push('user_id LIKE ?');
      params.push(`%${user_id}%`);
    }
    if (ip) {
      whereConditions.push('ip LIKE ?');
      params.push(`%${ip}%`);
    }
    if (start_date) {
      whereConditions.push('processed_at >= ?');
      params.push(start_date);
    }
    if (end_date) {
      whereConditions.push('processed_at <= ?');
      params.push(end_date);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM moderation_logs ${whereClause}`;
    const [[{ total }]] = await pool.query(countQuery, params);

    // 查询数据
    const dataQuery = `
      SELECT 
        id, user_id, ip, 
        SUBSTRING(content, 1, 100) as content_preview,
        risk_level, 
        JSON_EXTRACT(risk_details, '$.risk_type') as risk_types,
        route, model, processed_at
      FROM moderation_logs 
      ${whereClause}
      ORDER BY processed_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const [rows] = await pool.query(dataQuery, [...params, parseInt(pageSize), offset]);

    res.json({
      data: rows,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取审核记录失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取审核记录详情
router.get('/stats/moderation-logs/:id', async (req, res) => {
  try {
    const query = `
      SELECT * FROM moderation_logs WHERE id = ?
    `;
    const [rows] = await pool.query(query, [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: '审核记录不存在' });
    }

    res.json({ data: rows[0] });
  } catch (error) {
    console.error('获取审核记录详情失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取用户/IP标记列表
router.get('/stats/user-ip-flags', async (req, res) => {
  const { page = 1, pageSize = 10, flag_type, is_banned, search } = req.query;
  const offset = (page - 1) * pageSize;

  try {
    let whereConditions = [];
    let params = [];

    if (flag_type && flag_type !== 'ALL') {
      whereConditions.push('flag_type = ?');
      params.push(flag_type);
    }
    
    if (is_banned !== undefined && is_banned !== 'ALL') {
      whereConditions.push('is_banned = ?');
      params.push(is_banned === 'true' ? 1 : 0);
    }
    
    if (search) {
      whereConditions.push('(user_id LIKE ? OR ip LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM user_ip_flags ${whereClause}`;
    const [[{ total }]] = await pool.query(countQuery, params);

    // 查询数据
    const dataQuery = `
      SELECT 
        id, user_id, ip, flag_type, violation_count,
        first_violation_at, last_violation_at, is_banned,
        ban_until, ban_reason, created_by, updated_at,
        CASE 
          WHEN is_banned = 0 THEN '正常'
          WHEN ban_until IS NULL THEN '永久禁用'
          WHEN ban_until > NOW() THEN '临时禁用'
          ELSE '禁用已过期'
        END as status_text
      FROM user_ip_flags 
      ${whereClause}
      ORDER BY updated_at DESC, violation_count DESC
      LIMIT ? OFFSET ?
    `;
    
    const [rows] = await pool.query(dataQuery, [...params, parseInt(pageSize), offset]);

    res.json({
      data: rows,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取用户/IP标记失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 管理用户/IP禁用状态
router.post('/stats/manage-ban', async (req, res) => {
  const { userId, ip, action, banDuration, banReason, operatorId = 'ADMIN' } = req.body;

  // 参数验证
  if (!userId && !ip) {
    return res.status(400).json({ error: '必须提供用户ID或IP地址' });
  }
  
  if (!['BAN', 'UNBAN'].includes(action)) {
    return res.status(400).json({ error: '操作类型必须是 BAN 或 UNBAN' });
  }

  if (action === 'BAN' && !banReason) {
    return res.status(400).json({ error: '禁用操作必须提供禁用原因' });
  }

  try {
    const success = await manageUserIpBan({
      userId,
      ip,
      action,
      banDuration: banDuration ? parseInt(banDuration) : null,
      banReason,
      operatorId
    });

    if (success) {
      const actionText = action === 'BAN' ? '禁用' : '解禁';
      const target = userId ? `用户 ${userId}` : `IP ${ip}`;
      res.json({
        success: true,
        message: `${target} ${actionText}成功`
      });
    } else {
      res.status(500).json({ error: '操作失败' });
    }
  } catch (error) {
    console.error('管理禁用状态失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取审核统计概览
router.get('/stats/moderation-overview', async (req, res) => {
  try {
    const queries = [
      // 今日审核总数
      `SELECT COUNT(*) as today_total FROM moderation_logs WHERE DATE(processed_at) = CURDATE()`,
      // 今日违规数量
      `SELECT COUNT(*) as today_violations FROM moderation_logs WHERE DATE(processed_at) = CURDATE() AND risk_level != 'PASS'`,
      // 本周审核总数
      `SELECT COUNT(*) as week_total FROM moderation_logs WHERE processed_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)`,
      // 当前被禁用的用户/IP数量
      `SELECT COUNT(*) as banned_count FROM user_ip_flags WHERE is_banned = TRUE AND (ban_until IS NULL OR ban_until > NOW())`,
      // 风险等级分布
      `SELECT risk_level, COUNT(*) as count FROM moderation_logs WHERE processed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY risk_level`
    ];

    const [
      [[{ today_total }]], 
      [[{ today_violations }]], 
      [[{ week_total }]], 
      [[{ banned_count }]],
      riskDistribution
    ] = await Promise.all(queries.map(query => pool.query(query)));

    res.json({
      data: {
        today_total: today_total || 0,
        today_violations: today_violations || 0,
        week_total: week_total || 0,
        banned_count: banned_count || 0,
        today_violation_rate: today_total > 0 ? ((today_violations / today_total) * 100).toFixed(2) : 0,
        risk_distribution: riskDistribution[0] || []
      }
    });
  } catch (error) {
    console.error('获取审核概览失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ==================== 图表统计数据 API ====================

// 违规趋势图表数据 (最近30天每日违规统计)
router.get('/stats/moderation-trends', async (req, res) => {
  const { days = 30 } = req.query;
  
  try {
    const query = `
      SELECT 
        DATE(processed_at) as date,
        COUNT(*) as total_count,
        SUM(CASE WHEN risk_level != 'PASS' THEN 1 ELSE 0 END) as violation_count,
        ROUND(SUM(CASE WHEN risk_level != 'PASS' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as violation_rate
      FROM moderation_logs 
      WHERE processed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY DATE(processed_at)
      ORDER BY date ASC
    `;
    
    const [rows] = await pool.query(query, [parseInt(days)]);
    
    res.json({
      data: rows.map(row => ({
        date: row.date,
        total_count: row.total_count || 0,
        violation_count: row.violation_count || 0,
        violation_rate: row.violation_rate || 0
      }))
    });
  } catch (error) {
    console.error('获取违规趋势失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 风险类型分布数据
router.get('/stats/risk-distribution', async (req, res) => {
  const { days = 7 } = req.query;
  
  try {
    // 获取风险等级分布
    const riskLevelQuery = `
      SELECT 
        risk_level,
        COUNT(*) as count
      FROM moderation_logs 
      WHERE processed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY risk_level
    `;
    
    // 获取具体风险类型分布（从risk_details中提取）
    const riskTypeQuery = `
      SELECT 
        JSON_UNQUOTE(JSON_EXTRACT(risk_details, '$.risk_type[0]')) as risk_type,
        COUNT(*) as count
      FROM moderation_logs 
      WHERE processed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND risk_level != 'PASS'
        AND JSON_LENGTH(JSON_EXTRACT(risk_details, '$.risk_type')) > 0
      GROUP BY risk_type
      HAVING risk_type IS NOT NULL
      ORDER BY count DESC
      LIMIT 10
    `;
    
    const [riskLevels] = await pool.query(riskLevelQuery, [parseInt(days)]);
    const [riskTypes] = await pool.query(riskTypeQuery, [parseInt(days)]);
    
    res.json({
      data: {
        risk_levels: riskLevels.map(row => ({
          name: row.risk_level === 'PASS' ? '通过' : 
                row.risk_level === 'REVIEW' ? '可疑' : '违规',
          value: row.count,
          risk_level: row.risk_level
        })),
        risk_types: riskTypes.map(row => ({
          name: row.risk_type || '未分类',
          value: row.count
        }))
      }
    });
  } catch (error) {
    console.error('获取风险分布失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 时间段违规分析 (24小时热力图数据)
router.get('/stats/hourly-violations', async (req, res) => {
  const { days = 7 } = req.query;
  
  try {
    const query = `
      SELECT 
        HOUR(processed_at) as hour,
        (DAYOFWEEK(processed_at) - 1) as day_of_week,
        COUNT(*) as total_count,
        SUM(CASE WHEN risk_level != 'PASS' THEN 1 ELSE 0 END) as violation_count,
        ROUND(SUM(CASE WHEN risk_level != 'PASS' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as violation_rate
      FROM moderation_logs 
      WHERE processed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY HOUR(processed_at), (DAYOFWEEK(processed_at) - 1)
      ORDER BY day_of_week, hour
    `;
    
    const [rows] = await pool.query(query, [parseInt(days)]);
    
    // 构建24小时x7天的热力图数据
    const heatmapData = [];
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const found = rows.find(row => row.day_of_week === day && row.hour === hour);
        heatmapData.push([
          hour,
          day,
          found ? found.violation_rate : 0,
          found ? found.violation_count : 0,
          found ? found.total_count : 0
        ]);
      }
    }
    
    res.json({
      data: {
        heatmap: heatmapData,
        day_names: dayNames,
        statistics: rows
      }
    });
  } catch (error) {
    console.error('获取时段分析失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 模型违规统计
router.get('/stats/model-violations', async (req, res) => {
  const { days = 30 } = req.query;
  
  try {
    const query = `
      SELECT 
        model,
        route,
        COUNT(*) as total_count,
        SUM(CASE WHEN risk_level != 'PASS' THEN 1 ELSE 0 END) as violation_count,
        ROUND(SUM(CASE WHEN risk_level != 'PASS' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as violation_rate
      FROM moderation_logs 
      WHERE processed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY model, route
      HAVING total_count > 0
      ORDER BY violation_rate DESC, violation_count DESC
      LIMIT 20
    `;
    
    const [rows] = await pool.query(query, [parseInt(days)]);
    
    res.json({
      data: rows.map(row => ({
        model: row.model || '未知',
        route: row.route || '未知',
        total_count: row.total_count || 0,
        violation_count: row.violation_count || 0,
        violation_rate: row.violation_rate || 0
      }))
    });
  } catch (error) {
    console.error('获取模型违规统计失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ==================== 配置管理API接口 ====================

// 引入配置管理相关的数据库函数
const { 
  getAllConfigRules, 
  addConfigRule, 
  updateConfigRule, 
  deleteConfigRule, 
  syncFileConfigToDatabase 
} = require('../db/index');

// 获取所有配置规则
router.get('/config/rules', async (req, res) => {
  const { rule_type, is_from_file, is_active, page = 1, pageSize = 50 } = req.query;
  const offset = (page - 1) * pageSize;
  
  try {
    // 构建查询条件
    let whereConditions = [];
    let queryParams = [];
    
    if (rule_type && rule_type.trim() !== '') {
      whereConditions.push('rule_type = ?');
      queryParams.push(rule_type);
    }
    
    if (is_from_file !== undefined && is_from_file.trim() !== '') {
      whereConditions.push('is_from_file = ?');
      queryParams.push(is_from_file === 'true' ? 1 : 0);
    }
    
    if (is_active !== undefined && is_active.trim() !== '') {
      whereConditions.push('is_active = ?');
      queryParams.push(is_active === 'true' ? 1 : 0);
    }
    
    // 查询总数
    let countQuery = 'SELECT COUNT(*) as total FROM config_rules';
    if (whereConditions.length > 0) {
      countQuery += ' WHERE ' + whereConditions.join(' AND ');
    }
    
    const [[{ total }]] = await pool.query(countQuery, queryParams);
    
    // 查询数据
    let dataQuery = `
      SELECT 
        id, rule_type, rule_key, rule_value, description, 
        is_from_file, is_active, priority, created_by, 
        created_at, updated_at
      FROM config_rules
    `;
    
    if (whereConditions.length > 0) {
      dataQuery += ' WHERE ' + whereConditions.join(' AND ');
    }
    
    dataQuery += ' ORDER BY is_from_file DESC, priority ASC, created_at DESC';
    dataQuery += ` LIMIT ${pageSize} OFFSET ${offset}`;
    
    const [rows] = await pool.query(dataQuery, queryParams);
    
    res.json({
      data: rows,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取配置规则失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 添加新的配置规则
router.post('/config/rules', async (req, res) => {
  const { rule_type, rule_key, rule_value, description, priority = 100, created_by = 'USER' } = req.body;
  
  // 验证必填字段
  if (!rule_type || !rule_key) {
    return res.status(400).json({ error: 'rule_type 和 rule_key 是必填字段' });
  }
  
  // 验证规则类型
  const validRuleTypes = [
    'BLACKLIST_USER', 'BLACKLIST_IP', 'WHITELIST_USER', 'WHITELIST_IP',
    'SENSITIVE_WORD', 'SENSITIVE_PATTERN', 'MODEL_FILTER', 'USER_RESTRICTION'
  ];
  
  if (!validRuleTypes.includes(rule_type)) {
    return res.status(400).json({ error: '无效的规则类型' });
  }
  
  try {
    // 检查是否已存在相同的规则
    const [existingRules] = await pool.query(
      'SELECT id FROM config_rules WHERE rule_type = ? AND rule_key = ? AND is_active = 1',
      [rule_type, rule_key]
    );
    
    if (existingRules.length > 0) {
      return res.status(400).json({ error: '相同的配置规则已存在' });
    }
    
    // 添加新规则
    const result = await addConfigRule({
      ruleType: rule_type,
      ruleKey: rule_key,
      ruleValue: rule_value,
      description,
      createdBy: created_by,
      priority: parseInt(priority)
    });
    
    res.status(201).json({
      message: '配置规则添加成功',
      id: result.insertId
    });
  } catch (error) {
    console.error('添加配置规则失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 更新配置规则
router.put('/config/rules/:id', async (req, res) => {
  const { id } = req.params;
  const { rule_value, description, is_active, priority } = req.body;
  
  try {
    // 检查规则是否存在
    const [existingRules] = await pool.query(
      'SELECT id, is_from_file FROM config_rules WHERE id = ?',
      [id]
    );
    
    if (existingRules.length === 0) {
      return res.status(404).json({ error: '配置规则不存在' });
    }
    
    // 检查是否为文件来源的规则（文件规则不允许修改）
    if (existingRules[0].is_from_file) {
      return res.status(403).json({ error: '文件来源的配置规则不允许修改' });
    }
    
    // 构建更新字段
    const updateFields = {};
    if (rule_value !== undefined) updateFields.rule_value = rule_value;
    if (description !== undefined) updateFields.description = description;
    if (is_active !== undefined) updateFields.is_active = is_active;
    if (priority !== undefined) updateFields.priority = parseInt(priority);
    
    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: '没有提供需要更新的字段' });
    }
    
    await updateConfigRule(id, updateFields);
    
    res.json({ message: '配置规则更新成功' });
  } catch (error) {
    console.error('更新配置规则失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 删除配置规则
router.delete('/config/rules/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // 检查规则是否存在
    const [existingRules] = await pool.query(
      'SELECT id, is_from_file FROM config_rules WHERE id = ?',
      [id]
    );
    
    if (existingRules.length === 0) {
      return res.status(404).json({ error: '配置规则不存在' });
    }
    
    // 检查是否为文件来源的规则（文件规则不允许删除）
    if (existingRules[0].is_from_file) {
      return res.status(403).json({ error: '文件来源的配置规则不允许删除' });
    }
    
    await deleteConfigRule(id);
    
    res.json({ message: '配置规则删除成功' });
  } catch (error) {
    console.error('删除配置规则失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取配置规则类型列表
router.get('/config/rule-types', async (req, res) => {
  try {
    const ruleTypes = [
      {
        value: 'BLACKLIST_USER',
        label: '用户黑名单',
        description: '禁止访问的用户ID列表'
      },
      {
        value: 'BLACKLIST_IP',
        label: 'IP黑名单',
        description: '禁止访问的IP地址列表'
      },
      {
        value: 'WHITELIST_USER',
        label: '用户白名单',
        description: '允许访问的用户ID列表'
      },
      {
        value: 'WHITELIST_IP',
        label: 'IP白名单',
        description: '允许访问的IP地址列表'
      },
      {
        value: 'SENSITIVE_WORD',
        label: '敏感词',
        description: '需要过滤的敏感词汇'
      },
      {
        value: 'SENSITIVE_PATTERN',
        label: '敏感模式',
        description: '需要检测的敏感内容模式'
      },
      {
        value: 'MODEL_FILTER',
        label: '模型过滤',
        description: '特定模型的内容过滤规则'
      },
      {
        value: 'USER_RESTRICTION',
        label: '用户限制',
        description: '用户访问模型的限制规则'
      }
    ];
    
    res.json({ data: ruleTypes });
  } catch (error) {
    console.error('获取规则类型失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 同步文件配置到数据库
router.post('/config/sync-files', async (req, res) => {
  try {
    await syncFileConfigToDatabase();
    res.json({ message: '文件配置同步到数据库成功' });
  } catch (error) {
    console.error('同步文件配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取配置统计信息
router.get('/config/stats', async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT 
        rule_type,
        COUNT(*) as total_count,
        SUM(CASE WHEN is_from_file = 1 THEN 1 ELSE 0 END) as file_count,
        SUM(CASE WHEN is_from_file = 0 THEN 1 ELSE 0 END) as database_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
      FROM config_rules 
      GROUP BY rule_type
      ORDER BY rule_type
    `);
    
    res.json({ data: stats });
  } catch (error) {
    console.error('获取配置统计失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ========== 系统配置管理 API ==========

// 获取系统配置列表
router.get('/stats/system-configs', async (req, res) => {
  try {
    const { configType, page = 1, pageSize = 20 } = req.query;
    const filters = {};
    
    if (configType && configType.trim() !== '') {
      filters.configType = configType;
    }
    
    const configs = await getSystemConfigs(filters, parseInt(page), parseInt(pageSize));
    res.json({ 
      data: configs.data,
      total: configs.total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取系统配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 添加系统配置
router.post('/stats/system-configs', async (req, res) => {
  try {
    const { configType, configKey, configValue, description, priority = 100 } = req.body;
    
    if (!configType || !configKey || !configValue) {
      return res.status(400).json({ error: '配置类型、配置键和配置值不能为空' });
    }
    
    const result = await addSystemConfig({
      configType,
      configKey,
      configValue,
      description,
      priority,
      createdBy: 'USER'
    });
    
    if (result) {
      res.json({ message: '系统配置添加成功', id: result });
    } else {
      res.status(500).json({ error: '系统配置添加失败' });
    }
  } catch (error) {
    console.error('添加系统配置失败:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: '该配置键已存在' });
    } else {
      res.status(500).json({ error: '服务器内部错误' });
    }
  }
});

// 更新系统配置
router.put('/stats/system-configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { configValue, description, isActive, priority } = req.body;
    
    const updateData = {};
    if (configValue !== undefined) updateData.configValue = configValue;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (priority !== undefined) updateData.priority = priority;
    
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: '没有提供要更新的字段' });
    }
    
    const result = await updateSystemConfig(parseInt(id), updateData);
    
    if (result) {
      res.json({ message: '系统配置更新成功' });
    } else {
      res.status(404).json({ error: '系统配置不存在' });
    }
  } catch (error) {
    console.error('更新系统配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 删除系统配置
router.delete('/stats/system-configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteSystemConfig(parseInt(id));
    
    if (result) {
      res.json({ message: '系统配置删除成功' });
    } else {
      res.status(404).json({ error: '系统配置不存在' });
    }
  } catch (error) {
    console.error('删除系统配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 重置系统配置到默认值
router.post('/stats/system-configs/reset/:configType', async (req, res) => {
  try {
    const { configType } = req.params;
    
    const validTypes = ['MODERATION', 'RATE_LIMIT', 'AUXILIARY_MODEL', 'CHATNIO_LIMIT'];
    if (!validTypes.includes(configType)) {
      return res.status(400).json({ error: '无效的配置类型' });
    }
    
    const result = await resetSystemConfigsToDefaults(configType);
    
    if (result) {
      res.json({ message: `${configType} 配置已重置为默认值` });
    } else {
      res.status(500).json({ error: '重置系统配置失败' });
    }
  } catch (error) {
    console.error('重置系统配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 获取系统配置统计信息
router.get('/stats/system-configs/statistics', async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT
        config_type,
        COUNT(*) as total_count,
        SUM(CASE WHEN is_default = 1 THEN 1 ELSE 0 END) as default_count,
        SUM(CASE WHEN is_default = 0 THEN 1 ELSE 0 END) as custom_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count
      FROM system_configs
      GROUP BY config_type
      ORDER BY config_type
    `);

    res.json({ data: stats });
  } catch (error) {
    console.error('获取系统配置统计失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ==================== 自动禁封配置管理 API ====================

// 获取自动禁封配置
router.get('/stats/autoban-config', async (req, res) => {
  try {
    const [configs] = await pool.query(`
      SELECT
        config_key,
        config_value,
        description,
        updated_at
      FROM system_configs
      WHERE config_type = 'AUTOBAN' AND is_active = TRUE
      ORDER BY config_key
    `);

    // 转换为对象格式，方便前端使用
    const configObj = {};
    configs.forEach(config => {
      let value = config.config_value;
      // 尝试解析数字类型
      if (!isNaN(value) && value !== '') {
        value = Number(value);
      }
      configObj[config.config_key] = {
        value: value,
        description: config.description,
        updated_at: config.updated_at
      };
    });

    // 设置默认值（如果数据库中没有配置）
    const defaultConfig = {
      violation_threshold: {
        value: configObj.violation_threshold?.value || 5,
        description: configObj.violation_threshold?.description || '触发自动禁封的违规次数阈值',
        updated_at: configObj.violation_threshold?.updated_at || null
      },
      ban_duration_hours: {
        value: configObj.ban_duration_hours?.value || 24,
        description: configObj.ban_duration_hours?.description || '自动禁封持续时长（小时）',
        updated_at: configObj.ban_duration_hours?.updated_at || null
      },
      enabled: {
        value: configObj.enabled?.value !== undefined ? (configObj.enabled.value === 'true' || configObj.enabled.value === true) : true,
        description: configObj.enabled?.description || '是否启用自动禁封功能',
        updated_at: configObj.enabled?.updated_at || null
      }
    };

    res.json({
      data: defaultConfig,
      message: '获取自动禁封配置成功'
    });
  } catch (error) {
    console.error('获取自动禁封配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 更新自动禁封配置
router.put('/stats/autoban-config', async (req, res) => {
  try {
    const { violation_threshold, ban_duration_hours, enabled } = req.body;

    // 参数验证
    if (violation_threshold !== undefined && (violation_threshold < 1 || violation_threshold > 100)) {
      return res.status(400).json({ error: '违规次数阈值必须在1-100之间' });
    }

    if (ban_duration_hours !== undefined && (ban_duration_hours < 1 || ban_duration_hours > 8760)) {
      return res.status(400).json({ error: '禁封时长必须在1小时-1年之间' });
    }

    // 开始事务
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // 更新配置项
      const updates = [
        { key: 'violation_threshold', value: violation_threshold, description: '触发自动禁封的违规次数阈值' },
        { key: 'ban_duration_hours', value: ban_duration_hours, description: '自动禁封持续时长（小时）' },
        { key: 'enabled', value: enabled, description: '是否启用自动禁封功能' }
      ];

      for (const update of updates) {
        if (update.value !== undefined) {
          await connection.query(`
            INSERT INTO system_configs (config_type, config_key, config_value, description, created_by, is_active)
            VALUES ('AUTOBAN', ?, ?, ?, 'USER', TRUE)
            ON DUPLICATE KEY UPDATE
              config_value = VALUES(config_value),
              description = VALUES(description),
              updated_at = NOW()
          `, [update.key, String(update.value), update.description]);
        }
      }

      await connection.commit();

      res.json({
        message: '自动禁封配置更新成功',
        data: {
          violation_threshold,
          ban_duration_hours,
          enabled
        }
      });

    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) connection.release();
    }

  } catch (error) {
    console.error('更新自动禁封配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 重置自动禁封配置为默认值
router.post('/stats/autoban-config/reset', async (req, res) => {
  try {
    const defaultConfigs = [
      { key: 'violation_threshold', value: '5', description: '触发自动禁封的违规次数阈值' },
      { key: 'ban_duration_hours', value: '24', description: '自动禁封持续时长（小时）' },
      { key: 'enabled', value: 'true', description: '是否启用自动禁封功能' }
    ];

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      for (const config of defaultConfigs) {
        await connection.query(`
          INSERT INTO system_configs (config_type, config_key, config_value, description, created_by, is_active, is_default)
          VALUES ('AUTOBAN', ?, ?, ?, 'SYSTEM', TRUE, TRUE)
          ON DUPLICATE KEY UPDATE
            config_value = VALUES(config_value),
            description = VALUES(description),
            is_default = TRUE,
            updated_at = NOW()
        `, [config.key, config.value, config.description]);
      }

      await connection.commit();

      res.json({
        message: '自动禁封配置已重置为默认值',
        data: {
          violation_threshold: 5,
          ban_duration_hours: 24,
          enabled: true
        }
      });

    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) connection.release();
    }

  } catch (error) {
    console.error('重置自动禁封配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ==================== 请求体修改配置管理 API ====================

// 获取请求体修改规则
router.get('/stats/request-body-rules', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, model_pattern, is_active } = req.query;
    const offset = (page - 1) * pageSize;

    let whereConditions = ["config_type = 'REQUEST_BODY_MODIFY'"];
    let queryParams = [];

    if (model_pattern && model_pattern.trim() !== '') {
      whereConditions.push('config_key LIKE ?');
      queryParams.push(`%${model_pattern}%`);
    }

    if (is_active !== undefined && is_active.trim() !== '') {
      whereConditions.push('is_active = ?');
      queryParams.push(is_active === 'true' ? 1 : 0);
    }

    const whereClause = whereConditions.join(' AND ');

    // 查询总数
    const countQuery = `SELECT COUNT(*) as total FROM system_configs WHERE ${whereClause}`;
    const [[{ total }]] = await pool.query(countQuery, queryParams);

    // 查询数据
    const dataQuery = `
      SELECT
        id, config_key, config_value,
        is_active, created_by, created_at, updated_at
      FROM system_configs
      WHERE ${whereClause}
      ORDER BY JSON_EXTRACT(config_value, '$.priority') ASC, created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(dataQuery, [...queryParams, parseInt(pageSize), offset]);

    // 解析配置JSON，提取规则字段
    const processedRows = rows.map(row => {
      // 安全地解析配置，处理已经是对象的情况
      let config;
      try {
        if (typeof row.config_value === 'string') {
          config = JSON.parse(row.config_value || '{}');
        } else {
          config = row.config_value || {};
        }
      } catch (error) {
        console.error(`解析配置失败 (ID: ${row.id}):`, error.message);
        config = {};
      }
      return {
        id: row.id,
        rule_name: config.rule_name || row.config_key,
        model_pattern: config.model_pattern,
        condition_type: config.condition_type,
        condition_config: config.condition_config,
        action_type: config.action_type,
        action_config: config.action_config,
        description: config.description,
        priority: config.priority,
        is_active: row.is_active,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at
      };
    });

    res.json({
      data: processedRows,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      message: '获取请求体修改规则成功'
    });
  } catch (error) {
    console.error('获取请求体修改规则失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 添加请求体修改规则
router.post('/stats/request-body-rules', async (req, res) => {
  try {
    const {
      model_pattern,
      modification_rules,
      description,
      priority = 100,
      is_active = true
    } = req.body;

    // 参数验证
    if (!model_pattern || !model_pattern.trim()) {
      return res.status(400).json({ error: '模型匹配规则不能为空' });
    }

    if (!modification_rules || typeof modification_rules !== 'object') {
      return res.status(400).json({ error: '修改规则必须是有效的JSON对象' });
    }

    // 检查是否已存在相同的模型匹配规则
    const [existingRules] = await pool.query(
      `SELECT id FROM system_configs
       WHERE config_type = 'REQUEST_BODY_MODIFY' AND config_key = ? AND is_active = 1`,
      [model_pattern.trim()]
    );

    if (existingRules.length > 0) {
      return res.status(400).json({ error: '相同的模型匹配规则已存在' });
    }

    // 添加新规则
    const [result] = await pool.query(`
      INSERT INTO system_configs
      (config_type, config_key, config_value, description, priority, is_active, created_by)
      VALUES ('REQUEST_BODY_MODIFY', ?, ?, ?, ?, ?, 'USER')
    `, [
      model_pattern.trim(),
      JSON.stringify(modification_rules),
      description || '',
      parseInt(priority),
      is_active ? 1 : 0
    ]);

    res.status(201).json({
      message: '请求体修改规则添加成功',
      id: result.insertId,
      data: {
        model_pattern: model_pattern.trim(),
        modification_rules,
        description,
        priority: parseInt(priority),
        is_active
      }
    });
  } catch (error) {
    console.error('添加请求体修改规则失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 更新请求体修改规则
router.put('/stats/request-body-rules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const requestData = req.body;

    // 检查规则是否存在并获取现有配置
    const [existingRules] = await pool.query(
      `SELECT config_value, is_active FROM system_configs WHERE id = ? AND config_type = 'REQUEST_BODY_MODIFY'`,
      [id]
    );

    if (existingRules.length === 0) {
      return res.status(404).json({ error: '请求体修改规则不存在' });
    }

    // 安全解析配置值
    let currentConfig;
    try {
      if (typeof existingRules[0].config_value === 'string') {
        currentConfig = JSON.parse(existingRules[0].config_value || '{}');
      } else {
        currentConfig = existingRules[0].config_value || {};
      }
    } catch (error) {
      console.error(`解析规则配置失败 (ID: ${id}):`, error.message);
      currentConfig = {};
    }

    // 构建更新字段
    const updateFields = [];
    const updateValues = [];

    // 如果只更新 is_active 状态（状态切换）
    if (Object.keys(requestData).length === 1 && requestData.hasOwnProperty('is_active')) {
      updateFields.push('is_active = ?');
      updateValues.push(requestData.is_active ? 1 : 0);
    } else {
      // 完整规则更新
      const updatedConfig = {
        ...currentConfig,
        rule_name: requestData.rule_name || currentConfig.rule_name,
        model_pattern: requestData.model_pattern || currentConfig.model_pattern,
        condition_type: requestData.condition_type || currentConfig.condition_type,
        condition_config: requestData.condition_config !== undefined ? requestData.condition_config : currentConfig.condition_config,
        action_type: requestData.action_type || currentConfig.action_type,
        action_config: requestData.action_config !== undefined ? requestData.action_config : currentConfig.action_config,
        description: requestData.description || currentConfig.description,
        priority: requestData.priority !== undefined ? requestData.priority : currentConfig.priority
      };

      updateFields.push('config_value = ?');
      updateValues.push(JSON.stringify(updatedConfig));

      if (requestData.is_active !== undefined) {
        updateFields.push('is_active = ?');
        updateValues.push(requestData.is_active ? 1 : 0);
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: '没有提供需要更新的字段' });
    }

    updateFields.push('updated_at = NOW()');
    updateValues.push(id);

    await pool.query(`
      UPDATE system_configs
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `, updateValues);

    res.json({
      message: '请求体修改规则更新成功'
    });
  } catch (error) {
    console.error('更新请求体修改规则失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 删除请求体修改规则
router.delete('/stats/request-body-rules/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 检查规则是否存在
    const [existingRules] = await pool.query(
      `SELECT id FROM system_configs WHERE id = ? AND config_type = 'REQUEST_BODY_MODIFY'`,
      [id]
    );

    if (existingRules.length === 0) {
      return res.status(404).json({ error: '请求体修改规则不存在' });
    }

    await pool.query(`DELETE FROM system_configs WHERE id = ?`, [id]);

    res.json({
      message: '请求体修改规则删除成功'
    });
  } catch (error) {
    console.error('删除请求体修改规则失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 批量导入当前中间件规则
router.post('/stats/request-body-rules/import-current', async (req, res) => {
  try {
    const currentRules = [
      {
        model_pattern: 'huggingface/*',
        modification_rules: {
          conditions: [{ field: 'top_p', condition: 'exists_and_less_than', value: 1 }],
          modifications: [{ field: 'top_p', action: 'set_value', value: 0.5 }]
        },
        description: 'Huggingface模型top_p参数优化',
        priority: 10
      },
      {
        model_pattern: 'Baichuan*',
        modification_rules: {
          conditions: [],
          modifications: [{ field: 'frequency_penalty', action: 'set_value', value: 1 }]
        },
        description: 'Baichuan模型frequency_penalty参数设置',
        priority: 20
      },
      {
        model_pattern: '*glm-4v*',
        modification_rules: {
          conditions: [],
          modifications: [{ field: 'max_tokens', action: 'set_value', value: 1024 }]
        },
        description: 'GLM-4V模型max_tokens参数限制',
        priority: 30
      },
      {
        model_pattern: 'o3-mini',
        modification_rules: {
          conditions: [],
          modifications: [{ field: 'top_p', action: 'delete_field' }]
        },
        description: 'O3-mini模型移除top_p参数',
        priority: 40
      },
      {
        model_pattern: 'o1-mini',
        modification_rules: {
          conditions: [],
          modifications: [{ field: 'top_p', action: 'delete_field' }]
        },
        description: 'O1-mini模型移除top_p参数',
        priority: 50
      },
      {
        model_pattern: 'tts-1',
        modification_rules: {
          conditions: [],
          modifications: [
            { field: 'model', action: 'set_value', value: 'fnlp/MOSS-TTSD-v0.5' },
            { field: 'stream', action: 'set_value', value: false },
            { field: 'speed', action: 'set_value', value: 1 },
            { field: 'gain', action: 'set_value', value: 0 },
            { field: 'voice', action: 'set_value', value: 'fishaudio/fish-speech-1.4:alex' },
            { field: 'response_format', action: 'set_value', value: 'mp3' },
            { field: '*', action: 'keep_only_fields', value: ['input', 'model', 'stream', 'speed', 'gain', 'voice', 'response_format'] }
          ]
        },
        description: 'TTS-1模型请求体重构',
        priority: 60
      }
    ];

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      let importedCount = 0;
      for (const rule of currentRules) {
        // 检查是否已存在 - 使用描述作为唯一标识
        const [existing] = await connection.query(
          `SELECT id FROM system_configs
           WHERE config_type = 'REQUEST_BODY_MODIFY' AND config_key = ?`,
          [rule.description]
        );

        if (existing.length === 0) {
          const configValue = {
            rule_name: rule.description || rule.model_pattern,
            model_pattern: rule.model_pattern,
            condition_type: rule.modification_rules.conditions.length > 0 ? 'param_exists' : 'always',
            condition_config: rule.modification_rules.conditions.length > 0 ?
              { param: rule.modification_rules.conditions[0].field } : null,
            action_type: rule.modification_rules.modifications.length === 1 &&
                        rule.modification_rules.modifications[0].action === 'delete_field' ? 'delete_param' :
                        rule.modification_rules.modifications.some(m => m.field === '*') ? 'replace_body' : 'set_param',
            action_config: rule.modification_rules.modifications.length === 1 &&
                          rule.modification_rules.modifications[0].action === 'delete_field' ?
                          [rule.modification_rules.modifications[0].field] :
                          rule.modification_rules.modifications.some(m => m.field === '*') ?
                          rule.modification_rules.modifications.reduce((acc, m) => {
                            if (m.field !== '*') acc[m.field] = m.value;
                            return acc;
                          }, {}) :
                          rule.modification_rules.modifications.reduce((acc, m) => {
                            acc[m.field] = m.value;
                            return acc;
                          }, {}),
            description: rule.description,
            priority: rule.priority
          };

          await connection.query(`
            INSERT INTO system_configs
            (config_type, config_key, config_value, is_active, created_by)
            VALUES ('REQUEST_BODY_MODIFY', ?, ?, TRUE, 'SYSTEM')
          `, [
            rule.description || rule.model_pattern,
            JSON.stringify(configValue)
          ]);
          importedCount++;
        }
      }

      await connection.commit();

      res.json({
        message: `成功导入 ${importedCount} 条请求体修改规则`,
        imported_count: importedCount,
        total_rules: currentRules.length
      });

    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) connection.release();
    }

  } catch (error) {
    console.error('导入当前规则失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ==================== 通知配置管理 API ====================

// 获取通知配置列表
// 加载预设通知规则
function loadPredefinedNotificationRules() {
  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, '..', 'config', 'notificationRules.json');

    if (fs.existsSync(configPath)) {
      const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return configData.predefined_rules || [];
    }
    return [];
  } catch (error) {
    console.error('[预设通知规则] 加载失败:', error.message);
    return [];
  }
}

router.get('/stats/notification-configs', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, config_key, is_active } = req.query;

    // 加载数据库配置
    let whereConditions = ["config_type = 'NOTIFICATION'"];
    let queryParams = [];

    if (config_key && config_key.trim() !== '') {
      whereConditions.push('config_key LIKE ?');
      queryParams.push(`%${config_key}%`);
    }

    if (is_active !== undefined && is_active.trim() !== '') {
      whereConditions.push('is_active = ?');
      queryParams.push(is_active === 'true' ? 1 : 0);
    }

    const whereClause = whereConditions.join(' AND ');

    // 查询数据库配置
    const dataQuery = `
      SELECT
        id, config_key, config_value,
        description, is_active, priority,
        created_by, created_at, updated_at
      FROM system_configs
      WHERE ${whereClause}
      ORDER BY priority ASC, config_key ASC
    `;

    const [dbRows] = await pool.query(dataQuery, queryParams);

    // 解析数据库配置JSON
    const processedDbRows = dbRows.map(row => {
      let configValue;
      try {
        if (typeof row.config_value === 'string') {
          configValue = JSON.parse(row.config_value || '{}');
        } else {
          configValue = row.config_value || {};
        }
      } catch (error) {
        console.error(`解析通知配置失败 (ID: ${row.id}):`, error.message);
        configValue = {};
      }

      return {
        id: row.id,
        config_key: row.config_key,
        config_value: configValue,
        description: row.description,
        is_active: Boolean(row.is_active),
        priority: row.priority,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
        readonly: false
      };
    });

    // 加载预设规则
    const predefinedRules = loadPredefinedNotificationRules();

    // 转换预设规则格式
    const processedPredefinedRules = predefinedRules.map(rule => ({
      id: rule.id,
      config_key: rule.topic,
      config_value: {
        notification_type: rule.type,
        enabled: rule.enabled,
        webhook_url: rule.config.webhook_url,
        api_key: rule.config.pushkey || rule.config.api_key
      },
      description: rule.name,
      is_active: rule.enabled,
      priority: rule.priority || 1000,
      created_by: 'SYSTEM',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      readonly: rule.readonly || false
    }));

    // 过滤预设规则（如果有搜索条件）
    let filteredPredefinedRules = processedPredefinedRules;
    if (config_key && config_key.trim() !== '') {
      filteredPredefinedRules = processedPredefinedRules.filter(rule =>
        rule.config_key.toLowerCase().includes(config_key.toLowerCase()) ||
        rule.description.toLowerCase().includes(config_key.toLowerCase())
      );
    }
    if (is_active !== undefined && is_active.trim() !== '') {
      const activeFilter = is_active === 'true';
      filteredPredefinedRules = filteredPredefinedRules.filter(rule => rule.is_active === activeFilter);
    }

    // 合并数据并分页
    const allData = [...processedDbRows, ...filteredPredefinedRules];
    const total = allData.length;
    const offset = (page - 1) * pageSize;
    const paginatedData = allData.slice(offset, offset + parseInt(pageSize));

    res.json({
      success: true,
      data: paginatedData,
      total: total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取通知配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 添加通知配置
router.post('/stats/notification-configs', async (req, res) => {
  try {
    const {
      config_key,
      notification_type,
      enabled = false,
      webhook_url = '',
      api_key = '',
      topic = '',
      description = '',
      priority = 100
    } = req.body;

    // 参数验证
    if (!config_key || !config_key.trim()) {
      return res.status(400).json({ error: '配置键名不能为空' });
    }

    if (!notification_type || !['pushdeer', 'lark', 'dingtalk', 'ntfy'].includes(notification_type)) {
      return res.status(400).json({ error: '通知类型必须是 pushdeer、lark、dingtalk 或 ntfy' });
    }

    // 构建配置对象
    const configValue = {
      notification_type,
      enabled: Boolean(enabled),
      webhook_url,
      api_key,
      topic,
      priority: parseInt(priority)
    };

    const result = await addSystemConfig({
      configType: 'NOTIFICATION',
      configKey: config_key.trim(),
      configValue,
      description: description.trim(),
      createdBy: 'ADMIN',
      priority: parseInt(priority)
    });

    res.json({
      success: true,
      message: '通知配置添加成功',
      id: result.insertId
    });
  } catch (error) {
    console.error('添加通知配置失败:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: '配置键名已存在' });
    } else {
      res.status(500).json({ error: '服务器内部错误' });
    }
  }
});

// 更新通知配置
router.put('/stats/notification-configs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || id <= 0) {
      return res.status(400).json({ error: '无效的配置ID' });
    }

    // 检查是否仅更新状态
    if (Object.keys(req.body).length === 1 && req.body.hasOwnProperty('is_active')) {
      const { is_active } = req.body;

      const [result] = await pool.query(
        'UPDATE system_configs SET is_active = ?, updated_at = NOW() WHERE id = ? AND config_type = "NOTIFICATION"',
        [Boolean(is_active), id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: '通知配置不存在' });
      }

      return res.json({
        success: true,
        message: '通知配置状态更新成功'
      });
    }

    // 完整配置更新
    const {
      notification_type,
      enabled,
      webhook_url,
      api_key,
      topic,
      description,
      priority,
      is_active
    } = req.body;

    if (notification_type && !['pushdeer', 'lark', 'dingtalk', 'ntfy'].includes(notification_type)) {
      return res.status(400).json({ error: '通知类型必须是 pushdeer、lark、dingtalk 或 ntfy' });
    }

    // 构建配置对象
    const configValue = {
      notification_type,
      enabled: Boolean(enabled),
      webhook_url: webhook_url || '',
      api_key: api_key || '',
      topic: topic || '',
      priority: parseInt(priority) || 100
    };

    const success = await updateSystemConfig(id, {
      configValue,
      description: description || '',
      isActive: Boolean(is_active),
      priority: parseInt(priority) || 100
    });

    if (!success) {
      return res.status(404).json({ error: '通知配置不存在' });
    }

    res.json({
      success: true,
      message: '通知配置更新成功'
    });
  } catch (error) {
    console.error('更新通知配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 更新预设通知规则状态
router.put('/stats/notification-configs/predefined/:id', async (req, res) => {
  try {
    const ruleId = req.params.id;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: '启用状态必须是布尔值' });
    }

    // 读取配置文件
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, '..', 'config', 'notificationRules.json');

    if (!fs.existsSync(configPath)) {
      return res.status(404).json({ error: '预设规则配置文件不存在' });
    }

    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const predefinedRules = configData.predefined_rules || [];

    // 查找要更新的规则
    const ruleIndex = predefinedRules.findIndex(rule => rule.id === ruleId);
    if (ruleIndex === -1) {
      return res.status(404).json({ error: '预设规则不存在' });
    }

    // 更新规则状态
    predefinedRules[ruleIndex].enabled = enabled;

    // 写回配置文件
    configData.predefined_rules = predefinedRules;
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8');

    // 清除通知配置缓存
    // 发送信号给主进程清除缓存（如果需要的话）

    res.json({
      success: true,
      message: '预设规则状态更新成功'
    });
  } catch (error) {
    console.error('更新预设规则失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 删除通知配置
router.delete('/stats/notification-configs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || id <= 0) {
      return res.status(400).json({ error: '无效的配置ID' });
    }

    const [result] = await pool.query(
      'DELETE FROM system_configs WHERE id = ? AND config_type = "NOTIFICATION"',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '通知配置不存在' });
    }

    res.json({
      success: true,
      message: '通知配置删除成功'
    });
  } catch (error) {
    console.error('删除通知配置失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 测试通知配置
router.post('/stats/notification-configs/:id/test', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || id <= 0) {
      return res.status(400).json({ error: '无效的配置ID' });
    }

    // 获取配置
    const [configs] = await pool.query(
      'SELECT config_key, config_value FROM system_configs WHERE id = ? AND config_type = "NOTIFICATION"',
      [id]
    );

    if (configs.length === 0) {
      return res.status(404).json({ error: '通知配置不存在' });
    }

    const config = configs[0];
    let configValue;
    try {
      if (typeof config.config_value === 'string') {
        configValue = JSON.parse(config.config_value || '{}');
      } else {
        configValue = config.config_value || {};
      }
    } catch (error) {
      return res.status(400).json({ error: '配置格式错误' });
    }

    // 构建测试消息
    const testMessage = {
      ip: '127.0.0.1',
      userId: 'test_user',
      modelName: 'test-model',
      time: new Date().toLocaleString('zh-CN')
    };

    const testContent = `测试消息\n模型：${testMessage.modelName}\nIP 地址：${testMessage.ip}\n用户 ID：${testMessage.userId}\n时间：${testMessage.time}`;

    let testResult;

    switch (configValue.notification_type) {
      case 'pushdeer':
        const { sendNotification } = require('../notices/pushDeerNotifier');
        testResult = await sendNotification(testMessage, testContent, configValue.api_key);
        break;
      case 'lark':
        const { sendLarkNotification } = require('../notices/larkNotifier');
        testResult = await sendLarkNotification(testMessage, testContent, configValue.webhook_url);
        break;
      case 'dingtalk':
        const { sendDingTalkNotification } = require('../notices/dingTalkNotifier');
        testResult = await sendDingTalkNotification(testContent, configValue.webhook_url);
        break;
      case 'ntfy':
        const { sendNTFYNotification } = require('../notices/ntfyNotifier');
        testResult = await sendNTFYNotification(testMessage, testContent, configValue.topic, configValue.api_key);
        break;
      default:
        return res.status(400).json({ error: '不支持的通知类型' });
    }

    res.json({
      success: true,
      message: '测试通知发送成功'
    });
  } catch (error) {
    console.error('测试通知发送失败:', error);
    res.status(500).json({ error: '测试通知发送失败: ' + error.message });
  }
});


module.exports = router;
