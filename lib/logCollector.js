/**
 * 控制台日志采集与读取工具
 *
 * 功能：
 * - 接管 console.xx 输出，追加写入日志文件
 * - 提供读取最近日志的接口供统计服务调用
 *
 * 注意：模块在被首次 require 时即完成打补丁操作。
 */

const fs = require('fs');
const path = require('path');
const { formatWithOptions } = require('util');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'console.log');
const MAX_LOG_SIZE = 1024 * 1024 * 1024; // 1GB
const MAX_BACKUP_FILES = 5;
const MAX_READ_BYTES = 2 * 1024 * 1024; // 最多读取最近 2MB
const FALLBACK_BUFFER_LIMIT = 500; // 兜底内存缓存

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug
};

let isPatched = false;
let logSource = null;
const fallbackBuffer = [];

/**
 * 将日志写入文件与内存缓冲
 */
function rotateLogsIfNeeded(approxSize) {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size + approxSize < MAX_LOG_SIZE) {
      return;
    }
  } catch (error) {
    if (error.code === 'ENOENT') return;
    originalConsole.error('[LogCollector] 检查日志文件大小失败:', error.message);
    return;
  }

  try {
    for (let i = MAX_BACKUP_FILES; i >= 1; i--) {
      const src = path.join(LOG_DIR, `console.log.${i}`);
      if (!fs.existsSync(src)) {
        continue;
      }
      if (i === MAX_BACKUP_FILES) {
        fs.unlinkSync(src);
      } else {
        const dest = path.join(LOG_DIR, `console.log.${i + 1}`);
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
        }
        fs.renameSync(src, dest);
      }
    }
    const firstBackup = path.join(LOG_DIR, 'console.log.1');
    if (fs.existsSync(firstBackup)) {
      fs.unlinkSync(firstBackup);
    }
    fs.renameSync(LOG_FILE, firstBackup);
  } catch (error) {
    originalConsole.error('[LogCollector] 轮换日志失败:', error.message);
  }
}

function persistLog(entry) {
  fallbackBuffer.push(entry);
  if (fallbackBuffer.length > FALLBACK_BUFFER_LIMIT) {
    fallbackBuffer.splice(0, fallbackBuffer.length - FALLBACK_BUFFER_LIMIT);
  }

  const line = JSON.stringify(entry);
  const approxSize = Buffer.byteLength(line, 'utf8') + 1;
  rotateLogsIfNeeded(approxSize);
  fs.appendFile(LOG_FILE, line + '\n', (err) => {
    if (err) {
      originalConsole.error('[LogCollector] 写入日志文件失败:', err.message);
    }
  });
}

/**
 * 构建 console 方法的包装
 */
function wrapConsoleMethod(level, originalMethod) {
  return function patchedConsoleMethod(...args) {
    const message = formatWithOptions({ depth: 6, colors: false }, ...args);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      source: logSource || process.title || 'node',
      pid: process.pid
    };

    persistLog(entry);
    return originalMethod.apply(console, args);
  };
}

/**
 * 读取日志文件尾部
 */
async function readRecentLogLines(requestedLimit = 200) {
  try {
    const stats = await fs.promises.stat(LOG_FILE);
    const fileSize = stats.size;
    const desiredSize = Math.max(1024 * 16, requestedLimit * 512);
    const readSize = Math.min(fileSize, Math.min(desiredSize, MAX_READ_BYTES));
    const start = Math.max(0, fileSize - readSize);

    const handle = await fs.promises.open(LOG_FILE, 'r');
    try {
      const buffer = Buffer.alloc(readSize);
      await handle.read(buffer, 0, buffer.length, start);
      const content = buffer.toString('utf8');
      return content.split(/\r?\n/).filter(Boolean);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    originalConsole.error('[LogCollector] 读取日志文件失败:', error.message);
    // 返回 fallback 缓存
    return fallbackBuffer.map((entry) => JSON.stringify(entry));
  }
}

/**
 * 根据查询条件返回日志
 */
async function getLogs(options = {}) {
  const {
    limit = 200,
    level,
    since
  } = options;

  const requestedLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  const lines = await readRecentLogLines(requestedLimit * 5); // 读取更多行以便筛选

  const targetLevel = level ? String(level).toLowerCase() : null;
  const sinceTimestamp = since ? Date.parse(since) : null;

  const matched = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (matched.length >= requestedLimit) break;
    const line = lines[i];
    try {
      const entry = JSON.parse(line);
      if (targetLevel && String(entry.level).toLowerCase() !== targetLevel) {
        continue;
      }
      if (sinceTimestamp && Date.parse(entry.timestamp) < sinceTimestamp) {
        continue;
      }
      matched.push(entry);
    } catch (_) {
      // 跳过无法解析的行
    }
  }

  // 返回按时间顺序排列的数据
  return matched.reverse();
}

/**
 * 设置日志来源标识，方便区分不同进程
 */
function setSource(source) {
  logSource = source;
}

function ensurePatched() {
  if (isPatched) return;
  isPatched = true;

  // 确保日志目录存在
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (error) {
    originalConsole.error('[LogCollector] 创建日志目录失败:', error.message);
  }

  console.log = wrapConsoleMethod('info', originalConsole.log);
  console.info = wrapConsoleMethod('info', originalConsole.info);
  console.warn = wrapConsoleMethod('warn', originalConsole.warn);
  console.error = wrapConsoleMethod('error', originalConsole.error);
  console.debug = wrapConsoleMethod('debug', originalConsole.debug);
}

ensurePatched();

module.exports = {
  setSource,
  getLogs
};
