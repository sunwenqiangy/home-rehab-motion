<template>
  <el-container class="layout-shell">
    <el-aside :width="isCollapse ? '88px' : '272px'" :class="{ 'layout-aside--collapsed': isCollapse }" class="layout-aside">
      <div class="aside-backdrop"></div>
      <div class="aside-brand">
        <div class="brand-mark" aria-hidden="true">
          <span class="brand-mark__ring"></span>
        </div>
        <div v-if="!isCollapse" class="brand-copy">
          <div class="brand-wordmark">Health</div>
          <div class="brand-subtitle">腹肌康复管理系统</div>
        </div>
      </div>
      <div v-if="!isCollapse" class="aside-brand-divider"></div>

      <el-scrollbar class="aside-scroll">
        <el-menu :default-active="activeMenu" :collapse="isCollapse" :collapse-transition="false" router class="aside-menu">
          <div class="menu-group" v-if="!isCollapse">总览视图</div>
          <el-menu-item v-if="hasPermission('dashboard')" index="/dashboard">
            <el-icon><Monitor /></el-icon>
            <template #title>工作台</template>
          </el-menu-item>

          <div class="menu-group" v-if="!isCollapse">业务运营</div>
          <el-menu-item v-if="hasPermission('patients')" index="/users">
            <el-icon><UserFilled /></el-icon>
            <template #title>患者管理</template>
          </el-menu-item>
          <el-menu-item v-if="hasPermission('videos')" index="/videos">
            <el-icon><VideoCamera /></el-icon>
            <template #title>视频记录</template>
          </el-menu-item>
          <el-menu-item v-if="hasPermission('guidance')" index="/guidance">
            <el-icon><Reading /></el-icon>
            <template #title>指导内容</template>
          </el-menu-item>
          <el-menu-item v-if="hasPermission('feedback')" index="/feedback">
            <el-icon><ChatDotRound /></el-icon>
            <template #title>反馈管理</template>
          </el-menu-item>

          <div class="menu-group" v-if="!isCollapse">系统配置</div>
          <el-menu-item v-if="hasPermission('thresholds')" index="/thresholds">
            <el-icon><Setting /></el-icon>
            <template #title>阈值参数</template>
          </el-menu-item>
          <el-menu-item v-if="hasPermission('motivation-rules')" index="/motivation-rules">
            <el-icon><Setting /></el-icon>
            <template #title>激励规则配置</template>
          </el-menu-item>
          <el-menu-item v-if="hasPermission('patient-config')" index="/patient-config">
            <el-icon><Setting /></el-icon>
            <template #title>患者应用配置</template>
          </el-menu-item>
          <el-menu-item v-if="hasPermission('accounts')" index="/accounts">
            <el-icon><User /></el-icon>
            <template #title>账号管理</template>
          </el-menu-item>

          <div class="menu-group" v-if="!isCollapse">开发工具</div>
          <el-menu-item v-if="hasPermission('flow-verify')" index="/flow-verify">
            <el-icon><Promotion /></el-icon>
            <template #title>流程验证</template>
          </el-menu-item>
          <el-menu-item v-if="hasPermission('gold-templates')" index="/gold-templates">
            <el-icon><Collection /></el-icon>
            <template #title>金标准管理</template>
          </el-menu-item>
        </el-menu>
      </el-scrollbar>

      <div class="aside-footer" v-if="!isCollapse">
        <div class="aside-footer__card">
          <div>
            <div class="aside-footer__label">系统状态</div>
            <div class="aside-footer__value">在线 · 数据同步正常</div>
          </div>
          <span class="aside-footer__dot"></span>
        </div>
      </div>
    </el-aside>

    <el-container class="layout-main-shell">
      <el-header class="layout-header">
        <div class="layout-header__left">
          <button class="collapse-btn" @click="isCollapse = !isCollapse" type="button" aria-label="切换侧栏">
            <el-icon>
              <Fold v-if="!isCollapse" />
              <Expand v-else />
            </el-icon>
          </button>
          <div>
            <div class="layout-page-title">{{ currentTitle }}</div>
            <div class="layout-page-subtitle">{{ currentDescription }}</div>
          </div>
        </div>

        <div class="layout-header__right">
          <div class="layout-pill">
            <span class="layout-pill__dot"></span>
            {{ nowLabel }}
          </div>
          <div class="layout-pill layout-pill--strong">{{ roleLabel }}</div>
          <el-dropdown @command="handleCommand">
            <button class="profile-chip" type="button">
              <span class="profile-chip__avatar">{{ roleInitial }}</span>
              <span class="profile-chip__text">
                <strong>{{ roleLabel }}</strong>
                <small>已登录</small>
              </span>
              <el-icon><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="layout-main">
        <div class="layout-main__glow"></div>
        <div class="layout-main__content">
          <RouterView />
        </div>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Monitor,
  VideoCamera,
  Promotion,
  Reading,
  ChatDotRound,
  Setting,
  User,
  UserFilled,
  Fold,
  Expand,
  ArrowDown,
  Collection,
} from '@element-plus/icons-vue';
import { hasPermission, getCurrentRole } from '@/utils/permission';

const route = useRoute();
const router = useRouter();
const isCollapse = ref(false);

const activeMenu = computed(() => {
  const path = route.path;
  if (path.startsWith('/users')) return '/users';
  if (path.startsWith('/videos')) return '/videos';
  if (path.startsWith('/flow-verify')) return '/flow-verify';
  if (path.startsWith('/guidance')) return '/guidance';
  if (path.startsWith('/gold-templates')) return '/gold-templates';
  return path;
});

const currentTitle = computed(() => {
  return (route.meta?.title as string) || '工作台';
});

const currentDescription = computed(() => {
  const descriptions: Record<string, string> = {
    '/dashboard': '查看训练完成率、业务节奏与异常入口。',
    '/users': '汇总患者训练档案、训练记录与评分变化。',
    '/videos': '聚合患者视频状态、分析结果与质量风险。',
    '/flow-verify': '一键验证上传、分析与结果展示主链路。',
    '/guidance': '管理训练动作说明、多媒体素材与版本变化。',
    '/feedback': '跟进患者问题，快速处理上传与报告反馈。',
    '/thresholds': '统一维护算法模板、阈值版本和参考配置。',
    '/gold-templates': '上传分析视频生成金标准，完成版本保存、启停与对比。',
    '/motivation-rules': '维护进步提示阈值和温和提醒频率，不影响既有训练快照。',
    '/patient-config': '管理患者端视频限制、周目标、分析等待时长等全局参数。',
    '/accounts': '查看当前后台账号与角色信息。',
  };

  const path = route.path;
  const hit = Object.keys(descriptions).find((item) => path.startsWith(item));
  return hit ? descriptions[hit] : '统一管理训练业务、算法配置和数据反馈。';
});

const roleLabel = computed(() => {
  const role = getCurrentRole();
  return role === 'admin' ? '管理员' : role === 'nurse' ? '医护角色' : '后台用户';
});

const roleInitial = computed(() => {
  const role = getCurrentRole();
  return role === 'admin' ? 'A' : role === 'nurse' ? 'N' : 'U';
});

const nowLabel = computed(() => {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date());
});

function handleCommand(cmd: string) {
  if (cmd === 'logout') {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_role');
    router.push('/login');
  }
}
</script>

<style scoped>
.layout-shell {
  height: 100vh;
  overflow: hidden;
  background: transparent;
}

.layout-aside {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  border-right: 1px solid rgba(148, 180, 214, 0.12);
  background: linear-gradient(180deg, #0b1729 0%, #10213a 50%, #112844 100%);
  box-shadow: 24px 0 60px rgba(8, 21, 37, 0.18);
}

.aside-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at top left, rgba(79, 195, 247, 0.18), transparent 32%),
    radial-gradient(circle at bottom right, rgba(79, 195, 247, 0.14), transparent 22%);
  pointer-events: none;
}

.aside-brand,
.aside-brand-divider,
.aside-footer {
  position: relative;
  z-index: 1;
}

.aside-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 20px 20px 17px;
}

.brand-mark {
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #2b6c9b 0%, #17456e 100%);
  border: 1px solid rgba(159, 224, 255, 0.42);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.18), 0 8px 18px rgba(5, 23, 43, 0.22);
}

.brand-mark__ring {
  width: 19px;
  height: 19px;
  border: 3px solid #d9f3ff;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(77, 192, 245, 0.18);
}

.brand-copy {
  min-width: 0;
}

.brand-wordmark {
  overflow: hidden;
  color: #f6fbff;
  font-size: 18px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-subtitle {
  overflow: hidden;
  margin-top: 4px;
  color: rgba(190, 220, 239, 0.72);
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aside-brand-divider {
  height: 1px;
  margin: 0 20px 14px;
  background: linear-gradient(90deg, rgba(151, 202, 232, 0.26), rgba(151, 202, 232, 0.1));
}

.aside-scroll {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  padding-bottom: 8px;
}

.menu-group {
  padding: 12px 20px 7px;
  color: rgba(177, 213, 236, 0.54);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.aside-menu {
  border-right: none;
  background: transparent;
}

.aside-menu :deep(.el-menu-item) {
  height: 44px;
  margin: 3px 12px;
  border-radius: 12px;
  color: rgba(228, 241, 250, 0.58);
  background: transparent;
  transition: color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
}

.aside-menu :deep(.el-menu-item:hover) {
  color: #f6fbff;
  background: rgba(255, 255, 255, 0.06);
}

.aside-menu :deep(.el-menu-item.is-active) {
  color: #f6fbff;
  background: linear-gradient(135deg, rgba(79, 195, 247, 0.2), rgba(79, 195, 247, 0.06));
  box-shadow: inset 0 0 0 1px rgba(121, 215, 255, 0.18);
}

.layout-aside--collapsed .aside-brand {
  justify-content: center;
  padding: 20px;
}

.layout-aside--collapsed .brand-mark {
  width: 48px;
  height: 48px;
}

.layout-aside--collapsed .aside-scroll {
  padding-top: 4px;
}

.layout-aside--collapsed .aside-menu :deep(.el-menu-item) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 48px;
  min-width: 0;
  margin: 5px auto;
  padding: 0 !important;
  border-radius: 14px;
}

.layout-aside--collapsed .aside-menu :deep(.el-menu-item .el-icon) {
  width: 20px;
  height: 20px;
  margin: 0;
  font-size: 18px;
}

.layout-aside--collapsed .aside-menu :deep(.el-menu-item.is-active) {
  background: linear-gradient(135deg, rgba(79, 195, 247, 0.28), rgba(79, 195, 247, 0.1));
  box-shadow: inset 0 0 0 1px rgba(121, 215, 255, 0.28), 0 8px 18px rgba(6, 30, 53, 0.18);
}

.aside-footer {
  margin: 10px 18px 18px;
  flex: none;
}

.aside-footer__card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.aside-footer__label {
  color: rgba(214, 234, 249, 0.48);
  font-size: 11px;
}

.aside-footer__value {
  margin-top: 4px;
  color: #f6fbff;
  font-size: 13px;
  font-weight: 700;
}

.aside-footer__dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #33b27b;
  box-shadow: 0 0 0 8px rgba(51, 178, 123, 0.12);
}

.layout-main-shell {
  position: relative;
  min-width: 0;
  height: 100vh;
  overflow: hidden;
}

.layout-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 26px;
  height: auto;
  background: rgba(237, 244, 251, 0.74);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(148, 180, 214, 0.18);
}

.layout-header__left,
.layout-header__right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.layout-page-title {
  font-size: 22px;
  font-weight: 800;
  color: var(--ink-950);
}

.layout-page-subtitle {
  margin-top: 4px;
  color: var(--ink-500);
  font-size: 13px;
}

.collapse-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: var(--ink-900);
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(148, 180, 214, 0.24);
  box-shadow: 0 10px 25px rgba(15, 40, 79, 0.08);
  cursor: pointer;
}

.layout-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(148, 180, 214, 0.22);
  color: var(--ink-700);
  font-size: 12px;
  font-weight: 700;
}

.layout-pill--strong {
  color: var(--brand-700);
  background: rgba(79, 195, 247, 0.12);
}

.layout-pill__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #33b27b;
}

.profile-chip {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px 6px 6px;
  border-radius: 999px;
  border: 1px solid rgba(148, 180, 214, 0.24);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 10px 25px rgba(15, 40, 79, 0.08);
  color: var(--ink-900);
  cursor: pointer;
}

.profile-chip__avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #f6fbff;
  font-weight: 800;
  background: linear-gradient(135deg, #12304e, #1f5878);
}

.profile-chip__text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.profile-chip__text strong {
  font-size: 13px;
  line-height: 1;
}

.profile-chip__text small {
  color: var(--ink-500);
  font-size: 11px;
}

.layout-main {
  position: relative;
  min-height: 0;
  padding: 22px 26px 28px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: transparent;
}

.layout-main__glow {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at top right, rgba(79, 195, 247, 0.12), transparent 24%),
    radial-gradient(circle at bottom left, rgba(35, 81, 125, 0.12), transparent 22%);
  pointer-events: none;
}

.layout-main__content {
  position: relative;
  z-index: 1;
}

@media (max-width: 1200px) {
  .layout-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .layout-header__right {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}

@media (max-width: 768px) {
  .layout-main,
  .layout-header {
    padding-left: 16px;
    padding-right: 16px;
  }

  .layout-page-title {
    font-size: 18px;
  }
}
</style>
