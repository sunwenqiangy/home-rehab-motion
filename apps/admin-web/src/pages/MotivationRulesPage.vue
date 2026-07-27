<template>
  <div class="admin-page motivation-rules-page" v-loading="loading">
    <section class="page-hero motivation-hero">
      <div class="motivation-hero__copy">
        <div class="page-hero__eyebrow">Motivation Rules</div>
        <div class="motivation-hero__title-row">
          <h1 class="page-hero__title">激励规则配置</h1>
          <span class="hero-status"><span class="hero-status__dot"></span>当前规则生效中</span>
        </div>
        <p class="page-hero__subtitle">统一维护患者进步提示和温和提醒的触发条件；保存后仅影响后续训练结果，不改写既有报告快照。</p>
      </div>
      <div class="motivation-hero__art" aria-hidden="true">
        <div class="motivation-hero__orbit motivation-hero__orbit--outer"></div>
        <div class="motivation-hero__orbit motivation-hero__orbit--inner"></div>
        <div class="motivation-hero__core"></div>
      </div>
    </section>

    <div class="rules-layout">
      <div class="rules-layout__main">
        <el-card class="surface-card rules-card" shadow="never">
          <template #header>
            <div class="card-heading">
              <div class="card-heading__icon card-heading__icon--blue">01</div>
              <div>
                <div class="card-heading__title">过程性进步阈值</div>
                <div class="card-heading__subtitle">系统会优先比较本次与上次同动作训练的数据，满足阈值后生成相应的正向提示。</div>
              </div>
            </div>
          </template>

          <div class="threshold-guide" role="note">
            <span class="threshold-guide__mark">i</span>
            <span><strong>轻微进步</strong>用于日常鼓励，<strong>明显进步</strong>用于强化反馈；明显进步阈值始终不低于轻微进步阈值。</span>
          </div>

          <el-form :model="form" class="rules-form" label-position="top">
            <div class="threshold-table">
              <div class="threshold-table__head">
                <span>评估指标</span>
                <span>轻微进步</span>
                <span>明显进步</span>
              </div>
              <div class="threshold-row">
                <div class="metric-cell"><span class="metric-icon metric-icon--score">分</span><span>综合分提升</span></div>
                <el-form-item><el-input-number v-model="form.scoreSlightDelta" :min="1" :max="30" controls-position="right" /><span class="input-unit">分</span></el-form-item>
                <el-form-item><el-input-number v-model="form.scoreClearDelta" :min="form.scoreSlightDelta" :max="50" controls-position="right" /><span class="input-unit">分</span></el-form-item>
              </div>
              <div class="threshold-row">
                <div class="metric-cell"><span class="metric-icon metric-icon--steady">稳</span><span>稳定性提升</span></div>
                <el-form-item><el-input-number v-model="form.stabilitySlightDelta" :min="1" :max="30" controls-position="right" /><span class="input-unit">分</span></el-form-item>
                <el-form-item><el-input-number v-model="form.stabilityClearDelta" :min="form.stabilitySlightDelta" :max="50" controls-position="right" /><span class="input-unit">分</span></el-form-item>
              </div>
              <div class="threshold-row">
                <div class="metric-cell"><span class="metric-icon metric-icon--time">秒</span><span>平均保持时间提升</span></div>
                <el-form-item><el-input-number v-model="form.durationSlightDelta" :min="0.1" :max="30" :step="0.1" controls-position="right" /><span class="input-unit">秒</span></el-form-item>
                <el-form-item><el-input-number v-model="form.durationClearDelta" :min="form.durationSlightDelta" :max="60" :step="0.1" controls-position="right" /><span class="input-unit">秒</span></el-form-item>
              </div>
              <div class="threshold-row">
                <div class="metric-cell"><span class="metric-icon metric-icon--reps">次</span><span>有效动作次数提升</span></div>
                <el-form-item><el-input-number v-model="form.repsSlightDelta" :min="1" :max="20" controls-position="right" /><span class="input-unit">次</span></el-form-item>
                <el-form-item><el-input-number v-model="form.repsClearDelta" :min="form.repsSlightDelta" :max="50" controls-position="right" /><span class="input-unit">次</span></el-form-item>
              </div>
            </div>
          </el-form>
        </el-card>
      </div>

      <aside class="rules-layout__aside">
        <section class="aside-panel aside-panel--summary">
          <div class="aside-panel__eyebrow">RULE IMPACT</div>
          <h2>规则如何生效？</h2>
          <p>配置不会影响既有结果，仅在后续训练分析完成后参与患者侧的激励内容生成。</p>
          <ol class="rule-flow">
            <li><span>1</span><div><strong>训练完成</strong><small>患者确认上传训练视频</small></div></li>
            <li><span>2</span><div><strong>分析结果回写</strong><small>服务端计算并记录本次数据</small></div></li>
            <li><span>3</span><div><strong>生成激励反馈</strong><small>对比阈值，更新报告、首页与消息</small></div></li>
          </ol>
        </section>

        <section class="aside-panel aside-panel--notice">
          <div class="aside-panel__notice-icon">!</div>
          <div><strong>保存提示</strong><p>保存后将立即用于新的训练分析；无需重新发布患者端。</p></div>
        </section>
      </aside>
    </div>

    <div class="save-bar" :class="`save-bar--${saveState.kind}`">
      <div class="save-bar__copy"><strong>{{ saveState.title }}</strong><span>{{ saveState.detail }}</span></div>
      <el-button v-if="saveState.retry" link @click="saveState.retry">重试</el-button>
      <el-button type="primary" size="large" :loading="saving" @click="save">{{ saving ? '正在保存…' : '保存规则' }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { MotivationRulesDto } from '@home-rehab-motion/shared-contract';
import { getMotivationRules, updateMotivationRules } from '@/services/config';

const loading = ref(false);
const saving = ref(false);
const saveState = ref<{ kind: 'idle' | 'saving' | 'success' | 'error'; title: string; detail: string; retry?: () => void }>({ kind: 'idle', title: '确认当前配置无误后保存', detail: '保存操作只影响后续训练，不影响历史报告。' });
const form = ref<MotivationRulesDto>({
  scoreSlightDelta: 3,
  scoreClearDelta: 8,
  stabilitySlightDelta: 3,
  stabilityClearDelta: 8,
  durationSlightDelta: 0.5,
  durationClearDelta: 1.5,
  repsSlightDelta: 1,
  repsClearDelta: 2,
});

async function load() {
  loading.value = true;
  try {
    form.value = await getMotivationRules();
  } catch {
    ElMessage.error('加载激励规则失败');
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  saveState.value = { kind: 'saving', title: '正在保存激励规则', detail: '正在同步后续训练的激励阈值，请勿关闭当前页面。', retry: () => void save() };
  try {
    form.value = await updateMotivationRules(form.value);
    saveState.value = { kind: 'success', title: '激励规则已保存', detail: '后续训练将按新规则计算，历史报告不会被改写。' };
    ElMessage.success('激励规则已保存，后续训练将按新规则计算');
  } catch (error: any) {
    const message = error?.response?.data?.message || '保存激励规则失败，请稍后重试';
    saveState.value = { kind: 'error', title: '激励规则保存失败', detail: message, retry: () => void save() };
    ElMessage.error(message);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.motivation-rules-page { max-width: 1440px; margin: 0 auto; padding-bottom: 92px; }
.motivation-hero { position: relative; display: flex; align-items: center; justify-content: space-between; min-height: 154px; overflow: hidden; padding: 28px 34px; border: 1px solid rgba(120, 205, 243, 0.22); border-radius: 22px; background: linear-gradient(113deg, #112c4b 0%, #153f66 53%, #1b6687 100%); box-shadow: 0 18px 38px rgba(15, 49, 81, 0.14); }
.motivation-hero::after { position: absolute; inset: 0; content: ''; background: linear-gradient(90deg, rgba(255, 255, 255, 0.05), transparent 48%); pointer-events: none; }
.motivation-hero__copy { position: relative; z-index: 1; max-width: 780px; }
.motivation-hero .page-hero__eyebrow { color: rgba(177, 227, 247, 0.78); letter-spacing: .13em; }
.motivation-hero .page-hero__title { margin: 7px 0 0; color: #fff; }
.motivation-hero .page-hero__subtitle { max-width: 720px; margin: 10px 0 0; color: rgba(225, 243, 251, .8); }
.motivation-hero__title-row { display: flex; align-items: center; gap: 12px; }
.hero-status { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px; border: 1px solid rgba(128, 233, 185, .28); border-radius: 999px; color: #c9f7dc; background: rgba(49, 178, 123, .16); font-size: 12px; font-weight: 700; }
.hero-status__dot { width: 7px; height: 7px; border-radius: 50%; background: #6fe0a2; box-shadow: 0 0 0 4px rgba(111, 224, 162, .12); }
.motivation-hero__art { position: relative; z-index: 1; width: 180px; height: 126px; margin-right: 28px; }
.motivation-hero__orbit { position: absolute; border: 1px solid rgba(209, 244, 255, .34); border-radius: 50%; }
.motivation-hero__orbit--outer { width: 154px; height: 154px; right: 0; top: -14px; }
.motivation-hero__orbit--inner { width: 98px; height: 98px; right: 28px; top: 14px; border-style: dashed; }
.motivation-hero__core { position: absolute; right: 62px; top: 47px; width: 32px; height: 32px; border: 8px solid #b7efff; border-radius: 50%; box-shadow: 0 0 0 10px rgba(183, 239, 255, .12), 0 0 28px rgba(167, 237, 255, .45); }
.rules-layout { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 20px; margin-top: 20px; align-items: start; }
.rules-layout__main { display: grid; gap: 20px; min-width: 0; }
.rules-card { overflow: hidden; border: 1px solid rgba(148, 180, 214, .26); border-radius: 18px; box-shadow: 0 10px 30px rgba(20, 49, 79, .06); }
.rules-card :deep(.el-card__header) { padding: 20px 24px; border-bottom: 1px solid rgba(148, 180, 214, .18); }
.rules-card :deep(.el-card__body) { padding: 20px 24px 24px; }
.card-heading { display: flex; align-items: flex-start; gap: 12px; }
.card-heading__icon { display: grid; flex: 0 0 auto; width: 34px; height: 34px; place-items: center; border-radius: 11px; font-size: 11px; font-weight: 800; letter-spacing: .05em; }
.card-heading__icon--blue { color: #17688d; background: #e4f5fb; border: 1px solid #caeaf6; }
.card-heading__icon--green { color: #278857; background: #eaf9f1; border: 1px solid #cdeedc; }
.card-heading__title { color: var(--ink-950); font-size: 16px; font-weight: 800; line-height: 1.35; }
.card-heading__subtitle { margin-top: 4px; color: var(--ink-500); font-size: 13px; line-height: 1.55; }
.threshold-guide { display: flex; gap: 9px; align-items: flex-start; padding: 11px 13px; margin-bottom: 18px; border: 1px solid #d7eaf5; border-radius: 10px; color: #537089; background: #f4faff; font-size: 12px; line-height: 1.6; }
.threshold-guide strong { color: #245c7d; }
.threshold-guide__mark { display: grid; flex: 0 0 auto; width: 16px; height: 16px; place-items: center; border-radius: 50%; color: #fff; background: #53a9cf; font-size: 11px; font-family: Georgia, serif; font-weight: 700; }
.threshold-table { overflow: hidden; border: 1px solid #e0ebf2; border-radius: 12px; }
.threshold-table__head, .threshold-row { display: grid; grid-template-columns: minmax(185px, 1.25fr) minmax(160px, 1fr) minmax(160px, 1fr); align-items: center; }
.threshold-table__head { min-height: 42px; padding: 0 18px; color: #71869a; background: #f6f9fc; font-size: 12px; font-weight: 700; }
.threshold-row { min-height: 69px; padding: 0 18px; border-top: 1px solid #e6eef4; transition: background .18s ease; }
.threshold-row:hover { background: #fbfdff; }
.threshold-row :deep(.el-form-item) { margin: 0; }
.threshold-row :deep(.el-form-item__content) { display: flex; align-items: center; }
.threshold-row :deep(.el-input-number) { width: 118px; }
.metric-cell { display: flex; align-items: center; gap: 10px; color: #253f57; font-size: 13px; font-weight: 700; }
.metric-icon { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 8px; font-size: 11px; font-weight: 800; }
.metric-icon--score { color: #2a78a1; background: #e5f4fb; }.metric-icon--steady { color: #397756; background: #eaf8ef; }.metric-icon--time { color: #a46d28; background: #fff5e7; }.metric-icon--reps { color: #7758b0; background: #f2edff; }
.input-unit { margin-left: 8px; color: #71869a; font-size: 12px; }
.rules-layout__aside { display: grid; gap: 14px; position: sticky; top: 16px; }
.aside-panel { border: 1px solid rgba(148, 180, 214, .24); border-radius: 16px; background: rgba(255, 255, 255, .94); box-shadow: 0 9px 24px rgba(20, 49, 79, .05); }
.aside-panel--summary { padding: 21px 19px 18px; }.aside-panel__eyebrow { color: #5490ad; font-size: 10px; font-weight: 800; letter-spacing: .13em; }.aside-panel h2 { margin: 7px 0; color: var(--ink-950); font-size: 16px; }.aside-panel p { margin: 0; color: #708397; font-size: 12px; line-height: 1.65; }
.rule-flow { display: grid; gap: 16px; padding: 18px 0 0; margin: 0; list-style: none; }.rule-flow li { display: flex; align-items: flex-start; gap: 10px; position: relative; }.rule-flow li:not(:last-child)::after { position: absolute; top: 28px; left: 12px; width: 1px; height: 18px; background: #cddfe9; content: ''; }.rule-flow li > span { display: grid; flex: 0 0 auto; width: 25px; height: 25px; place-items: center; border-radius: 50%; color: #2c779c; background: #e7f5fb; font-size: 11px; font-weight: 800; }.rule-flow strong { display: block; color: #344f66; font-size: 12px; }.rule-flow small { display: block; margin-top: 3px; color: #8798a7; font-size: 11px; line-height: 1.45; }
.aside-panel--notice { display: flex; gap: 10px; padding: 14px; border-color: #dbece4; background: #f8fcfa; }.aside-panel__notice-icon { display: grid; flex: 0 0 auto; width: 21px; height: 21px; place-items: center; border-radius: 50%; color: #fff; background: #48a878; font-size: 12px; font-weight: 800; }.aside-panel--notice strong { color: #347456; font-size: 12px; }.aside-panel--notice p { margin-top: 3px; font-size: 11px; }
.save-bar { position: fixed; z-index: 10; right: 32px; bottom: 22px; left: 304px; display: flex; align-items: center; justify-content: space-between; gap: 20px; max-width: 1390px; padding: 12px 16px 12px 20px; border: 1px solid rgba(148, 180, 214, .28); border-radius: 15px; background: rgba(255, 255, 255, .92); box-shadow: 0 14px 36px rgba(20, 49, 79, .16); backdrop-filter: blur(16px); }.save-bar--saving { border-color:rgba(79,195,247,.45); }.save-bar--success { border-color:rgba(51,178,123,.42); }.save-bar--error { border-color:rgba(239,106,106,.45); }.save-bar__copy { display: flex; align-items: baseline; gap: 10px; }.save-bar__copy strong { color: #26435b; font-size: 13px; }.save-bar__copy span { color: #7e91a1; font-size: 12px; }.save-bar :deep(.el-button) { min-width: 112px; font-weight: 700; }
@media (max-width: 1200px) { .rules-layout { grid-template-columns: 1fr; }.rules-layout__aside { grid-template-columns: 1fr 1fr; position: static; }.save-bar { left: 120px; }.motivation-hero__art { margin-right: 0; } }
@media (max-width: 820px) { .motivation-hero { padding: 24px; }.motivation-hero__art { display: none; }.threshold-table { overflow-x: auto; }.threshold-table__head, .threshold-row { min-width: 620px; }.rules-layout__aside { grid-template-columns: 1fr; }.save-bar { right: 16px; left: 16px; }.save-bar__copy span { display: none; } }
</style>
