const Minio = require('minio');

let cachedClient = null;

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value === 'true' || value === true;
}

function parsePort(portValue, defaultValue) {
  if (!portValue && portValue !== 0) {
    return defaultValue;
  }
  const parsed = parseInt(portValue, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function buildClientConfig() {
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error('缺少 MinIO 配置，请检查 MINIO_ACCESS_KEY / MINIO_SECRET_KEY 环境变量');
  }

  const hasInternalEndpoint = Boolean(process.env.MINIO_INTERNAL_ENDPOINT);
  const rawEndpoint = hasInternalEndpoint
    ? process.env.MINIO_INTERNAL_ENDPOINT
    : process.env.MINIO_ENDPOINT;

  if (!rawEndpoint) {
    throw new Error('缺少 MinIO 连接地址，请配置 MINIO_INTERNAL_ENDPOINT 或 MINIO_ENDPOINT');
  }

  let endPoint = rawEndpoint.trim();
  let port = hasInternalEndpoint
    ? parsePort(process.env.MINIO_INTERNAL_PORT, 9000)
    : parsePort(process.env.MINIO_PORT, 443);
  let useSSL = hasInternalEndpoint
    ? parseBoolean(process.env.MINIO_INTERNAL_USE_SSL, false)
    : parseBoolean(process.env.MINIO_USE_SSL, true);

  // 允许在 MINIO_ENDPOINT/MINIO_INTERNAL_ENDPOINT 中带协议或端口
  if (/^[a-zA-Z]+:\/\//.test(endPoint)) {
    try {
      const url = new URL(endPoint);
      endPoint = url.hostname;
      if (url.port) {
        port = parsePort(url.port, url.protocol === 'https:' ? 443 : 80);
      } else {
        port = url.protocol === 'https:' ? 443 : 80;
      }
      useSSL = url.protocol === 'https:';
    } catch (error) {
      throw new Error(`MINIO${hasInternalEndpoint ? '_INTERNAL' : ''}_ENDPOINT 格式不正确：${error.message}`);
    }
  } else {
    // 支持 host:port 形式
    try {
      const pseudoUrl = new URL(`http://${endPoint}`);
      if (pseudoUrl.hostname) {
        endPoint = pseudoUrl.hostname;
      }
      if (pseudoUrl.port) {
        port = parsePort(pseudoUrl.port, port);
      }
    } catch (error) {
      // 保持原样但确保去除可能的多余空格
      endPoint = endPoint.trim();
    }
  }

  const region = process.env.MINIO_REGION || 'us-east-1';

  return {
    endPoint,
    port,
    useSSL,
    accessKey,
    secretKey,
    region,
    pathStyle: true
  };
}

function createMinioClient() {
  const config = buildClientConfig();
  return new Minio.Client(config);
}

function getMinioClient() {
  if (!cachedClient) {
    cachedClient = createMinioClient();
  }
  return cachedClient;
}

module.exports = {
  getMinioClient,
};
