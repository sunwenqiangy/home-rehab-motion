<template>
  <div class="app-root">
    <RouterView />
  </div>
</template>

<script setup lang="ts">
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700;800&family=Sora:wght@400;500;600;700;800&display=swap');

:root {
  --brand-950: #081525;
  --brand-900: #0f2038;
  --brand-850: #142946;
  --brand-800: #193657;
  --brand-700: #23517d;
  --brand-600: #2f6798;
  --brand-500: #4fc3f7;
  --brand-400: #79d7ff;
  --brand-300: #b1e8ff;
  --surface-strong: rgba(255, 255, 255, 0.96);
  --surface-soft: rgba(255, 255, 255, 0.72);
  --surface-muted: rgba(255, 255, 255, 0.52);
  --ink-950: #132034;
  --ink-900: #1a2b42;
  --ink-700: #53657d;
  --ink-500: #7990ab;
  --line-soft: rgba(94, 126, 160, 0.18);
  --line-strong: rgba(94, 126, 160, 0.28);
  --success: #33b27b;
  --warning: #f0a63f;
  --danger: #ef6a6a;
  --shadow-soft: 0 18px 55px rgba(15, 40, 79, 0.12);
  --shadow-strong: 0 24px 80px rgba(8, 21, 37, 0.22);
  --radius-xl: 28px;
  --radius-lg: 22px;
  --radius-md: 16px;
  --radius-sm: 12px;
  --el-color-primary: var(--brand-500);
  --el-color-success: var(--success);
  --el-color-warning: var(--warning);
  --el-color-danger: var(--danger);
  --el-border-radius-base: 14px;
  --el-font-family: 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  --el-bg-color: rgba(255, 255, 255, 0.92);
  --el-border-color: rgba(94, 126, 160, 0.24);
  --el-fill-color-light: rgba(233, 242, 249, 0.8);
  --el-fill-color-blank: rgba(255, 255, 255, 0.94);
  --el-text-color-primary: var(--ink-900);
  --el-text-color-regular: var(--ink-700);
  --el-text-color-secondary: var(--ink-500);
}

* {
  box-sizing: border-box;
}

html,
body,
#app,
.app-root {
  min-height: 100%;
}

html {
  background:
    radial-gradient(circle at 15% 20%, rgba(79, 195, 247, 0.18), transparent 28%),
    radial-gradient(circle at 84% 16%, rgba(35, 81, 125, 0.2), transparent 24%),
    linear-gradient(180deg, #edf4fb 0%, #e9f0f7 48%, #eff4f9 100%);
}

body {
  margin: 0;
  font-family: 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  color: var(--ink-900);
  background: transparent;
}

button,
input,
textarea,
select {
  font: inherit;
}

h1,
h2,
h3,
h4,
.display-font,
.metric-value,
.page-hero__title,
.brand-wordmark,
.layout-page-title {
  font-family: 'Sora', 'Noto Sans SC', 'PingFang SC', sans-serif;
}

#app {
  color: var(--ink-900);
}

.admin-page {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.page-hero {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-xl);
  padding: 28px 30px;
  color: #f6fbff;
  background:
    radial-gradient(circle at top right, rgba(121, 215, 255, 0.32), transparent 28%),
    linear-gradient(140deg, #102038 0%, #153150 58%, #1f5878 100%);
  box-shadow: var(--shadow-strong);
}

.page-hero::before,
.page-hero::after {
  content: '';
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
}

.page-hero::before {
  inset: auto -80px -130px auto;
  width: 260px;
  height: 260px;
  background: rgba(79, 195, 247, 0.14);
}

.page-hero::after {
  inset: -120px auto auto -60px;
  width: 220px;
  height: 220px;
  border: 1px solid rgba(177, 232, 255, 0.22);
}

.page-hero__content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.page-hero__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.16);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-hero__title {
  margin: 14px 0 10px;
  font-size: 30px;
  line-height: 1.16;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.page-hero__subtitle {
  max-width: 720px;
  margin: 0;
  color: rgba(240, 248, 255, 0.76);
  font-size: 14px;
  line-height: 1.8;
}

.page-hero__meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 18px;
}

.page-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(246, 251, 255, 0.88);
  font-size: 12px;
  font-weight: 600;
}

.page-pill--light {
  color: var(--ink-900);
  background: rgba(255, 255, 255, 0.86);
  border-color: rgba(255, 255, 255, 0.4);
}

.page-hero__side {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 12px;
  min-width: 230px;
}

.hero-glass-card {
  min-width: 230px;
  padding: 16px 18px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.11);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(16px);
}

.hero-glass-card__label {
  font-size: 12px;
  color: rgba(240, 248, 255, 0.66);
}

.hero-glass-card__value {
  margin-top: 10px;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.hero-glass-card__hint {
  margin-top: 10px;
  font-size: 12px;
  color: rgba(240, 248, 255, 0.66);
}

.metric-grid,
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
}

.metric-card,
.summary-card {
  position: relative;
  overflow: hidden;
  padding: 20px 22px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 251, 255, 0.92));
  border: 1px solid rgba(148, 180, 214, 0.24);
  box-shadow: var(--shadow-soft);
}

.metric-card::after,
.summary-card::after {
  content: '';
  position: absolute;
  inset: auto -26px -42px auto;
  width: 120px;
  height: 120px;
  border-radius: 999px;
  background: rgba(79, 195, 247, 0.08);
}

.metric-card__label,
.summary-card__label {
  color: var(--ink-500);
  font-size: 12px;
  font-weight: 600;
}

.metric-card__value,
.summary-card__value {
  margin-top: 16px;
  font-size: 38px;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--ink-950);
}

.metric-card__foot,
.summary-card__foot {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--ink-700);
}

.metric-card__icon,
.summary-card__icon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-700);
  background: rgba(79, 195, 247, 0.12);
  font-size: 18px;
}

.metric-card__trend--up {
  color: var(--success);
}

.metric-card__trend--warn {
  color: var(--warning);
}

.summary-card__value--sm {
  font-size: 28px;
}

.surface-card {
  overflow: hidden;
  border-radius: 24px !important;
  border: 1px solid rgba(148, 180, 214, 0.24) !important;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 251, 255, 0.9)) !important;
  box-shadow: var(--shadow-soft) !important;
}

.surface-card > .el-card__header {
  padding: 22px 24px 0 !important;
  border-bottom: none !important;
  background: transparent !important;
}

.surface-card > .el-card__body {
  padding: 20px 24px 24px !important;
}

.surface-card--dark {
  background: linear-gradient(180deg, rgba(13, 27, 47, 0.95), rgba(18, 38, 63, 0.92)) !important;
  border-color: rgba(121, 215, 255, 0.16) !important;
  color: #f4fbff;
}

.surface-card--dark > .el-card__header,
.surface-card--dark > .el-card__body {
  color: #f4fbff;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.section-header__title {
  font-size: 18px;
  font-weight: 700;
  color: var(--ink-950);
}

.section-header__subtitle {
  margin-top: 5px;
  color: var(--ink-500);
  font-size: 13px;
}

.pagination-bar,
.pagination-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 18px;
  color: var(--ink-500);
  font-size: 12px;
}

.pagination-bar > span,
.pagination-row__total {
  flex: 0 0 auto;
}

.pagination-bar .el-pagination,
.pagination-row .el-pagination {
  flex: 0 0 auto;
  margin-left: auto;
}

.el-message {
  z-index: 4000 !important;
}

.toolbar-row,
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-row {
  justify-content: space-between;
}

.filter-shell {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(232, 242, 250, 0.74);
  border: 1px solid rgba(148, 180, 214, 0.2);
}

.filter-shell--stacked {
  display: grid;
  gap: 14px;
}

.filter-shell__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-shell__hint {
  color: var(--ink-500);
  font-size: 12px;
}

.table-shell {
  margin-top: 18px;
}

.table-shell .el-table,
.table-shell .el-table__inner-wrapper,
.table-shell .el-table__header-wrapper,
.table-shell .el-table__body-wrapper {
  background: transparent !important;
}

.table-shell .el-table {
  --el-table-border-color: rgba(148, 180, 214, 0.16);
  --el-table-header-bg-color: rgba(229, 239, 248, 0.78);
  --el-table-tr-bg-color: transparent;
  --el-table-row-hover-bg-color: rgba(79, 195, 247, 0.06);
  border-radius: 18px;
  overflow: hidden;
}

.table-shell .el-table th.el-table__cell {
  padding: 14px 12px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-700);
  letter-spacing: 0.02em;
}

.table-shell .el-table td.el-table__cell {
  padding: 16px 12px;
  color: var(--ink-900);
}

.table-shell .el-table .cell {
  line-height: 1.5;
}

.soft-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.soft-tag--info {
  background: rgba(79, 195, 247, 0.12);
  color: var(--brand-700);
}

.soft-tag--success {
  background: rgba(51, 178, 123, 0.14);
  color: var(--success);
}

.soft-tag--warning {
  background: rgba(240, 166, 63, 0.16);
  color: #cf7b00;
}

.soft-tag--danger {
  background: rgba(239, 106, 106, 0.14);
  color: var(--danger);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
}

.info-pair {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid rgba(148, 180, 214, 0.16);
}

.info-pair:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.info-pair__label {
  color: var(--ink-500);
  font-size: 12px;
  font-weight: 600;
}

.info-pair__value {
  text-align: right;
  color: var(--ink-950);
  font-size: 14px;
  font-weight: 700;
}

.info-pair__value--multiline {
  max-width: 70%;
  text-align: left;
  line-height: 1.7;
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.95fr);
  gap: 20px;
}

.form-stack {
  display: grid;
  gap: 20px;
}

.form-panel-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  color: var(--ink-950);
}

.form-panel-subtitle {
  margin: 0 0 18px;
  color: var(--ink-500);
  font-size: 13px;
  line-height: 1.7;
}

.compact-code {
  margin: 0;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(8, 21, 37, 0.92);
  color: #d9f1ff;
  font-size: 12px;
  line-height: 1.7;
  font-family: 'SFMono-Regular', 'SF Mono', Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-note,
.diagnostic-note {
  padding: 22px 20px;
  border-radius: 18px;
  background: rgba(232, 242, 250, 0.72);
  color: var(--ink-700);
  font-size: 13px;
  line-height: 1.8;
}

.diagnostic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.diagnostic-card {
  padding: 18px 18px 16px;
  border-radius: 20px;
  border: 1px solid rgba(148, 180, 214, 0.2);
  background: rgba(248, 251, 255, 0.72);
}

.diagnostic-card__label {
  font-size: 12px;
  color: var(--ink-500);
  font-weight: 600;
}

.diagnostic-card__value {
  margin-top: 12px;
  color: var(--ink-950);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.diagnostic-card__foot {
  margin-top: 10px;
  color: var(--ink-700);
  font-size: 12px;
  line-height: 1.7;
}

.insight-list {
  display: grid;
  gap: 12px;
}

.insight-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(248, 251, 255, 0.72);
  border: 1px solid rgba(148, 180, 214, 0.16);
}

.insight-item__dot {
  width: 10px;
  height: 10px;
  margin-top: 6px;
  border-radius: 999px;
  background: var(--brand-500);
}

.insight-item__content strong {
  display: block;
  color: var(--ink-950);
  font-size: 13px;
}

.insight-item__content span {
  display: block;
  margin-top: 5px;
  color: var(--ink-700);
  font-size: 12px;
  line-height: 1.7;
}

.meta-strip {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.meta-strip__item {
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(248, 251, 255, 0.72);
  border: 1px solid rgba(148, 180, 214, 0.16);
  min-width: 160px;
}

.meta-strip__label {
  color: var(--ink-500);
  font-size: 11px;
  font-weight: 600;
}

.meta-strip__value {
  margin-top: 8px;
  color: var(--ink-950);
  font-size: 16px;
  font-weight: 700;
}

.el-button {
  min-height: 40px;
  border-radius: 14px;
  font-weight: 700;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.el-button:hover {
  transform: translateY(-1px);
}

.el-button--primary {
  box-shadow: 0 14px 30px rgba(79, 195, 247, 0.2);
}

.el-button--primary.is-link {
  box-shadow: none;
}

.el-input__wrapper,
.el-select__wrapper,
.el-textarea__inner {
  border-radius: 16px !important;
  box-shadow: none !important;
}

.el-input__wrapper,
.el-select__wrapper {
  min-height: 46px;
  background: rgba(248, 251, 255, 0.9) !important;
  border: 1px solid rgba(148, 180, 214, 0.24);
}

.el-textarea__inner {
  min-height: 120px;
  padding: 14px 16px;
  background: rgba(248, 251, 255, 0.9) !important;
  border: 1px solid rgba(148, 180, 214, 0.24) !important;
}

.el-dialog {
  border-radius: 24px !important;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.98) !important;
  box-shadow: var(--shadow-strong) !important;
}

.el-dialog__header {
  margin-right: 0 !important;
  padding: 24px 24px 6px !important;
}

.el-dialog__body {
  padding: 18px 24px 20px !important;
}

.el-dialog__footer {
  padding: 0 24px 24px !important;
}

.el-descriptions {
  --el-descriptions-table-border: rgba(148, 180, 214, 0.18);
}

@media (max-width: 1200px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .page-hero {
    padding: 24px 22px;
  }

  .page-hero__title {
    font-size: 24px;
  }

  .metric-grid,
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .surface-card > .el-card__header,
  .surface-card > .el-card__body {
    padding-left: 18px !important;
    padding-right: 18px !important;
  }

  .pagination-bar,
  .pagination-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .pagination-bar .el-pagination,
  .pagination-row .el-pagination {
    margin-left: 0;
  }

  .info-pair {
    flex-direction: column;
  }

  .info-pair__value,
  .info-pair__value--multiline {
    max-width: 100%;
    text-align: left;
  }
}
</style>
