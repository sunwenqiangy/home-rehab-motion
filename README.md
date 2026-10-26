# 安舒随行（Home Rehab Motion）

安舒随行是一个居家动作训练与记录工具。患者通过微信小程序查看动作指导、上传短视频或创建自主记录；系统异步分析视频，生成训练反馈和留痕；管理端用于维护指导内容、患者配置、激励与反馈。

当前支持缩腹运动、骨盆倾斜和膝关节旋转。视频用于观察动作完成情况和生成建议，**不用于医疗诊断、疗效判定或精确临床测量**。

## 快速开始

本地需要 Node.js 20、npm、Python 3.11、Docker（推荐，用于 MySQL / Redis / MinIO）和微信开发者工具。

```bash
nvm use
npm ci
cp .env.example .env  # 已有本地配置时不要覆盖
docker compose -f infra/docker-compose.local.yml up -d
./start-local.sh
```

如果你的 Docker 环境只提供独立版 Compose，请将上面的 `docker compose` 替换为 `docker-compose`。

然后：

- 管理端：打开脚本输出的地址（默认 `http://127.0.0.1:5173`）
- 患者端：使用微信开发者工具打开 `apps/patient-miniapp`
- 停止本地服务：`./start-local.sh stop`

`start-local.sh` 会优先读取根目录 `.env`；服务端口和对象存储配置以该文件的实际值为准。项目本地默认将分析 API 设为 `8000`；如需改端口，必须同时修改 `ANALYSIS_PORT` 与 `ANALYSIS_SERVICE_URL`。

完整的环境变量、登录、MinIO、故障排查与验收步骤见[本地启动运行指南](docs/本地启动运行指南.md)。

## 项目结构

| 目录 | 职责 |
| --- | --- |
| `apps/patient-miniapp` | 患者微信小程序：训练、上传、报告、历史和反馈 |
| `apps/admin-web` | 管理端 Web：指导内容、患者、配置、反馈与预览 |
| `services/main-service` | NestJS 主服务：业务接口、上传协调、报告、记录与激励 |
| `services/analysis-service` | FastAPI + Celery：视频分析、动作切分、评分与回调 |
| `packages/*` | 跨端接口契约、类型与常量 |
| `infra/` | 本地依赖、生产 Compose 与部署相关配置 |
| `docs/` | 当前产品、实现、运行与交接文档 |

## 常用命令

```bash
# 完整启动 / 关闭
./start-local.sh
./start-local.sh stop

# 按服务启动
./start-local.sh main
./start-local.sh analysis
./start-local.sh admin

# 基础校验
npm run typecheck
npm run build -w @home-rehab-motion/main-service
npm run build -w @home-rehab-motion/admin-web
git diff --check
```

健康检查地址从 `.env` 中的 `PORT` 和 `ANALYSIS_PORT` 推导：

```bash
curl -fsS http://127.0.0.1:<PORT>/api/health/live
curl -fsS http://127.0.0.1:<PORT>/api/health/ready
curl -fsS http://127.0.0.1:<ANALYSIS_PORT>/health/live
```

## 文档入口

从[文档导航](docs/README.md)进入专题文档。最常用的入口是：

- [产品能力与用户旅程](docs/项目梳理/产品视角_产品能力与用户旅程.md)
- [系统架构与实现地图](docs/项目梳理/开发者视角_系统架构与实现地图.md)
- [当前实现口径](docs/技术方案/当前实现口径.md)
- [三类康复动作拆分、分析与评分说明](docs/技术方案/三类康复动作拆分分析评分说明.md)
- [项目交接与运行指南](docs/项目交接与运行指南.md)
- [阿里云 ECS 发布部署操作手册](docs/阿里云ECS发布部署操作手册.md)

## 文档与资产约定

- 当前实现事实只在对应的规范文档维护；不要新增重复总览或把历史归档当成当前规则。
- `docs/video/` 与 `docs/标准教学视频/` 是保留的教学/算法验证资产，不参与文档清理；详见[视频资产说明](docs/视频资产说明.md)。
- `.env`、生产凭据、真实患者视频与本地运行日志不得提交。
