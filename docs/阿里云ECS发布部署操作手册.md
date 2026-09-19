# Home Rehab Motion 阿里云 ECS 发布部署操作手册

> 适用环境：单台阿里云 ECS、宝塔 Nginx/MySQL、Docker Compose、阿里云 ACR 和私有 OSS Bucket。
>
> 生产域名为 `sunwenqiang.cn`：`/` 为管理端，`/api/` 为业务 API。

## 1. 架构

| 服务 | ACR 镜像 | 职责 | 宿主机端口 |
| --- | --- | --- | --- |
| `admin-web` | `home-rehab-motion-admin` | Vue 管理端 | `127.0.0.1:8080` |
| `main-service` | `home-rehab-motion-main` | API、登录、上传签名、业务数据 | `127.0.0.1:3000` |
| `analysis-service` | `home-rehab-motion-analysis` | 分析 API | 不暴露 |
| `analysis-worker` | `home-rehab-motion-analysis` | Celery 视频分析任务 | 不暴露 |
| `analysis-beat` | `home-rehab-motion-analysis` | 失败回调重试调度 | 不暴露 |
| `redis` | `home-rehab-motion-redis:7.4-alpine` | 缓存和消息队列 | 不暴露 |

宝塔 Nginx 负责公网 `80/443` 和 TLS；MySQL 运行在宝塔宿主机，容器通过 `host.docker.internal:3306` 访问。推荐应用部署目录为 `/opt/home-rehab-motion`，不需要放在 `/www/wwwroot`。

## 2. 一次性准备

### 2.1 网络、HTTPS 与 MySQL

1. 将 `sunwenqiang.cn` A 记录解析到 ECS 公网 IP。
2. 阿里云安全组只对公网开放 `22`、`80`、`443`；不能开放 `3000`、`8080`、`3306`、`6379`。
3. 在宝塔创建 `sunwenqiang.cn` 网站，申请证书并启用 HTTP 跳转 HTTPS。
4. 若使用 UFW，MySQL `3306` 仅允许 Docker 实际网段访问：

```bash
docker network inspect home-rehab-motion_internal
sudo ufw allow from 172.18.0.0/16 to any port 3306 proto tcp
```

上述网段仅为示例，必须以 `docker network inspect` 结果为准。

在宝塔 MySQL 中创建数据库及业务账号，不能使用 `root`：

```sql
CREATE DATABASE IF NOT EXISTS home_rehab_motion
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'home_rehab_motion'@'172.18.%'
  IDENTIFIED BY '替换为高强度密码';
GRANT ALL PRIVILEGES ON home_rehab_motion.* TO 'home_rehab_motion'@'172.18.%';
FLUSH PRIVILEGES;
```

`172.18.%` 要按真实 Docker 网段修改；多个网段需分别授权。

### 2.2 OSS 私有 Bucket

1. 创建北京地域 Bucket，例如 `home-rehab-motion-assets-prod`，ACL 设为**私有**。
2. 创建 RAM 子账号 AccessKey，仅授予该 Bucket 必要读写权限；不要用阿里云主账号 AccessKey。
3. 配置 CORS：来源 `https://sunwenqiang.cn`，方法 `POST`、`GET`、`HEAD`，Allowed Headers 为 `*`，Expose Headers 为 `ETag`。

Bucket 私有是预期配置：数据库仅保存对象 `objectKey`；主服务读取数据时生成有时效的签名 URL。`OSS_PRESIGNED_EXPIRES_SECONDS=3600` 表示链接有效一小时。OSS 自定义域名/CDN 是可选优化，不是上传或访问前置条件。

### 2.3 GitHub Actions 与 ACR

`.github/workflows/publish-images.yml` 会推送：

- `home-rehab-motion-main`
- `home-rehab-motion-analysis`
- `home-rehab-motion-admin`
- `home-rehab-motion-redis:7.4-alpine`（同步 Redis 基础镜像，避免 ECS 无法访问 Docker Hub）

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 用途 |
| --- | --- |
| `ACR_REGISTRY` | 如 `crpi-xxx.cn-beijing.personal.cr.aliyuncs.com` |
| `ACR_NAMESPACE` | ACR 命名空间，例如 `sunwenqiang` |
| `ACR_USERNAME` | ACR 访问凭证用户名 |
| `ACR_PASSWORD` | ACR 访问凭证密码或令牌 |

推送版本 Tag 会自动构建同名镜像：

```bash
git tag v0.1.1
git push origin v0.1.1
```

也可以在 GitHub Actions 手动运行 `publish-production-images` 并填写 `image_tag`。生产务必使用 `v0.1.1` 这种不可变标签，不要使用 `latest`。

### 2.4 ECS 初始化

从 ACR 控制台复制登录命令到 ECS 执行：

```bash
docker login --username=<ACR用户名> crpi-xxx.cn-beijing.personal.cr.aliyuncs.com
```

初始化部署目录：

```bash
sudo mkdir -p /opt/home-rehab-motion
sudo chown "$USER" /opt/home-rehab-motion
cd /opt/home-rehab-motion
git clone <GitHub仓库地址> .
chmod 600 .env.production
```

`.env.production` 包含密码、Token、AccessKey，绝不能提交到 Git、输出到 CI 日志或发送到他人。

## 3. `.env.production` 核心配置

服务器路径：`/opt/home-rehab-motion/.env.production`。

```env
MYSQL_HOST=host.docker.internal
MYSQL_PORT=3306
MYSQL_DATABASE=home_rehab_motion
MYSQL_USER=home_rehab_motion
MYSQL_PASSWORD=<业务数据库密码>

REDIS_IMAGE=crpi-xxx.cn-beijing.personal.cr.aliyuncs.com/<namespace>/home-rehab-motion-redis:7.4-alpine
REDIS_PASSWORD=<至少32位随机密码>

AUTH_TOKEN_SECRET=<至少32位随机密钥>
ANALYSIS_INTERNAL_TOKEN=<至少32位随机密钥>
PUBLIC_API_BASE_URL=https://sunwenqiang.cn/api
ANALYSIS_CALLBACK_URL=https://sunwenqiang.cn/api/videos/internal/analysis-callback

OSS_ENDPOINT=https://oss-cn-beijing.aliyuncs.com
OSS_BUCKET=home-rehab-motion-assets-prod
OSS_ACCESS_KEY_ID=<RAM AccessKey ID>
OSS_ACCESS_KEY_SECRET=<RAM AccessKey Secret>
OSS_FORCE_PATH_STYLE=false
OSS_PUBLIC_BASE_URL=
OSS_PRESIGNED_EXPIRES_SECONDS=3600

WX_APP_ID=<小程序AppID>
WX_APP_SECRET=<小程序AppSecret>

MAIN_SERVICE_IMAGE=crpi-xxx.cn-beijing.personal.cr.aliyuncs.com/<namespace>/home-rehab-motion-main:v0.1.1
ANALYSIS_SERVICE_IMAGE=crpi-xxx.cn-beijing.personal.cr.aliyuncs.com/<namespace>/home-rehab-motion-analysis:v0.1.1
ADMIN_WEB_IMAGE=crpi-xxx.cn-beijing.personal.cr.aliyuncs.com/<namespace>/home-rehab-motion-admin:v0.1.1
```

生产 Compose 已固定使用 `NODE_ENV=production`、`STORAGE_UPLOAD_MODE=s3_post`，并关闭 Mock 登录、样例视频及 Mock 关键点回退。改动 `.env.production` 后需重建容器，`restart` 不会加载新变量。

## 4. 宝塔 Nginx

在宝塔网站 `sunwenqiang.cn` 创建根路径反向代理，目标：

```text
http://127.0.0.1:8080
```

在站点配置加入 API 规则。`proxy_pass` 末尾不能带 `/`，否则会剥离 `/api` 前缀并导致接口 404：

```nginx
location ^~ /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
    client_max_body_size 210m;
}
```

宝塔已生成 `/` 反代时，不要额外手写 `location /`，否则 Nginx 会报 `duplicate location "/"`。修改后测试并重载 Nginx。

## 5. 首次部署

在 ECS 执行：

```bash
cd /opt/home-rehab-motion
docker compose --env-file .env.production -f infra/docker-compose.production.yml pull
docker compose --env-file .env.production -f infra/docker-compose.production.yml up -d

docker compose --env-file .env.production -f infra/docker-compose.production.yml ps
docker compose --env-file .env.production -f infra/docker-compose.production.yml logs --tail=100 main-service
```

### 5.1 数据库迁移

迁移前备份 MySQL。首次部署必须执行；之后仅当代码带来新的 Prisma 迁移时需要执行。禁止生产使用 `prisma migrate dev`。

```bash
docker compose --env-file .env.production -f infra/docker-compose.production.yml run --rm main-service \
  node node_modules/prisma/build/index.js migrate deploy \
  --schema services/main-service/prisma/schema.prisma
```

没有新增迁移时重复运行是安全的，不会重复建表。

### 5.2 初始化管理员

仅在数据库中尚无管理员账号时执行；密码至少 12 位：

```bash
BOOTSTRAP_ADMIN_USERNAME='admin' \
BOOTSTRAP_ADMIN_PASSWORD='替换为至少12位高强度密码' \
BOOTSTRAP_ADMIN_DISPLAY_NAME='初始管理员' \
docker compose --env-file .env.production -f infra/docker-compose.production.yml run --rm \
  -e BOOTSTRAP_ADMIN_USERNAME -e BOOTSTRAP_ADMIN_PASSWORD -e BOOTSTRAP_ADMIN_DISPLAY_NAME \
  main-service npm run bootstrap:admin -w @home-rehab-motion/main-service
```

### 5.3 验收

```bash
curl -fsS http://127.0.0.1:3000/api/health/live
curl -fsS http://127.0.0.1:3000/api/health/ready
curl -I https://sunwenqiang.cn/
curl -fsS https://sunwenqiang.cn/api/health/live
```

在浏览器验证：管理员登录、指导图片/视频上传与预览、指导内容发布、小程序授权上传、分析完成与报告查看。并检查 `analysis-worker` 无持续报错。

## 6. 日常发布

生产发布分为两步：先由 GitHub Actions 构建并推送三个业务镜像到 ACR，再由 ECS 拉取指定 Tag 并重建服务。镜像 Tag 必须在三个业务镜像中保持一致，建议只使用未曾发布过的新版本号，例如 `v0.1.21`。

ECS 中的 `deploy-production.sh` 与 `.env.production` 均位于 `/opt/home-rehab-motion`。部署脚本会同步更新 `.env.production` 中的 `MAIN_SERVICE_IMAGE`、`ANALYSIS_SERVICE_IMAGE` 和 `ADMIN_WEB_IMAGE`，拉取镜像、重建服务、输出容器状态，并轮询主服务就绪接口。

### 6.1 自动发布：推送 Git Tag

适用于常规版本发布。推送以 `v` 开头的 Git Tag 会自动触发 GitHub Actions 的 `publish-production-images` 工作流，镜像 Tag 与 Git Tag 完全一致。

1. 确认 `main` 已包含待发布代码且本地测试完成。
2. 创建并推送新的版本 Tag：

```bash
git checkout main
git pull --ff-only origin main
git tag -a v0.1.21 -m "release v0.1.21"
git push origin v0.1.21
```

3. 打开 GitHub Actions，等待 `publish-production-images` 工作流成功；确认 `main-service`、`analysis-service`、`admin-web` 三个构建任务均成功。
4. 在 ECS 执行发布。无数据库迁移时：

```bash
cd /opt/home-rehab-motion
chmod +x deploy-production.sh
./deploy-production.sh v0.1.21
```

5. 如本次版本包含新的 Prisma migration，**先完成 MySQL 备份**，再执行：

```bash
cd /opt/home-rehab-motion
./deploy-production.sh v0.1.21 --migrate
```

### 6.2 手动命名发布：指定镜像 Tag

适用于补发镜像、修复构建产物，或不希望创建 Git Tag 的发布。此方式需要在 GitHub Actions 中手动填写镜像 Tag；请使用新的、可追溯的名称，例如 `v0.1.21-hotfix.1`。不要覆盖已用于生产的 Tag。

1. 打开仓库的 **Actions** 页面，选择 `publish-production-images` 工作流。
2. 点击 **Run workflow**，选择要构建的代码分支或提交所在分支。
3. 在 **image_tag** 中显式填写镜像 Tag，例如 `v0.1.21-hotfix.1`，然后运行工作流。不要留空：留空时工作流会使用当前 Git 引用名称，可能得到 `main` 等不适合生产追溯的 Tag。
4. 等待三个业务镜像构建并推送成功后，登录 ECS，编辑 `/opt/home-rehab-motion/.env.production`，将以下三个变量的 Tag 都改为相同的手动命名 Tag，例如 `v0.1.21-hotfix.1`：

```bash
MAIN_SERVICE_IMAGE=.../home-rehab-motion-main:v0.1.21-hotfix.1
ANALYSIS_SERVICE_IMAGE=.../home-rehab-motion-analysis:v0.1.21-hotfix.1
ADMIN_WEB_IMAGE=.../home-rehab-motion-admin:v0.1.21-hotfix.1
```

5. 手动拉取并启动新版本：

```bash
cd /opt/home-rehab-motion
docker compose --env-file .env.production -f infra/docker-compose.production.yml pull
docker compose --env-file .env.production -f infra/docker-compose.production.yml up -d
docker compose --env-file .env.production -f infra/docker-compose.production.yml ps
```

6. 如有新的 Prisma migration，**先完成 MySQL 备份**，再执行迁移：

```bash
cd /opt/home-rehab-motion
docker compose --env-file .env.production -f infra/docker-compose.production.yml run --rm main-service \
  node node_modules/prisma/build/index.js migrate deploy \
  --schema services/main-service/prisma/schema.prisma
```

### 6.3 发布后的检查与失败处理

脚本默认要求交互确认；自动化场景可附加 `--yes`。在服务重建前失败时，脚本会自动恢复 `.env.production` 的镜像配置；服务已重建但健康检查失败时，脚本会保留现场并输出关键日志，避免在存在数据库迁移时盲目回滚。原镜像配置会备份为 `.env.production.before-release.<时间戳>`。

如需额外检查日志：

```bash
cd /opt/home-rehab-motion
docker compose --env-file .env.production -f infra/docker-compose.production.yml logs --tail=100 main-service analysis-service analysis-worker
curl -fsS https://sunwenqiang.cn/api/health/ready
```

### 6.4 仅修改主服务或环境变量

例如调整 `OSS_PRESIGNED_EXPIRES_SECONDS` 后，仅重建主服务：

```bash
cd /opt/home-rehab-motion
docker compose --env-file .env.production -f infra/docker-compose.production.yml up -d --no-deps --force-recreate main-service
```

如果代码变更，需要先让 GitHub Actions 构建相应新镜像、更新 `.env.production` 镜像 Tag，再执行以上命令。

## 7. 回滚

1. 从 `.env.production` 或 ACR 找到上一稳定版本 Tag。
2. 将三个业务镜像变量改回上一版本。
3. 重新拉取并启动：

```bash
cd /opt/home-rehab-motion
docker compose --env-file .env.production -f infra/docker-compose.production.yml pull
docker compose --env-file .env.production -f infra/docker-compose.production.yml up -d
```

4. 检查 `/api/health/live`、`/api/health/ready` 和 Worker 日志。

数据库迁移不能默认自动回滚。若迁移导致数据问题，按迁移前备份恢复；因此每次执行 `migrate deploy` 前都必须完成数据库备份。

## 8. 常用排查命令

```bash
# 服务状态
docker compose --env-file .env.production -f infra/docker-compose.production.yml ps

# 实时日志
docker compose --env-file .env.production -f infra/docker-compose.production.yml logs -f main-service

docker compose --env-file .env.production -f infra/docker-compose.production.yml logs -f analysis-worker

# 查看容器最终注入的签名链接有效期
docker compose --env-file .env.production -f infra/docker-compose.production.yml exec main-service \
  printenv OSS_PRESIGNED_EXPIRES_SECONDS

# 检查本机端口监听
sudo ss -lntp | grep -E ':3000|:8080|:3306'

# Nginx 配置测试（宝塔环境按实际 Nginx 路径执行）
nginx -t
```

常见问题：

| 现象 | 优先检查 |
| --- | --- |
| 管理端 502 | `admin-web` 是否启动、`127.0.0.1:8080` 是否监听、宝塔根路径反代是否正确 |
| API 404，路径变为 `/admin/...` | API 的 `proxy_pass` 是否错误带了末尾 `/` |
| Nginx `duplicate location "/"` | 删除手写重复的 `location /`，保留宝塔根反代 |
| Prisma `P1000` | MySQL 用户、密码、允许连接的 Host 与 Docker 网段授权 |
| MySQL TCP 超时 | UFW、防火墙、3306 监听地址和 Docker 网段放行 |
| OSS 上传成功但无法预览 | OSS CORS、签名 URL 有效期、主服务是否升级到签名 URL 读取逻辑 |
| Redis unhealthy | `REDIS_PASSWORD` 与 Redis healthcheck 是否一致，确认使用 ACR Redis 镜像 |
