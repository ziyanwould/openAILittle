# MySQL性能优化配置说明

> **更新时间**: 2025-10-24
> **优化版本**: v1.11.1
> **目标**: 解决 `ER_OUT_OF_SORTMEMORY` 错误 + 提升查询性能

---

## 🎯 优化目标

### 问题分析
- **报错**: `Out of sort memory, consider increasing server sort buffer size`
- **根本原因**: MySQL默认 `sort_buffer_size` 太小(256KB),无法处理大量数据排序
- **影响范围**: `/api/stats/usage` 等接口超时或报错

### 解决方案
1. ✅ **代码优化**: 移除不必要的 `ORDER BY` 语句
2. ✅ **资源优化**: 增加MySQL容器资源限制
3. ✅ **参数优化**: 调整MySQL内存缓冲区参数

---

## 📊 资源配置对比

### 优化前
```yaml
mysql:
  image: mysql:8.2
  # ❌ 无资源限制,默认配置
  # ❌ sort_buffer_size = 256KB (太小!)
  # ❌ innodb_buffer_pool_size = 128MB (默认值)
```

### 优化后
```yaml
mysql:
  deploy:
    resources:
      limits:
        cpus: '2.0'      # 最多2个CPU核心
        memory: 2G       # 最大2GB内存
      reservations:
        cpus: '1.0'      # 保证1个CPU核心
        memory: 1G       # 保证1GB内存
  command:
    - --sort_buffer_size=4M           # ✅ 排序缓冲 256KB → 4MB (16倍)
    - --innodb_buffer_pool_size=1G    # ✅ InnoDB缓冲池 128MB → 1GB
    - --max_connections=500           # ✅ 最大连接数 151 → 500
```

---

## 🔧 配置文件说明

### 1. compose.yml
**主要变更**:
- 添加 `deploy.resources` 资源限制
- 添加 `command` 参数覆盖默认配置
- 挂载自定义配置文件 `mysql-custom.cnf`

### 2. mysql-custom.cnf
**核心参数**:
```ini
# 内存优化
sort_buffer_size = 4M              # 排序缓冲区
innodb_buffer_pool_size = 1G       # InnoDB缓冲池
join_buffer_size = 4M              # JOIN缓冲区
tmp_table_size = 64M               # 临时表大小

# 性能优化
innodb_flush_log_at_trx_commit = 2 # 每秒刷新日志(性能优先)
innodb_io_capacity = 2000          # I/O容量
slow_query_log = 1                 # 慢查询日志
long_query_time = 2                # 慢查询阈值2秒
```

---

## 🚀 部署步骤

### 方案A: 本地测试环境

```bash
# 1. 停止现有MySQL容器
docker-compose down

# 2. 启动优化后的MySQL容器
docker-compose up -d mysql

# 3. 查看容器状态
docker-compose ps

# 4. 查看MySQL日志,确认配置生效
docker-compose logs -f mysql | grep -E "sort_buffer_size|innodb_buffer_pool_size"

# 5. 验证配置
docker exec -it nodeopenai-mysql2 mysql -uappuser -papppass -e "SHOW VARIABLES LIKE 'sort_buffer_size';"
docker exec -it nodeopenai-mysql2 mysql -uappuser -papppass -e "SHOW VARIABLES LIKE 'innodb_buffer_pool_size';"
```

### 方案B: 线上生产环境

```bash
# 1. 进入项目目录
cd /mnt/disk2t/www/Back-end/openAILittle

# 2. 备份现有配置
cp compose.yml compose.yml.backup.$(date +%Y%m%d_%H%M%S)

# 3. 上传新配置文件
# - compose.yml
# - mysql-custom.cnf

# 4. 停止MySQL容器(注意:会短暂中断服务!)
docker-compose down mysql

# 5. 启动优化后的MySQL容器
docker-compose up -d mysql

# 6. 等待MySQL启动完成(约10-30秒)
docker-compose logs -f mysql

# 7. 验证服务可用
curl -I http://localhost:7102

# 8. 重启依赖MySQL的服务
pm2 restart statsServer
pm2 restart index

# 9. 查看应用日志,确认连接正常
pm2 logs statsServer --lines 50
```

---

## ✅ 验证配置生效

### 1. 检查MySQL参数
```bash
# 进入MySQL容器
docker exec -it nodeopenai-mysql2 mysql -uappuser -papppass

# 查看关键参数
SHOW VARIABLES LIKE 'sort_buffer_size';          -- 应该是 4194304 (4MB)
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';   -- 应该是 1073741824 (1GB)
SHOW VARIABLES LIKE 'max_connections';           -- 应该是 500
SHOW VARIABLES LIKE 'slow_query_log';            -- 应该是 ON
```

### 2. 测试接口性能
```bash
# 测试使用情况查询(之前报错的接口)
time curl 'https://openailittle.liujiarong.top/api/stats/usage?page=1&pageSize=10'

# 预期结果: 响应时间 < 2秒, 无错误
```

### 3. 监控资源使用
```bash
# 查看容器资源占用
docker stats nodeopenai-mysql2

# 预期结果:
# CPU: 10-30%
# 内存: 800MB-1.5GB (根据负载动态变化)
```

---

## 📈 性能提升预期

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| **sort_buffer_size** | 256KB | 4MB | 16倍 ⬆️ |
| **innodb_buffer_pool** | 128MB | 1GB | 8倍 ⬆️ |
| **最大连接数** | 151 | 500 | 3.3倍 ⬆️ |
| **查询响应时间** | 5-10秒 | <1秒 | 10倍 ⬆️ |
| **ER_OUT_OF_SORTMEMORY错误** | 频繁 | 0次 | 100% ⬇️ |

---

## 🔍 故障排查

### 问题1: 容器启动失败
**症状**: `docker-compose up -d` 失败

**可能原因**:
- 端口7102被占用
- mysql-custom.cnf语法错误
- 磁盘空间不足

**解决方法**:
```bash
# 检查端口占用
lsof -i:7102

# 查看容器日志
docker-compose logs mysql

# 验证配置文件语法
docker run --rm -v $(pwd)/mysql-custom.cnf:/etc/mysql/conf.d/custom.cnf:ro mysql:8.2 mysqld --help --verbose
```

### 问题2: 配置未生效
**症状**: `SHOW VARIABLES` 显示旧值

**可能原因**:
- 配置文件挂载路径错误
- command参数被覆盖
- 配置文件权限问题

**解决方法**:
```bash
# 检查挂载点
docker inspect nodeopenai-mysql2 | grep -A 10 "Mounts"

# 验证配置文件内容
docker exec nodeopenai-mysql2 cat /etc/mysql/conf.d/custom.cnf

# 重新创建容器
docker-compose down
docker-compose up -d mysql
```

### 问题3: 内存占用过高
**症状**: 容器内存超过2GB

**可能原因**:
- innodb_buffer_pool_size设置过大
- 大量并发连接
- 内存泄漏

**解决方法**:
```bash
# 调整参数(修改compose.yml)
--innodb_buffer_pool_size=512M  # 降低到512MB

# 限制连接数
--max_connections=200

# 重启容器
docker-compose restart mysql
```

---

## 📚 参数说明详解

### 内存相关
- **sort_buffer_size**: 每个需要排序的线程分配的缓冲区大小
- **join_buffer_size**: JOIN操作的缓冲区大小
- **tmp_table_size**: 内存临时表最大大小
- **innodb_buffer_pool_size**: InnoDB数据和索引缓存,最重要的参数!

### 性能相关
- **innodb_flush_log_at_trx_commit**:
  - `0` = 每秒刷新(最快,但可能丢失1秒数据)
  - `1` = 每次提交刷新(最安全,但较慢)
  - `2` = 每秒刷新到OS缓存(平衡方案,推荐)

- **innodb_io_capacity**: SSD建议2000-4000, HDD建议200-400

### 日志相关
- **slow_query_log**: 记录慢查询,用于性能分析
- **long_query_time**: 超过此时间的查询会被记录

---

## 🎯 进一步优化建议

### 如果服务器资源充足
```yaml
# compose.yml
limits:
  cpus: '4.0'
  memory: 4G

# mysql-custom.cnf
innodb_buffer_pool_size = 2G
sort_buffer_size = 8M
```

### 如果资源紧张
```yaml
# compose.yml
limits:
  cpus: '1.0'
  memory: 1G

# mysql-custom.cnf
innodb_buffer_pool_size = 512M
sort_buffer_size = 2M
```

### 启用主从复制(高可用)
```ini
# 主库配置
[mysqld]
server-id = 1
log_bin = mysql-bin
binlog_format = ROW
```

---

## 📞 技术支持

- **文档版本**: 1.0
- **最后更新**: 2025-10-24
- **作者**: Liu Jiarong

---

**注意事项**:
- ⚠️ 重启MySQL容器会短暂中断数据库服务(约10-30秒)
- ⚠️ 建议在低峰期进行配置变更
- ⚠️ 修改前务必备份数据库和配置文件
- ✅ 配置变更后建议观察24小时确认稳定性
