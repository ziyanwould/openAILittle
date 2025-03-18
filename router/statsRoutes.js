// statsRoutes.js
const router = require('express').Router();
const { pool } = require('../db');

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


module.exports = router;