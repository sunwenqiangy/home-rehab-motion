<template>
  <div class="admin-page patient-config-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Patient App Config</div>
          <h1 class="page-hero__title">患者端应用配置</h1>
          <p class="page-hero__subtitle">
            短片段上传：缩腹、骨盆最多 30 秒，膝旋转最多 60 秒；管理训练目标与动作类型。
          </p>
        </div>
      </div>
    </section>

    <el-card class="surface-card" shadow="never" v-loading="loading">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">配置项</div>
            <div class="section-header__subtitle">修改后立即下发到患者端，无需发版。</div>
          </div>
          <el-button type="primary" @click="handleSave" :loading="saving">{{ saving ? '正在保存…' : '保存配置' }}</el-button>
        </div>
      </template>

      <div class="operation-feedback" :class="`operation-feedback--${saveState.kind}`" role="status"><span class="operation-feedback__dot"></span><div><strong>{{ saveState.title }}</strong><span>{{ saveState.detail }}</span></div><el-button v-if="saveState.retry" link size="small" @click="saveState.retry">重试</el-button></div>

      <el-form :model="form" label-width="180px" label-position="left">
        <el-divider content-position="left">视频上传限制</el-divider>

        <el-form-item label="视频最短时长（秒）">
          <el-input-number v-model="form.videoMinDurationSeconds" :min="1" :max="30" :step="1" />
          <div class="form-hint">低于此时长的视频将无法上传</div>
        </el-form-item>

        <el-form-item label="相册视频最长时长（秒）">
          <el-input-number v-model="form.videoMaxDurationSeconds" :min="30" :max="60" :step="10" />
          <div class="form-hint">全局上限不超过 60 秒；缩腹、骨盆始终最多 30 秒，不能通过配置放宽。</div>
        </el-form-item>

        <el-form-item label="录制视频最长时长（秒）">
          <el-input-number v-model="form.videoRecordMaxDurationSeconds" :min="1" :max="60" :step="10" />
          <div class="form-hint">小程序内录制的视频超过此时长将自动停止录制</div>
        </el-form-item>

        <el-form-item label="视频大小上限（MB）">
          <el-input-number v-model="form.videoMaxSizeMB" :min="10" :max="200" :step="10" />
          <div class="form-hint">超过此大小的视频将无法上传</div>
        </el-form-item>

        <el-divider content-position="left">训练目标</el-divider>
        <el-form-item label="允许自主记录练习">
          <div class="self-training-setting">
            <div class="self-training-setting__toggle">
              <el-switch v-model="form.selfTrainingEnabled" aria-label="允许自主记录练习" />
              <span :class="{ 'self-training-setting__status--on': form.selfTrainingEnabled }">{{ form.selfTrainingEnabled ? '已开启' : '已关闭' }}</span>
            </div>
            <div class="form-hint">开启后，患者无需上传视频即可记录当天练习。关闭后，已有记录仍可查看。</div>
          </div>
        </el-form-item>

        <el-form-item label="每周目标天数">
          <el-input-number v-model="form.weeklyTarget" :min="1" :max="14" :step="1" />
          <div class="form-hint">患者端首页的每周训练目标显示值</div>
        </el-form-item>

        <el-divider content-position="left">动作类型</el-divider>

        <el-form-item label="支持的动作类型">
          <el-checkbox-group v-model="form.supportedActionTypes">
            <el-checkbox label="abdominal_crunch">缩腹运动</el-checkbox>
            <el-checkbox label="pelvic_tilt">骨盆倾斜</el-checkbox>
            <el-checkbox label="knee_rotation">膝关节旋转</el-checkbox>
          </el-checkbox-group>
          <div class="form-hint">控制患者端可选择的动作类型</div>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getPatientAppConfig, updatePatientAppConfig } from '@/services/config';
import type { PatientAppConfigDto, UpdatePatientAppConfigRequestDto } from '@home-rehab-motion/shared-contract';
import type { TrainingActionType } from '@home-rehab-motion/shared-types';

const loading = ref(false);
const saving = ref(false);
const saveState = ref<{ kind: 'idle' | 'saving' | 'success' | 'error'; title: string; detail: string; retry?: () => void }>({ kind: 'idle', title: '保存状态', detail: '修改配置后点击保存，变更将立即下发。' });

const form = ref<UpdatePatientAppConfigRequestDto>({
  selfTrainingEnabled: false,
  videoMinDurationSeconds: 10,
  videoMaxDurationSeconds: 60,
  videoRecordMaxDurationSeconds: 60,
  videoMaxSizeMB: 200,
  weeklyTarget: 7,
  supportedActionTypes: ['abdominal_crunch', 'pelvic_tilt', 'knee_rotation'] as TrainingActionType[],
});

async function loadData() {
  loading.value = true;
  try {
    const data = await getPatientAppConfig();
    form.value = {
      selfTrainingEnabled: data.selfTrainingEnabled,
      videoMinDurationSeconds: data.videoMinDurationSeconds,
      videoMaxDurationSeconds: data.videoMaxDurationSeconds,
      videoRecordMaxDurationSeconds: data.videoRecordMaxDurationSeconds,
      videoMaxSizeMB: data.videoMaxSizeMB,
      weeklyTarget: data.weeklyTarget,
      supportedActionTypes: [...data.supportedActionTypes],
    };
  } catch {
    ElMessage.error('加载配置失败');
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  saveState.value = { kind: 'saving', title: '正在保存配置', detail: '正在同步患者端应用参数，请勿关闭当前页面。', retry: () => void handleSave() };
  try {
    await updatePatientAppConfig(form.value);
    saveState.value = { kind: 'success', title: '配置已保存', detail: '新配置已立即生效，后续患者端操作将按当前参数执行。' };
    ElMessage.success('保存成功');
  } catch (err: any) {
    const message = err?.response?.data?.message || '保存失败，请稍后重试';
    saveState.value = { kind: 'error', title: '配置保存失败', detail: message, retry: () => void handleSave() };
    ElMessage.error(message);
  } finally {
    saving.value = false;
  }
}

onMounted(loadData);
</script>

<style scoped>
.operation-feedback { display:flex; align-items:center; gap:12px; padding:12px 14px; margin-bottom:18px; border:1px solid var(--line-soft); border-radius:14px; background:rgba(248,251,255,.8); }.operation-feedback__dot { width:9px; height:9px; flex:0 0 auto; border-radius:50%; background:var(--ink-500); }.operation-feedback > div { display:grid; gap:3px; flex:1; }.operation-feedback strong { color:var(--ink-900); font-size:13px; }.operation-feedback span { color:var(--ink-500); font-size:12px; }.operation-feedback--saving { border-color:rgba(79,195,247,.35); }.operation-feedback--saving .operation-feedback__dot { background:var(--brand-500); animation:pulse 1.2s infinite; }.operation-feedback--success { border-color:rgba(51,178,123,.32); background:rgba(241,253,247,.9); }.operation-feedback--success .operation-feedback__dot { background:var(--success); }.operation-feedback--error { border-color:rgba(239,106,106,.32); background:rgba(255,246,246,.9); }.operation-feedback--error .operation-feedback__dot { background:var(--danger); }@keyframes pulse { 50% { opacity:.35; transform:scale(1.55); } }
.form-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
.self-training-setting { width: min(100%, 560px); padding: 12px 16px; border: 1px solid #e3ecea; border-radius: 12px; background: #f8fbfa; line-height: 1.6; }
.self-training-setting__toggle { display: flex; align-items: center; gap: 10px; color: #687b78; font-size: 13px; font-weight: 600; }
.self-training-setting__status--on { color: #087f76; }
.self-training-setting .form-hint { line-height: 1.6; }
</style>
