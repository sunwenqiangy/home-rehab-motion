<template>
  <div class="admin-page account-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Account Overview</div>
          <h1 class="page-hero__title">账号管理</h1>
          <p class="page-hero__subtitle">
            查看并维护后台账号、角色权限和状态，支持创建账号、重置密码、启停和删除。
          </p>
          <div class="page-hero__meta">
            <span class="page-pill">当前角色 {{ roleLabel }}</span>
            <span class="page-pill">Token {{ hasToken ? '已登录' : '未登录' }}</span>
          </div>
        </div>
        <div class="page-hero__side">
          <div class="hero-glass-card">
            <div class="hero-glass-card__label">账号总数</div>
            <div class="hero-glass-card__value">{{ accounts.length }}</div>
            <div class="hero-glass-card__hint">含管理员与医护账号</div>
          </div>
        </div>
      </div>
    </section>

    <section class="summary-grid">
      <article class="summary-card">
        <div class="summary-card__label">管理员账号</div>
        <div class="summary-card__value summary-card__value--sm">{{ adminCount }}</div>
        <div class="summary-card__foot">
          <span>具备完整后台管理权限</span>
          <span class="summary-card__icon"><el-icon><UserFilled /></el-icon></span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">医护账号</div>
        <div class="summary-card__value summary-card__value--sm">{{ nurseCount }}</div>
        <div class="summary-card__foot">
          <span>聚焦视频查看与反馈回复</span>
          <span class="summary-card__icon"><el-icon><User /></el-icon></span>
        </div>
      </article>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">账号列表</div>
            <div class="section-header__subtitle">支持创建、修改角色与状态、重置密码和删除。</div>
          </div>
          <div class="toolbar-group">
            <el-button @click="openCreateDialog">新建账号</el-button>
            <el-button type="primary" @click="loadData" :loading="loading">刷新</el-button>
          </div>
        </div>
      </template>

      <div class="meta-strip" style="margin-bottom: 18px;">
        <div class="meta-strip__item">
          <div class="meta-strip__label">当前登录角色</div>
          <div class="meta-strip__value">{{ roleLabel }}</div>
        </div>
        <div class="meta-strip__item">
          <div class="meta-strip__label">Token 状态</div>
          <div class="meta-strip__value">{{ hasToken ? '已登录' : '未登录' }}</div>
        </div>
      </div>

      <div class="table-shell" v-loading="loading">
        <el-table :data="accounts" stripe style="width: 100%">
          <el-table-column prop="accountId" label="ID" width="88" />
          <el-table-column prop="username" label="用户名" min-width="160" />
          <el-table-column prop="displayName" label="显示名" min-width="140">
            <template #default="{ row }">{{ row.displayName || '-' }}</template>
          </el-table-column>
          <el-table-column prop="role" label="角色" width="120">
            <template #default="{ row }">
              <span class="soft-tag" :class="row.role === 'admin' ? 'soft-tag--success' : 'soft-tag--info'">
                {{ row.role === 'admin' ? '管理员' : row.role === 'nurse' ? '医护' : row.role }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <span class="soft-tag" :class="row.status === 1 ? 'soft-tag--success' : 'soft-tag--danger'">
                {{ row.status === 1 ? '启用' : '禁用' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="创建时间" min-width="180" />
          <el-table-column label="操作" min-width="320" fixed="right">
            <template #default="{ row }">
              <div class="toolbar-group">
                <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
                <el-button link type="primary" @click="openResetPasswordDialog(row)">重置密码</el-button>
                <el-button link type="danger" @click="onDeleteAccount(row)">删除</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <el-dialog v-model="createDialogVisible" title="新建账号" width="520px">
      <el-form :model="createForm" label-position="top">
        <el-form-item label="用户名">
          <el-input v-model="createForm.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="createForm.displayName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="createForm.role" style="width: 100%">
            <el-option label="管理员" value="admin" />
            <el-option label="医护" value="nurse" />
          </el-select>
        </el-form-item>
        <el-form-item label="初始密码">
          <el-input v-model="createForm.password" show-password placeholder="至少 6 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onCreateAccount">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDialogVisible" title="编辑账号" width="520px">
      <el-form :model="editForm" label-position="top">
        <el-form-item label="用户名">
          <el-input :model-value="editTarget?.username || ''" disabled />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="editForm.displayName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editForm.role" style="width: 100%">
            <el-option label="管理员" value="admin" />
            <el-option label="医护" value="nurse" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="editForm.status" style="width: 100%">
            <el-option label="启用" :value="1" />
            <el-option label="禁用" :value="0" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onUpdateAccount">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetPasswordDialogVisible" title="重置密码" width="460px">
      <el-form :model="resetPasswordForm" label-position="top">
        <el-form-item label="目标账号">
          <el-input :model-value="resetPasswordTarget?.username || ''" disabled />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="resetPasswordForm.password" show-password placeholder="至少 6 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetPasswordDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onResetPassword">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { User, UserFilled } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  createAccount,
  deleteAccount,
  getAccountList,
  resetAccountPassword,
  updateAccount,
  type AccountItem,
} from '@/services/account';

const accounts = ref<AccountItem[]>([]);
const loading = ref(false);
const submitting = ref(false);

const createDialogVisible = ref(false);
const editDialogVisible = ref(false);
const resetPasswordDialogVisible = ref(false);

const editTarget = ref<AccountItem | null>(null);
const resetPasswordTarget = ref<AccountItem | null>(null);

const createForm = reactive({
  username: '',
  displayName: '',
  role: 'nurse' as 'admin' | 'nurse',
  password: '',
});

const editForm = reactive({
  displayName: '',
  role: 'nurse' as 'admin' | 'nurse',
  status: 1 as 0 | 1,
});

const resetPasswordForm = reactive({
  password: '',
});

const roleLabel = computed(() => {
  const role = localStorage.getItem('admin_role');
  return role === 'admin' ? '管理员' : role === 'nurse' ? '医护' : '未知';
});

const hasToken = computed(() => !!localStorage.getItem('admin_token'));
const adminCount = computed(() => accounts.value.filter((item) => item.role === 'admin').length);
const nurseCount = computed(() => accounts.value.filter((item) => item.role === 'nurse').length);

function resetCreateForm() {
  createForm.username = '';
  createForm.displayName = '';
  createForm.role = 'nurse';
  createForm.password = '';
}

async function loadData() {
  loading.value = true;
  try {
    accounts.value = await getAccountList();
  } catch {
    accounts.value = [];
  } finally {
    loading.value = false;
  }
}

function openCreateDialog() {
  resetCreateForm();
  createDialogVisible.value = true;
}

function openEditDialog(item: AccountItem) {
  editTarget.value = item;
  editForm.displayName = item.displayName || '';
  editForm.role = item.role === 'admin' ? 'admin' : 'nurse';
  editForm.status = item.status;
  editDialogVisible.value = true;
}

function openResetPasswordDialog(item: AccountItem) {
  resetPasswordTarget.value = item;
  resetPasswordForm.password = '';
  resetPasswordDialogVisible.value = true;
}

async function onCreateAccount() {
  const username = createForm.username.trim();
  if (!username) {
    ElMessage.warning('请输入用户名');
    return;
  }
  if (createForm.password.length < 6) {
    ElMessage.warning('密码长度至少 6 位');
    return;
  }

  submitting.value = true;
  try {
    await createAccount({
      username,
      displayName: createForm.displayName.trim() || undefined,
      role: createForm.role,
      password: createForm.password,
    });
    ElMessage.success('账号创建成功');
    createDialogVisible.value = false;
    await loadData();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '账号创建失败');
  } finally {
    submitting.value = false;
  }
}

async function onUpdateAccount() {
  if (!editTarget.value) {
    return;
  }

  submitting.value = true;
  try {
    await updateAccount(editTarget.value.accountId, {
      role: editForm.role,
      status: editForm.status,
      displayName: editForm.displayName.trim() || undefined,
    });
    ElMessage.success('账号更新成功');
    editDialogVisible.value = false;
    await loadData();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '账号更新失败');
  } finally {
    submitting.value = false;
  }
}

async function onResetPassword() {
  if (!resetPasswordTarget.value) {
    return;
  }
  if (resetPasswordForm.password.length < 6) {
    ElMessage.warning('密码长度至少 6 位');
    return;
  }

  submitting.value = true;
  try {
    await resetAccountPassword(resetPasswordTarget.value.accountId, resetPasswordForm.password);
    ElMessage.success('密码重置成功');
    resetPasswordDialogVisible.value = false;
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '密码重置失败');
  } finally {
    submitting.value = false;
  }
}

async function onDeleteAccount(item: AccountItem) {
  try {
    await ElMessageBox.confirm(
      `确认删除账号「${item.username}」吗？该操作不可撤销。`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    );

    submitting.value = true;
    await deleteAccount(item.accountId);
    ElMessage.success('账号删除成功');
    await loadData();
  } catch (err: any) {
    if (err !== 'cancel') {
      ElMessage.error(err?.response?.data?.message || '账号删除失败');
    }
  } finally {
    submitting.value = false;
  }
}

onMounted(loadData);
</script>
