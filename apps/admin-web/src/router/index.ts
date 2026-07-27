import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';
import { setupRouterGuard } from './guard';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/',
    component: () => import('@/layouts/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/pages/DashboardPage.vue'),
        meta: { title: '工作台' },
      },
      {
        path: 'users',
        name: 'patient-list',
        component: () => import('@/pages/PatientListPage.vue'),
        meta: { title: '患者管理' },
      },
      {
        path: 'users/:patientId',
        name: 'patient-detail',
        component: () => import('@/pages/PatientDetailPage.vue'),
        meta: { title: '患者详情' },
      },
      {
        path: 'videos',
        name: 'video-list',
        component: () => import('@/pages/VideoListPage.vue'),
        meta: { title: '视频记录' },
      },
      {
        path: 'videos/:videoId',
        name: 'video-detail',
        component: () => import('@/pages/VideoDetailPage.vue'),
        meta: { title: '视频详情' },
      },
      {
        path: 'flow-verify',
        name: 'flow-verify',
        component: () => import('@/pages/FlowVerifyPage.vue'),
        meta: { title: '流程验证' },
      },
      {
        path: 'guidance',
        name: 'guidance-list',
        component: () => import('@/pages/GuidanceListPage.vue'),
        meta: { title: '指导内容管理' },
      },
      {
        path: 'guidance/create',
        name: 'guidance-create',
        component: () => import('@/pages/GuidanceEditPage.vue'),
        meta: { title: '新建指导内容' },
      },
      {
        path: 'guidance/:id/edit',
        name: 'guidance-edit',
        component: () => import('@/pages/GuidanceEditPage.vue'),
        meta: { title: '编辑指导内容' },
      },
      {
        path: 'feedback',
        name: 'feedback-list',
        component: () => import('@/pages/FeedbackListPage.vue'),
        meta: { title: '反馈管理' },
      },
      {
        path: 'feedback/:feedbackId',
        name: 'feedback-detail',
        component: () => import('@/pages/FeedbackDetailPage.vue'),
        meta: { title: '工单详情' },
      },
      {
        path: 'thresholds',
        name: 'thresholds',
        component: () => import('@/pages/ThresholdPage.vue'),
        meta: { title: '阈值参数管理' },
      },
      {
        path: 'gold-templates',
        name: 'gold-templates',
        component: () => import('@/pages/GoldTemplatePage.vue'),
        meta: { title: '金标准管理' },
      },
      {
        path: 'motivation-rules',
        name: 'motivation-rules',
        component: () => import('@/pages/MotivationRulesPage.vue'),
        meta: { title: '激励规则配置' },
      },
      {
        path: 'patient-config',
        name: 'patient-config',
        component: () => import('@/pages/PatientConfigPage.vue'),
        meta: { title: '患者应用配置' },
      },
      {
        path: 'accounts',
        name: 'accounts',
        component: () => import('@/pages/AccountPage.vue'),
        meta: { title: '账号管理' },
      },
    ],
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

setupRouterGuard(router);

export default router;
