<template>
  <div class="login-page">
    <div class="login-page__mesh"></div>
    <div class="login-shell">
      <section class="login-brand-panel">
        <div class="login-brand-panel__eyebrow">Home Rehab Motion Control Center</div>
        <h1 class="login-brand-panel__title">腹部肌肉训练分析后台</h1>
        <p class="login-brand-panel__subtitle">
          面向医护与运营团队的训练数据中枢，统一管理患者视频、动作指导、阈值配置与反馈处置。
        </p>

        <div class="login-highlights">
          <div class="login-highlight-card">
            <div class="login-highlight-card__label">数据视野</div>
            <div class="login-highlight-card__value">训练进度 · 报告质量 · 异常反馈</div>
          </div>
          <div class="login-highlight-card">
            <div class="login-highlight-card__label">团队协作</div>
            <div class="login-highlight-card__value">管理员 + 医护双角色工作流</div>
          </div>
        </div>

        <div class="login-account-hints">
          <div class="login-account-hints__title">后台账号登录</div>
          <p class="login-account-hints__content">请使用已初始化的后台账户和密码登录。</p>
          <p class="login-account-hints__content">如尚未创建账户，请联系系统管理员完成初始化。</p>
        </div>
      </section>

      <section class="login-form-panel">
        <div class="login-form-panel__header">
          <div class="login-form-panel__badge">Secure Access</div>
          <h2>进入管理端工作台</h2>
          <p>使用后台账号登录，查看训练分析、内容配置和运营反馈。</p>
        </div>

        <el-form :model="form" :rules="rules" ref="formRef" label-width="0" @submit.prevent="handleLogin">
          <el-form-item prop="username">
            <el-input v-model="form.username" placeholder="请输入用户名" :prefix-icon="User" size="large" />
          </el-form-item>
          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" placeholder="请输入密码" :prefix-icon="Lock" size="large" show-password />
          </el-form-item>
          <el-form-item>
            <el-button class="login-submit" type="primary" size="large" :loading="loading" native-type="submit">
              登录并进入控制台
            </el-button>
          </el-form-item>
        </el-form>

        <div class="login-form-panel__foot">
          <span class="page-pill page-pill--light">受控访问</span>
          <span class="login-form-panel__foot-text">所有后台操作均在本地测试环境内完成。</span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { FormInstance, FormRules } from 'element-plus';
import { Lock, User } from '@element-plus/icons-vue';
import { adminLogin } from '@/services/auth';

const router = useRouter();
const route = useRoute();
const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({
  username: '',
  password: '',
});

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    const res = await adminLogin({ username: form.username, password: form.password });
    localStorage.setItem('admin_token', res.token);
    localStorage.setItem('admin_role', res.role);
    ElMessage.success('登录成功');

    const redirect = (route.query.redirect as string) || '/';
    router.push(redirect);
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '登录失败，请检查用户名和密码');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  overflow: hidden;
  background:
    radial-gradient(circle at 15% 16%, rgba(79, 195, 247, 0.18), transparent 22%),
    radial-gradient(circle at 84% 18%, rgba(79, 195, 247, 0.14), transparent 20%),
    linear-gradient(145deg, #081525 0%, #10213a 56%, #133456 100%);
}

.login-page__mesh {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(177, 232, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(177, 232, 255, 0.05) 1px, transparent 1px);
  background-size: 34px 34px;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.7), transparent 92%);
}

.login-shell {
  position: relative;
  z-index: 1;
  width: min(1180px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(380px, 420px);
  gap: 28px;
  align-items: stretch;
}

.login-brand-panel,
.login-form-panel {
  border-radius: 32px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(22px);
}

.login-brand-panel {
  position: relative;
  overflow: hidden;
  padding: 38px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 640px;
  background:
    radial-gradient(circle at top right, rgba(121, 215, 255, 0.22), transparent 28%),
    linear-gradient(145deg, rgba(10, 28, 48, 0.92), rgba(14, 41, 70, 0.78));
  box-shadow: 0 30px 90px rgba(4, 11, 21, 0.36);
}

.login-brand-panel__eyebrow {
  display: inline-flex;
  align-self: flex-start;
  padding: 8px 14px;
  border-radius: 999px;
  color: rgba(246, 251, 255, 0.88);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.login-brand-panel__title {
  margin: 24px 0 12px;
  color: #f6fbff;
  font-size: 42px;
  font-weight: 800;
  line-height: 1.1;
}

.login-brand-panel__subtitle {
  max-width: 580px;
  margin: 0;
  color: rgba(240, 248, 255, 0.72);
  font-size: 15px;
  line-height: 1.9;
}

.login-highlights {
  display: grid;
  gap: 14px;
  margin-top: 34px;
}

.login-highlight-card {
  padding: 18px 20px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.login-highlight-card__label {
  color: rgba(121, 215, 255, 0.82);
  font-size: 12px;
  font-weight: 700;
}

.login-highlight-card__value {
  margin-top: 10px;
  color: #f6fbff;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.5;
}

.login-account-hints {
  margin-top: 28px;
  padding: 22px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.login-account-hints__title {
  color: rgba(246, 251, 255, 0.88);
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
}

.login-account-hints__content {
  margin: 0;
  color: rgba(240, 248, 255, 0.72);
  font-size: 13px;
  line-height: 1.75;
}

.login-account-hints__content + .login-account-hints__content {
  margin-top: 4px;
  color: rgba(240, 248, 255, 0.56);
}

.login-form-panel {
  padding: 34px 30px;
  background: rgba(249, 252, 255, 0.94);
  box-shadow: 0 24px 80px rgba(4, 11, 21, 0.2);
}

.login-form-panel__header {
  margin-bottom: 26px;
}

.login-form-panel__badge {
  display: inline-flex;
  padding: 8px 14px;
  border-radius: 999px;
  color: var(--brand-700);
  background: rgba(79, 195, 247, 0.12);
  font-size: 12px;
  font-weight: 700;
}

.login-form-panel__header h2 {
  margin: 18px 0 8px;
  color: var(--ink-950);
  font-size: 28px;
  font-weight: 800;
}

.login-form-panel__header p {
  margin: 0;
  color: var(--ink-500);
  font-size: 14px;
  line-height: 1.8;
}

.login-submit {
  width: 100%;
  min-height: 48px;
  margin-top: 8px;
}

.login-form-panel__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.login-form-panel__foot-text {
  color: var(--ink-500);
  font-size: 12px;
}

@media (max-width: 980px) {
  .login-shell {
    grid-template-columns: 1fr;
  }

  .login-brand-panel {
    min-height: auto;
  }
}

@media (max-width: 640px) {
  .login-page {
    padding: 18px;
  }

  .login-brand-panel,
  .login-form-panel {
    padding: 24px 20px;
    border-radius: 24px;
  }

  .login-brand-panel__title {
    font-size: 32px;
  }
}
</style>
