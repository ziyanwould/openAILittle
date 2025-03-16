// statsRoutes.js
const router = require('express').Router();
const { pool } = require('../db');

// 基础查询构建器 (添加分页参数)
function buildFilterQuery(params, forCount = false) {
  let query = forCount ? 'SELECT COUNT(*) as total FROM requests WHERE 1=1' : 'SELECT * FROM requests WHERE 1=1'; // 根据是否统计数量选择不同查询
  const filters = [];

  if (params.user) filters.push(`user_id = '${params.user}'`);
  if (params.ip) filters.push(`ip = '${params.ip}'`);
  if (params.model) filters.push(`model = '${params.model}'`);
  if (params.start) filters.push(`timestamp >= '${params.start}'`);
  if (params.end) filters.push(`timestamp <= '${params.end}'`);

  let filterCondition = filters.length ? ` AND ${filters.join(' AND ')}` : '';

  return query + filterCondition; //返回基础的查询
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

      // 先查询总数
      const countQuery = `
      SELECT COUNT(DISTINCT user_id) as total
      FROM requests
      WHERE timestamp >= NOW() - INTERVAL ${interval}
    `;
    const [[{ total }]] = await pool.query(countQuery);

    const query = `
      SELECT user_id, GROUP_CONCAT(DISTINCT model) AS models,
      MIN(timestamp) AS first_active, MAX(timestamp) AS last_active
      FROM requests
      WHERE timestamp >= NOW() - INTERVAL ${interval}
      GROUP BY user_id
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
        //  查询总数
        const countQuery = `
            SELECT COUNT(*) as total FROM (
                SELECT user_id, ip, model
                FROM requests
                WHERE is_restricted = true
                GROUP BY user_id, ip, model
            ) as subquery`;  // 使用子查询先分组再去重

        const [[{ total }]] = await pool.query(countQuery); //获取total

        const dataQuery = `
            SELECT user_id, ip, model, COUNT(*) AS count
            FROM requests
            WHERE is_restricted = true
            GROUP BY user_id, ip, model
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

module.exports = router;