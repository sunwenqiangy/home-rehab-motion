<template>
  <div class="admin-page feedback-detail-page" v-loading="loading">
    <section class="page-hero compact-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Training Support Ticket</div>
          <h1 class="page-hero__title">工单 #{{ detail?.feedbackId || feedbackId || '-' }}</h1>
          <p class="page-hero__subtitle">{{ detail?.patientName || `患者 #${detail?.patientId || '-'}` }} · {{ typeLabel(detail?.feedbackType) }} · 创建于 {{ formatDate(detail?.createdAt) }}</p>
          <div class="page-hero__meta">
            <span class="page-pill">{{ statusLabel(detail?.status) }}</span>
            <span v-if="detail?.lastMessageAt" class="page-pill">最后更新 {{ formatDate(detail.lastMessageAt) }}</span>
          </div>
        </div>
        <div class="page-hero__side"><div class="hero-glass-card hero-glass-card--compact"><div class="hero-glass-card__label">当前处理状态</div><div class="hero-glass-card__value">{{ statusLabel(detail?.status) }}</div><div class="hero-glass-card__hint">{{ statusHint }}</div></div></div>
      </div>
    </section>

    <div class="toolbar-group compact-toolbar"><el-button @click="router.push('/feedback')">返回工单列表</el-button><el-button type="primary" :loading="loading" @click="loadDetail">刷新工单</el-button></div>

    <div v-if="detail" class="ticket-layout">
      <aside class="ticket-sidebar">
        <el-card class="surface-card" shadow="never">
          <template #header><div class="section-header"><div><div class="section-header__title">患者信息</div><div class="section-header__subtitle">关联本次训练的患者档案</div></div></div></template>
          <div class="patient-card"><span class="patient-card__avatar">{{ (detail.patientName || '患').slice(0, 1) }}</span><div><strong>{{ detail.patientName || `患者 #${detail.patientId}` }}</strong><p>患者 ID #{{ detail.patientId }}</p></div></div>
          <el-button class="full-width" @click="router.push(`/users/${detail.patientId}`)">查看患者详情</el-button>
        </el-card>

        <el-card class="surface-card" shadow="never">
          <template #header><div class="section-header"><div><div class="section-header__title">关联训练</div><div class="section-header__subtitle">工单关联的视频与分析结果</div></div></div></template>
          <template v-if="detail.trainingContext">
            <div class="training-score"><strong>{{ detail.trainingContext.averageScore ?? '-' }}</strong><span>综合评分</span><em>{{ detail.trainingContext.grade || '待评级' }}</em></div>
            <dl class="fact-list"><div><dt>视频编号</dt><dd>#{{ detail.trainingContext.videoId }}</dd></div><div><dt>动作类型</dt><dd>{{ actionLabel(detail.trainingContext.actionType) }}</dd></div><div><dt>训练时长</dt><dd>{{ durationLabel(detail.trainingContext.duration) }}</dd></div><div><dt>分析状态</dt><dd>{{ analysisStatusLabel(detail.trainingContext.analysisStatus) }}</dd></div><div><dt>上传时间</dt><dd>{{ formatDate(detail.trainingContext.uploadedAt) }}</dd></div></dl>
            <el-button class="full-width" type="primary" plain @click="router.push(`/videos/${detail.trainingContext?.videoId}`)">查看训练视频</el-button>
          </template>
          <el-empty v-else description="该工单未关联训练视频" :image-size="50" />
        </el-card>
      </aside>

      <main class="ticket-main">
        <el-card class="surface-card" shadow="never">
          <template #header><div class="section-header"><div><div class="section-header__title">沟通记录</div><div class="section-header__subtitle">患者补充内容和工作人员回复按时间顺序展示</div></div></div></template>
          <section class="ticket-timeline">
            <article v-for="message in detail.messages || []" :key="message.messageId" class="ticket-message" :class="`ticket-message--${message.senderRole}`">
              <div class="ticket-message__head"><strong>{{ senderLabel(message.senderRole) }}</strong><small>{{ formatDate(message.createdAt) }}</small></div>
              <p>{{ message.content }}</p>
              <div v-if="message.imageUrls?.length" class="ticket-images"><el-image v-for="(url, index) in message.imageUrls" :key="url" :src="url" fit="cover" :preview-src-list="message.imageUrls" :initial-index="index" preview-teleported><template #error><div class="ticket-images__error">图片加载失败</div></template></el-image></div>
            </article>
            <el-empty v-if="!detail.messages?.length" description="暂无沟通内容" :image-size="54" />
          </section>
        </el-card>

        <el-card class="surface-card" shadow="never">
          <template #header><div class="section-header"><div><div class="section-header__title">工单处理</div><div class="section-header__subtitle">仅提供训练指导，不提供诊断、紧急医疗帮助或治疗建议。</div></div><span class="soft-tag" :class="tagClass(detail.status)">{{ statusLabel(detail.status) }}</span></div></template>
          <section v-if="detail.handlingMode === 'manual' && detail.status !== 'closed'" class="ticket-actions">
            <el-alert v-if="detail.status === 'pending'" type="info" :closable="false" title="该工单尚未开始处理。开始处理后，患者会看到“处理中”状态。" />
            <el-button v-if="detail.status === 'pending'" @click="handleStart" :loading="saving">开始处理</el-button>
            <el-select v-model="selectedTemplate" clearable placeholder="选择回复模板" style="width:190px" @change="applyTemplate"><el-option v-for="item in templates" :key="item.code" :label="item.label" :value="item.code" /></el-select>
            <el-input v-model="replyContent" type="textarea" :rows="5" maxlength="1000" show-word-limit placeholder="请输入给患者的训练指导回复" />
            <div class="action-buttons"><el-button @click="showCloseDialog" :loading="saving">关闭工单</el-button><el-button type="primary" :loading="saving" @click="handleReply">发送回复</el-button></div>
          </section>
          <el-alert v-else-if="detail.handlingMode === 'safety_auto'" type="warning" :closable="false" title="该记录已完成安全分流" description="患者已收到暂停训练、及时咨询医生或前往医疗机构评估的系统提示，无需人工回复。" />
          <el-alert v-else type="success" :closable="false" title="工单已关闭" description="患者不能在此工单继续补充问题；如有新的训练问题，将从报告页重新提交。" />
        </el-card>
      </main>
    </div>
    <el-dialog v-model="closeDialogVisible" title="确认关闭工单" width="440px" :close-on-click-modal="false" :close-on-press-escape="!saving">
      <p class="close-dialog__message">关闭后患者不能继续在该工单追问。适用于患者已表示问题解决、无需进一步回复，或工作人员确认本次沟通已结束的场景。</p>
      <template #footer>
        <el-button @click="closeDialogVisible = false" :disabled="saving">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleClose">确认关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { AdminFeedbackListItemDto } from '@home-rehab-motion/shared-contract';
import type { AnalysisStatus } from '@home-rehab-motion/shared-types';
import { ANALYSIS_STATUS_LABELS } from '@home-rehab-motion/shared-constants';
import { closeFeedback, getFeedbackDetail, getReplyTemplates, replyFeedback, startFeedback, type ReplyTemplate } from '@/services/feedback';

const route = useRoute();
const router = useRouter();
const feedbackId = computed(() => Number(route.params.feedbackId || 0));
const detail = ref<AdminFeedbackListItemDto | null>(null);
const templates = ref<ReplyTemplate[]>([]);
const selectedTemplate = ref('');
const replyContent = ref('');
const loading = ref(false);
const saving = ref(false);
const closeDialogVisible = ref(false);
const statusHint = computed(() => ({ pending: '等待工作人员接手', processing: '正在查看训练情况', replied: '已等待患者查看回复', closed: '本次问题已结束' }[detail.value?.status || 'pending']));

const typeLabel = (value?: string) => ({ report_question: '报告疑问', action_issue: '动作问题', upload_issue: '上传问题', body_discomfort: '身体不适', other: '其他训练问题' }[value || ''] || '训练反馈');
const actionLabel = (value?: string) => ({ abdominal_crunch: '缩腹运动', pelvic_tilt: '骨盆倾斜', knee_rotation: '膝关节旋转' }[value || ''] || '未记录');
const statusLabel = (value?: string) => ({ pending: '待处理', processing: '处理中', replied: '已回复', closed: '已关闭' }[value || ''] || '-');
const analysisStatusLabel = (value?: AnalysisStatus) => value ? ANALYSIS_STATUS_LABELS[value] || value : '未记录';
const senderLabel = (value: string) => ({ patient: '患者', staff: '工作人员', system: '系统提示' }[value] || value);
const tagClass = (value: string) => ({ pending: 'soft-tag--danger', processing: 'soft-tag--warning', replied: 'soft-tag--success', closed: 'soft-tag--info' }[value] || 'soft-tag--info');
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '-';
const durationLabel = (duration?: number) => duration ? `${Math.round(duration)} 秒` : '未记录';

async function loadDetail() {
  if (!feedbackId.value) { ElMessage.error('工单编号无效'); return; }
  loading.value = true;
  try { [detail.value, templates.value] = await Promise.all([getFeedbackDetail(feedbackId.value), getReplyTemplates()]); }
  catch (error: any) { ElMessage.error(error?.response?.data?.message || '加载工单详情失败'); }
  finally { loading.value = false; }
}
function applyTemplate(code: string) { const item = templates.value.find((template) => template.code === code); if (item) replyContent.value = item.content; }
async function handleStart() { if (!detail.value) return; saving.value = true; try { await startFeedback(detail.value.feedbackId); ElMessage.success('已开始处理'); await loadDetail(); } catch (error: any) { ElMessage.error(error?.response?.data?.message || '操作失败'); } finally { saving.value = false; } }
async function handleReply() { if (!detail.value || replyContent.value.trim().length < 1) { ElMessage.warning('回复至少需要 1 个字'); return; } saving.value = true; try { await replyFeedback(detail.value.feedbackId, { content: replyContent.value, templateCode: selectedTemplate.value || undefined }); ElMessage.success('回复已发送，患者将收到通知'); replyContent.value = ''; selectedTemplate.value = ''; await loadDetail(); } catch (error: any) { ElMessage.error(error?.response?.data?.message || '发送失败'); } finally { saving.value = false; } }
function showCloseDialog() { if (!detail.value) return; closeDialogVisible.value = true; }
async function handleClose() { if (!detail.value) return; saving.value = true; try { await closeFeedback(detail.value.feedbackId); ElMessage.success('工单已关闭'); closeDialogVisible.value = false; await loadDetail(); } catch (error: any) { ElMessage.error(error?.response?.data?.message || '关闭失败'); } finally { saving.value = false; } }
onMounted(loadDetail);
</script>

<style scoped>
.ticket-layout{display:grid;grid-template-columns:minmax(260px,320px) minmax(0,1fr);gap:18px}.ticket-sidebar,.ticket-main{display:grid;align-content:start;gap:18px}.patient-card{display:flex;align-items:center;gap:12px;margin-bottom:16px}.patient-card__avatar{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:#dceef0;color:#0c7e82;font-size:20px;font-weight:700}.patient-card strong{display:block;color:var(--ink-900)}.patient-card p{margin:5px 0 0;color:var(--ink-500);font-size:12px}.full-width{width:100%}.training-score{display:grid;grid-template-columns:auto 1fr;align-items:end;column-gap:9px;padding:14px;border-radius:12px;background:linear-gradient(135deg,#edf8f4,#f5fbfc);margin-bottom:14px}.training-score strong{font-size:30px;line-height:1;color:#118673}.training-score span{color:var(--ink-500);font-size:12px}.training-score em{grid-column:1/-1;margin-top:8px;font-style:normal;font-size:12px;color:#15806d}.fact-list{display:grid;gap:10px;margin:0 0 16px}.fact-list div{display:flex;justify-content:space-between;gap:12px;font-size:13px}.fact-list dt{color:var(--ink-500)}.fact-list dd{margin:0;text-align:right;color:var(--ink-800)}.ticket-timeline{display:grid;gap:12px;min-height:140px}.ticket-message{padding:14px 16px;border:1px solid rgba(148,180,214,.18);border-radius:14px;background:#f5f8fb}.ticket-message--staff{background:rgba(51,178,123,.09);border-color:rgba(51,178,123,.22)}.ticket-message--system{background:rgba(240,166,63,.11);border-color:rgba(240,166,63,.24)}.ticket-message__head{display:flex;justify-content:space-between;gap:12px}.ticket-message__head strong{font-size:13px;color:var(--ink-800)}.ticket-message__head small{color:var(--ink-500);font-size:12px}.ticket-message p{margin:9px 0 0;white-space:pre-wrap;line-height:1.7;color:var(--ink-800)}.ticket-images{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}.ticket-images :deep(.el-image){width:148px;height:112px;overflow:hidden;border:1px solid rgba(65,117,151,.18);border-radius:10px;background:#edf4f7;cursor:zoom-in}.ticket-images :deep(.el-image__inner){transition:transform .2s}.ticket-images :deep(.el-image:hover .el-image__inner){transform:scale(1.04)}.ticket-images__error{display:grid;place-items:center;width:100%;height:100%;padding:8px;box-sizing:border-box;color:var(--ink-500);font-size:12px;text-align:center}.ticket-actions{display:grid;gap:12px}.action-buttons{display:flex;justify-content:flex-end;gap:10px}.close-dialog__message{margin:0;color:var(--ink-600);line-height:1.7}@media(max-width:900px){.ticket-layout{grid-template-columns:1fr}.ticket-sidebar{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:640px){.ticket-sidebar{grid-template-columns:1fr}.ticket-images :deep(.el-image){width:120px;height:96px}}
</style>
