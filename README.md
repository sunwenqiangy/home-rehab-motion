# Home Rehab Motion 本地启动说明

## 快速导航

- 想最快跑起来：看 `开发同学最短启动路径`
- 想知道每个服务是干什么的：看 `各服务说明`
- 想看完整启动/关闭命令：看 `启动方式` / `关闭项目`
- 第一次启动报错：看 `首次启动常见问题`
- 想知道启动后怎么验证：看 `启动后验证`

## 项目结构

本仓库包含以下主要工程：

- `apps/patient-miniapp`：患者端微信小程序
- `apps/admin-web`：管理端 Web
- `services/main-service`：主服务（NestJS）
- `services/analysis-service`：分析服务（FastAPI + Celery）
- `packages/*`：共享 contract / type / constant

## 各服务说明

### 1. 患者端小程序

目录：`apps/patient-miniapp`

作用：

- 患者训练入口
- 动作指导查看
- 视频上传
- 分析中状态轮询
- 报告查看
- 历史记录 / 我的页面

启动方式：

- 不通过命令行直接启动
- 使用微信开发者工具打开：`apps/patient-miniapp`

### 2. 管理端 Web

目录：`apps/admin-web`

作用：

- 管理指导内容
- 查看视频记录
- 处理反馈
- 管理阈值和账号

启动后访问：

- `http://127.0.0.1:5173`

### 3. 主服务 main-service

目录：`services/main-service`

作用：

- 业务主后端（NestJS）
- 提供患者端和管理端的大部分接口
- 处理登录、指导、上传确认、报告、历史、反馈等业务
- 负责调用分析服务并接收分析结果回调

启动后访问：

- `http://127.0.0.1:3000/api`

### 4. 分析服务 analysis-service

目录：`services/analysis-service`

作用：

- 视频分析服务（FastAPI）
- Celery Worker 执行异步分析任务
- 产出动作评分和建议
- 回调主服务写入结果

启动后访问：

- `http://127.0.0.1:8000`

## 开发同学最短启动路径

如果你只是第一次把项目跑起来，按下面步骤即可：

### 方式 A：最省事（推荐）

1. 启动依赖环境（MySQL / Redis，如本机未安装可用 Docker）：

```bash
docker compose -f infra/docker-compose.local.yml up -d
```

2. 在项目根目录启动后端 + 管理端：

```bash
./start-local.sh
```

3. 用微信开发者工具打开：

```text
apps/patient-miniapp
```

### 方式 B：如果你只想看管理端和后端

```bash
./start-local.sh
```

打开：

- 管理端：`http://127.0.0.1:5173`
- 主服务：`http://127.0.0.1:3000/api`

### 方式 C：只启动某一个服务

```bash
./start-local.sh main
./start-local.sh analysis
./start-local.sh admin
```

## 启动方式

推荐使用根目录脚本：

```bash
./start-local.sh
```

该命令会默认启动以下服务：

- 主服务 `main-service`，端口 `3000`
- 分析服务 API `analysis-service`，端口 `8000`
- 分析服务 Worker `celery worker`
- 管理端 `admin-web`，端口 `5173`

启动完成后默认访问地址：

- 管理端：`http://127.0.0.1:5173`
- 主服务 API：`http://127.0.0.1:3000/api`
- 分析服务 API：`http://127.0.0.1:8000`

## 分模块启动

只启动主服务：

```bash
./start-local.sh main
```

只启动分析服务 API + Worker：

```bash
./start-local.sh analysis
```

只启动管理端：

```bash
./start-local.sh admin
```

停止全部后台服务：

```bash
./start-local.sh stop
```

## 启动前依赖

脚本会检查以下依赖是否存在：

- `node`
- `npm`
- `python3`
- `mysql`
- `redis-cli`

如果缺失，请先安装。

## 启动前环境要求

### 1. MySQL

默认连接：

- Host: `127.0.0.1`
- Port: `3306`
- DB: `home-rehab-motion`
- User: `root`
- Password: `（默认留空）`

脚本会尝试自动创建 `home-rehab-motion` 数据库。

### 2. Redis

默认连接：

- `redis://127.0.0.1:6379/0`

### 3. Python 虚拟环境

首次启动分析服务时，如果目录不存在：

```bash
services/analysis-service/.venv
```

脚本会自动：

- 创建虚拟环境
- 安装 `requirements.txt`

## 默认环境变量

`start-local.sh` 内默认使用以下环境变量：

```bash
PORT=3000
DATABASE_URL=mysql://root@127.0.0.1:3306/home_rehab_motion
REDIS_URL=redis://127.0.0.1:6379/0
ANALYSIS_SERVICE_URL=http://127.0.0.1:8000
ANALYSIS_CALLBACK_URL=http://127.0.0.1:3000/api/videos/internal/analysis-callback
ANALYSIS_INTERNAL_TOKEN=home-rehab-motion-internal-token
ANALYSIS_PORT=8000
CELERY_BROKER_URL=redis://127.0.0.1:6379/1
CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/2
ANALYSIS_DATABASE_URL=mysql+pymysql://root@127.0.0.1:3306/home_rehab_motion
```

如果你本地环境不同，可以在执行前先导出覆盖，例如：

```bash
export DATABASE_URL="mysql://root:yourpassword@127.0.0.1:3306/home_rehab_motion"
export ANALYSIS_DATABASE_URL="mysql+pymysql://root:yourpassword@127.0.0.1:3306/home_rehab_motion"
./start-local.sh
```

## 日志与 PID 文件

脚本启动后台服务后会在根目录生成：

- 日志目录：`.local-logs/`
- PID 目录：`.local-pids/`

常见日志文件：

- `.local-logs/main.log`
- `.local-logs/analysis-api.log`
- `.local-logs/analysis-worker.log`
- `.local-logs/admin-web.log`

查看日志示例：

```bash
tail -f .local-logs/main.log
```

## 关闭项目

推荐统一关闭：

```bash
./start-local.sh stop
```

该命令会读取 `.local-pids/*.pid` 并依次停止后台进程。

## 启动后验证

启动完成后，建议按下面方式快速确认服务是否真的起来了：

### 1. 验证管理端

浏览器打开：

- `http://127.0.0.1:5173`

能看到管理端登录页或页面内容，说明管理端已正常启动。

### 2. 验证主服务

浏览器或命令行访问：

```bash
curl http://127.0.0.1:3000/api/health
```

如果能返回健康检查结果，说明主服务正常。

### 3. 验证分析服务

浏览器或命令行访问：

```bash
curl http://127.0.0.1:8000/health
```

如果能返回健康检查结果，说明分析服务 API 正常。

### 4. 验证日志

如果页面打不开或接口不通，优先查看日志：

```bash
tail -f .local-logs/main.log
tail -f .local-logs/analysis-api.log
tail -f .local-logs/admin-web.log
```

### 5. 验证小程序

微信开发者工具打开 `apps/patient-miniapp` 后，重点检查：

- 首页是否正常加载
- 是否能访问后端接口
- 上传、分析、报告链路是否能跑通

## Docker 辅助环境（可选）

如果本机没有单独安装 MySQL / Redis / MinIO，也可以使用：

```bash
docker compose -f infra/docker-compose.local.yml up -d
```

关闭：

```bash
docker compose -f infra/docker-compose.local.yml down
```

该 compose 会启动：

- MySQL `3306`
- Redis `6379`
- MinIO `9000`
- MinIO Console `9001`

## 常用命令

工作区类型检查：

```bash
npm run typecheck
```

仅检查患者端：

```bash
npm run typecheck -w @home-rehab-motion/patient-miniapp
```

仅检查管理端：

```bash
npm run typecheck -w @home-rehab-motion/admin-web
```

仅检查主服务：

```bash
npm run typecheck -w @home-rehab-motion/main-service
```

生成 Prisma Client：

```bash
npm run db:generate
```

## 首次启动常见问题

### 1. `mysql` 连接失败

说明：本机 MySQL 未启动，或 root 密码不是 README 默认值。

处理方式：

- 先启动本机 MySQL，或使用 Docker 启动
- 如密码不是 `root`，先覆盖环境变量再启动：

```bash
export DATABASE_URL="mysql://root:你的密码@127.0.0.1:3306/home_rehab_motion"
export ANALYSIS_DATABASE_URL="mysql+pymysql://root:你的密码@127.0.0.1:3306/home_rehab_motion"
./start-local.sh
```

### 2. `redis` 连接失败

说明：本机 Redis 未启动。

处理方式：

- 本机安装用户可先启动 Redis
- 或直接使用：

```bash
docker compose -f infra/docker-compose.local.yml up -d
```

### 3. 分析服务虚拟环境创建很慢

说明：首次启动 `analysis-service` 时，脚本会自动创建 `.venv` 并安装依赖。

处理方式：

- 首次等待完成即可
- 后续再次启动会直接复用，不会重复安装

### 4. 小程序打不开

说明：患者端不是通过 `./start-local.sh` 打开的。

处理方式：

- 使用微信开发者工具打开：`apps/patient-miniapp`
- 如果只启动了后端，确保 `main-service` 已在 `3000` 端口运行

## 说明

- 当前 `start-local.sh` 默认启动的是：主服务、分析服务、Celery Worker、管理端。
- 患者端微信小程序不通过该脚本启动，需要使用微信开发者工具打开：

```text
apps/patient-miniapp
```

- 如果你只想验证后端和管理端，本地执行 `./start-local.sh` 即可。
- 停止项目统一使用：

```bash
./start-local.sh stop
```
