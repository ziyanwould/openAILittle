/**
 * @Author: Liu Jiarong
 * @Date: 2025-03-16 01:27:25
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-06-10 22:44:55
 * @FilePath: /openAILittle-1/statsServer.js
 * @Description: 
 * @
 * @Copyright (c) 2025 by ${git_name_email}, All Rights Reserved. 
 */
// statsServer.js
const express = require('express');
const { pool } = require('./db');
const cors = require('cors');  // 按需安装
const statsRoutes = require('./router/statsRoutes');

// 新建独立应用实例
const statsApp = express();

// 中间件 (只影响此端口)
statsApp.use(cors()); // 允许跨域访问统计接口
statsApp.use(express.json());

// 路由挂载
statsApp.use('/api', statsRoutes);

// 独立端口配置
const STATS_PORT = process.env.STATS_PORT || 30491;

// 启动服务
statsApp.listen(STATS_PORT, () => {
  console.log(`📊 统计接口运行于 http://localhost:${STATS_PORT}`);
});