/**
 * middleware/userBehaviorLimitMiddleware.js
 *
 * 用户行为限流中间件
 * - 按用户维度（跨模型）限制小时/日调用次数
 * - 白名单用户自动豁免
 * - 配置从 system_configs 表读取，支持前端动态调整
 * - 全部使用缓存，出错时 fail-open（放行），不影响正常用户
 */

const { pool } = require('../db');

// ─── 配置缓存（60s TTL） ───────────────────────────────────────────────────────
let _config    = null;
let _configTs  = 0;
const CONFIG_TTL = 60 * 1000;

async function loadConfig() {
  if (_config !== null && Date.now() - _configTs < CONFIG_TTL) return _config;
  try {
    const [rows] = await pool.query(
      `SELECT config_value FROM system_configs
       WHERE config_type = 'USER_BEHAVIOR_LIMIT'
         AND config_key  = 'global'
         AND is_active   = 1
       ORDER BY priority ASC LIMIT 1`
    );
    _config   = rows.length > 0
      ? (typeof rows[0].config_value === 'string'
          ? JSON.parse(rows[0].config_value)
          : rows[0].config_value)
      : null;
    _configTs = Date.now();
  } catch (e) {
    console.error('[UserBehaviorLimit] 读取配置失败:', e.message);
  }
  return _config;
}

// ─── 白名单缓存（60s TTL） ────────────────────────────────────────────────────
let _whitelist   = null;
let _whitelistTs = 0;
const WHITELIST_TTL = 60 * 1000;

async function loadWhitelist() {
  if (_whitelist !== null && Date.now() - _whitelistTs < WHITELIST_TTL) return _whitelist;
  try {
    const [rows] = await pool.query(
      `SELECT rule_key FROM config_rules
       WHERE rule_type = 'WHITELIST_USER' AND is_active = 1`
    );
    _whitelist   = rows.map(r => r.rule_key);
    _whitelistTs = Date.now();
  } catch (e) {
    console.error('[UserBehaviorLimit] 读取白名单失败:', e.message);
    _whitelist = [];
  }
  return _whitelist;
}

// ─── 用户计数缓存（10s TTL per user） ─────────────────────────────────────────
const _countCache = new Map();
const COUNT_TTL   = 10 * 1000;

async function getUserCounts(userId) {
  const hit = _countCache.get(userId);
  if (hit && Date.now() - hit.ts < COUNT_TTL) return hit.counts;

  const [[row]] = await pool.query(
    `SELECT
       SUM(timestamp >= DATE_SUB(NOW(), INTERVAL 4 HOUR))                          AS rolling4h,
       SUM(timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY))                           AS weekly,
       SUM(CASE WHEN timestamp >= DATE_SUB(NOW(), INTERVAL 4 HOUR)
                THEN COALESCE(total_tokens, 0) END)                                AS tokens_4h,
       SUM(CASE WHEN timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                THEN COALESCE(total_tokens, 0) END)                                AS tokens_weekly
     FROM requests
     WHERE user_id  = ?
       AND timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    [userId]
  );
  const counts = {
    rolling4h:     Number(row.rolling4h     || 0),
    weekly:        Number(row.weekly        || 0),
    tokens_4h:     Number(row.tokens_4h     || 0),
    tokens_weekly: Number(row.tokens_weekly || 0),
  };
  _countCache.set(userId, { counts, ts: Date.now() });
  return counts;
}

// 定期清理过期缓存，防止内存泄漏
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _countCache.entries()) {
    if (now - v.ts > COUNT_TTL * 30) _countCache.delete(k);
  }
}, 10 * 60 * 1000).unref();

// ─── 对外暴露缓存清除（由 /internal/cache/refresh-config 调用） ───────────────
function clearCache() {
  _config    = null;
  _configTs  = 0;
  _whitelist = null;
  _whitelistTs = 0;
  _countCache.clear();
}

// ─── AI 路由判断（与 responseInterceptorMiddleware 保持一致） ─────────────────
const AI_PREFIXES = [
  '/v1/', '/google/', '/chatnio/', '/freelyai/',
  '/freeopenai/', '/freegemini/', '/cloudflare/', '/siliconflow/'
];

function isAIRoute(url) {
  return AI_PREFIXES.some(p => url.startsWith(p));
}

// ─── 中间件主体 ───────────────────────────────────────────────────────────────
async function userBehaviorLimitMiddleware(req, res, next) {
  if (req.method !== 'POST') return next();
  if (!isAIRoute(req.originalUrl || req.url)) return next();

  try {
    const config = await loadConfig();
    if (!config || !config.enabled) return next();

    const userId = req.headers['x-user-id'] || req.body?.user;
    if (!userId || userId === 'anonymous') return next();

    // 白名单豁免
    if (config.exempt_whitelist) {
      const wl = await loadWhitelist();
      if (wl.includes(userId)) return next();
    }

    // target_mode: listed_only → 只对 target_users 里的用户生效
    if (config.target_mode === 'listed_only') {
      const targets = Array.isArray(config.target_users) ? config.target_users : [];
      if (!targets.includes(userId)) return next();
    }

    const counts = await getUserCounts(userId);

    if (config.rolling4h_call_limit > 0 && counts.rolling4h >= config.rolling4h_call_limit) {
      console.warn(`[UserBehaviorLimit] 4小时次数限流: user=${userId} ${counts.rolling4h}/${config.rolling4h_call_limit}`);
      return res.status(429).json({
        error: {
          message: `请求过于频繁，您在过去 4 小时内已发送 ${counts.rolling4h} 次请求，上限为 ${config.rolling4h_call_limit} 次，请稍后再试。`,
          type: 'rate_limit_exceeded',
          code: 4301
        }
      });
    }

    if (config.rolling4h_token_limit > 0 && counts.tokens_4h >= config.rolling4h_token_limit) {
      console.warn(`[UserBehaviorLimit] 4小时token限流: user=${userId} ${counts.tokens_4h}/${config.rolling4h_token_limit}`);
      return res.status(429).json({
        error: {
          message: `请求过于频繁，您在过去 4 小时内已消耗 ${counts.tokens_4h.toLocaleString()} tokens，上限为 ${config.rolling4h_token_limit.toLocaleString()} tokens，请稍后再试。`,
          type: 'rate_limit_exceeded',
          code: 4303
        }
      });
    }

    if (config.weekly_call_limit > 0 && counts.weekly >= config.weekly_call_limit) {
      console.warn(`[UserBehaviorLimit] 周次数限流: user=${userId} ${counts.weekly}/${config.weekly_call_limit}`);
      return res.status(429).json({
        error: {
          message: `本周请求已达上限，您本周已发送 ${counts.weekly} 次请求，上限为 ${config.weekly_call_limit} 次，请下周再试。`,
          type: 'rate_limit_exceeded',
          code: 4302
        }
      });
    }

    if (config.weekly_token_limit > 0 && counts.tokens_weekly >= config.weekly_token_limit) {
      console.warn(`[UserBehaviorLimit] 周token限流: user=${userId} ${counts.tokens_weekly}/${config.weekly_token_limit}`);
      return res.status(429).json({
        error: {
          message: `本周用量已达上限，您本周已消耗 ${counts.tokens_weekly.toLocaleString()} tokens，上限为 ${config.weekly_token_limit.toLocaleString()} tokens，请下周再试。`,
          type: 'rate_limit_exceeded',
          code: 4304
        }
      });
    }

    next();
  } catch (e) {
    console.error('[UserBehaviorLimit] 中间件异常:', e.message);
    next(); // fail-open：出错时放行，不影响正常用户
  }
}

module.exports = userBehaviorLimitMiddleware;
module.exports.clearCache = clearCache;
