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
