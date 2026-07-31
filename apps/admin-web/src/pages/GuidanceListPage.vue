<template>
  <div class="admin-page guidance-list-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Content Library</div>
          <h1 class="page-hero__title">指导内容管理</h1>
          <p class="page-hero__subtitle">可为同一动作创建多份内容，但患者端同一动作始终只展示一份已启用内容。</p>
          <div class="page-hero__meta"><span class="page-pill">共 {{ list.length }} 份内容</span><span class="page-pill">每个动作仅允许 1 份启用</span></div>
        </div>
      </div>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div><div class="section-header__title">指导内容列表</div><div class="section-header__subtitle">启用一份新内容时，系统会自动下线该动作之前已启用的内容。</div></div>
          <div class="toolbar-group"><el-button :loading="loading" @click="loadData">刷新</el-button><el-button :loading="exporting" @click="exportConfig">导出标准配置</el-button><el-button @click="importDialogVisible = true">导入标准配置</el-button><el-button type="primary" @click="router.push('/guidance/create')">新建指导内容</el-button></div>
        </div>
      </template>
      <div v-loading="loading" class="table-shell">
        <el-table :data="list" stripe>
          <el-table-column prop="contentId" label="ID" width="76" />
          <el-table-column label="动作类型" min-width="140"><template #default="{ row }">{{ actionTypeLabel(row.actionType) }}</template></el-table-column>
          <el-table-column prop="title" label="标题" min-width="230" />
          <el-table-column label="状态" width="105"><template #default="{ row }"><span class="soft-tag" :class="row.enabled ? 'soft-tag--success' : 'soft-tag--info'">{{ row.enabled ? '已启用' : '未启用' }}</span></template></el-table-column>
          <el-table-column prop="updatedAt" label="最近编辑" min-width="180"><template #default="{ row }">{{ formatDate(row.updatedAt) }}</template></el-table-column>
          <el-table-column label="操作" width="300" fixed="right">
            <template #default="{ row }"><div class="guidance-actions">
              <el-button link type="primary" @click="router.push(`/guidance/${row.contentId}/edit`)">编辑</el-button>
              <el-button link @click="handleCopy(row)">复制</el-button>
              <el-button v-if="!row.enabled" link type="success" @click="confirmSetEnabled(row)">启用</el-button>
              <el-button v-else link type="warning" @click="confirmSetEnabled(row)">下线</el-button>
              <el-button link type="danger" @click="confirmDelete(row)">删除</el-button>
            </div></template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-dialog v-model="importDialogVisible" title="导入指导内容标准配置" width="560px" :close-on-click-modal="false">
      <div class="import-dialog"><el-alert type="info" :closable="false" show-icon title="只会补齐当前数据库中不存在的动作内容，不会覆盖已有人工维护内容。"/><el-upload class="import-upload" accept="application/json,.json" :show-file-list="false" :auto-upload="false" :on-change="readConfigFile"><el-button type="primary">选择配置文件</el-button><template #tip><div class="el-upload__tip">请选择通过“导出标准配置”生成的 JSON 文件。</div></template></el-upload><p v-if="selectedConfigName" class="import-dialog__file">已选择：{{ selectedConfigName }}</p></div>
      <template #footer><el-button @click="importDialogVisible = false">取消</el-button><el-button type="primary" :disabled="!importConfig" :loading="importing" @click="submitImport">开始导入</el-button></template>
    </el-dialog>

    <el-dialog v-model="enableDialogVisible" :title="enableTarget?.enabled ? '确认下线内容' : '确认启用内容'" width="500px" :close-on-click-modal="false">
      <div class="enable-dialog"><el-alert :type="enableTarget?.enabled ? 'warning' : 'success'" :closable="false" show-icon :title="enableTarget?.enabled ? '下线后患者端将不再展示该动作指导' : '启用后会自动下线同一动作的其他内容'"/><p>{{ enableTarget?.enabled ? `确认下线「${enableTarget?.title || ''}」吗？` : `确认启用「${enableTarget?.title || ''}」吗？` }}</p></div>
      <template #footer><el-button @click="enableDialogVisible = false">取消</el-button><el-button :type="enableTarget?.enabled ? 'warning' : 'success'" :loading="loading" @click="setGuidanceEnabledState">{{ enableTarget?.enabled ? '确认下线' : '确认启用' }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="deleteDialogVisible" title="确认删除指导内容" width="500px" :close-on-click-modal="false">
      <div class="delete-dialog"><el-alert type="warning" :closable="false" show-icon title="删除后无法恢复"/><p>确认永久删除「{{ deleteTarget?.title || (deleteTarget ? actionTypeLabel(deleteTarget.actionType) : '') }}」吗？</p><small>{{ deleteTarget?.enabled ? '该内容当前已启用，删除后患者端将不再展示该动作指导。' : '删除后将无法恢复该内容及其历史保存记录。' }}</small></div>
      <template #footer><el-button @click="deleteDialogVisible = false">取消</el-button><el-button type="danger" :loading="loading" @click="deleteGuidanceContent">确认删除</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { copyGuidance, deleteGuidance, exportGuidanceConfigPackage, getGuidanceList, importGuidanceConfigPackage, setGuidanceEnabled, type GuidanceConfigPackage } from '@/services/guidance';
import type { AdminGuidanceListItemDto } from '@home-rehab-motion/shared-contract';
import type { TrainingActionType } from '@home-rehab-motion/shared-types';

const router = useRouter();
const list = ref<AdminGuidanceListItemDto[]>([]);
const loading = ref(false);
const enableDialogVisible = ref(false);
const enableTarget = ref<AdminGuidanceListItemDto | null>(null);
const deleteDialogVisible = ref(false);
const deleteTarget = ref<AdminGuidanceListItemDto | null>(null);
const exporting = ref(false);
const importing = ref(false);
const importDialogVisible = ref(false);
const importConfig = ref<GuidanceConfigPackage | null>(null);
const selectedConfigName = ref('');
const actionTypeLabel = (type: TrainingActionType) => ({ abdominal_crunch: '缩腹运动', pelvic_tilt: '骨盆倾斜', knee_rotation: '膝关节旋转' } as Record<string, string>)[type] || type;
const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const errorText = (error: any) => error?.response?.data?.message || error?.message || '操作失败，请稍后重试';

async function loadData() { loading.value = true; try { list.value = await getGuidanceList(); } catch (error: any) { ElMessage.error(errorText(error)); } finally { loading.value = false; } }
async function exportConfig() { exporting.value = true; try { const config = await exportGuidanceConfigPackage(); const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `指导内容标准配置-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); ElMessage.success(`已导出 ${config.items.length} 个动作配置`); } catch (error: any) { ElMessage.error(errorText(error)); } finally { exporting.value = false; } }
function readConfigFile(uploadFile: any) { const file = uploadFile.raw as File | undefined; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const parsed = JSON.parse(String(reader.result || '')); if (parsed?.format !== 'home-rehab-motion.guidance-config' || parsed?.version !== 1 || !Array.isArray(parsed?.items)) throw new Error('文件不是有效的指导内容标准配置'); importConfig.value = parsed as GuidanceConfigPackage; selectedConfigName.value = file.name; ElMessage.success(`已读取 ${parsed.items.length} 个动作配置`); } catch (error: any) { importConfig.value = null; selectedConfigName.value = ''; ElMessage.error(error?.message || '配置文件解析失败'); } }; reader.readAsText(file, 'utf-8'); }
async function submitImport() { if (!importConfig.value) return; importing.value = true; try { const result = await importGuidanceConfigPackage(importConfig.value); const parts = [`已导入 ${result.imported.length} 项`, `已跳过 ${result.skipped.length} 项`]; if (result.invalid.length) parts.push(`无效 ${result.invalid.length} 项`); ElMessage.success(parts.join('，')); importDialogVisible.value = false; importConfig.value = null; selectedConfigName.value = ''; await loadData(); } catch (error: any) { ElMessage.error(errorText(error)); } finally { importing.value = false; } }
function confirmSetEnabled(row: AdminGuidanceListItemDto) {
  enableTarget.value = row;
  enableDialogVisible.value = true;
}
async function setGuidanceEnabledState() {
  if (!enableTarget.value) return;
  const enabled = !enableTarget.value.enabled;
  loading.value = true;
  try { await setGuidanceEnabled(enableTarget.value.contentId, enabled); ElMessage.success(enabled ? '内容已启用' : '内容已下线'); enableDialogVisible.value = false; enableTarget.value = null; await loadData(); } catch (error: any) { ElMessage.error(errorText(error)); } finally { loading.value = false; }
}
async function handleCopy(row: AdminGuidanceListItemDto) {
  loading.value = true;
  try { const copied = await copyGuidance(row.contentId); ElMessage.success('已复制为新内容，请继续编辑'); await router.push(`/guidance/${copied.contentId}/edit`); } catch (error: any) { ElMessage.error(errorText(error)); } finally { loading.value = false; }
}
function confirmDelete(row: AdminGuidanceListItemDto) {
  deleteTarget.value = row;
  deleteDialogVisible.value = true;
}
async function deleteGuidanceContent() {
  if (!deleteTarget.value) return;
  loading.value = true;
  try { await deleteGuidance(deleteTarget.value.contentId); ElMessage.success('指导内容已删除'); deleteDialogVisible.value = false; deleteTarget.value = null; await loadData(); } catch (error: any) { ElMessage.error(errorText(error)); } finally { loading.value = false; }
}
onMounted(loadData);
</script>

<style scoped>
.guidance-actions { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
.guidance-actions :deep(.el-button + .el-button) { margin-left: 0; }
.enable-dialog p, .delete-dialog p { margin: 16px 0 8px; color: var(--ink-900); font-weight: 700; }
.delete-dialog small { display: block; color: var(--ink-500); line-height: 1.6; }
.import-dialog { display: grid; gap: 16px; }
.import-upload { padding: 16px; border: 1px dashed rgba(94,126,160,.34); border-radius: 12px; background: rgba(248,251,255,.8); }
.import-dialog__file { margin: 0; color: var(--ink-700); font-size: 13px; font-weight: 700; }
</style>
