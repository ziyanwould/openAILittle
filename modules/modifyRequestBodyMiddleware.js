/**
 * @Author: Liu Jiarong
 * @Date: 2025-03-15 19:58:30
 * @LastEditors: Liu Jiarong
 * @LastEditTime: 2025-09-14 15:30:00
 * @FilePath: /openAILittle/modules/modifyRequestBodyMiddleware.js
 * @Description: 基于数据库配置的请求体修改中间件
 * 动态从数据库加载请求体修改规则，支持灵活配置
 * @
 * @Copyright (c) 2025 by ${git_name_email}, All Rights Reserved.
 */

const { getRequestBodyModifyRules } = require('../db/index');

// 缓存规则和缓存时间
let rulesCache = [];
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

/**
 * 获取请求体修改规则（带缓存）
 */
async function getRules() {
  const now = Date.now();

  // 如果缓存仍然有效，直接返回缓存的规则
  if (rulesCache.length > 0 && (now - cacheTimestamp) < CACHE_DURATION) {
    return rulesCache;
  }

  try {
    // 从数据库获取最新规则
    rulesCache = await getRequestBodyModifyRules();
    cacheTimestamp = now;
    console.log(`[RequestBodyMiddleware] 加载了 ${rulesCache.length} 条规则`);
    return rulesCache;
  } catch (error) {
    console.error('[RequestBodyMiddleware] 获取规则失败，使用旧缓存:', error.message);
    // 如果数据库查询失败，继续使用旧缓存（如果有的话）
    return rulesCache;
  }
}

/**
 * 检查模型是否匹配模式
 * 支持通配符匹配
 */
function matchModel(model, pattern) {
  if (!pattern || !model) return false;

  // 精确匹配
  if (pattern === model) return true;

  // 通配符匹配
  if (pattern.includes('*')) {
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/[+^${}()|[\]\\]/g, '\\$&');

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(model);
  }

  // startsWith 匹配
  if (pattern.endsWith('/') || pattern.endsWith('*')) {
    const prefix = pattern.replace(/[\/*]+$/, '');
    return model.startsWith(prefix);
  }

  // includes 匹配
  return model.includes(pattern);
}

/**
 * 检查条件是否匹配
 */
function checkCondition(req, rule) {
  const { condition_type, condition_config } = rule;

  switch (condition_type) {
    case 'always':
      return true;

    case 'param_exists':
      if (!condition_config || !condition_config.param) return false;
      return req.body.hasOwnProperty(condition_config.param);

    case 'param_value':
      if (!condition_config || !condition_config.param) return false;
      const paramValue = req.body[condition_config.param];
      if (condition_config.hasOwnProperty('value')) {
        return paramValue === condition_config.value;
      }
      return paramValue !== undefined;

    default:
      return false;
  }
}

/**
 * 执行操作
 */
function executeAction(req, rule) {
  const { action_type, action_config } = rule;

  if (!action_config) {
    console.warn(`[RequestBodyMiddleware] 规则 ${rule.rule_name} 缺少操作配置`);
    return;
  }

  switch (action_type) {
    case 'set_param':
      // 设置参数
      if (typeof action_config === 'object') {
        Object.keys(action_config).forEach(key => {
          req.body[key] = action_config[key];
        });
        console.log(`[RequestBodyMiddleware] 设置参数:`, action_config);
      }
      break;

    case 'delete_param':
      // 删除参数
      if (Array.isArray(action_config)) {
        action_config.forEach(param => {
          if (req.body.hasOwnProperty(param)) {
            delete req.body[param];
            console.log(`[RequestBodyMiddleware] 删除参数: ${param}`);
          }
        });
      }
      break;

    case 'replace_body':
      // 替换整个请求体
      if (typeof action_config === 'object') {
        const newBody = { ...action_config };

        // 支持模板变量替换
        Object.keys(newBody).forEach(key => {
          if (typeof newBody[key] === 'string') {
            newBody[key] = newBody[key].replace(/\{\{(\w+)\}\}/g, (match, varName) => {
              return req.body[varName] || match;
            });
          }
        });

        req.body = newBody;
        console.log(`[RequestBodyMiddleware] 替换请求体:`, newBody);
      }
      break;

    default:
      console.warn(`[RequestBodyMiddleware] 未知的操作类型: ${action_type}`);
  }
}

/**
 * 请求体修改中间件
 */
const modifyRequestBodyMiddleware = async (req, res, next) => {
  try {
    // 只处理有 body 和 model 的请求
    if (!req.body || !req.body.model) {
      return next();
    }

    const model = req.body.model;
    const rules = await getRules();

    // 如果没有规则，直接继续
    if (!rules || rules.length === 0) {
      return next();
    }

    // 应用匹配的规则
    let appliedRules = 0;
    for (const rule of rules) {
      // 检查模型是否匹配
      if (!matchModel(model, rule.model_pattern)) {
        continue;
      }

      // 检查条件是否匹配
      if (!checkCondition(req, rule)) {
        continue;
      }

      // 执行操作
      console.log(`[RequestBodyMiddleware] 应用规则: ${rule.rule_name} (模型: ${model})`);
      executeAction(req, rule);
      appliedRules++;
    }

    if (appliedRules > 0) {
      console.log(`[RequestBodyMiddleware] 共应用了 ${appliedRules} 条规则，模型: ${model}`);
    }

  } catch (error) {
    console.error('[RequestBodyMiddleware] 处理请求体修改时出错:', error.message);
    // 出错时不阻塞请求，继续执行
  }

  next();
};

module.exports = modifyRequestBodyMiddleware;