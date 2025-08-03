# OpenAI Little - AI 模型代理服务

一个功能完善的AI模型代理服务，为多种AI模型（OpenAI、Google Gemini等）提供统一的代理访问接口，具备企业级的安全防护和限流控制能力。

## 📋 项目概述

本项目是一个基于 Node.js 的AI模型代理服务，采用微服务架构设计，提供以下核心能力：

- 🔄 **多AI模型代理** - 统一接口访问 OpenAI、Gemini、ChatNio 等模型
- 🛡️ **安全防护系统** - 多层安全验证和内容过滤机制
- ⚡ **智能限流控制** - 灵活的限流策略和反滥用机制
- 📊 **监控统计系统** - 实时监控和使用统计分析
- 🚀 **容器化部署** - 基于 Docker 的快速部署方案

## 🏗️ 项目架构

### 核心组件

```
openAILittle-1/
├── index.js                   # 主代理服务器 (端口: 20491)
├── statsServer.js             # 统计服务器 (端口: 30491)
├── package.json               # 项目依赖配置
├── Dockerfile                 # Docker 镜像构建文件
├── compose.yml                # Docker Compose 配置
├── middleware/                # 中间件模块
│   ├── limitRequestBodyLength.js    # 请求长度限制
│   ├── loggingMiddleware.js         # 日志中间件
│   └── modifyRequestBodyMiddleware.js # 请求体修改
├── modules/                   # 功能模块
│   ├── auxiliaryModels.js           # 辅助模型配置
│   ├── chatnioRateLimits.js         # ChatNio 限流配置
│   └── modelRateLimits.js           # 模型限流配置
├── notices/                   # 通知服务
│   ├── dingTalkNotifier.js          # 钉钉通知
│   ├── larkNotifier.js              # 飞书通知
│   ├── ntfyNotifier.js              # Ntfy 通知
│   └── pushDeerNotifier.js          # PushDeer 通知
├── router/                    # 路由模块
│   └── statsRoutes.js              # 统计 API 路由
├── services/                  # 业务服务层
├── utils/                     # 工具函数
│   └── index.js                    # 通用工具函数
├── config/                    # 配置文件目录
├── db/                        # 数据库相关
│   └── index.js                    # 数据库连接配置
└── 配置文件/                   # 安全和过滤配置
    ├── whitelist.json              # 白名单配置
    ├── restrictedUsers.json        # 受限用户配置
    ├── sensitive_patterns.json     # 敏感内容正则配置
    ├── filterConfig.json           # 过滤配置
    ├── BlacklistedUsers.txt        # 用户黑名单
    ├── BlacklistedIPs.txt          # IP 黑名单
    └── Sensitive.txt               # 敏感词列表
```

### 技术栈

- **运行环境**: Node.js 18 + Express.js
- **数据库**: MySQL 8+ (usage_stats)
- **容器化**: Docker + Docker Compose
- **包管理**: pnpm
- **代理**: http-proxy-middleware
- **限流**: express-rate-limit
- **时间处理**: moment.js

## 🚀 主要功能模块

### 1. 多AI模型代理

支持多种AI模型的统一代理访问：

| 路由路径 | 目标服务 | 描述 |
|---------|---------|------|
| `/v1/*` | OpenAI API | 标准 OpenAI 接口代理 |
| `/google/*` | Google Gemini | Gemini 模型代理 |
| `/chatnio/*` | ChatNio | ChatNio 平台代理 |
| `/freelyai/*` | FreelyAI | FreelyAI 服务代理 |
| `/freeopenai/*` | Free OpenAI | 免费 OpenAI 接口 |
| `/freegemini/*` | Free Gemini | 免费 Gemini 接口 |

### 2. 安全防护系统

#### 黑白名单机制
- **用户黑名单** (`BlacklistedUsers.txt`) - 禁止访问的用户ID
- **IP黑名单** (`BlacklistedIPs.txt`) - 禁止访问的IP地址
- **白名单机制** (`whitelist.json`) - 绕过限制的用户和IP

#### 内容安全过滤
- **敏感词过滤** (`Sensitive.txt`) - 关键词检测和拦截
- **正则表达式过滤** (`sensitive_patterns.json`) - 复杂模式匹配
- **实时内容检测** - 请求内容的实时安全扫描

#### 访问控制
- **模型权限控制** (`restrictedUsers.json`) - 限制特定用户访问特定模型
- **模型白名单验证** - 环境变量配置的模型访问权限

### 3. 智能限流控制

#### 多层限流策略
- **时间窗口限流** - 指定时间内的请求次数限制
- **每日总量限制** - 每日最大请求次数控制
- **模型级别限流** - 不同模型采用不同限流策略
- **用户级别限流** - 针对特定用户的自定义限流

#### 反滥用机制
- **重复请求检测** - 防止短时间内相同内容请求
- **频率限制** - 防止单用户高频请求不同模型
- **内容哈希检测** - 基于内容哈希的重复检测

### 4. 监控通知系统

#### 多渠道通知
- **PushDeer** - 移动端推送通知
- **飞书 (Lark)** - 企业级即时通知
- **钉钉** - 团队协作通知
- **Ntfy** - 轻量级推送服务

#### 监控项目
- 请求频率异常
- 安全规则触发
- 限流事件
- 系统错误

### 5. 数据统计分析

#### 统计服务 (statsServer.js)
- **独立端口服务** - 端口 30491
- **使用数据统计** - 模型使用情况分析
- **API接口** - RESTful 统计数据接口
- **跨域支持** - 前端数据可视化支持

## 🐳 部署配置

### Docker 部署

```bash
# 使用 Docker Compose 部署
docker-compose up -d

# 或手动构建
docker build -t openai-little .
docker run -p 20492:20491 -p 30492:30491 openai-little
```

### 端口配置

- **主服务**: 20492:20491 (对外:容器内)
- **统计服务**: 30492:30491 (对外:容器内)
- **MySQL**: 内部端口 3306

### 环境变量配置

创建 `.env` 文件：

```env
# 目标服务器配置
TARGET_SERVER=https://api.openai.com
TARGET_SERVER_GEMIN=https://generativelanguage.googleapis.com
TARGET_SERVER_FEISHU=https://open.feishu.cn/open-apis/bot/v2/hook/

# 模型白名单配置
FREELYAI_WHITELIST=model1,model2
ROBOT_WHITELIST=gpt-3.5-turbo,gpt-4

## 白名单配置说明

### ROBOT_WHITELIST
- **影响路由**: `/v1/*` (所有以 `/v1` 开头的路由)
- **用途**: 控制机器人/OpenAI API 路由的模型访问权限
- **示例**: `/v1/chat/completions`、`/v1/audio/speech` 等
- **配置示例**: `ROBOT_WHITELIST=gpt-3.5-turbo,gpt-4,tts-1`

### FREELYAI_WHITELIST  
- **影响路由**: `/freelyai/*` (所有以 `/freelyai` 开头的路由)
- **用途**: 控制 FreelyAI 路由的模型访问权限
- **示例**: `/freelyai/v1/chat/completions` 等
- **配置示例**: `FREELYAI_WHITELIST=model1,model2,tts-1`

### 白名单格式
- 支持逗号分隔的模型名称列表
- 支持等号分割格式：`model=value` (只取等号左边部分)
- 自动过滤空值和空格

### 升级提示信息配置
- **UPGRADE_MESSAGE**: 统一管理所有限流和错误提示中的升级链接
- 默认值：`或者使用 https://chatnio.demo.top 平台解锁更多额度`
- 可通过环境变量自定义提示信息

# 统计服务端口
STATS_PORT=30491

# 升级提示信息
UPGRADE_MESSAGE=或者使用 https://chatnio.demo.top 平台解锁更多额度
```

### 数据库配置

MySQL 容器自动创建 `usage_stats` 数据库，配置如下：
- **用户**: appuser
- **密码**: apppass
- **数据库**: usage_stats
- **时区**: Asia/Shanghai

## 🛡️ 安全特性

### 多重验证机制
1. **IP地址验证** - 黑白名单双重检查
2. **用户ID验证** - 用户身份合法性检查
3. **模型权限验证** - 模型访问权限控制
4. **内容安全检测** - 敏感内容实时过滤

### 防护策略
- **请求频率限制** - 防止接口滥用
- **内容长度限制** - 防止恶意大数据攻击
- **重复请求拦截** - 防止重复提交攻击
- **实时监控告警** - 异常行为即时通知

## 🔧 维护说明

### 配置文件管理
- 配置文件每 5 分钟自动重载
- 支持运行时动态更新黑白名单
- 日志实时输出配置更新状态

### 监控和日志
- 所有请求记录详细日志
- 异常事件实时通知
- 性能指标统计分析

### 缓存管理
- 重复请求缓存自动清理 (30分钟)
- 请求内容哈希缓存 (15秒)
- 用户请求历史缓存管理

## 📊 错误码说明

| 错误码 | 描述 | 触发条件 |
|-------|------|---------|
| 4001 | 输入非自然语言 | 辅助模型输入格式错误 |
| 4002 | 辅助模型访问限制 | 非匿名用户访问辅助模型 |
| 4003 | 模型访问被拒绝 | 受限用户访问非授权模型 |
| 4031 | 用户黑名单 | 用户ID在黑名单中 |
| 4032 | 敏感词拦截 | 内容包含敏感词 |
| 4033 | 正则匹配拦截 | 内容匹配敏感模式 |
| 4034 | IP黑名单 | IP地址在黑名单中 |
| 4291-4299 | 限流相关 | 各种限流策略触发 |

## 🤝 开发和维护

### 启动服务

```bash
# 安装依赖
pnpm install

# 启动开发环境
pnpm start

# 或分别启动
pnpm run start:main    # 主服务
pnpm run start:stats   # 统计服务
```

### 项目结构说明
- 采用模块化设计，功能按目录分类
- 中间件可插拔，易于扩展
- 配置文件外置，支持动态更新
- 微服务架构，主服务与统计服务分离

---

**作者**: Liu Jiarong  
**版本**: 1.0.0  
**许可证**: ISC