#!/usr/bin/env bash
# 在 ECS 的项目根目录执行：./deploy-production.sh <镜像标签> [--migrate] [--yes]
# 使用同一个标签发布 main-service、analysis-service 与 admin-web；数据库迁移仅在显式传入 --migrate 时执行。
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 生产环境的脚本位于项目根目录；同时兼容仓库中 scripts/ 下的开发位置。
if [ -f "$SCRIPT_DIR/infra/docker-compose.production.yml" ]; then
  ROOT_DIR="$SCRIPT_DIR"
else
  ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/infra/docker-compose.production.yml}"
READY_URL="${READY_URL:-http://127.0.0.1:3000/api/health/ready}"
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-90}"

COMPOSE=()
ENV_BACKUP=""
DEPLOYED=false

log() {
  printf '[deploy-production] %s\n' "$*"
}

fail() {
  printf '[deploy-production] 错误：%s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法：
  ./scripts/deploy-production.sh <镜像标签> [--migrate] [--yes]

参数：
  <镜像标签>   GitHub Actions 发布到 ACR 的同一镜像标签，例如 v0.1.21。
  --migrate    拉取新镜像后、重建业务服务前执行 Prisma migrate deploy。
               执行前请确认数据库已经完成备份。
  --yes        跳过发布前的交互确认，适用于自动化发布。

可选环境变量：
  ENV_FILE                    环境文件路径，默认 .env.production
  COMPOSE_FILE                Compose 文件路径，默认 infra/docker-compose.production.yml
  READY_URL                   主服务就绪检查地址，默认 http://127.0.0.1:3000/api/health/ready
  READY_TIMEOUT_SECONDS       就绪检查超时秒数，默认 90
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令：$1"
}

restore_env_on_failure() {
  local exit_code=$?

  if [ "$DEPLOYED" = false ] && [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
    cp -p "$ENV_BACKUP" "$ENV_FILE"
    log "发布未完成，已恢复镜像配置：$ENV_FILE"
  fi

  exit "$exit_code"
}

update_image_tag() {
  local source_file="$1"
  local target_file="$2"
  local image_tag="$3"

  awk -v image_tag="$image_tag" '
    BEGIN {
      required["MAIN_SERVICE_IMAGE"] = 1
      required["ANALYSIS_SERVICE_IMAGE"] = 1
      required["ADMIN_WEB_IMAGE"] = 1
    }
    /^MAIN_SERVICE_IMAGE=/ || /^ANALYSIS_SERVICE_IMAGE=/ || /^ADMIN_WEB_IMAGE=/ {
      split($0, pair, "=")
      key = pair[1]
      value = substr($0, length(key) + 2)
      if (value !~ /:[^:]+$/) {
        printf "镜像变量 %s 缺少标签：%s\n", key, value > "/dev/stderr"
        exit 2
      }
      sub(/:[^:]+$/, ":" image_tag, value)
      print key "=" value
      seen[key] = 1
      next
    }
    { print }
    END {
      for (key in required) {
        if (!seen[key]) {
          printf "环境文件缺少镜像变量：%s\n", key > "/dev/stderr"
          exit 2
        }
      }
    }
  ' "$source_file" > "$target_file"
}

wait_for_ready() {
  local started_at=$SECONDS

  while true; do
    if curl --fail --silent --show-error --max-time 5 "$READY_URL" >/dev/null; then
      log "主服务已就绪：$READY_URL"
      return 0
    fi

    if (( SECONDS - started_at >= READY_TIMEOUT_SECONDS )); then
      return 1
    fi

    sleep 3
  done
}

main() {
  local image_tag=""
  local run_migration=false
  local assume_yes=false
  local env_tmp
  local current_main_image
  local current_analysis_image
  local current_admin_image

  while (( $# > 0 )); do
    case "$1" in
      --migrate)
        run_migration=true
        ;;
      --yes)
        assume_yes=true
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --*)
        fail "不支持的参数：$1"
        ;;
      *)
        if [ -n "$image_tag" ]; then
          fail "只允许指定一个镜像标签"
        fi
        image_tag="$1"
        ;;
    esac
    shift
  done

  [ -n "$image_tag" ] || { usage >&2; exit 1; }
  [[ "$image_tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "镜像标签包含不允许的字符：$image_tag"
  [[ "$READY_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "READY_TIMEOUT_SECONDS 必须是正整数"

  require_command docker
  require_command awk
  require_command curl
  [ -f "$ENV_FILE" ] || fail "环境文件不存在：$ENV_FILE"
  [ -f "$COMPOSE_FILE" ] || fail "Compose 文件不存在：$COMPOSE_FILE"

  COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
  "${COMPOSE[@]}" config --quiet

  current_main_image="$(grep -E '^MAIN_SERVICE_IMAGE=' "$ENV_FILE" | cut -d= -f2-)"
  current_analysis_image="$(grep -E '^ANALYSIS_SERVICE_IMAGE=' "$ENV_FILE" | cut -d= -f2-)"
  current_admin_image="$(grep -E '^ADMIN_WEB_IMAGE=' "$ENV_FILE" | cut -d= -f2-)"
  [ -n "$current_main_image" ] || fail "环境文件缺少 MAIN_SERVICE_IMAGE"
  [ -n "$current_analysis_image" ] || fail "环境文件缺少 ANALYSIS_SERVICE_IMAGE"
  [ -n "$current_admin_image" ] || fail "环境文件缺少 ADMIN_WEB_IMAGE"

  printf '%s\n' \
    "即将发布镜像标签：$image_tag" \
    "  main-service:     $current_main_image" \
    "  analysis-service: $current_analysis_image" \
    "  admin-web:        $current_admin_image"
  if [ "$run_migration" = true ]; then
    printf '%s\n' '  数据库迁移：执行（请确认已完成数据库备份）'
  else
    printf '%s\n' '  数据库迁移：跳过（需要时请传入 --migrate）'
  fi

  if [ "$assume_yes" = false ]; then
    read -r -p '确认继续发布？[y/N] ' answer
    [[ "$answer" =~ ^[Yy]$ ]] || { log '已取消发布。'; exit 0; }
  fi

  ENV_BACKUP="$ENV_FILE.before-release.$(date +%Y%m%d%H%M%S)"
  cp -p "$ENV_FILE" "$ENV_BACKUP"
  trap restore_env_on_failure ERR

  env_tmp="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  update_image_tag "$ENV_FILE" "$env_tmp" "$image_tag"
  mv "$env_tmp" "$ENV_FILE"
  log "已更新镜像配置；原配置备份为：$ENV_BACKUP"

  COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
  "${COMPOSE[@]}" config --quiet

  log '拉取镜像…'
  "${COMPOSE[@]}" pull

  if [ "$run_migration" = true ]; then
    log '执行 Prisma migrate deploy…'
    "${COMPOSE[@]}" run --rm main-service \
      node node_modules/prisma/build/index.js migrate deploy \
      --schema services/main-service/prisma/schema.prisma
  fi

  log '重建并启动服务…'
  "${COMPOSE[@]}" up -d --remove-orphans
  DEPLOYED=true
  trap - ERR

  "${COMPOSE[@]}" ps

  if ! wait_for_ready; then
    "${COMPOSE[@]}" ps
    "${COMPOSE[@]}" logs --tail=100 main-service analysis-service analysis-worker
    fail "主服务未在 ${READY_TIMEOUT_SECONDS}s 内就绪：$READY_URL；镜像配置未自动回滚，请根据日志决定是否回滚"
  fi

  log "发布完成。若需回滚，可恢复 $ENV_BACKUP 后重新执行 docker compose up -d。"
}

main "$@"
