<template>
  <div class="admin-page guidance-list-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Content Library</div>
          <h1 class="page-hero__title">指导内容管理</h1>
          <p class="page-hero__subtitle">保存后立即更新患者端内容，请确认信息完整无误。</p>
          <div class="page-hero__meta">
            <span class="page-pill">当前内容 {{ list.length }} 条</span>
            <span class="page-pill">直接保存 · 患者即时可见</span>
          </div>
        </div>
      </div>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">指导内容列表</div>
            <div class="section-header__subtitle">新建和修改均会直接上线，无草稿和版本切换流程。</div>
          </div>
          <div class="toolbar-group">
            <el-button :loading="loading" @click="loadData">刷新</el-button>
            <el-button type="primary" @click="router.push('/guidance/create')">新建指导内容</el-button>
          </div>
        </div>
      </template>

      <div v-loading="loading" class="table-shell">
        <el-table :data="list" stripe>
          <el-table-column prop="contentId" label="ID" width="76" />
          <el-table-column prop="actionType" label="动作类型" min-width="150">
            <template #default="{ row }">
              {{ actionTypeLabel(row.actionType) }}
            </template>
          </el-table-column>
          <el-table-column prop="title" label="标题" min-width="240" />
          <el-table-column prop="updatedAt" label="最近上线更新" min-width="180">
            <template #default="{ row }">
              {{ formatDate(row.updatedAt) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <div class="guidance-actions">
                <el-button type="primary" link @click="router.push(`/guidance/${row.contentId}/edit`)">
                  编辑
                </el-button>
                <el-popconfirm
                  title="确认永久删除该指导内容吗？患者端将无法再查看。"
                  confirm-button-text="确认删除"
                  cancel-button-text="取消"
                  @confirm="handleDelete(row)"
                >
                  <template #reference>
                    <el-button type="danger" link>删除</el-button>
                  </template>
                </el-popconfirm>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { deleteGuidance, getGuidanceList } from '@/services/guidance';
import type { AdminGuidanceListItemDto } from '@home-rehab-motion/shared-contract';
import type { TrainingActionType } from '@home-rehab-motion/shared-types';

const router = useRouter();
const list = ref<AdminGuidanceListItemDto[]>([]);
const loading = ref(false);

function actionTypeLabel(type: TrainingActionType) {
  return ({
    abdominal_crunch: '缩腹运动',
    pelvic_tilt: '骨盆倾斜',
    knee_rotation: '膝关节旋转',
  } as Record<string, string>)[type] || type;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

async function loadData() {
  loading.value = true;
  try {
    list.value = await getGuidanceList();
  } catch {
    ElMessage.error('获取指导内容失败');
  } finally {
    loading.value = false;
  }
}

async function handleDelete(row: AdminGuidanceListItemDto) {
  loading.value = true;
  try {
    await deleteGuidance(row.contentId);
    ElMessage.success('指导内容已删除');
    await loadData();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '删除失败，请稍后重试');
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>

<style scoped>
.guidance-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.guidance-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
