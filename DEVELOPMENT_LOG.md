# OpenAI Little - 开发记录文档

> **更新时间**: 2025-09-13  
> **版本**: 1.3.0 (内容审核管理系统+现代化前端界面)  
> **作者**: Liu Jiarong  

## 🏗️ 项目架构概览

### 核心服务架构
```
openAILittle/
├── 主代理服务 (index.js)           # 端口: 7104 (20491容器内)
├── 统计服务 (statsServer.js)       # 端口: 7103 (30491容器内)  
├── MySQL数据库                     # 端口: 7102 (usage_stats)
└── Docker容器化部署                # docker-compose.yml
```

### 技术栈
- **运行环境**: Node.js 18 + Express.js
- **数据库**: MySQL 8+ (usage_stats)
- **容器化**: Docker + Docker Compose
- **包管理**: pnpm
- **代理**: http-proxy-middleware
- **限流**: express-rate-limit
- **时间处理**: moment.js

## 🔄 支持的AI模型路由

| 路由前缀 | 目标服务 | 端口配置 | 状态 |
|---------|---------|----------|------|
| `/v1/*` | OpenAI API | TARGET_SERVER | ✅ 运行中 |
| `/google/*` | Google Gemini | TARGET_SERVER_GEMIN | ✅ 运行中 |
| `/chatnio/*` | ChatNio | TARGET_SERVER | ✅ 运行中 |
| `/freelyai/*` | FreelyAI | TARGET_SERVER | ✅ 运行中 |
| `/freeopenai/*` | Free OpenAI | TARGET_SERVER | ✅ 运行中 |
| `/freegemini/*` | Free Gemini | TARGET_SERVER_GEMIN | ✅ 运行中 |

## 🛡️ 安全防护系统

### 多层安全机制
1. **黑白名单控制**
   - `whitelist.json` - 用户ID和IP白名单
   - `BlacklistedUsers.txt` - 用户黑名单
   - `BlacklistedIPs.txt` - IP地址黑名单

2. **内容安全过滤**
   - `Sensitive.txt` - 敏感词列表
   - `sensitive_patterns.json` - 正则表达式模式
   - `filterConfig.json` - 模型级别过滤配置

3. **模型访问控制**
   - `restrictedUsers.json` - 基于用户的模型权限限制
   - `FREELYAI_WHITELIST` - FreelyAI模型白名单
   - `ROBOT_WHITELIST` - OpenAI路由模型白名单

4. **🆕 内容审查系统** (2025-09-11 新增)
   - `modules/moderationConfig.js` - 内容审查配置
   - `middleware/contentModerationMiddleware.js` - 审查中间件
   - 集成智谱AI内容安全API
   - 支持实时内容审查和风险检测

## ⚡ 智能限流系统

### 限流配置文件
- `modules/modelRateLimits.js` - 模型级别限流策略
- `modules/chatnioRateLimits.js` - ChatNio专属限流
- `modules/auxiliaryModels.js` - 辅助模型列表

### 限流策略
- **时间窗口限流** - 指定时间内请求次数
- **每日总量限制** - 日最大请求数控制
- **模型级别限流** - 不同模型不同策略
- **反滥用机制** - 重复请求检测、频率控制

## 🔧 中间件系统

### 现有中间件
| 中间件文件 | 功能描述 | 状态 |
|-----------|----------|------|
| `limitRequestBodyLength.js` | 请求体长度限制 | ✅ 活跃 |
| `loggingMiddleware.js` | 日志记录中间件 | ✅ 活跃 |
| `modifyRequestBodyMiddleware.js` | 请求体修改处理 | ✅ 活跃 |
| `contentModerationMiddleware.js` | 内容审查中间件 | 🆕 新增 |

### 中间件执行顺序 (index.js)
```javascript
1. restrictGeminiModelAccess
2. loggingMiddleware  
3. contentModerationMiddleware  // 🆕 新增
4. 其他路由特定中间件...
```

## 📊 监控通知系统

### 通知渠道
- `notices/pushDeerNotifier.js` - 移动端推送
- `notices/larkNotifier.js` - 飞书企业通知
- `notices/dingTalkNotifier.js` - 钉钉团队通知
- `notices/ntfyNotifier.js` - 轻量级推送

### 监控项目
- 请求频率异常
- 安全规则触发
- 限流事件触发
- 系统错误和异常
- 🆕 内容审查失败事件

## 🗄️ 数据层

### MySQL数据库
- **连接配置**: `db/index.js`
- **统计API**: `router/statsRoutes.js`
- **数据库名**: usage_stats
- **用户认证**: appuser/apppass

### 统计服务 (statsServer.js)
- **独立端口**: 7103 (30491容器内)
- **CORS支持**: 前端数据可视化
- **API路由**: `/api/*`

## 🆕 内容审查功能详情 (2025-09-11)

### 配置文件: `modules/moderationConfig.js`
```javascript
{
  global: {
    enabled: true, // ✅ 已启用
    apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/moderations',
    timeout: 10000
  },
  routes: {
    '/v1': { enabled: true, models: {...} },
    '/chatnio': { enabled: true, models: {
      'deepseek-ai/DeepSeek-V3.1': { enabled: true } // 已配置
    }},
    '/freeopenai': { enabled: true, models: {...} }
  }
}
```

### 智谱AI内容安全API集成
- **API端点**: `https://open.bigmodel.cn/api/paas/v4/moderations`
- **模型**: `moderation`
- **认证**: Bearer token (ZHIPU_API_KEY)
- **输入限制**: 最大2000字符
- **风险等级**: PASS(通过) / REVIEW(可疑,拦截) / REJECT(违规,拦截)

### 审查流程
```
1. 请求到达 → 2. 检查路由/模型配置 → 3. 提取内容 
→ 4. 调用智谱API → 5. 解析结果 → 6. 通过/拦截
```

### 缓存机制
- **缓存时间**: 30分钟
- **缓存清理**: 每10分钟自动清理
- **配置重载**: 每5分钟热更新

## 🐳 容器化部署

### Docker配置
- **基础镜像**: node:18-alpine
- **工作目录**: /app
- **包管理**: pnpm
- **端口暴露**: 20491, 30491

### Docker Compose服务
```yaml
services:
  mysql:
    image: mysql:8.2
    container_name: nodeopenai-mysql2
    ports: ["7102:3306"]
    environment:
      MYSQL_DATABASE: usage_stats
      MYSQL_USER: appuser
      MYSQL_PASSWORD: apppass
```

## 🔑 环境变量配置

### 核心配置 (.env)
```bash
# 服务端点
TARGET_SERVER=http://10.31.31.135:7068
TARGET_SERVER_GEMIN=https://proxy.liujiarong.online/google
TARGET_SERVER_FEISHU=https://open.feishu.cn/open-apis/bot/v2/hook/

# 数据库配置
DB_HOST=127.0.0.1
DB_USER=appuser
DB_PASSWORD=apppass
DB_NAME=usage_stats
DB_PORT=7102

# 端口配置
STATS_PORT=7103
MAIN_PORT=7104

# 🆕 内容审查配置
ZHIPU_API_KEY=c5a84cde65d86beb070277e68a0d41a5.qoo9MSsDXWiENir3

# 模型白名单
FREELYAI_WHITELIST=deepseek-v3,deepseek-r1,glm-4-flashx-250414...
ROBOT_WHITELIST=deepseek-v3,deepseek-r1,gpt-4.5-preview...
```

## 📋 开发记录

### 最近更新 (2025-09-11)
1. ✅ **新增内容审查功能**
   - 创建 `modules/moderationConfig.js` 配置文件
   - 实现 `middleware/contentModerationMiddleware.js` 中间件
   - 集成智谱AI内容安全API
   - 添加详细的调试日志

2. ✅ **功能验证完成**
   - API调用成功 (状态码200)
   - 响应解析正确 (risk_level: PASS/REVIEW/REJECT)
   - 缓存机制正常工作
   - 错误处理完善

### 测试状态
- ✅ 正常内容通过审查 (PASS)
- ✅ API响应格式解析正确
- ✅ 缓存和配置热更新正常
- ✅ 日志记录详细完整

### 待测试项目
- ⏳ 违规内容拦截测试 (REJECT)
- ⏳ 可疑内容处理测试 (REVIEW)
- ⏳ 长文本截断测试 (>2000字符)
- ⏳ API错误处理测试

## 🚀 性能优化记录

### 已实现优化
1. **缓存系统**: 内容审查结果缓存30分钟
2. **异步处理**: 日志中间件无阻塞处理
3. **配置热更新**: 避免重启服务
4. **请求复用**: 相同内容复用审查结果
5. **错误容错**: API错误时默认通过，不阻塞服务

### 性能指标
- **内容审查延迟**: ~1-2秒 (含网络请求)
- **缓存命中率**: 预期 >60% (相同内容重复请求)
- **API调用成本**: 1.2元/万次 (智谱AI定价)

## 🛠️ 常用命令

### 开发环境
```bash
# 启动服务
pnpm start                    # 同时启动主服务和统计服务
pnpm run start:main          # 仅启动主服务 (端口7104)
pnpm run start:stats         # 仅启动统计服务 (端口7103)

# 数据库操作
docker-compose up -d mysql   # 启动MySQL容器
docker-compose ps           # 查看容器状态
```

### 调试和监控
```bash
# 实时日志
tail -f logs/app.log        # 应用日志
docker logs -f nodeopenai-mysql2  # 数据库日志

# 内容审查调试
grep "Content Moderation" logs/app.log  # 过滤审查日志
```

## 🔍 故障排查指南

### 内容审查相关问题
1. **API调用失败 (404)**
   - 检查 `ZHIPU_API_KEY` 是否正确配置
   - 验证API端点 `https://open.bigmodel.cn/api/paas/v4/moderations`

2. **审查未触发**
   - 确认 `global.enabled = true`
   - 检查路由和模型配置是否匹配
   - 查看 `[Content Moderation]` 日志

3. **内容长度超限**
   - 智谱AI限制文本最大2000字符
   - 中间件会自动截断超长内容

### 常见错误码
- `4035` - 内容审查未通过
- `4031` - 用户黑名单
- `4032` - 敏感词拦截
- `4291-4299` - 各种限流策略触发

## 🆕 更新日志

### 2025-09-13 - v1.3.0 重大更新：完整审核管理系统

#### 🚀 后端系统增强
**数据库架构升级**
- 新增 `moderation_logs` 表：完整记录所有审核结果，支持内容哈希去重
- 新增 `user_ip_flags` 表：用户/IP违规计数与禁用管理
- 完整的索引策略：提升查询性能，支持大数据量
- 外键约束设计：保证数据一致性和完整性

**内容审核中间件升级**
- **数据库集成**：所有审核结果自动入库，支持历史追踪
- **智能用户识别**：兼容多种请求格式的用户ID和IP提取
- **自动违规管理**：5次违规自动禁用24小时，支持递进式处罚
- **性能优化**：缓存+数据库双重存储，批量操作减少延迟

**管理API完整实现**
- 审核记录API：分页查询、多维度筛选、详情查看
- 用户/IP管理API：禁用/解禁操作、批量管理
- 统计分析API：概览数据、趋势分析、风险分布
- 图表数据API：违规趋势、热力图、模型统计

#### 🎨 前端界面全面重构
**现代企业级设计**
- **侧边栏导航**：深色主题 + 图标化菜单，宽度优化200px
- **顶部导航**：面包屑导航 + 用户下拉菜单 + 通知系统
- **响应式布局**：完整移动端适配，媒体查询优化
- **视觉设计**：蚂蚁设计规范配色，专业企业风格

**完整审核管理界面**
- **审核记录管理**：表格展示、实时筛选、详情弹窗
- **用户/IP管理**：违规统计、禁用控制、状态追踪
- **数据可视化**：ECharts图表组件，交互式数据展示
- **统计分析页面**：多维度图表、实时数据刷新

**图表组件系统**
- `ViolationTrendsChart`：违规趋势线图，支持时间范围选择
- `RiskDistributionChart`：风险类型饼图，可切换等级/类型视图
- `HourlyHeatmapChart`：24小时热力图，时段风险分析
- 所有图表支持响应式、悬浮提示、图例交互

#### 🛠️ 技术架构优化
**安全防护增强**
- 自动禁用机制：智能识别频繁违规用户
- 数据完整性：事务处理，错误不影响主流程
- 性能优化：SQL查询优化，批量操作减少IO

**代码质量提升**
- Vue 3 Composition API：现代化组件架构
- TypeScript类型安全：接口定义清晰
- 错误处理完善：数据库异常降级处理
- 日志系统增强：详细的审核流程日志

#### 📊 功能特性
**管理员操作**
- 实时查看所有审核记录和违规统计
- 手动禁用/解禁用户或IP地址
- 设置禁用时长（小时级精确控制）
- 导出审核报告（开发中）

**数据分析**
- 违规趋势分析：日、周、月维度统计
- 风险类型分布：饼图展示高危内容类型
- 时段分析：24小时热力图识别高风险时段
- 模型统计：不同AI模型的违规率对比

---

### 2025-09-11 - v1.2.0：内容审查功能
- 集成智谱AI内容安全API
- 实现内容审查中间件
- 支持实时内容风险检测

## 📚 相关文档链接

- [智谱AI内容安全API文档](https://docs.bigmodel.cn/api-reference/moderation)
- [Docker Compose参考](https://docs.docker.com/compose/)
- [Express.js中间件文档](https://expressjs.com/en/guide/using-middleware.html)
- [Vue 3 官方文档](https://vuejs.org/)
- [Element Plus 组件库](https://element-plus.org/)
- [ECharts 数据可视化](https://echarts.apache.org/)

---

**维护说明**: 此文档记录了项目的完整架构和最新开发进展，建议每次重大更新后及时更新此文档。