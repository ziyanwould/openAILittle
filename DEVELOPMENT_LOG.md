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

### 2025-09-14 - v1.5.0 自动禁封配置管理系统

#### 🎯 新增功能特性
**自动禁封配置管理**
- 创建完整的自动禁封配置API接口系统
- 实现前端可视化配置管理界面
- 支持违规次数阈值和禁封时长的动态配置
- 添加预设配置选项：轻度/默认/宽松/严格四种策略

#### 🔧 后端系统增强
**API接口完善**
- `GET /api/stats/autoban-config` - 获取当前自动禁封设置
- `PUT /api/stats/autoban-config` - 更新违规阈值和禁封时长
- `POST /api/stats/autoban-config/reset` - 重置为默认配置
- 完整的参数验证：违规次数1-100次，禁封时长1-8760小时

**数据库结构升级**
- 扩展 `system_configs` 表支持 `AUTOBAN` 配置类型
- 修改字段类型以支持简单值存储和检索
- 添加配置更新时间追踪机制

**智能化违规管理**
- `updateViolationCount` 函数重构，支持配置化参数
- `getAutoBanConfig` 函数提供缓存和默认值机制
- 支持完全禁用自动禁封功能的选项
- 动态阈值检测和可配置禁封时长

#### 🎨 前端管理界面升级
**自动禁封配置页面**
- 在内容审核管理页面新增"自动禁封设置"标签页
- 响应式表单设计，支持移动端操作
- 实时参数验证和错误提示系统
- 预设配置按钮：快速应用常用禁封策略

**用户体验优化**
- 详细的配置说明和使用指导
- 最后更新时间显示
- 重置确认对话框防误操作
- 现代化的UI设计和交互动画

#### 📊 功能验证测试
**完整测试覆盖**
- API接口功能验证：配置读取、更新、重置
- 自动禁封逻辑测试：阈值触发和时长控制
- 前端界面测试：表单验证和用户交互
- 集成测试：端到端工作流程验证

**测试结果确认**
- ✅ 配置动态更新：2次违规/1小时禁封策略生效
- ✅ 自动禁封触发：达到阈值用户被正确禁用
- ✅ 禁用状态检查：被禁封用户无法继续使用服务
- ✅ 配置持久化：重启服务后配置保持有效

#### 🚀 技术改进
**代码质量提升**
- 模块化设计：配置管理逻辑独立封装
- 错误处理完善：数据库异常和API错误处理
- 类型安全：完整的参数验证和类型转换
- 性能优化：配置缓存机制减少数据库查询

**安全性增强**
- 参数边界检查：防止异常值导致系统问题
- 事务处理：确保配置更新的原子性
- 默认值机制：配置读取失败时的降级处理

---

### 2025-09-13 - v1.4.1 审核路由识别与配置精简（已回退，仅保留"记录原始路由"变更）

本次版本变更已回退，保留的唯一改动：内容审核中间件记录原始路由（通过 `req.baseUrl/originalUrl` 分析），其余路由中间件、运行时 DB 优先等调整均已撤销。

### 2025-09-13 - v1.4.0 系统优化与配置管理升级

#### 🗂️ 配置文件结构优化
**配置文件统一管理**
- 创建专用 `config/` 文件夹，整理所有配置文件
- 统一文件路径：所有 `.txt` 和 `.json` 配置文件移至 `config/` 目录
- 更新代码引用：`index.js` 和 `db/index.js` 中的配置路径全部更新
- 保留核心文件：`package.json` 和 `错误码.txt` 留在根目录

**数据库配置管理系统**
- 实现混合配置加载策略：文件配置 + 数据库存储
- 文件规则优先级设为1，数据库规则默认优先级100
- 配置同步功能：一键同步文件配置到数据库
- 前端配置管理界面：可视化CRUD操作，支持规则类型筛选

**前端配置管理页面**
- 完整的配置规则管理界面 (`ConfigManagement.vue`)
- 视觉区分：文件规则（灰色背景 + "文件"标签 + 只读）vs 数据库规则（可编辑）
- 规则类型分类：敏感词、黑名单、白名单、用户限制、模型过滤等
- API接口完善：分页查询、新增、编辑、删除、文件同步

#### ⚡ 中间件执行顺序优化
**内容审核位置调整**
- **调整前**：内容审核在第3位执行（过早调用外部API）
- **调整后**：内容审核移至校验链末尾，作为最后防线
- **优化效果**：减少不必要的API调用，提升系统效率
- **校验顺序**：黑名单 → 敏感词 → 正则 → 业务逻辑 → 限流 → 内容审核 → 代理转发

**性能提升验证**
- 敏感词请求在前置校验被拦截，不触发内容审核API
- 正常请求通过所有前置校验后，才执行内容审核
- 系统日志清晰显示校验执行顺序，便于调试分析

#### 🛠️ API接口修复
**查询参数处理优化**
- 修复空字符串参数问题：空 `rule_type=` 不再被当作有效过滤条件
- API查询结果：从0条记录修复为正确返回19条配置规则
- 参数验证增强：`trim()` 检查确保空字符串被忽略

#### 📋 配置文件新结构
```
config/
├── BlacklistedUsers.txt      # 用户黑名单
├── BlacklistedIPs.txt        # IP黑名单  
├── Sensitive.txt             # 敏感词列表
├── whitelist.json           # 白名单配置
├── restrictedUsers.json     # 用户限制配置
├── sensitive_patterns.json  # 敏感正则模式
└── filterConfig.json        # 模型过滤配置
```

#### 🔧 技术改进
**代码质量优化**
- 统一配置文件路径管理
- API查询逻辑优化和参数验证
- 中间件执行顺序重构
- 配置管理器缓存机制完善

**系统稳定性**
- 配置加载容错处理：数据库失败时回退到文件加载
- 混合配置策略：确保系统在任何情况下都能正常运行
- 错误日志详细记录：便于问题定位和调试

---

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
