<template>
  <div class="admin-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Patient Directory</div>
          <h1 class="page-hero__title">患者管理</h1>
          <p class="page-hero__subtitle">集中查看患者基本资料、训练参与度与最近评估表现，快速进入患者档案进行连续跟进。</p>
          <div class="page-hero__meta">
            <span class="page-pill">已归档 {{ overview.totalPatientCount }} 位患者</span>
            <span class="page-pill">当前页 {{ patients.length }} 位</span>
          </div>
        </div>
        <div class="page-hero__side">
          <div class="hero-glass-card">
            <div class="hero-glass-card__label">重点跟进</div>
            <div class="hero-glass-card__value">{{ overview.followUpPatientCount }}</div>
            <div class="hero-glass-card__hint">按最近一次已完成训练的评级判定</div>
          </div>
        </div>
      </div>
    </section>

    <section class="summary-grid">
      <article class="summary-card">
        <div class="summary-card__label">患者总数</div>
        <div class="summary-card__value summary-card__value--sm">{{ overview.totalPatientCount }}</div>
        <div class="summary-card__foot"><span>已注册患者档案</span><span class="summary-card__icon"><el-icon><UserFilled /></el-icon></span></div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">活跃训练患者</div>
        <div class="summary-card__value summary-card__value--sm">{{ overview.activeTrainingPatientCount }}</div>
        <div class="summary-card__foot"><span>最近 7 天上传训练超过 3 次</span><span class="summary-card__icon"><el-icon><VideoCamera /></el-icon></span></div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">重点跟进</div>
        <div class="summary-card__value summary-card__value--sm">{{ overview.followUpPatientCount }}</div>
        <div class="summary-card__foot"><span>最近评级为“需改进”或“无效”</span><span class="summary-card__icon"><el-icon><TrendCharts /></el-icon></span></div>
      </article>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">患者列表</div>
            <div class="section-header__subtitle">可按姓名、患者编号或微信标识检索；查看档案后可继续查看关联训练视频。</div>
          </div>
          <el-button type="primary" :loading="loading" @click="loadPatients">刷新数据</el-button>
        </div>
      </template>

      <div class="filter-shell">
        <el-input v-model="keywordInput" clearable placeholder="搜索姓名、患者编号或微信标识" style="width: min(420px, 100%)" @keyup.enter="searchPatients" />
        <el-button type="primary" @click="searchPatients">搜索</el-button>
        <el-button @click="resetSearch">重置</el-button>
      </div>

      <div class="table-shell" v-loading="loading">
        <el-table :data="patients" stripe style="width: 100%" empty-text="暂未找到患者数据">
          <el-table-column label="患者" min-width="190">
            <template #default="{ row }">
              <div class="patient-cell">
                <span class="patient-avatar">{{ row.name.slice(0, 1) }}</span>
                <div><strong>{{ row.name }}</strong><small>ID #{{ row.patientId }}</small></div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="基础信息" min-width="130">
            <template #default="{ row }">{{ row.gender }}<span v-if="row.age"> · {{ row.age }} 岁</span></template>
          </el-table-column>
          <el-table-column prop="registeredAt" label="注册时间" min-width="165">
            <template #default="{ row }">{{ formatDate(row.registeredAt) }}</template>
          </el-table-column>
          <el-table-column prop="totalTrainingCount" label="训练次数" width="110" />
          <el-table-column label="最近训练" min-width="165">
            <template #default="{ row }">{{ row.latestTrainingAt ? formatDate(row.latestTrainingAt) : '暂无训练' }}</template>
          </el-table-column>
          <el-table-column label="最近评分" min-width="130">
            <template #default="{ row }"><span v-if="row.latestGrade" class="soft-tag" :class="gradeClass(row.latestGrade)">{{ row.latestGrade }} {{ row.averageScore ?? '-' }}</span><span v-else>—</span></template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }"><el-button type="primary" link @click="router.push(`/users/${row.patientId}`)">查看档案</el-button></template>
          </el-table-column>
        </el-table>
      </div>

      <div class="pagination-row">
        <span class="pagination-row__total">共 {{ total }} 条</span>
        <el-pagination
          :current-page="page"
          :page-size="limit"
          :page-sizes="[10, 20, 50]"
          :total="total"
          :pager-count="5"
          small
          background
          layout="sizes, prev, pager, next"
          @current-change="handlePageChange"
          @size-change="handlePageSizeChange"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { TrendCharts, UserFilled, VideoCamera } from '@element-plus/icons-vue';
import { getAdminPatientList, type PatientListItem } from '@/services/patient';
import { ElMessage } from 'element-plus';

const router = useRouter();
const patients = ref<PatientListItem[]>([]);
const total = ref(0);
const overview = ref({ totalPatientCount: 0, activeTrainingPatientCount: 0, followUpPatientCount: 0 });
const page = ref(1);
const limit = ref(10);
const loading = ref(false);
const keywordInput = ref('');
const keyword = ref('');

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function gradeClass(grade: string) {
  if (grade === '优秀') return 'soft-tag--success';
  if (grade === '合格') return 'soft-tag--info';
  if (grade === '需改进') return 'soft-tag--warning';
  return 'soft-tag--danger';
}

function searchPatients() {
  page.value = 1;
  keyword.value = keywordInput.value.trim();
  loadPatients();
}

function resetSearch() {
  keywordInput.value = '';
  keyword.value = '';
  page.value = 1;
  loadPatients();
}

function handlePageChange(nextPage: number) {
  page.value = nextPage;
  loadPatients();
}

function handlePageSizeChange(nextLimit: number) {
  limit.value = nextLimit;
  page.value = 1;
  loadPatients();
}

async function loadPatients(nextPage = page.value) {
  page.value = nextPage;
  loading.value = true;
  try {
    const response = await getAdminPatientList({ keyword: keyword.value || undefined, page: page.value, limit: limit.value });
    patients.value = response.items;
    total.value = response.total;
    overview.value = response.overview;
    // 以服务端归一化后的页码为准，避免筛选后页码超出范围。
    page.value = response.page;
    limit.value = response.limit;
  } catch (error: any) {
    patients.value = [];
    total.value = 0;
    ElMessage.error(error?.response?.data?.message || '加载患者列表失败');
  } finally {
    loading.value = false;
  }
}

onMounted(loadPatients);
</script>

<style scoped>
.patient-cell { display: flex; align-items: center; gap: 10px; }
.patient-avatar { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border-radius: 12px; background: rgba(79, 195, 247, .14); color: var(--brand-700); font-weight: 800; }
.patient-cell strong, .patient-cell small { display: block; }
.patient-cell small { margin-top: 3px; color: var(--ink-500); font-size: 11px; }
.pagination-row { min-width: 0; }
.pagination-row :deep(.el-pagination) { display: inline-flex; flex-wrap: nowrap; min-width: 0; white-space: nowrap; }
.pagination-row :deep(.el-pagination button),
.pagination-row :deep(.el-pagination .el-pager li) { min-width: 28px; min-height: 28px; height: 28px; margin: 0 2px; line-height: 28px; }
@media (max-width: 640px) { .pagination-row { justify-content: space-between; gap: 8px; }.pagination-row :deep(.el-pagination .el-pager li:not(.is-active)) { display: none; } }
</style>
