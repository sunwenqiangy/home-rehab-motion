#!/usr/bin/env bash
# ─── Home Rehab Motion 本地全栈启动脚本 ─────────────────────────────────
# 用法:
#   ./start-local.sh          # 启动全部服务（含分析回调重试调度器）
#   ./start-local.sh main     # 只启动主服务
#   ./start-local.sh analysis # 只启动分析服务 API + Worker
#   ./start-local.sh admin    # 只启动管理端
#   ./start-local.sh stop     # 停止全部后台服务
# ────────────────────────────────────────────────────────────────
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/.local-logs"
PID_DIR="$ROOT_DIR/.local-pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# ─── 优先加载项目根目录 .env，便于和小程序/服务端配置保持一致 ─────
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

# ─── 环境变量 (按你本地实际情况修改) ──────────────────────────
export PORT="${PORT:-3000}"
export DATABASE_URL="${DATABASE_URL:-mysql://root@127.0.0.1:3306/home_rehab_motion}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}"
export ANALYSIS_SERVICE_URL="${ANALYSIS_SERVICE_URL:-http://127.0.0.1:8000}"
export ANALYSIS_CALLBACK_URL="${ANALYSIS_CALLBACK_URL:-http://127.0.0.1:3000/api/videos/internal/analysis-callback}"
export ANALYSIS_INTERNAL_TOKEN="${ANALYSIS_INTERNAL_TOKEN:-home-rehab-motion-internal-token}"

export ANALYSIS_PORT="${ANALYSIS_PORT:-8000}"
export CELERY_BROKER_URL="${CELERY_BROKER_URL:-redis://127.0.0.1:6379/1}"
export CELERY_RESULT_BACKEND="${CELERY_RESULT_BACKEND:-redis://127.0.0.1:6379/2}"
export ANALYSIS_DATABASE_URL="${ANALYSIS_DATABASE_URL:-mysql+pymysql://root@127.0.0.1:3306/home_rehab_motion}"

# ─── 颜色 ─────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[home-rehab-motion]${NC} $*"; }
warn() { echo -e "${YELLOW}[home-rehab-motion]${NC} $*"; }
err()  { echo -e "${RED}[home-rehab-motion]${NC} $*" >&2; }

# ─── 前置检查 ─────────────────────────────────────────────────
check_deps() {
  local missing=0
  for cmd in node npm python3 mysql redis-cli; do
    if ! command -v "$cmd" &>/dev/null; then
      err "缺少依赖: $cmd"
      missing=1
    fi
  done
  if [ "$missing" -eq 1 ]; then
    err "请先安装上述依赖后再运行"
    exit 1
  fi

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$node_major" -lt 20 ]; then
    err "当前 Node.js 为 $(node --version)，项目要求 Node.js 20 LTS。请执行：nvm use"
    exit 1
  fi
}

check_mysql() {
  if mysql -h 127.0.0.1 -uroot -e "USE home_rehab_motion" &>/dev/null; then
    log "MySQL ✓  home-rehab-motion 数据库已就绪"
  else
    warn "home-rehab-motion 数据库不存在，尝试创建..."
    mysql -h 127.0.0.1 -uroot -e "CREATE DATABASE IF NOT EXISTS home_rehab_motion DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null \
      && log "MySQL ✓  home-rehab-motion 数据库已创建" \
      || err "MySQL ✗  无法创建数据库，请手动执行: mysql -h 127.0.0.1 -uroot -e \"CREATE DATABASE IF NOT EXISTS home_rehab_motion ...\""
  fi
}

check_redis() {
  if redis-cli ping &>/dev/null; then
    log "Redis ✓  $(redis-cli ping)"
  else
    err "Redis ✗  无法连接，请先启动: brew services start redis"
    exit 1
  fi
}

apply_migrations() {
  log "检查数据库迁移..."
  if ! (cd "$ROOT_DIR" && npx prisma migrate deploy --schema services/main-service/prisma/schema.prisma); then
    err "数据库迁移失败，已停止启动；请检查 DATABASE_URL 与迁移日志"
    exit 1
  fi

  if ! (cd "$ROOT_DIR" && npx prisma generate --schema services/main-service/prisma/schema.prisma); then
    err "Prisma Client 生成失败，已停止启动；请检查 Node 依赖与 Prisma 配置"
    exit 1
  fi
}

check_venv() {
  local analysis_dir="$ROOT_DIR/services/analysis-service"
  local venv_bin="$analysis_dir/.venv/bin"

  if [ ! -x "$venv_bin/python" ]; then
    warn "分析服务虚拟环境不存在，正在创建..."
    python3 -m venv "$analysis_dir/.venv"
  fi

  if ! "$venv_bin/python" -c 'import uvicorn, celery' &>/dev/null; then
    warn "分析服务依赖不完整，正在安装..."
    "$venv_bin/python" -m pip install -r "$analysis_dir/requirements.txt"
  fi

  if ! "$venv_bin/python" -c 'import uvicorn, celery' &>/dev/null; then
    err "分析服务依赖安装失败，请检查 $analysis_dir/.venv"
    exit 1
  fi

  log "Python 虚拟环境 & 依赖 ✓"
}

# ─── 停止后台服务 ─────────────────────────────────────────────
stop_all() {
  log "停止所有后台服务..."
  for pid_file in "$PID_DIR"/*.pid; do
    [ -f "$pid_file" ] || continue
    local name="$(basename "$pid_file" .pid)"
    local pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null && log "已停止 $name (PID: $pid)" || warn "无法停止 $name"
    else
      log "$name 已停止"
    fi
    rm -f "$pid_file"
  done

  # 兜底清理 uvicorn --reload / celery worker 残留子进程，避免端口与队列被旧进程占用
  pkill -f "uvicorn app.main:app --app-dir $ROOT_DIR/services/analysis-service" 2>/dev/null || true
  pkill -f "celery -A app.tasks.celery_app:celery_app worker" 2>/dev/null || true
  pkill -f "celery -A app.tasks.celery_app:celery_app beat" 2>/dev/null || true
  pkill -f "ts-node-dev --respawn --transpile-only src/main.ts" 2>/dev/null || true
}

# ─── 清理失活 PID ────────────────────────────────────────────
prepare_service() {
  local name="$1"
  local port="${2:-}"
  local pid_file="$PID_DIR/$name.pid"

  if [ ! -f "$pid_file" ]; then
    return 0
  fi

  local pid="$(cat "$pid_file")"
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    return 0
  fi

  if [ -n "$port" ] && lsof -ti :"$port" &>/dev/null; then
    local port_pids="$(lsof -ti :"$port" | tr '\n' ' ')"
    if echo " $port_pids " | grep -q " $pid "; then
      log "$name 已在运行 (PID: $pid)"
      return 1
    fi

    warn "$name 对应端口 $port 已被其他旧进程占用，尝试清理端口监听进程: $port_pids"
    lsof -ti :"$port" | xargs kill -TERM 2>/dev/null || true
    sleep 1
  fi

  warn "$name 检测到旧进程 (PID: $pid) 但端口未监听，尝试清理后重启..."
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
  sleep 1
  rm -f "$pid_file"
}

# ─── 启动单个后台服务 ─────────────────────────────────────────
start_bg() {
  local name="$1"
  shift
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  # 如果已经在跑就跳过
  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    log "$name 已在运行 (PID: $(cat "$pid_file"))"
    return
  fi

  log "启动 $name ..."
  "$@" > "$log_file" 2>&1 &
  echo $! > "$pid_file"
  log "$name 已启动 (PID: $(cat "$pid_file"), 日志: $log_file)"
}

# ─── 等待端口就绪 ─────────────────────────────────────────────
wait_port() {
  local port="$1"
  local name="$2"
  local max_wait="${3:-30}"
  local waited=0
  while ! lsof -ti :"$port" &>/dev/null; do
    if [ "$waited" -ge "$max_wait" ]; then
      err "$name 在 ${max_wait}s 内未就绪 (端口 $port)，请查看日志: $LOG_DIR/$name.log"
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  log "$name ✓  端口 $port 已就绪 (${waited}s)"
}

# ─── 启动主服务 ───────────────────────────────────────────────
start_main() {
  log "── 主服务 (NestJS, 端口 $PORT) ──"
  prepare_service main "$PORT" || return 0
  start_bg main npx npm run start:dev -w @home-rehab-motion/main-service
  wait_port "$PORT" main 30
}

# ─── 启动分析服务 ─────────────────────────────────────────────
start_analysis() {
  log "── 分析服务 API (FastAPI, 端口 $ANALYSIS_PORT) ──"
  local venv_bin="$ROOT_DIR/services/analysis-service/.venv/bin"
  prepare_service analysis-api "$ANALYSIS_PORT" || true
  start_bg analysis-api env DATABASE_URL="$ANALYSIS_DATABASE_URL" CELERY_BROKER_URL="$CELERY_BROKER_URL" CELERY_RESULT_BACKEND="$CELERY_RESULT_BACKEND" ANALYSIS_CALLBACK_URL="$ANALYSIS_CALLBACK_URL" ANALYSIS_INTERNAL_TOKEN="$ANALYSIS_INTERNAL_TOKEN" "$venv_bin/uvicorn" app.main:app --app-dir "$ROOT_DIR/services/analysis-service" --host 0.0.0.0 --port "$ANALYSIS_PORT" --reload
  wait_port "$ANALYSIS_PORT" analysis-api 30

  log "── Celery Worker ──"
  prepare_service analysis-worker || true
  start_bg analysis-worker bash -c "cd \"$ROOT_DIR/services/analysis-service\" && DATABASE_URL=\"$ANALYSIS_DATABASE_URL\" CELERY_BROKER_URL=\"$CELERY_BROKER_URL\" CELERY_RESULT_BACKEND=\"$CELERY_RESULT_BACKEND\" ANALYSIS_CALLBACK_URL=\"$ANALYSIS_CALLBACK_URL\" ANALYSIS_INTERNAL_TOKEN=\"$ANALYSIS_INTERNAL_TOKEN\" \"$venv_bin/celery\" -A app.tasks.celery_app:celery_app worker --loglevel=info --concurrency=2 --queues=analysis --hostname=analysis-worker@%h"
  sleep 2
  log "Celery Worker 已启动"

  log "── Celery Beat（回调重试调度）──"
  prepare_service analysis-beat || true
  start_bg analysis-beat bash -c "cd \"$ROOT_DIR/services/analysis-service\" && DATABASE_URL=\"$ANALYSIS_DATABASE_URL\" CELERY_BROKER_URL=\"$CELERY_BROKER_URL\" CELERY_RESULT_BACKEND=\"$CELERY_RESULT_BACKEND\" ANALYSIS_CALLBACK_URL=\"$ANALYSIS_CALLBACK_URL\" ANALYSIS_INTERNAL_TOKEN=\"$ANALYSIS_INTERNAL_TOKEN\" \"$venv_bin/celery\" -A app.tasks.celery_app:celery_app beat --loglevel=info"
}

# ─── 启动管理端 ───────────────────────────────────────────────
start_admin() {
  log "── 管理端 (Vite, 端口 5173) ──"
  prepare_service admin-web 5173 || return 0
  start_bg admin-web npx npm run dev -w @home-rehab-motion/admin-web
  wait_port 5173 admin-web 30
}

# ─── 入口 ─────────────────────────────────────────────────────
main() {
  local target="${1:-all}"

  case "$target" in
    stop)
      stop_all
      exit 0
      ;;
    main)
      check_deps && check_mysql && check_redis && apply_migrations
      start_main
      ;;
    analysis)
      check_deps && check_redis && check_venv
      start_analysis
      ;;
    admin)
      check_deps
      start_admin
      ;;
    all)
      check_deps && check_mysql && check_redis && apply_migrations && check_venv
      start_main
      start_analysis
      start_admin
      echo ""
      log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      log "全部服务已启动！"
      log ""
      log "  管理端:       http://127.0.0.1:5173"
      log "  主服务 API:   http://127.0.0.1:$PORT/api"
      log "  分析服务 API: http://127.0.0.1:$ANALYSIS_PORT"
      log ""
      log "  停止全部:     ./start-local.sh stop"
      log "  查看日志:     tail -f $LOG_DIR/<name>.log"
      log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      ;;
    *)
      echo "用法: $0 {all|main|analysis|admin|stop}"
      echo ""
      echo "  all      启动全部 4 个服务 (默认)"
      echo "  main     只启动主服务 (NestJS, 端口 $PORT)"
      echo "  analysis 只启动分析服务 API + Celery Worker"
      echo "  admin    只启动管理端 (Vite, 端口 5173)"
      echo "  stop     停止全部后台服务"
      exit 1
      ;;
  esac
}

main "$@"
