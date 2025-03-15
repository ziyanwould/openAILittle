/**
 * @Author: Liu Jiarong
 * @Date: 2025-03-15 23:14:10
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-03-15 23:14:16
 * @FilePath: /openAILittle/router/statsRoutes.js
 * @Description: 
 * @
 * @Copyright (c) 2025 by ${git_name_email}, All Rights Reserved. 
 */
// statsRoutes.js
const router = require('express').Router();
const { pool } = require('../db');

// 基础查询构建器
function buildFilterQuery(params) {
  let query = 'SELECT * FROM requests WHERE 1=1';
  const filters = [];
  
  if (params.user) filters.push(`user_id = '${params.user}'`);
  if (params.ip) filters.push(`ip = '${params.ip}'`);
  if (params.model) filters.push(`model = '${params.model}'`);
  if (params.start) filters.push(`timestamp >= '${params.start}'`);
  if (params.end) filters.push(`timestamp <= '${params.end}'`);
  
  return query + (filters.length ? ` AND ${filters.join(' AND ')}` : '');
}

// 使用统计接口
router.get('/stats/usage', async (req, res) => {
  const query = buildFilterQuery(req.query);
  const [rows] = await pool.query(query);
  res.json(rows);
});

// 用户活跃统计
router.get('/stats/active-users', async (req, res) => {
  const { period } = req.query;
  let interval = '';
  
  switch (period) {
    case 'day': interval = '1 DAY'; break;
    case 'week': interval = '1 WEEK'; break;
    case 'month': interval = '1 MONTH'; break;
  }
  
  const query = `
    SELECT user_id, GROUP_CONCAT(DISTINCT model) AS models, 
    MIN(timestamp) AS first_active, MAX(timestamp) AS last_active 
    FROM requests 
    WHERE timestamp >= NOW() - INTERVAL ${interval}
    GROUP BY user_id
  `;
  
  const [rows] = await pool.query(query);
  res.json(rows);
});

// 受限模型统计
router.get('/stats/restricted-usage', async (req, res) => {
  const query = `
    SELECT user_id, ip, model, COUNT(*) AS count 
    FROM requests 
    WHERE is_restricted = true
    GROUP BY user_id, ip, model 
    ORDER BY count DESC
    LIMIT 100
  `;
  
  const [rows] = await pool.query(query);
  res.json(rows);
});

module.exports = router;