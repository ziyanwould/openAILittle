# OpenAI Little - 开发记录文档

> **更新时间**: 2025-10-18
> **版本**: 1.11.0
> **作者**: Liu Jiarong

---

## 📋 快速了解

**项目定位**: 多模态AI服务聚合平台，统一代理多个AI服务提供商，具备企业级安全防护、限流、内容审查、监控通知等功能。

**核心价值**:
- 🔒 统一安全防护层（黑白名单、敏感词过滤、内容审查）
- ⚡ 智能限流系统（防滥用、成本控制）
- 📊 完整的监控通知和数据统计
- 🎨 前端可视化管理界面
- 🐳 Docker容器化部署

---

## 🏗️ 项目架构

### 核心服务
```
openAILittle/
├── 主代理服务 (index.js)           # 端口: 7104 (20491容器内)
├── 统计服务 (statsServer.js)       # 端口: 7103 (30491容器内)
├── MySQL数据库                     # 端口: 7102 (usage_stats)
├── 图像中间件                      # 端口: 6053
└── Docker容器化部署                # docker-compose.yml
```

### 技术栈
- **运行环境**: Node.js 18 + Express.js
- **数据库**: MySQL 8.2
- **容器化**: Docker + Docker Compose
- **包管理**: pnpm
- **核心库**: http-proxy-middleware, express-rate-limit, moment.js

---

## 🔄 支持的AI服务路由

| 路由前缀 | 目标服务 | 支持功能 | 状态 |
|---------|---------|----------|------|
| `/v1/*` | OpenAI API | 文本生成、TTS | ✅ |
| `/google/*` | Google Gemini | 文本生成、多模态 | ✅ |
| `/chatnio/*` | ChatNio | 文本生成 | ✅ |
| `/freelyai/*` | FreelyAI | 文本生成 | ✅ |
| `/freeopenai/*` | Free OpenAI | 文本生成 | ✅ |
| `/freegemini/*` | Free Gemini | 文本生成、多模态 | ✅ |
| `/cloudflare/*` | Cloudflare AI | 图像生成 | ✅ |
| `/siliconflow/*` | SiliconFlow AI | 图像生成/编辑 | ✅ |
| `/image-middleware/*` | 本地图像中间件 | 图像/视频生成 | ✅ |

---

## 🛡️ 核心功能系统

### 1. 安全防护系统
- **黑白名单**: `whitelist.json`, `BlacklistedUsers.txt`, `BlacklistedIPs.txt`
- **敏感词过滤**: `Sensitive.txt`, `sensitive_patterns.json`
- **模型访问控制**: `restrictedUsers.json`, 数据库白名单配置
- **内容审查**: 集成智谱AI，支持数据库动态配置，实时生效

### 2. 智能限流系统
- **配置文件**: `modules/modelRateLimits.js`, `modules/chatnioRateLimits.js`
- **策略**: 时间窗口限流 + 每日总量限制 + 模型级别限流 + 反滥用机制

### 3. 监控通知系统
- **支持渠道**: PushDeer、飞书、钉钉、Ntfy
- **管理方式**: 数据库驱动 + 前端可视化界面
- **配置文件**: `config/notificationRules.json`（预设规则）

### 4. 会话管理系统
- **UUID标识**: 全局唯一追踪
- **智能识别**: 30分钟超时自动新建会话
- **存储优化**: 增量更新，节省55%空间
- **核心模块**: `utils/conversationManager.js`

### 5. 日志与监控
- **控制台日志**: 可视化面板，支持级别筛选和关键字搜索
- **日志轮换**: 1GB单文件，保留5个历史切片
- **图像中间件日志**: 独立收集 + 主服务聚合展示
- **健康检查**: `/health` 端点用于监控探测

---

## 🔧 中间件系统

### 执行顺序
```javascript
1. restrictGeminiModelAccess      // Gemini模型访问控制
2. loggingMiddleware              // 日志记录
3. contentModerationMiddleware    // 内容审查（动态配置）
4. 路由特定中间件...
```

### 核心中间件
- `limitRequestBodyLength.js` - 请求体长度限制
- `loggingMiddleware.js` - 日志记录
- `modifyRequestBodyMiddleware.js` - 请求体修改
- `contentModerationMiddleware.js` - 内容审查
- `responseInterceptorMiddleware.js` - 响应拦截与对话记录

---

## 🗄️ 数据库结构

### 核心表
- **requests**: 每次请求记录（用于统计、审计、限流）
- **conversation_logs**: 会话维度存储（优化查询，节省空间）
- **system_configs**: 系统配置（审核、通知、白名单等）

### 关键字段
- `conversation_id` (VARCHAR 36): 会话UUID标识
- `is_new_conversation` (TINYINT): 是否新会话开始
- `message_count` (INT): 当前会话消息总数

---

## 🔑 环境变量配置

### 核心配置 (.env)
```bash
# 服务端点
TARGET_SERVER=http://10.31.31.135:7068
TARGET_SERVER_GEMIN=https://proxy.liujiarong.online/google
IMAGE_MIDDLEWARE_TARGET=http://localhost:6053

# 数据库配置
DB_HOST=127.0.0.1
DB_USER=appuser
DB_PASSWORD=apppass
DB_NAME=usage_stats
DB_PORT=7102

# 端口配置
MAIN_PORT=7104
STATS_PORT=7103

# 内容审查
ZHIPU_API_KEY=c5a84cde65d86beb070277e68a0d41a5.qoo9MSsDXWiENir3

# 模型白名单（已迁移到数据库管理）
# FREELYAI_WHITELIST=... (不再使用)
# ROBOT_WHITELIST=... (不再使用)
```

---

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
docker-compose logs -f      # 查看容器日志

# 调试和监控
tail -f logs/app.log        # 应用日志
grep "Content Moderation" logs/app.log  # 过滤审查日志
```

---

## 📈 版本更新记录

### v1.11.0 (2025-10-18) - 图像中间件日志推送 + 动态审核配置
**核心更新**:
- ✅ 图像中间件日志收集系统（独立收集 + 主服务聚合）
- ✅ 动态审核配置系统（数据库驱动 + 前端可视化）
- ✅ 统一日志界面（支持来源筛选：local/middleware/all）
- ✅ 配置实时生效（无需重启服务）

**涉及文件**:
- `modules/databaseModerationConfig.js` - 数据库配置加载器
- `middleware/contentModerationMiddleware.js` - 支持动态配置
- `lib/logCollector.js` - 多源日志聚合
- `router/statsRoutes.js` - 新增 `/api/logs/middleware`

### v1.10.2 (2025-10-14) - 控制台日志可视化 + 日志轮换
- ✅ 实时控制台日志面板（级别筛选、关键字搜索、5秒自动刷新）
- ✅ 使用情况CSV导出功能
- ✅ 首页概览卡片（累计请求、会话总数、活跃用户、违规拦截）
- ✅ 日志轮换管理（1GB单文件，保留5个历史切片）

### v1.10.0 (2025-10-12) - 对话会话管理优化
**问题**: 每次对话都创建独立记录，数据库冗余严重（4轮对话=4条记录，55%冗余）

**解决方案**:
- ✅ UUID会话标识，全局唯一追踪
- ✅ 智能会话边界识别（30分钟超时 / 消息重置 / 前端标志）
- ✅ 增量更新机制（同一会话只存最新完整消息）
- ✅ 存储优化（节省55%空间，查询性能提升70%）

**核心模块**: `utils/conversationManager.js`

### v1.9.1 (2025-10-12) - 对话记录完整性修复
- ✅ 三重保障查询机制（userId+时间 → IP+时间 → userId+最新）
- ✅ 匿名用户对话记录完整率提升至~100%
- ✅ userId标准化统一处理

### v1.9.0 (2025-09-17) - SiliconFlow AI代理支持
- ✅ 新增 `/siliconflow/*` 路由（图像生成/编辑）
- ✅ 支持3种模型：Qwen-Image, Qwen-Image-Edit, Kolors
- ✅ 修复二进制图片数据的JSON解析错误
- ✅ 扩展为多模态AI服务聚合平台

### v1.8.0 (2025-09-15) - 模型白名单可视化管理
- ✅ 从 `.env` 迁移到数据库驱动
- ✅ 前端可视化管理界面（增删改查）
- ✅ 支持一键"重置为默认"
- ✅ 配置即时生效（60秒缓存）

### v1.7.1 (2025-09-15) - 预设通知规则配置文件化
- ✅ 创建 `config/notificationRules.json`
- ✅ 8条预设规则（4个主题 × 2种通知类型）
- ✅ 前端支持预设规则启用/停用
- ✅ 混合展示数据库配置和预设规则

---

## 🔍 故障排查

### 内容审查相关
- **API调用失败**: 检查 `ZHIPU_API_KEY` 配置
- **审查未触发**: 确认数据库配置 `enabled=true`，查看日志
- **内容长度超限**: 智谱AI限制2000字符，中间件自动截断

### 常见错误码
- `4035` - 内容审查未通过
- `4031` - 用户黑名单
- `4032` - 敏感词拦截
- `4291-4299` - 各种限流策略触发

### 日志调试
```bash
# 查看关键日志
grep "\[ConversationManager\]" logs/app.log  # 会话管理
grep "\[Content Moderation\]" logs/app.log  # 内容审查
grep "\[ResponseInterceptor\]" logs/app.log # 响应拦截

# 实时监控
tail -f logs/app.log | grep "ERROR"
```

---

## 📚 核心文件目录

```
openAILittle/
├── index.js                          # 主代理服务入口
├── statsServer.js                    # 统计服务入口
├── middleware/                       # 中间件目录
│   ├── loggingMiddleware.js         # 日志记录
│   ├── contentModerationMiddleware.js  # 内容审查
│   └── responseInterceptorMiddleware.js # 响应拦截
├── modules/                          # 核心模块
│   ├── moderationConfig.js          # 静态审核配置
│   ├── databaseModerationConfig.js  # 数据库审核配置
│   ├── modelRateLimits.js           # 限流配置
│   └── auxiliaryModels.js           # 辅助模型列表
├── utils/                            # 工具函数
│   └── conversationManager.js       # 会话管理器
├── lib/                              # 核心库
│   ├── logger.js                    # 日志记录器
│   └── logCollector.js              # 日志收集器
├── db/                               # 数据库层
│   └── index.js                     # 数据库连接和初始化
├── router/                           # 路由层
│   └── statsRoutes.js               # 统计服务API
├── config/                           # 配置文件
│   ├── notificationRules.json       # 通知规则
│   └── modelWhitelists.json         # 模型白名单
└── notices/                          # 通知渠道
    ├── pushDeerNotifier.js
    ├── larkNotifier.js
    ├── dingTalkNotifier.js
    └── ntfyNotifier.js
```

---

## 🎯 项目进化路径

```
v1.0  纯文本AI代理
  ↓
v1.7  配置管理可视化
  ↓
v1.9  多模态AI代理（图像生成）
  ↓
v1.10 会话管理优化（存储优化55%）
  ↓
v1.11 动态配置 + 统一日志监控
  ↓
未来  企业级AI服务聚合平台
```

---

## 📞 联系与反馈

- **作者**: Liu Jiarong
- **项目路径**: `/Users/liujiarong/dockerSoftware/openAILittle`
- **前端项目**: `openailittle-frontend` (Vue.js)

---

**最后更新**: 2025-10-18
**文档版本**: 2.0（精简版）
