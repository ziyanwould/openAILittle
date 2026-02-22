# TODO - 配置管理改进计划

> 背景：配置管理页面（/config-management、/system-config-management、/moderation-management）存在以下核心问题：
> 1. 配置保存后需等待最长 ~10 分钟才生效（缓存未主动刷新）
> 2. 表单 JSON 字段填写无实时验证，提交才知道格式错了
> 3. 各字段缺乏填写引导，隔段时间就忘记怎么填
> 4. 操作反馈不足，部分功能用户不知道为什么不能操作

---

## ✅ 第一优先级 — 配置保存后立即生效（后端）

### 1.1 新增配置缓存刷新接口
- **文件**: `index.js`
- **内容**: 新增 `GET /internal/cache/refresh-config` 接口
- **作用**: 调用后立即清除 ConfigManager 缓存，并重新从数据库加载黑名单、白名单等所有规则到内存
- **状态**: ✅ 已完成（2026-02-22）

### 1.2 配置规则路由添加主动刷新
- **文件**: `router/statsRoutes.js`
- **实现方式**: 顶部新增 `refreshConfigCache()` 工具函数，所有配置变更路由在成功返回前调用它
- **涉及路由**: POST/PUT/DELETE `/config/rules`、`/config/sync-files`、`/stats/system-configs`
- **状态**: ✅ 已完成（2026-02-22）

---

## ✅ 第二优先级 — 填写引导和模板（前端）

### 2.1 ConfigManagement 自动填充模板
- **文件**: `openailittle-frontend/src/views/ConfigManagement.vue`
- **内容**: 监听 `rule_type` 变化自动填入模板，`rule_key` 动态 placeholder
- **状态**: ✅ 已完成（2026-02-22）

### 2.2 SystemConfigManagement 添加配置模板
- **文件**: `openailittle-frontend/src/views/SystemConfigManagement.vue`
- **内容**: 切换 `configType` 自动填入对应 JSON 模板，`configKey` 动态 placeholder
- **状态**: ✅ 已完成（2026-02-22）

---

## ✅ 第三优先级 — 黑名单/白名单快速入口（前端）

### 3.1 ConfigManagement 快速添加区域
- **文件**: `openailittle-frontend/src/views/ConfigManagement.vue`
- **内容**: 新增快速添加卡片（黑名单用户/IP、白名单用户/IP），支持回车提交
- **状态**: ✅ 已完成（2026-02-22）

---

## 🔄 第四优先级 — 表单验证与交互细节（前端）

### 4.1 ConfigManagement — `rule_value` 实时 JSON 验证
- **文件**: `openailittle-frontend/src/views/ConfigManagement.vue`
- **内容**: 在 `formRules` 中为 `rule_value` 添加 JSON 格式校验器，失焦时验证并显示红色错误提示
- **状态**: ✅ 已完成（2026-02-22）

### 4.2 ConfigManagement — 优先级字段添加说明文字
- **文件**: `openailittle-frontend/src/views/ConfigManagement.vue`
- **内容**: 在 `el-input-number` 下方添加说明文字（placeholder 在此组件无效）
- **状态**: ✅ 已完成（2026-02-22）

### 4.3 ConfigManagement — 表格内快速启用/禁用开关
- **文件**: `openailittle-frontend/src/views/ConfigManagement.vue`
- **内容**: 在操作列前增加 `el-switch`，直接切换 `is_active`，无需进入编辑弹窗
- **状态**: ✅ 已完成（2026-02-22）

### 4.4 SystemConfigManagement — `configValueText` 实时 JSON 验证
- **文件**: `openailittle-frontend/src/views/SystemConfigManagement.vue`
- **内容**: textarea 失焦时校验 JSON 格式，实时显示错误提示
- **状态**: ✅ 已完成（2026-02-22）

### 4.5 SystemConfigManagement — 编辑时显示 configKey（只读）
- **文件**: `openailittle-frontend/src/views/SystemConfigManagement.vue`
- **内容**: 编辑对话框中以只读方式展示 `configKey`，让用户知道在改哪个配置
- **状态**: ✅ 已完成（2026-02-22）

### 4.6 SystemConfigManagement — RATE_LIMIT 模板补充单位注释
- **文件**: `openailittle-frontend/src/views/SystemConfigManagement.vue`
- **内容**: 在 RATE_LIMIT 模板的 `windowMs` 值旁添加注释说明单位为毫秒
- **状态**: ✅ 已完成（2026-02-22）

### 4.7 SystemConfigManagement — 删除按钮添加 Tooltip
- **文件**: `openailittle-frontend/src/views/SystemConfigManagement.vue`
- **内容**: 对 `is_default=true` 的行，删除按钮用 `el-tooltip` 包裹并说明原因
- **状态**: ✅ 已完成（2026-02-22）

### 4.8 SystemConfigManagement — 补全配置类型下拉选项
- **文件**: `openailittle-frontend/src/views/SystemConfigManagement.vue`
- **内容**: 筛选和表单下拉补全 AUTOBAN、NOTIFICATION、MODEL_WHITELIST 三种类型
- **状态**: ✅ 已完成（2026-02-22）

### 4.9 ModerationManagement — 请求体规则 condition/action 自动填模板
- **文件**: `openailittle-frontend/src/views/ModerationManagement.vue`
- **内容**: 切换 `condition_type` / `action_type` 时自动填入对应 JSON 示例模板
- **状态**: ✅ 已完成（2026-02-22）

### 4.10 ModerationManagement — condition_config 补充 JSON 验证
- **文件**: `openailittle-frontend/src/views/ModerationManagement.vue`
- **内容**: 在 `ruleFormRules` 中为 `condition_config` 补充 JSON 格式校验（目前只有 action_config 有）
- **状态**: ✅ 已完成（2026-02-22）

### 4.11 ModerationManagement — 通知 Webhook URL 格式验证
- **文件**: `openailittle-frontend/src/views/ModerationManagement.vue`
- **内容**: 为飞书/钉钉的 webhook_url 字段添加 URL 格式校验规则
- **状态**: ✅ 已完成（2026-02-22）

---

## 🔄 第五优先级 — 展示优化

### 5.1 SystemConfigManagement — configValue 折叠/展开
- **文件**: `openailittle-frontend/src/views/SystemConfigManagement.vue`
- **内容**: 默认只显示 JSON 单行预览，点击「展开」按钮查看完整内容，避免长 JSON 撑开行高
- **状态**: ✅ 已完成（2026-02-22）

### 5.2 ConfigManagement — USER_RESTRICTION 内联展示模型列表
- **文件**: `openailittle-frontend/src/views/ConfigManagement.vue`
- **内容**: USER_RESTRICTION 规则的规则值列以 el-tag 形式展示 allowedModels 列表
- **状态**: ✅ 已完成（2026-02-22）

### 5.3 ConfigManagement — 同步文件配置危险确认弹窗
- **文件**: `openailittle-frontend/src/views/ConfigManagement.vue`
- **内容**: 点击「同步文件配置」先弹出确认对话框，说明操作影响后再执行
- **状态**: ✅ 已完成（2026-02-22）

### 5.4 ModerationManagement — 模型白名单批量粘贴
- **文件**: `openailittle-frontend/src/views/ModerationManagement.vue`
- **内容**: 白名单区域新增「批量粘贴」入口，支持逗号/换行分隔一次性导入多个模型名
- **状态**: ✅ 已完成（2026-02-22）

---

## ✅ 第六优先级 — Token 追踪 & 用户行为限流（2026-02-22）

### 6.1 requests 表新增 token 字段
- **内容**: `ALTER TABLE requests ADD COLUMN prompt_tokens INT, completion_tokens INT, total_tokens INT`
- **状态**: ✅ 已完成

### 6.2 requests 表新增索引
- **内容**: `CREATE INDEX idx_user_timestamp ON requests (user_id, timestamp)`
- **状态**: ✅ 已完成

### 6.3 Token 异步追踪
- **文件**: `middleware/responseInterceptorMiddleware.js`
- **内容**: 新增 `extractTokenUsage()`（兼容 OpenAI 非流式/流式及 Gemini usageMetadata）和 `asyncUpdateTokenUsage()`（延迟 1s 异步回写），不阻塞响应
- **状态**: ✅ 已完成

### 6.4 流式请求注入 stream_options
- **文件**: `index.js`
- **内容**: 新增 `injectStreamOptions` 中间件，对 stream:true 的请求自动注入 `stream_options:{include_usage:true}`，覆盖 `/v1/` `/chatnio/` `/freelyai/` `/freeopenai/` `/cloudflare/` `/siliconflow/` 6条路由
- **状态**: ✅ 已完成

### 6.5 用户行为限流中间件
- **文件**: `middleware/userBehaviorLimitMiddleware.js`
- **内容**: 按用户维度限制4小时/周的调用次数与token用量，三层缓存（配置60s、白名单60s、用户计数10s），fail-open 设计
- **阈值**: 4小时150次/200万token，每周1500次/8000万token（对应每人约30元/天上限）
- **状态**: ✅ 已完成（阈值经实际数据分析后从50次调整为150次）

### 6.6 system_configs 扩展 USER_BEHAVIOR_LIMIT 类型
- **内容**: ALTER TABLE MODIFY COLUMN ENUM 扩展，插入默认配置，/internal/cache/refresh-config 接入 clearCache()
- **状态**: ✅ 已完成

### 6.7 数据大屏 Token 使用趋势图
- **文件**: `router/statsRoutes.js` + `openailittle-frontend/src/views/Dashboard.vue`
- **内容**: 新增 `/stats/token-trend` 接口（按天聚合 prompt/completion/total_tokens），Dashboard 新增全宽堆叠柱+折线双轴图，tooltip 展示估算费用（¥2.12/M）
- **状态**: ✅ 已完成

### 6.8 前端 SystemConfigManagement 支持 USER_BEHAVIOR_LIMIT
- **文件**: `openailittle-frontend/src/views/SystemConfigManagement.vue`
- **内容**: 筛选/表单下拉新增类型，configTypeGuides 新增模板，getConfigTypeName/Color 补全映射
- **状态**: ✅ 已完成

---

## ⏸ 暂缓 — 全面重构为功能导向多子页面

- 成本大，当前配置使用频率不高，暂不实施

---

## 已知问题备忘

| 问题 | 原因 | 解决方案 |
|------|------|--------|
| 配置不立即生效 | 后端有 5 分钟 ConfigManager 缓存 | ✅ 保存后主动调用刷新接口 |
| rule_value 格式不明 | 纯文本输入框，无格式引导 | ✅ 按 rule_type 自动填模板 |
| 系统配置难填 | 复杂 JSON 需手写 | ✅ 提供预设模板 |
| JSON 填错不知道 | 仅提交时验证 | ✅ 实时失焦验证 |
| 文件规则覆盖 UI 规则 | 同步文件会重新插入 is_from_file=TRUE 的规则 | 文档说明，暂不修改逻辑 |
