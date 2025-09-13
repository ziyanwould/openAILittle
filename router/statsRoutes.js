// statsRoutes.js
const router = require('express').Router();
const { pool, manageUserIpBan } = require('../db');

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
        DAYOFWEEK(processed_at) - 1 as day_of_week,
        COUNT(*) as total_count,
        SUM(CASE WHEN risk_level != 'PASS' THEN 1 ELSE 0 END) as violation_count,
        ROUND(SUM(CASE WHEN risk_level != 'PASS' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as violation_rate
      FROM moderation_logs 
      WHERE processed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY HOUR(processed_at), DAYOFWEEK(processed_at)
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


module.exports = router;