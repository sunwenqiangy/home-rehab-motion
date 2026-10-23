# 安舒随行项目交接说明

更新时间：2026-10-23

## 一、项目定位

这是一个“居家动作训练与记录工具”，由微信小程序、管理端、主服务和动作分析服务组成。小程序名称为“安舒随行”，简称“安舒”。产品提供动作指导、短视频观察、练习记录、训练报告和连续练习激励。

当前产品原则是：视频用于观察动作是否标准和生成建议，不要求用户上传完整训练过程；缩腹、骨盆动作视频控制在 30 秒内，膝关节旋转最长 60 秒，支持自主记录作为无视频留痕入口。

## 二、代码结构

- `apps/patient-miniapp`：微信小程序，包含首页、动作指导、上传、分析中、报告、训练历史、个人资料、隐私政策等页面。
- `apps/admin-web`：管理端 Vue 页面，包含患者、动作指导、拍摄要求、评分模板、患者应用配置和激励规则配置。
- `services/main-service`：NestJS 主服务，负责登录、用户资料、动作指导、视频上传、分析任务、报告、训练记录、徽章和系统配置。
- `services/analysis-service`：Python 分析服务，负责视频抽帧、动作识别、质量判断和评分结果生成。
- `packages/shared-contract`：前后端 DTO 和接口契约。
- `packages/shared-types`、`packages/shared-constants`：共享类型和常量。
- `docs`：项目说明和交接文档。

## 三、已完成的主要功能

### 小程序

- 登录页、首页、训练入口和底部导航完成一轮视觉统一。
- 动作指导页支持教学视频、动作步骤、拍摄要求、常见错误和拍摄/相册上传入口。
- 拍摄要求示意图支持正侧面、全身入镜、光线均匀等素材；小程序内图片按完整比例展示，留白使用黑色背景。
- 上传视频限制和提示围绕“至少一段完整动作”设计；缩腹、骨盆不超过 30 秒，膝关节旋转不超过 60 秒。
- 视频训练报告、训练历史、自主练习记录和自主练习详情页已接通。
- 自主练习支持管理端开关控制，并限制同一天重复创建记录。
- 个人资料、隐私政策、关于系统、反馈和通知页面已做样式优化。
- 使用“安舒随行”品牌头像：`apps/patient-miniapp/assets/brand/anshu-suixing-avatar.png`。

### 管理端

- 动作指导编辑页已支持基础信息、教学视频、动作步骤、拍摄要求、常见错误和患者端预览。
- 患者端预览已按照小程序动作指导详情页同步：模块顺序、卡片层级、图片比例、黑色留白、拍摄要求徽标和底部按钮。
- 动作指导保存采用单一内容流程：保存时直接校验并生成正式版本，不再创建新的“草稿/启用”双状态流程。
- 保存校验会明确列出缺项；缺项清单仅在点击“保存内容”后展示。
- 当前动作指导必填规则：基础信息、教学视频、3～5 个动作步骤、至少 1 条完整拍摄要求。常见错误整体可选，但新增后必须填写完整。
- “预计训练时长”字段在管理端隐藏，保留后端字段和默认值。
- 激励规则配置只保留实际生效的 6 个阈值：综合分、稳定性、平均保持时间的轻微/明显进步阈值。有效动作次数阈值已移除，因为当前服务端不使用它。

## 四、关键业务规则

### 动作指导发布

动作指导仍使用内容版本表和启用状态来决定患者端展示哪个动作。编辑页保存会校验完整性并生成新版本；管理端列表中的“启用/下线”控制患者端是否展示。新流程不再生成可见草稿。

历史上曾产生过未发布草稿记录，主服务保留了兼容读取逻辑。已发布记录进入编辑页时读取当前已发布版本，不会被历史草稿标题覆盖。

### 视频分析

- `short_clip` 表示用于动作观察的短视频。
- 腹部、骨盆等动作短视频有 30 秒服务端上限。
- 普通视频分析结果可生成动作指标、建议、报告和连续训练激励。
- 短视频只用于动作观察，部分长期激励和徽章逻辑会跳过不适合短片的指标。

### 激励

激励配置由 `system_config` 的 `motivation_rules` 保存，使用位置主要在：

- `services/main-service/src/motivation/motivation.service.ts`
- `services/main-service/src/config/config.service.ts`
- `apps/admin-web/src/pages/MotivationRulesPage.vue`

徽章定义目前在 `services/main-service/src/badge/badge.service.ts` 中维护，包括首次尝试、连续 3/7 天、累计 30/60/90 天和首次优秀。

## 五、常用开发命令

```bash
npm install
npm run typecheck
npm run dev:admin
npm run dev:main
npm run dev:analysis
npm run db:generate
```

一次启动管理端、主服务和分析服务：

```bash
npm run dev
```

提交前至少执行：

```bash
npm run typecheck
git diff --check
```

## 六、真机和资源注意事项

- 微信开发者工具真机调试曾遇到单文件/源码包超过 2 MB 的错误（错误码 80051）。新增大图或视频素材应优先使用服务端素材地址或 OSS，不要重复放入小程序本地资源目录。
- 拍摄要求默认图已从小程序本地资源移除，运行时通过 `/guidance-defaults/*.png` 访问服务端资源。
- 新增图片应控制尺寸和压缩率；品牌头像是当前保留的本地图片资源。
- 管理端动作指导预览只是编辑态模拟，真实展示以 `apps/patient-miniapp/pages/guidance/detail.wxml/.wxss` 为准；两端修改时需要同步检查。

## 七、当前验证状态

生产运行基线：`v0.1.36`（2026-10-23 已完成容器实际镜像、主服务存活/就绪接口与管理端 HTTP 200 核验）。

最近一次功能提交：`88978cf 统一训练配置与质量不足处理流程`。该提交已完成以下本地代码校验：

已通过：

- 管理端 TypeScript 检查
- 主服务 TypeScript 检查
- 管理端生产构建
- 主服务生产构建
- 主服务 Node 测试 3/3
- 分析服务 Python 测试 98/98
- `git diff --check`

## 八、后续建议

1. 用微信开发者工具重新编译并做一次完整链路验收：登录 → 首页 → 动作指导 → 上传 → 分析 → 报告 → 历史。
2. 清理数据库中历史未发布草稿记录，或在后台增加一次性迁移脚本，避免长期保留旧数据。
3. 为动作指导保存校验补充端到端验证，重点覆盖“至少 1 条拍摄要求”和“缺项清单仅在点击保存后出现”。
4. 继续观察真机源码包大小，避免把新素材直接放入 `apps/patient-miniapp/assets`。

## 九、生产运行交接（ECS / 宝塔）

> 本节以 2026-10-23 的生产核查结果为准。账号、密码、AccessKey、JWT 密钥等敏感信息仅保存在 ECS 的 `.env.production`，**不记录在本文档、Git 或聊天记录中**。

### 9.1 当前生产基线

| 项目 | 当前状态 |
| --- | --- |
| ECS | `101.200.164.177`，项目目录 `/opt/home-rehab-motion` |
| 公网域名 | `https://admin.bjrpxx.cn` |
| 管理端入口 | `https://admin.bjrpxx.cn/rehab/` |
| 业务 API | `https://admin.bjrpxx.cn/api/` |
| 当前生产版本 | `v0.1.36`（`admin-web`、`main-service`、`analysis-service/worker/beat` 均已核验） |
| 公网健康检查 | `GET /api/health/live`、`GET /api/health/ready` 返回成功；`/rehab/` 返回 HTTP 200 |
| 主机内存 / Swap | 约 1.6 GiB 内存、1 GiB Swap；可用内存通常只有数百 MiB，必须维持单分析任务并发 |
| 根分区 | 40 GiB；2026-10-23 使用约 19 GiB（52%） |

域名迁移已经完成：生产业务不再使用 `sunwenqiang.cn`。小程序请求 API、OSS 白名单/CORS、微信公众平台合法域名均应只维护 `admin.bjrpxx.cn`。

### 9.2 服务与流量路径

```text
微信小程序 / 管理员浏览器
          │ HTTPS admin.bjrpxx.cn
          ▼
宝塔 Nginx（证书、80/443、路径反代）
  ├─ /rehab/ ───────────────► admin-web :8080（仅 127.0.0.1）
  └─ /api/ ─────────────────► main-service :3000（仅 127.0.0.1）
                                        ├─ 宿主机宝塔 MySQL
                                        ├─ Redis（Docker 内网）
                                        ├─ OSS（视频、指导素材）
                                        └─ analysis-service / Celery Worker
                                                        │
                                                   MediaPipe 分析
```

Docker 服务和职责：

| Compose 服务 | 职责 | 生产保护配置 |
| --- | --- | --- |
| `admin-web` | 管理端静态站点 | 128 MiB / 0.25 CPU |
| `main-service` | NestJS API、登录、上传签名、报告、任务协调 | 512 MiB / 0.5 CPU |
| `analysis-service` | FastAPI，接收任务和提供骨架预览 | 512 MiB / 0.5 CPU |
| `analysis-worker` | Celery + MediaPipe，实际执行视频分析 | 640 MiB / 1 CPU，`--concurrency=1`，每任务重建子进程 |
| `analysis-beat` | 分析回调失败重试调度 | 128 MiB / 0.15 CPU |
| `redis` | 消息队列与缓存 | 256 MiB / 0.25 CPU |

不要把分析 Worker 并发直接调大。在当前小内存 ECS 上，多条视频应排队；提高并发会增加 OOM、Swap 抖动和整机无响应风险。

### 9.3 宝塔 / Nginx 关键点

- 宝塔负责证书与公网 `80/443`；Docker 的 `3000`、`8080`、`6379`、MySQL `3306` 均不得对公网开放。
- 根路径反代到 `http://127.0.0.1:8080`；`/api/` 反代到 `http://127.0.0.1:3000`。
- `/api/` 的 `proxy_pass` **末尾不能带 `/`**，否则 Nginx 会去掉 `/api` 前缀，导致主服务接口 404。
- 不要额外手写重复的 `location /`，宝塔已有根反代时会产生 `duplicate location "/"`。
- API 需要 `client_max_body_size 210m` 和 `proxy_read_timeout 600s`，以支持签名上传和分析回调。

完整初始配置及回滚说明见 [阿里云 ECS 发布部署操作手册](阿里云ECS发布部署操作手册.md)。

### 9.4 发布与回滚

发布前提：GitHub Actions 已将三个同名 Tag 镜像成功推送到 ACR。不要用 `latest`，三个业务镜像必须使用同一不可变 Tag。

```bash
# ECS 上执行；无数据库迁移的普通发布
cd /opt/home-rehab-motion
./deploy-production.sh v0.1.37 --yes

# 仅当本次有新的 Prisma migration：先完成 MySQL 备份，再加 --migrate
./deploy-production.sh v0.1.37 --migrate
```

脚本会备份 `.env.production` 中的镜像变量、拉取镜像、重建服务并轮询主服务就绪状态。拉取大分析镜像时 SSH 输出可能中断，但不代表部署完成；必须执行以下验证：

```bash
cd /opt/home-rehab-motion
docker compose --env-file .env.production -f infra/docker-compose.production.yml ps
curl -fsS https://admin.bjrpxx.cn/api/health/live
curl -fsS https://admin.bjrpxx.cn/api/health/ready
curl -I https://admin.bjrpxx.cn/rehab/
```

若新容器已启动但出现异常，先保留日志和现场，再按上一稳定 Tag 回滚三个镜像变量并重建。数据库迁移不是镜像回滚的一部分，未经备份不要尝试逆向迁移：

```bash
docker compose --env-file .env.production -f infra/docker-compose.production.yml \
  logs --tail=150 main-service analysis-service analysis-worker
```

### 9.5 分析配置、评分口径与姿态缓存

生产 `.env.production` 的已核验低资源参数为：

```env
SAMPLE_FPS=5
MODEL_COMPLEXITY=1
MAX_ANALYSIS_DURATION_SECONDS=300
MAX_ANALYSIS_FRAMES=600
MAX_POSE_FRAME_WIDTH=480
ABDOMINAL_SEGMENTATION_MODE=shadow
ABDOMINAL_VISUAL_SCORE_MODE=evidence
```

- 缩腹新上传视频使用视觉完整周期和 `evidence` 分数；这是当前患者端正式口径。改成 `legacy_peak` 或 `legacy` 会改变新结果的计次/评分口径，不能把它当作普通性能开关。
- 修改上述环境变量后，必须重建至少 `analysis-service` 和 `analysis-worker`；只执行 `docker restart` 不会加载新环境变量。
- 历史视频结果不会因配置变更自动重算；需要重算时必须单独设计任务和审计范围。
- `analysis-keypoints-data` 是 Docker 命名卷，当前约 35 MiB，挂载点为 `/var/lib/docker/volumes/home-rehab-motion_analysis-keypoints-data/_data`。Worker 保存同一视频的关键点 JSON，analysis-service 只读供管理端骨架预览。
- 该缓存不是业务事实数据：原视频在 OSS、正式分析报告在 MySQL。迁移服务器或清理该卷后不会丢失报告和原视频，只会让同视频下次访问/分析需要重新解码、重新生成骨架缓存。除非明确接受这项性能损失，**不要执行 `docker volume rm home-rehab-motion_analysis-keypoints-data`**。

### 9.6 资源监控与已知 CPU 事件

已安装并启用 `home-rehab-resource-snapshot.timer`，每分钟采集主机、进程、Docker CPU/内存、I/O、磁盘与压力指标。日志保留 30 天并压缩轮转：

```bash
systemctl status home-rehab-resource-snapshot.timer
tail -300 /var/log/home-rehab-monitor/resource-$(date +%F).log
```

2026-10-21 的 05:40–08:10 CPU 异常已完成归因：主因是阿里云 HBR 文件系统备份扫描根目录，尾段叠加 Ubuntu 自动更新与 PCP 日志归档；不是视频分析 Worker 持续执行。详情见 [CPU 事件记录](operations/2026-10-21-cpu-incident.md)。

建议保留采样器；如再次出现 CPU 峰值，优先保留对应时间窗的快照、`analysis-worker` 日志和 HBR/系统日志，再决定是否调整 HBR 备份时间、范围或自动更新维护窗口。不要在没有证据时直接提高容器 CPU/内存限制。

### 9.7 日常排查清单

| 现象 | 优先检查 |
| --- | --- |
| 管理端打不开 / 502 | `admin-web` 状态、`127.0.0.1:8080` 监听、宝塔根路径反代和证书 |
| API 404 | 宝塔 `/api/` 的 `proxy_pass` 是否错误带尾部 `/`；再查 `main-service` 日志 |
| 小程序上传失败 | 微信合法域名、OSS CORS/白名单、签名 URL、主服务日志；不要恢复旧域名 |
| 视频长期“分析中” | Worker 是否健康、Redis、队列、`analysis-worker` 日志和回调日志；单 Worker 排队时 `queued` 是正常现象 |
| 分析失败或服务器卡顿 | 检查资源快照、Worker 内存限制、视频时长/分辨率；不要同时运行多条 MediaPipe 任务 |
| 管理端无骨架或帧号不一致 | 确认姿态缓存卷仍挂载；页面的“分析采样帧”与“源视频帧”是不同概念，前者是采样序号、后者是原始视频帧号 |
| 磁盘空间增长 | `docker system df`、OSS 临时文件、缓存卷、宝塔日志与 HBR；先确认目标再清理 |

### 9.8 交接后的优先事项

1. 每次发布后按“发布与回滚”中的健康检查验收，并至少做一次小程序上传 → 分析 → 报告的真实链路验证。
2. 继续观察姿态缓存命中率、分析耗时与缓存卷大小；当前缓存很小，不是内存压力来源。
3. HBR 备份如继续保留，应避开业务与系统更新窗口，并考虑缩小根目录扫描范围；此变更影响灾备能力，需要运维负责人确认。
4. 若服务器规格不变，保持 `analysis-worker` 单并发。若业务量增加，优先将分析 Worker 拆到独立更高内存实例，而非在同一小主机堆叠并发。
