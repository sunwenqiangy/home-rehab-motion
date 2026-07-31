<template>
  <div class="admin-page template-version-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Version Governance</div>
          <h1 class="page-hero__title">评分模板版本管理</h1>
          <p class="page-hero__subtitle">统一管理金标准模板与阈值调优版本。历史记录不可直接修改，可基于任一未归档版本派生新的调优版本。</p>
          <div class="page-hero__meta">
            <span class="page-pill">本次筛选 {{ total }} 条</span>
            <span class="page-pill">当前生效 {{ activeCount }} 条</span>
          </div>
        </div>
        <div class="page-hero__side"><div class="hero-glass-card"><div class="hero-glass-card__label">归档版本</div><div class="hero-glass-card__value">{{ archivedCount }}</div><div class="hero-glass-card__hint">归档后永久保留追溯信息</div></div></div>
      </div>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div><div class="section-header__title">版本列表</div><div class="section-header__subtitle">已启用或曾启用的版本不允许删除；请使用归档保留审核与回溯依据。</div></div>
          <el-button type="primary" :loading="loading" @click="loadVersions">刷新列表</el-button>
        </div>
      </template>
      <div class="filter-shell">
        <el-select v-model="actionFilter" clearable placeholder="全部动作" style="width:180px" @change="handleFilterChange"><el-option v-for="option in actionOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select>
        <el-select v-model="statusFilter" clearable placeholder="全部状态" style="width:160px" @change="handleFilterChange"><el-option label="当前生效" :value="1" /><el-option label="已停用" :value="0" /><el-option label="已归档" :value="2" /></el-select>
      </div>
      <div class="table-scroll-shell" v-loading="loading">
        <el-table :data="versions" stripe min-width="1120" empty-text="暂无版本记录">
          <el-table-column label="动作" width="125"><template #default="{ row }"><strong>{{ actionLabel(row.actionType) }}</strong></template></el-table-column>
          <el-table-column label="版本标识" min-width="185"><template #default="{ row }"><div class="version-cell"><strong>{{ row.version }}</strong></div></template></el-table-column>
          <el-table-column label="版本类型" width="120"><template #default="{ row }"><span class="soft-tag" :class="row.versionType === 'gold_template' ? 'soft-tag--info' : 'soft-tag--warning'">{{ typeLabel(row.versionType) }}</span></template></el-table-column>
          <el-table-column label="状态" width="110"><template #default="{ row }"><span class="soft-tag" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span></template></el-table-column>
          <el-table-column label="变更说明" min-width="230" show-overflow-tooltip><template #default="{ row }">{{ row.changeSummary || row.description || '未填写变更说明' }}</template></el-table-column>
          <el-table-column label="创建信息" width="180"><template #default="{ row }"><div>{{ formatTime(row.createdAt) }}</div><small class="muted">{{ row.createdBy || '系统' }}</small></template></el-table-column>
          <el-table-column label="操作" width="270" align="right" fixed="right"><template #default="{ row }"><div class="operation-actions"><el-button type="primary" link @click="openDetail(row)">查看参数</el-button><el-button :disabled="row.status === 2" link @click="openDerive(row)">派生调优</el-button><el-button v-if="row.status === 0" type="success" link @click="requestStatusChange(row, 1)">启用</el-button><el-button v-if="row.status === 1" type="warning" link @click="requestStatusChange(row, 0)">停用</el-button><el-button v-if="row.status === 0" type="warning" link @click="requestArchive(row)">归档</el-button><el-button v-if="canDelete(row)" type="danger" link @click="requestDelete(row)">删除</el-button></div></template></el-table-column>
        </el-table>
      </div>
      <div class="pagination-bar"><span>共 {{ total }} 条</span><el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10, 20, 50, 100]" :total="total" layout="sizes, prev, pager, next" @size-change="handlePageSizeChange" @current-change="loadVersions" /></div>
    </el-card>

    <el-dialog v-model="actionDialogVisible" :title="actionDialogTitle" width="460px" :close-on-click-modal="false" destroy-on-close>
      <div class="action-confirm"><el-alert :closable="false" :type="pendingAction?.kind === 'delete' ? 'warning' : 'info'" show-icon :title="actionDialogMessage" /><p v-if="pendingAction?.kind === 'delete'">删除后无法恢复，仅从未启用且无派生版本的记录允许删除。</p></div>
      <template #footer><el-button @click="actionDialogVisible = false">取消</el-button><el-button :type="pendingAction?.kind === 'delete' ? 'danger' : 'primary'" :loading="actionSubmitting" @click="confirmAction">确认</el-button></template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="版本参数详情" width="880px" destroy-on-close>
      <template v-if="selected"><div class="detail-grid"><div class="info-pair"><span class="info-pair__label">版本标识</span><strong class="info-pair__value">{{ selected.version }}</strong></div><div class="info-pair"><span class="info-pair__label">版本类型</span><strong class="info-pair__value">{{ typeLabel(selected.versionType) }}</strong></div><div class="info-pair"><span class="info-pair__label">变更说明</span><strong class="info-pair__value">{{ selected.changeSummary || selected.description || '-' }}</strong></div></div><h3>金标准统计参数</h3><pre class="compact-code">{{ JSON.stringify(selected.referenceStats, null, 2) }}</pre><h3>阈值参数</h3><pre class="compact-code">{{ JSON.stringify(selected.thresholdConfig, null, 2) }}</pre><template v-if="selected.changeDiff && Object.keys(selected.changeDiff).length"><h3>相对来源版本的差异</h3><pre class="compact-code">{{ JSON.stringify(selected.changeDiff, null, 2) }}</pre></template></template>
      <template #footer><el-button @click="detailVisible = false">关闭</el-button><el-button v-if="selected && selected.status !== 2" type="primary" @click="openDerive(selected)">基于此版本调优</el-button></template>
    </el-dialog>

    <el-dialog v-model="deriveVisible" title="基于历史版本调整阈值" width="760px" destroy-on-close>
      <template v-if="deriveTarget"><el-alert :closable="false" type="info" show-icon title="将创建新的阈值调优版本，不会直接修改当前或历史版本。"/><el-form label-position="top" class="derive-form"><el-form-item label="基准版本"><el-input :model-value="`${actionLabel(deriveTarget.actionType)} · ${deriveTarget.version}`" disabled /></el-form-item><el-form-item label="变更说明"><el-input v-model="deriveSummary" maxlength="500" show-word-limit placeholder="例如：放宽保持时长的有效区间" /></el-form-item><el-form-item label="阈值参数（JSON）"><el-input v-model="deriveConfigText" type="textarea" :rows="16" /></el-form-item><el-checkbox v-model="deriveActivate">保存后立即启用</el-checkbox></el-form></template>
      <template #footer><el-button @click="deriveVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveDerived">保存新版本</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { GoldTemplateVersionDto, GoldTemplateVersionType } from '@home-rehab-motion/shared-contract';
import type { TrainingActionType } from '@home-rehab-motion/shared-types';
import { archiveGoldTemplateVersion, deleteGoldTemplateVersion, getGoldTemplateVersion, getGoldTemplateVersions, updateGoldTemplateVersionStatus, updateThreshold } from '@/services/config';

const actionOptions = [{ value: 'abdominal_crunch', label: '缩腹运动' }, { value: 'pelvic_tilt', label: '骨盆倾斜' }, { value: 'knee_rotation', label: '膝关节旋转' }];
type PendingAction = { kind: 'enable' | 'disable' | 'archive' | 'delete'; row: GoldTemplateVersionDto };
const versions = ref<GoldTemplateVersionDto[]>([]); const total = ref(0); const page = ref(1); const pageSize = ref(10); const loading = ref(false); const saving = ref(false); const actionSubmitting = ref(false); const actionFilter = ref<TrainingActionType | ''>(''); const statusFilter = ref<number | undefined>(); const selected = ref<GoldTemplateVersionDto | null>(null); const detailVisible = ref(false); const deriveVisible = ref(false); const deriveTarget = ref<GoldTemplateVersionDto | null>(null); const deriveConfigText = ref(''); const deriveSummary = ref(''); const deriveActivate = ref(true); const actionDialogVisible = ref(false); const pendingAction = ref<PendingAction | null>(null);
const activeCount = computed(() => versions.value.filter((item) => item.status === 1).length); const archivedCount = computed(() => versions.value.filter((item) => item.status === 2).length);
const actionLabel = (value: TrainingActionType) => ({ abdominal_crunch: '缩腹运动', pelvic_tilt: '骨盆倾斜', knee_rotation: '膝关节旋转' }[value]); const typeLabel = (value: GoldTemplateVersionType) => value === 'gold_template' ? '金标准' : '阈值调整'; const actionDialogTitle = computed(() => ({ enable: '确认启用版本', disable: '确认停用版本', archive: '确认归档版本', delete: '确认删除版本' }[pendingAction.value?.kind || 'enable'])); const actionDialogMessage = computed(() => { const action = pendingAction.value; if (!action) return ''; if (action.kind === 'enable') return `启用「${action.row.version}」后，同动作当前生效版本将自动停用。`; if (action.kind === 'disable') return `确认停用「${action.row.version}」吗？请确保已有替代版本。`; if (action.kind === 'archive') return `归档「${action.row.version}」后将保留追溯记录，且不能再次启用。`; return `确认删除「${action.row.version}」吗？`; }); const statusLabel = (value: number) => ({ 0: '已停用', 1: '生效中', 2: '已归档' }[value] || '未知'); const statusClass = (value: number) => value === 1 ? 'soft-tag--success' : value === 2 ? 'soft-tag--info' : 'soft-tag--warning'; const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false }); const canDelete = (item: GoldTemplateVersionDto) => item.status === 0 && !item.everActivated;
async function loadVersions() { loading.value = true; try { const response = await getGoldTemplateVersions({ actionType: actionFilter.value || undefined, status: statusFilter.value, page: page.value, pageSize: pageSize.value }); versions.value = response.items; total.value = response.total; if (page.value > 1 && !versions.value.length) { page.value -= 1; await loadVersions(); } } catch (error: any) { ElMessage.error(error?.response?.data?.message || '加载版本列表失败'); } finally { loading.value = false; } }
function handleFilterChange() { page.value = 1; loadVersions(); }
function handlePageSizeChange() { page.value = 1; loadVersions(); }
async function openDetail(row: GoldTemplateVersionDto) { try { selected.value = await getGoldTemplateVersion(row.templateId); detailVisible.value = true; } catch (error: any) { ElMessage.error(error?.response?.data?.message || '加载版本详情失败'); } }
function openDerive(row: GoldTemplateVersionDto) { detailVisible.value = false; deriveTarget.value = row; deriveConfigText.value = JSON.stringify(row.thresholdConfig, null, 2); deriveSummary.value = ''; deriveActivate.value = true; deriveVisible.value = true; }
async function saveDerived() { if (!deriveTarget.value) return; let thresholdConfig: Record<string, unknown>; try { thresholdConfig = JSON.parse(deriveConfigText.value); } catch { ElMessage.error('请输入合法的阈值 JSON'); return; } saving.value = true; try { await updateThreshold(deriveTarget.value.actionType, thresholdConfig, deriveSummary.value.trim() || '基于历史版本调整阈值', deriveTarget.value.templateId, deriveActivate.value); ElMessage.success(deriveActivate.value ? '已创建并启用新的阈值版本' : '已创建新的停用阈值版本'); deriveVisible.value = false; await loadVersions(); } catch (error: any) { ElMessage.error(error?.response?.data?.message || '保存版本失败'); } finally { saving.value = false; } }
function requestStatusChange(row: GoldTemplateVersionDto, status: number) { pendingAction.value = { kind: status === 1 ? 'enable' : 'disable', row }; actionDialogVisible.value = true; }
function requestArchive(row: GoldTemplateVersionDto) { pendingAction.value = { kind: 'archive', row }; actionDialogVisible.value = true; }
function requestDelete(row: GoldTemplateVersionDto) { pendingAction.value = { kind: 'delete', row }; actionDialogVisible.value = true; }
async function confirmAction() { const action = pendingAction.value; if (!action) return; actionSubmitting.value = true; try { if (action.kind === 'enable') { await updateGoldTemplateVersionStatus(action.row.templateId, { status: 1 }); ElMessage.success('版本已启用'); } else if (action.kind === 'disable') { await updateGoldTemplateVersionStatus(action.row.templateId, { status: 0 }); ElMessage.success('版本已停用'); } else if (action.kind === 'archive') { await archiveGoldTemplateVersion(action.row.templateId); ElMessage.success('版本已归档'); } else { await deleteGoldTemplateVersion(action.row.templateId); ElMessage.success('版本已删除'); } actionDialogVisible.value = false; pendingAction.value = null; await loadVersions(); } catch (error: any) { ElMessage.error(error?.response?.data?.message || '操作失败，请稍后重试'); } finally { actionSubmitting.value = false; } }
onMounted(loadVersions);
</script>

<style scoped>
.table-scroll-shell{margin-top:18px;overflow-x:auto;border-radius:18px}.pagination-bar{display:flex;align-items:center;justify-content:space-between;margin-top:18px;color:var(--ink-600);font-size:13px}.table-scroll-shell :deep(.el-table){min-width:1120px}.table-scroll-shell :deep(.el-table__fixed-right),.table-scroll-shell :deep(.el-table__fixed-right-patch){background:#f8fbff!important}.table-scroll-shell :deep(.el-table__fixed-right .el-table__cell){background:#f8fbff!important}.table-scroll-shell :deep(.el-table__fixed-right::before){background:#dce9f5}.version-cell{display:grid;gap:4px}.version-cell strong{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink-950);font-size:12px}.version-cell small,.muted{color:var(--ink-500);font-size:11px}.operation-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:2px 10px;min-width:240px}.action-confirm p{margin:14px 0 0;color:var(--ink-700);line-height:1.7}.detail-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0 18px}.template-version-page h3{margin:22px 0 10px;color:var(--ink-950);font-size:15px}.derive-form{margin-top:16px}@media(max-width:680px){.pagination-bar{align-items:flex-start;gap:10px;flex-direction:column}.detail-grid{grid-template-columns:1fr}.operation-actions{justify-content:flex-start}}
</style>
