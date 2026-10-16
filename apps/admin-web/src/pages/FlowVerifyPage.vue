<template>
  <div class="admin-page flow-verify-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Flow Verification</div>
          <h1 class="page-hero__title">上传 + 分析 + 结果验证</h1>
          <p class="page-hero__subtitle">
            该页面用于快速验证完整主链路：患者登录、视频上传、创建分析任务、状态轮询、报告结果展示。
          </p>
          <div class="page-hero__meta">
            <span class="page-pill">当前状态：{{ statusLabel(currentStatus) }}</span>
            <span class="page-pill" v-if="currentVideoId">视频ID：{{ currentVideoId }}</span>
            <span class="page-pill" v-if="polling">轮询中（{{ pollCount }}）</span>
            <span class="page-pill" v-if="analysisDetailReady">评分明细已加载</span>
          </div>
        </div>
      </div>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">验证参数</div>
            <div class="section-header__subtitle">选择动作和视频，点击开始后自动执行全流程。</div>
          </div>
        </div>
      </template>

      <div class="verify-form-grid">
        <div class="verify-form-item">
          <label class="verify-form-item__label">动作类型</label>
          <el-select v-model="actionType" style="width: 100%">
            <el-option v-for="item in actionOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </div>

        <div class="verify-form-item verify-form-item--file">
          <label class="verify-form-item__label">训练视频</label>
          <input class="verify-file-input" type="file" accept="video/*" @change="onFileChange" />
          <div class="verify-file-tip" v-if="selectedFileName">
            已选择：{{ selectedFileName }}
            <span v-if="selectedFileSizeLabel">（{{ selectedFileSizeLabel }}）</span>
            <span v-if="videoDurationSeconds">，时长约 {{ videoDurationSeconds }} 秒</span>
          </div>
          <div class="verify-file-tip verify-file-tip--warn" v-else>
            请先选择一个本地视频文件。
          </div>
        </div>
      </div>

      <div class="toolbar-group verify-toolbar">
        <el-button type="primary" :loading="running" @click="startVerification">开始验证流程</el-button>
        <el-button :disabled="!currentVideoId || running" @click="refreshStatus">刷新状态</el-button>
        <el-button :disabled="!polling" @click="stopPolling">停止轮询</el-button>
        <el-button :disabled="running" @click="resetState">重置</el-button>
      </div>

      <div class="verify-error" v-if="errorText">{{ errorText }}</div>
    </el-card>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">视频预览</div>
            <div class="section-header__subtitle">同时查看本地上传视频和服务端落库视频，确认上传内容是否一致。</div>
          </div>
          <div class="section-header__actions" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
            <el-tag size="small" type="info">本页可直接看纯骨架，也可跳详情页复核</el-tag>
            <el-button size="small" :disabled="!currentVideoId" @click="goToVideoDetail">
              前往视频详情页
            </el-button>
          </div>
        </div>
      </template>

      <div class="preview-grid">
        <div class="preview-card">
          <div class="preview-card__title">上传前（本地文件）</div>
          <video
            v-if="localPreviewUrl"
            class="preview-card__video"
            :src="localPreviewUrl"
            controls
            playsinline
            preload="metadata"
          ></video>
          <div v-else class="empty-state">请选择视频后可预览本地文件。</div>
        </div>
        <div class="preview-card">
          <div class="preview-card__title">上传后（服务端文件）</div>
          <video
            v-if="uploadedVideoPreviewUrl"
            class="preview-card__video"
            :src="uploadedVideoPreviewUrl"
            controls
            playsinline
            preload="metadata"
          ></video>
          <div v-else class="empty-state">分析完成后会显示服务端视频预览。</div>
        </div>
      </div>

      <div class="skeleton-inline">
        <div class="skeleton-inline__header">
          <div class="skeleton-inline__title">骨架分析对比（可切换“纯骨架”）</div>
          <el-button
            size="small"
            :disabled="!currentVideoId"
            :loading="keypointsLoading"
            @click="loadKeypointsForCurrentVideo()"
          >
            {{ keypointsData ? '重新加载骨架数据' : '加载骨架数据' }}
          </el-button>
        </div>

        <SkeletonOverlay
          v-if="uploadedVideoPreviewUrl && keypointsData && keypointsData.total_frames > 0"
          :videoUrl="uploadedVideoPreviewUrl"
          :keypointsData="keypointsData"
          :summaryTotalReps="analysisDetail?.summary?.totalReps ?? 0"
          :summaryValidReps="analysisDetail?.summary?.validReps ?? 0"
          :actionType="actionType"
        />

        <el-alert
          v-else-if="keypointsData && keypointsData.total_frames === 0"
          type="warning"
          :closable="false"
          :title="keypointsData.message || '当前视频暂无关键点数据'"
        />

        <el-empty
          v-else
          description="完成分析后点击“加载骨架数据”，然后在组件里点“纯骨架”即可"
          :image-size="72"
        />
      </div>
    </el-card>

    <section class="summary-grid">
      <article class="summary-card">
        <div class="summary-card__label">样本来源</div>
        <div class="summary-card__value summary-card__value--sm">内部验证</div>
        <div class="summary-card__foot">
          <span>不会计入患者训练记录与统计</span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">任务状态</div>
        <div class="summary-card__value summary-card__value--sm">{{ statusLabel(currentStatus) }}</div>
        <div class="summary-card__foot">
          <span>reportReady：{{ reportReady ? 'true' : 'false' }}</span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">分析结果</div>
        <div class="summary-card__value summary-card__value--sm">{{ analysisDetail?.summary?.grade || '-' }}</div>
        <div class="summary-card__foot">
          <span>平均分：{{ analysisDetail?.summary?.averageScore ?? '-' }}</span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">识别可信度</div>
        <div class="summary-card__value summary-card__value--sm">{{ analysisDetail?.summary?.confidenceScore ?? '-' }}</div>
        <div class="summary-card__foot">
          <span>准确性判断：{{ accuracyHint }}</span>
        </div>
      </article>
    </section>

    <div class="verify-grid">
      <el-card class="surface-card" shadow="never">
        <template #header>
          <div class="section-header">
            <div>
              <div class="section-header__title">评分与识别明细</div>
              <div class="section-header__subtitle">用于判断当前评分依据、识别出的动作特征和准确性参考。</div>
            </div>
          </div>
        </template>

        <div v-if="analysisDetail" class="analysis-panel">
          <el-alert
            v-if="analysisTerminalIssue"
            :type="analysisTerminalIssue.type"
            :closable="false"
            :title="analysisTerminalIssue.title"
            :description="analysisTerminalIssue.description"
          />
          <div v-if="analysisDetail.summary" class="analysis-explain">
            <div class="analysis-explain__title">评分规则（当前服务配置）</div>
            <div v-if="kneeBilateralDiagnostics?.mode === 'bilateral'" class="analysis-explain__line">
              双侧闭环评分：可见幅度 8 分、双侧均衡 5 分、到位保持 4 分、节奏 3 分，基分 72，最高 94。此分数只反映视频中可观察的练习，不判断康复效果。
            </div>
            <div v-else class="analysis-explain__line">
              四维权重：准确度 {{ analysisDetail.scoringExplain.weights.accuracy }}，稳定性 {{ analysisDetail.scoringExplain.weights.stability }}，
              控制度 {{ analysisDetail.scoringExplain.weights.control }}，持续度 {{ analysisDetail.scoringExplain.weights.duration }}
            </div>
            <div v-if="kneeBilateralDiagnostics?.mode !== 'bilateral'" class="analysis-explain__line">
              分级区间：
              <span v-for="item in analysisDetail.scoringExplain.gradeRanges" :key="item.grade" class="analysis-chip">
                {{ item.grade }} {{ item.min }}-{{ item.max }}
              </span>
            </div>
          <div v-if="kneeBilateralDiagnostics?.mode !== 'bilateral'" class="analysis-explain__line">{{ analysisDetail.scoringExplain.scoringHint }}</div>
          <div class="analysis-explain__line analysis-explain__line--pure-skeleton">
            说明：本页面用于流程验证，若要看“纯骨架/骨架+视频”切换，请点上方“前往视频详情看纯骨架”。
          </div>
        </div>


          <div v-if="!analysisDetail.summary" class="analysis-note">
            本次未生成评分。请优先查看上方服务端视频和问题提示：质量不足通常与拍摄取景、遮挡或关键点识别有关；分析失败则需结合流程日志和任务状态排查。
          </div>

          <section v-if="segmentationDiagnostics" class="segmentation-panel">
            <div class="segmentation-panel__header">
              <div>
                <div class="analysis-section-title">缩腹切分对照</div>
                <div class="segmentation-panel__subtitle">同一视频比较三种切分。下表把“切出了几次”和“按什么规则评分”分开；仅正式结果写入本次流程验证报告。</div>
              </div>
              <el-tag :type="segmentationModeTagType">{{ segmentationModeLabel }}</el-tag>
            </div>

            <div class="segmentation-comparison">
              <div class="segmentation-comparison__head"><span>切分方式</span><span>识别次数</span><span>姿态模板分</span><span>视觉规则分</span><span>用途</span></div>
              <div v-for="row in segmentationComparisonRows" :key="row.key" class="segmentation-comparison__row">
                <div class="segmentation-comparison__name">{{ row.name }}<small>{{ row.detail }}</small></div>
                <strong>{{ row.count }}</strong>
                <div class="segmentation-comparison__score" data-label="姿态模板分">{{ row.poseScore }}<small>{{ row.poseScoreHint }}</small></div>
                <div class="segmentation-comparison__score" data-label="视觉规则分">{{ row.visualScore }}<small>{{ row.visualScoreHint }}</small></div>
                <el-tag :type="row.formal ? 'success' : 'info'" size="small">{{ row.formal ? '本次正式' : '仅供对比' }}</el-tag>
              </div>
            </div>

            <div class="segmentation-panel__subtitle">姿态模板分使用关键点特征；视觉规则分使用腹部轮廓的完整周期、保持、回位与节奏。轮廓行的“姿态模板分”只是把轮廓切出的边界交给姿态模板试算，不是第四种切分，也不与视觉规则分直接比较。</div>
            <div class="segmentation-panel__subtitle">本次正式切分版本：{{ segmentationDiagnostics.formalVersion || '-' }}。配置切换仅影响新分析，历史结果不会自动重算。实际抽帧率 {{ formatFps(segmentationDiagnostics.effectiveSampleFps) }}；影子切分额外耗时 {{ formatMilliseconds(segmentationDiagnostics.shadowOverheadMs) }}（含轮廓提取，不含评分试算）。</div>

            <el-alert
              v-if="segmentationDiagnostics.mode === 'shadow'"
              type="info"
              :closable="false"
              title="本次后台验证仍使用姿态峰值正式计次和评分。视觉规则分只在本页试算；小程序新上传的缩腹短片段按其自身配置选择口径。"
            />

            <el-alert
              v-if="segmentationDiagnostics.scoringContract?.compatible === false"
              type="warning"
              :closable="false"
              title="当前缩腹模板与评分特征口径不一致"
              description="当前计算器使用角度（deg、deg/s），模板可能仍是旧百分比口径。正式分数及下方试算仅供排查；请用同版本金标准重新生成模板并复核后再比较。"
            />

            <div v-if="segmentationDiagnostics.mode === 'shadow'" class="segmentation-candidate-group">
              <div class="segmentation-candidate-group__title">方式 C · 腹部轮廓｜完整周期与边界（试运行）</div>
              <div v-if="!segmentationDiagnostics.visualObservable" class="empty-state">
                {{ segmentationDiagnostics.visualUnavailableReason || '本次未运行视觉诊断；旧流程验证记录需重新上传分析。' }}
              </div>
              <template v-else>
                <div class="segmentation-panel__subtitle">画面轮廓有效帧 {{ Math.round((segmentationDiagnostics.visualValidRatio ?? 0) * 100) }}%；顶点指腹部隆起最高的平台。轮廓幅度为相对身体尺度的比例，不是角度或评分。</div>
                <div v-if="segmentationDiagnostics.visualAcceptedCycles.length" class="analysis-table-wrap">
                  <table class="analysis-table">
                    <thead><tr><th>候选</th><th>开始</th><th>隆起顶点</th><th>顶点平台</th><th>回落</th><th>轮廓幅度</th></tr></thead>
                    <tbody>
                      <tr v-for="(item, index) in segmentationDiagnostics.visualAcceptedCycles" :key="`visual-${index}`">
                        <td>第 {{ index + 1 }} 次</td>
                        <td>{{ formatVideoTime(item.startTime) }}</td>
                        <td>{{ formatVideoTime(item.peakTime) }}</td>
                        <td>{{ formatVideoTime(item.peakStartTime) }}–{{ formatVideoTime(item.peakEndTime) }}</td>
                        <td>{{ formatVideoTime(item.returnTime) }}</td>
                        <td>{{ formatAmplitude(item.amplitude) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-else class="empty-state">腹壁轮廓可见，但未找到完成隆起和回落的周期；不能据此认定患者没有练习。</div>
                <div v-if="segmentationDiagnostics.visualRejectedCandidates.length" class="segmentation-candidate-group">
                  <div class="segmentation-candidate-group__title">方式 C · 未计入的轮廓候选（{{ segmentationDiagnostics.visualRejectedCandidates.length }}）</div>
                  <div class="analysis-table-wrap">
                    <table class="analysis-table">
                      <thead><tr><th>开始</th><th>隆起顶点</th><th>回落</th><th>未计入原因</th></tr></thead>
                      <tbody>
                        <tr v-for="(item, index) in segmentationDiagnostics.visualRejectedCandidates" :key="`visual-rejected-${index}`">
                          <td>{{ formatVideoTime(item.startTime) }}</td>
                          <td>{{ formatVideoTime(item.peakTime) }}</td>
                          <td>{{ formatVideoTime(item.returnTime) }}</td>
                          <td class="segmentation-reason">{{ item.reason || '未满足完整周期条件' }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </template>
            </div>

            <div v-if="segmentationDiagnostics.mode === 'shadow'" class="segmentation-candidate-group">
              <div class="segmentation-candidate-group__title">方式 C · 腹部轮廓按视觉规则评分（试算）</div>
              <div class="segmentation-panel__subtitle">使用上方同一批完整周期，按顶部保持、回位与节奏评分；不套用姿态模板，不写入本次后台正式报告。</div>
              <div v-if="segmentationDiagnostics.visualEvidencePreview?.score_available" class="segmentation-score-summary">
                <strong>平均 {{ segmentationDiagnostics.visualEvidencePreview.average_score }} 分</strong>
                <span>各周期：{{ segmentationDiagnostics.visualEvidencePreview.rep_scores?.map((score, index) => `第 ${index + 1} 次 ${score} 分`).join(' · ') || '暂无明细' }}</span>
              </div>
              <div v-else class="empty-state">{{ segmentationDiagnostics.visualEvidencePreview?.reason || '本次未试算视觉规则分；旧记录请重新验证。' }}</div>
            </div>

            <div v-if="segmentationDiagnostics.visualScorePreview" class="segmentation-candidate-group">
              <div class="segmentation-candidate-group__title">方式 C · 轮廓周期按姿态模板评分（交叉诊断）</div>
              <div class="segmentation-panel__subtitle">
                周期边界仍由腹部轮廓切出，仅评分时使用姿态关键点与模板；用于检查“换一套边界”对姿态分的影响。这不是小程序采用的视觉规则分，也不是新的切分方式。
                <span v-if="segmentationDiagnostics.visualScorePreview.score_status === 'unavailable'">试算未完成：{{ segmentationDiagnostics.visualScorePreview.reason || '请查看分析日志' }}。</span>
                <span v-else-if="!segmentationDiagnostics.visualScorePreview.template_comparable">模板口径不兼容，两组分数不能作为动作质量结论。</span>
              </div>
              <div v-if="segmentationDiagnostics.visualScorePreview.template_comparable && segmentationDiagnostics.visualScorePreview.reps?.length" class="analysis-table-wrap">
                <table class="analysis-table">
                  <thead><tr><th>视觉周期</th><th>边界</th><th>试算分</th><th>准确</th><th>稳定</th><th>控制</th><th>持续</th></tr></thead>
                  <tbody>
                    <tr v-for="item in segmentationDiagnostics.visualScorePreview.reps" :key="`visual-score-${item.rep_id}`">
                      <td>第 {{ item.rep_id }} 次</td>
                      <td>{{ formatVideoTime(item.start_time) }}–{{ formatVideoTime(item.end_time) }}</td>
                      <td>{{ item.score }}</td>
                      <td>{{ item.dimensions.accuracy }}</td>
                      <td>{{ item.dimensions.stability }}</td>
                      <td>{{ item.dimensions.control }}</td>
                      <td>{{ item.dimensions.duration }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="empty-state">{{ segmentationDiagnostics.visualScorePreview.score_status === 'unavailable' ? '试算未完成，请查看分析日志。' : segmentationDiagnostics.visualScorePreview.template_comparable ? '暂无完整视觉周期；被拒绝的候选不会纳入平均分。' : '模板口径不兼容，原始试算值不作为可展示分数。' }}</div>
            </div>

            <div class="segmentation-candidate-group__title">方式 B · 姿态闭环｜周期与拒绝原因</div>
            <div class="segmentation-state-guide">
              <strong>状态说明：</strong>
              <span><b>完整闭环（COMPLETE）</b>：已完成收缩、顶点、回落和稳定，计入闭环次数。</span>
              <span><b>尾部截断（INCOMPLETE_TAIL）</b>：是否计入以“闭环接受周期”列表为准；出现在拒绝候选中则不计入。</span>
              <span><b>回落反弹（REBOUND）</b>：回落过程中的局部反弹，未形成独立完整动作，不计入次数。</span>
            </div>

            <div class="segmentation-candidates">
              <div class="segmentation-candidate-group">
                <div class="segmentation-candidate-group__title">闭环接受周期（{{ segmentationDiagnostics.acceptedCycles.length }}）</div>
                <div v-if="segmentationDiagnostics.acceptedCycles.length" class="analysis-table-wrap">
                  <table class="analysis-table">
                    <thead><tr><th>状态</th><th>起始（帧 / 视频时间）</th><th>顶点（帧 / 视频时间）</th><th>回落（帧 / 视频时间）</th><th>稳定（帧 / 视频时间）</th><th>幅度</th><th>判定</th></tr></thead>
                    <tbody>
                      <tr v-for="(item, index) in segmentationDiagnostics.acceptedCycles" :key="`accepted-${index}`">
                        <td><span class="analysis-tag analysis-tag--normal" :title="item.state">{{ segmentationStateLabel(item.state) }}</span></td>
                        <td>{{ formatFrameTime(item.startFrame, item.startTime) }}</td><td>{{ formatFrameTime(item.peakFrame, item.peakTime) }}</td><td>{{ formatFrameTime(item.returnFrame, item.returnTime) }}</td><td>{{ formatFrameTime(item.stableFrame, item.stableTime) }}</td><td>{{ formatAmplitude(item.amplitude) }}</td><td class="segmentation-reason">{{ item.reason }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-else class="empty-state">未记录闭环接受周期（可能处于 legacy 模式，或诊断快照尚不可用）。</div>
              </div>

              <div class="segmentation-candidate-group">
                <div class="segmentation-candidate-group__title">闭环拒绝候选（{{ segmentationDiagnostics.rejectedCandidates.length }}）</div>
                <div v-if="segmentationDiagnostics.rejectedCandidates.length" class="analysis-table-wrap">
                  <table class="analysis-table">
                    <thead><tr><th>状态</th><th>起始（帧 / 视频时间）</th><th>顶点（帧 / 视频时间）</th><th>幅度</th><th>拒绝原因</th></tr></thead>
                    <tbody>
                      <tr v-for="(item, index) in segmentationDiagnostics.rejectedCandidates" :key="`rejected-${index}`">
                        <td><span :class="['analysis-tag', item.state === 'REBOUND' ? 'analysis-tag--warning' : 'analysis-tag--invalid']" :title="item.state">{{ segmentationStateLabel(item.state) }}</span></td>
                        <td>{{ formatFrameTime(item.startFrame, item.startTime) }}</td><td>{{ formatFrameTime(item.peakFrame, item.peakTime) }}</td><td>{{ formatAmplitude(item.amplitude) }}</td><td class="segmentation-reason">{{ item.reason }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-else class="empty-state">未发现被状态机拒绝的候选。</div>
              </div>
            </div>
          </section>

          <div v-else-if="actionType === 'abdominal_crunch'" class="analysis-note">
            当前结果尚无双切分诊断。请确认分析服务已使用支持 P0 的版本，并将 <code>ABDOMINAL_SEGMENTATION_MODE</code> 设为 <code>shadow</code> 或 <code>cycle_state_machine</code> 后重新验证。
          </div>

          <section v-if="kneeBilateralDiagnostics" class="segmentation-panel">
            <div class="segmentation-panel__header">
              <div>
                <div class="analysis-section-title">膝关节旋转切分对照</div>
                <div class="segmentation-panel__subtitle">同一份关键点对比旧姿态峰值和新版双侧闭环；只有标为“本次正式”的结果写入报告。</div>
              </div>
              <el-tag :type="kneeBilateralDiagnostics.mode === 'bilateral' ? 'success' : 'info'">{{ kneeBilateralDiagnostics.mode === 'bilateral' ? '双侧闭环正式' : '双侧闭环试算' }}</el-tag>
            </div>
            <div class="segmentation-comparison">
              <div class="segmentation-comparison__head"><span>切分方式</span><span>识别次数</span><span>评分</span><span>说明</span><span>用途</span></div>
              <div class="segmentation-comparison__row">
                <div class="segmentation-comparison__name">姿态峰值<small>旧规则</small></div>
                <strong>{{ kneeBilateralDiagnostics.legacyCount ?? '-' }}</strong>
                <div class="segmentation-comparison__score">{{ kneeBilateralDiagnostics.mode !== 'bilateral' ? (analysisDetail.summary?.averageScore ?? '-') : '—' }}<small>旧姿态模板分</small></div>
                <span>用于对照</span>
                <el-tag :type="kneeBilateralDiagnostics.mode === 'bilateral' ? 'info' : 'success'" size="small">{{ kneeBilateralDiagnostics.mode === 'bilateral' ? '仅供对比' : '本次正式' }}</el-tag>
              </div>
              <div class="segmentation-comparison__row">
                <div class="segmentation-comparison__name">双侧闭环<small>两侧各到位并回正，合为 1 次</small></div>
                <strong>{{ kneeBilateralDiagnostics.cycleCount }}</strong>
                <div class="segmentation-comparison__score">{{ kneeBilateralDiagnostics.scorePreview?.available ? kneeBilateralDiagnostics.scorePreview.average_score : '—' }}<small>独立规则分</small></div>
                <span>{{ kneeBilateralDiagnostics.reason }}</span>
                <el-tag :type="kneeBilateralDiagnostics.mode === 'bilateral' ? 'success' : 'info'" size="small">{{ kneeBilateralDiagnostics.mode === 'bilateral' ? '本次正式' : '仅供对比' }}</el-tag>
              </div>
            </div>
            <div class="segmentation-panel__subtitle">“两侧”指画面中相反方向的双膝位移；关键点本身不能确认解剖学上的左/右。新版分数不套用旧姿态模板，也不与旧分数直接比较。配置切换仅影响新分析。</div>
            <div v-if="kneeBilateralDiagnostics.cycles.length" class="analysis-table-wrap">
              <table class="analysis-table">
                <thead><tr><th>次数</th><th>第一侧开始</th><th>第一侧到位</th><th>中间回正</th><th>第二侧到位</th><th>最终回正</th></tr></thead>
                <tbody>
                  <tr v-for="(cycle, index) in kneeBilateralDiagnostics.cycles" :key="`knee-cycle-${index}`">
                    <td>第 {{ index + 1 }} 次</td>
                    <td>{{ formatVideoTime(cycle.first.start_seconds) }}</td>
                    <td>{{ formatVideoTime(cycle.first.arrival_seconds) }}</td>
                    <td>{{ formatVideoTime(cycle.first.end_seconds) }}</td>
                    <td>{{ formatVideoTime(cycle.second.arrival_seconds) }}</td>
                    <td>{{ formatVideoTime(cycle.second.end_seconds) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="empty-state">{{ kneeBilateralDiagnostics.reason || '没有可确认的双侧完整周期。' }}</div>
          </section>

          <template v-if="analysisDetail.summary">
          <div class="analysis-section-title">分次动作评分（rep）</div>
          <div class="analysis-table-wrap">
            <table class="analysis-table">
              <thead>
                <tr>
                  <th>rep</th>
                  <th>总分</th>
                  <th>等级</th>
                  <th>有效</th>
                  <th>准确</th>
                  <th>稳定</th>
                  <th>控制</th>
                  <th>持续</th>
                  <th>代偿项</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in analysisDetail.repScores" :key="`${idx}-${row.repId ?? 'none'}`">
                  <td>{{ row.repId ?? '-' }}</td>
                  <td>{{ row.totalScore ?? '-' }}</td>
                  <td>{{ row.grade || '-' }}</td>
                  <td>{{ row.validFlag ? '是' : '否' }}</td>
                  <td>{{ row.accuracyScore ?? '-' }}</td>
                  <td>{{ row.stabilityScore ?? '-' }}</td>
                  <td>{{ row.controlScore ?? '-' }}</td>
                  <td>{{ row.durationScore ?? '-' }}</td>
                  <td>{{ row.compensationTypes?.length ? row.compensationTypes.join('、') : '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="analysis-section-title">特征对比结果（feature）</div>
          <div class="analysis-table-wrap">
            <table class="analysis-table">
              <thead>
                <tr>
                  <th>rep</th>
                  <th>特征码</th>
                  <th>特征值</th>
                  <th>单位</th>
                  <th>对比标签</th>
                  <th>偏离σ</th>
                  <th>置信度</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in analysisDetail.featureRows" :key="`${idx}-${row.featureCode}-${row.repId ?? 'none'}`">
                  <td>{{ row.repId ?? '-' }}</td>
                  <td>{{ row.featureCode }}</td>
                  <td>{{ row.value ?? '-' }}</td>
                  <td>{{ row.unit || '-' }}</td>
                  <td>
                    <span :class="['analysis-tag', featureTagClass(row.compareLabel)]">{{ row.compareLabel || '-' }}</span>
                  </td>
                  <td>{{ row.deviationSigma ?? '-' }}</td>
                  <td>{{ row.confidence ?? '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="analysis-note">
            <template v-if="actionType === 'pelvic_tilt'">骨盆倾斜按“稳定中立位 → 后倾顶点 → 回到稳定中立位”确认完整周期；短暂调整、准备动作及未回正动作不计入次数。</template>
            建议判断准确性时重点看：
            1）compareLabel 中 invalid/warning 占比；
            2）deviationSigma 是否普遍大于 1.5；
            3）validReps / totalReps；
            4）confidenceScore 与 qualityScore 是否偏低。
          </div>
          </template>
        </div>
        <div v-else class="empty-state">暂无评分明细，请先完成一次分析或手动点击“刷新状态”。</div>
      </el-card>

      <el-card class="surface-card" shadow="never">
        <template #header>
          <div class="section-header">
            <div>
              <div class="section-header__title">流程日志</div>
              <div class="section-header__subtitle">每一步实时记录，便于快速排查。</div>
            </div>
          </div>
        </template>

        <div class="log-panel">
          <div v-if="!logs.length" class="empty-state">点击“开始验证流程”后会显示执行日志。</div>
          <div v-for="(item, idx) in logs" :key="`${idx}-${item}`" class="log-line">{{ item }}</div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { ElMessage } from 'element-plus';
import { ANALYSIS_STATUS_LABELS } from '@home-rehab-motion/shared-constants';
import type { AnalysisStatus, TrainingActionType, VideoQualityStatus } from '@home-rehab-motion/shared-types';
import type { KeypointsData } from '@/services/video';
import SkeletonOverlay from '@/components/SkeletonOverlay.vue';

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message?: string;
};

type PresignData = {
  videoId: number;
  uploadUrl: string;
  objectKey: string;
  uploadType?: 'local_proxy' | 's3_post';
  uploadFields?: Record<string, string>;
};

type VideoStatusData = {
  videoId: number;
  status: AnalysisStatus;
  reportReady: boolean;
};

type SegmentationCandidate = {
  state: string;
  startFrame: number;
  peakFrame: number;
  returnFrame: number | null;
  stableFrame: number | null;
  startTime: number | null;
  peakTime: number | null;
  returnTime: number | null;
  stableTime: number | null;
  amplitude: number;
  reason: string;
};

type SegmentationSnapshot = {
  mode?: string;
  knee_bilateral_preview?: {
    mode: string; cycle_count: number; reason?: string;
    cycles: Array<{ first: { start_seconds: number; arrival_seconds: number; end_seconds: number };
      second: { arrival_seconds: number; end_seconds: number } }>;
    score_preview?: { available: boolean; average_score?: number | null; rep_scores?: number[] };
  };
  formal_version?: string;
  scoring_contract?: { compatible?: boolean; mismatched_units?: Record<string, { expected: string; actual: string | null }> };
  visual_score_preview?: {
    template_comparable?: boolean; average_score?: number | null; score_status?: string; reason?: string;
    reps?: Array<{ rep_id: number; start_time: number; end_time: number; score: number;
      dimensions: { accuracy: number; stability: number; control: number; duration: number } }>;
  };
  cycle_score_preview?: SegmentationSnapshot['visual_score_preview'];
  visual_evidence_preview?: {
    version?: string; uncalibrated?: boolean; score_available?: boolean;
    average_score?: number | null; rep_scores?: number[]; reason?: string;
  };
  effective_sample_fps?: number;
  legacy_rep_count?: number;
  cycle_rep_count?: number;
  count_delta?: number;
  visual_observable?: boolean;
  visual_rep_count?: number | null;
  visual_unavailable_reason?: string;
  visual_quality?: { valid_ratio?: number };
  visual_accepted_cycles?: Array<{
    start_time?: number | null; peak_time?: number | null; return_time?: number | null;
    peak_start_time?: number | null; peak_end_time?: number | null; amplitude?: number;
  }>;
  visual_rejected_candidates?: Array<{
    start_time?: number | null; peak_time?: number | null; return_time?: number | null; reason?: string;
  }>;
  timings_ms?: { shadow_overhead_ms?: number };
  accepted_cycles?: Array<{
    state?: string; start_frame?: number; peak_frame?: number; return_frame?: number | null;
    stable_frame?: number | null; start_time?: number | null; peak_time?: number | null;
    return_time?: number | null; stable_time?: number | null; amplitude?: number; reason?: string;
  }>;
  rejected_candidates?: Array<{
    state?: string; start_frame?: number; peak_frame?: number; return_frame?: number | null;
    stable_frame?: number | null; start_time?: number | null; peak_time?: number | null;
    return_time?: number | null; stable_time?: number | null; amplitude?: number; reason?: string;
  }>;
};

type AnalysisDetailData = {
  videoId: number;
  actionType: TrainingActionType;
  analysisStatus: AnalysisStatus;
  taskStatus: string;
  qualityStatus: VideoQualityStatus | null;
  qualityScore: number | null;
  qualityIssues: Array<{
    code?: string;
    scope?: string;
    valid_frame_ratio?: number;
    required_ratio?: number;
    affected_keypoints?: string[];
  }>;
  failReason: string | null;
  videoKey: string | null;
  videoPreviewUrl: string | null;
  reportReady: boolean;
  segmentation: {
    version: string | null;
    snapshot: SegmentationSnapshot | null;
  } | null;
  summary: {
    averageScore: number | null;
    grade: string | null;
    totalReps: number;
    validReps: number;
    confidenceScore: number | null;
    accuracyAvg: number | null;
    stabilityAvg: number | null;
    controlAvg: number | null;
    durationAvg: number | null;
    avgHoldDuration: number | null;
    mainIssues: unknown[];
    adviceSummary: unknown[];
  } | null;
  scoringExplain: {
    gradeRanges: Array<{ min: number; max: number; grade: string }>;
    weights: { accuracy: number; stability: number; control: number; duration: number };
    scoringHint: string;
  };
  repScores: Array<{
    repId: number | null;
    accuracyScore: number | null;
    stabilityScore: number | null;
    controlScore: number | null;
    durationScore: number | null;
    totalScore: number | null;
    grade: string | null;
    validFlag: boolean;
    holdDuration: number | null;
    compensationTypes: string[];
  }>;
  featureRows: Array<{
    repId: number | null;
    featureCode: string;
    value: number | null;
    unit: string | null;
    compareLabel: string | null;
    deviationSigma: number | null;
    confidence: number | null;
  }>;
};

function normalizeErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (!raw) return fallback;

  let statusCode = 0;
  let backendMessage = '';

  if (axios.isAxiosError(error)) {
    statusCode = Number(error.response?.status || 0);
    const data = error.response?.data as { message?: string | { message?: string }; detail?: string } | string | undefined;
    if (typeof data === 'string') {
      backendMessage = data;
    } else {
      const rawMessage = data?.message;
      backendMessage = typeof rawMessage === 'string'
        ? rawMessage
        : rawMessage?.message || data?.detail || '';
    }
  }

  const merged = `${raw} ${backendMessage}`;

  if (statusCode === 503 || merged.includes('status code 503') || merged.includes('Service Unavailable')) {
    return '分析服务暂时不可用，请稍后重试';
  }
  if (statusCode === 502 || statusCode === 504 || merged.includes('status code 502') || merged.includes('status code 504')) {
    return '分析链路暂时不稳定，请稍后重试';
  }
  if (statusCode === 401 || merged.includes('status code 401')) {
    return '登录状态已失效，请重新登录后重试';
  }
  if (statusCode === 403 || merged.includes('status code 403')) {
    return backendMessage ? `权限校验失败：${backendMessage}` : '当前账号没有执行内部验证的权限';
  }
  if (statusCode === 400 || merged.includes('status code 400')) {
    return backendMessage ? `请求参数异常：${backendMessage}` : '请求参数异常，请重新选择视频后重试';
  }
  if (merged.includes('timeout') || merged.includes('timed out')) {
    return '请求超时，请检查网络后重试';
  }

  return backendMessage || raw;
}

const api = axios.create({
  baseURL: '/api',
  timeout: 20_000,
});

const router = useRouter();

const actionOptions: Array<{ label: string; value: TrainingActionType }> = [
  { label: '缩腹运动', value: 'abdominal_crunch' },
  { label: '骨盆倾斜', value: 'pelvic_tilt' },
  { label: '膝关节旋转', value: 'knee_rotation' },
];

const actionType = ref<TrainingActionType>('abdominal_crunch');

const selectedFile = ref<File | null>(null);
const selectedFileName = ref('');
const selectedFileSizeLabel = ref('');
const videoDurationSeconds = ref(0);

const currentVideoId = ref<number | null>(null);
const currentStatus = ref<AnalysisStatus>('pending');
const reportReady = ref(false);
const pollCount = ref(0);

const analysisDetail = ref<AnalysisDetailData | null>(null);
const keypointsData = ref<KeypointsData | null>(null);
const keypointsLoading = ref(false);
const logs = ref<string[]>([]);
const errorText = ref('');

const running = ref(false);
const polling = ref(false);

let pollingTimer: number | null = null;

const localPreviewUrl = ref('');


const analysisDetailReady = computed(() => Boolean(analysisDetail.value));

const uploadedVideoPreviewUrl = computed(() => {
  const value = analysisDetail.value?.videoPreviewUrl || '';
  if (!value) return '';
  return value.startsWith('http') ? value : `${window.location.origin}${value}`;
});

const trunkKeypointQualityIssue = computed(() => analysisDetail.value?.qualityIssues.find(
  (item) => item.code === 'TRUNK_KEYPOINTS_UNSTABLE',
) || null);

const analysisTerminalIssue = computed(() => {
  const detail = analysisDetail.value;
  if (!detail || !['quality_insufficient', 'failed'].includes(detail.analysisStatus)) return null;

  const issue = trunkKeypointQualityIssue.value;
  if (issue) {
    const pointLabels: Record<string, string> = {
      LEFT_SHOULDER: '左肩', RIGHT_SHOULDER: '右肩', LEFT_HIP: '左髋', RIGHT_HIP: '右髋',
    };
    const points = (issue.affected_keypoints || []).map((point) => pointLabels[point] || point).join('、') || '关键躯干点';
    const validRatio = typeof issue.valid_frame_ratio === 'number' ? `${Math.round(issue.valid_frame_ratio * 100)}%` : '-';
    const requiredRatio = typeof issue.required_ratio === 'number' ? `${Math.round(issue.required_ratio * 100)}%` : '-';
    return {
      type: 'warning' as const,
      title: '质量不足：关键躯干点未稳定识别，未生成评分',
      description: `管理诊断：${points}在部分抽样帧中未稳定识别；关键点可用率 ${validRatio}，门槛 ${requiredRatio}。该比例是姿态估计可用性指标，不等同于画面缺失比例。请结合上方服务端视频回看取景范围、遮挡和动作过程中是否移出镜头。`,
    };
  }

  return {
    type: detail.analysisStatus === 'failed' ? 'error' as const : 'warning' as const,
    title: detail.analysisStatus === 'failed' ? '分析失败：未生成评分' : '质量不足：未生成评分',
    description: detail.failReason || '未获取到具体原因。请结合上方服务端视频和流程日志排查上传、分析任务或拍摄质量问题。',
  };
});

const segmentationDiagnostics = computed(() => {
  const detail = analysisDetail.value;
  const snapshot = detail?.segmentation?.snapshot;
  if (detail?.actionType !== 'abdominal_crunch' || !snapshot) return null;

  const toCandidate = (item: NonNullable<SegmentationSnapshot['accepted_cycles']>[number]): SegmentationCandidate => ({
    state: item.state || 'UNKNOWN',
    startFrame: Number(item.start_frame ?? 0),
    peakFrame: Number(item.peak_frame ?? 0),
    returnFrame: item.return_frame == null ? null : Number(item.return_frame),
    stableFrame: item.stable_frame == null ? null : Number(item.stable_frame),
    startTime: item.start_time == null ? null : Number(item.start_time),
    peakTime: item.peak_time == null ? null : Number(item.peak_time),
    returnTime: item.return_time == null ? null : Number(item.return_time),
    stableTime: item.stable_time == null ? null : Number(item.stable_time),
    amplitude: Number(item.amplitude ?? 0),
    reason: item.reason || '-',
  });

  return {
    mode: snapshot.mode || 'legacy_peak',
    formalVersion: detail.segmentation?.version || snapshot.formal_version || null,
    effectiveSampleFps: snapshot.effective_sample_fps ?? null,
    legacyRepCount: snapshot.legacy_rep_count ?? null,
    cycleRepCount: snapshot.cycle_rep_count ?? null,
    visualObservable: snapshot.visual_observable === true,
    visualRepCount: snapshot.visual_rep_count ?? null,
    visualUnavailableReason: snapshot.visual_unavailable_reason || '',
    scoringContract: snapshot.scoring_contract ?? null,
    visualScorePreview: snapshot.visual_score_preview ?? null,
    cycleScorePreview: snapshot.cycle_score_preview ?? null,
    visualEvidencePreview: snapshot.visual_evidence_preview ?? null,
    visualValidRatio: snapshot.visual_quality?.valid_ratio ?? null,
    visualAcceptedCycles: (snapshot.visual_accepted_cycles || []).map((item) => ({
      startTime: item.start_time ?? null,
      peakTime: item.peak_time ?? null,
      returnTime: item.return_time ?? null,
      peakStartTime: item.peak_start_time ?? null,
      peakEndTime: item.peak_end_time ?? null,
      amplitude: Number(item.amplitude ?? 0),
    })),
    visualRejectedCandidates: (snapshot.visual_rejected_candidates || []).map((item) => ({
      startTime: item.start_time ?? null,
      peakTime: item.peak_time ?? null,
      returnTime: item.return_time ?? null,
      reason: item.reason || '',
    })),
    countDelta: snapshot.count_delta ?? null,
    shadowOverheadMs: snapshot.timings_ms?.shadow_overhead_ms ?? null,
    acceptedCycles: (snapshot.accepted_cycles || []).map(toCandidate),
    rejectedCandidates: (snapshot.rejected_candidates || []).map(toCandidate),
  };
});

const kneeBilateralDiagnostics = computed(() => {
  const detail = analysisDetail.value;
  if (detail?.actionType !== 'knee_rotation') return null;
  const preview = detail.segmentation?.snapshot?.knee_bilateral_preview;
  if (!preview) return null;
  return {
    ...preview,
    legacyCount: detail.segmentation?.snapshot?.legacy_rep_count ?? null,
    cycleCount: preview.cycle_count,
    scorePreview: preview.score_preview,
  };
});

const segmentationComparisonRows = computed(() => {
  const diagnostic = segmentationDiagnostics.value;
  if (!diagnostic) return [];
  const isCycleFormal = diagnostic.formalVersion?.startsWith('abdominal_cycle_') === true;
  const poseScore = analysisDetail.value?.summary?.grade === '待复核'
    ? null : analysisDetail.value?.summary?.averageScore;
  const previewScore = (preview: SegmentationSnapshot['visual_score_preview'] | null, count: number | null) => {
    if (count === 0) return { value: '—', hint: '未切出完整周期' };
    if (!preview) return { value: '—', hint: '未试算；旧记录请重新验证' };
    if (!preview.template_comparable) return { value: '—', hint: '模板不兼容，不展示分数' };
    if (typeof preview.average_score !== 'number') return { value: '—', hint: preview.reason || '试算未完成' };
    return { value: String(preview.average_score), hint: '边界替换试算' };
  };
  const cyclePose = previewScore(diagnostic.cycleScorePreview, diagnostic.cycleRepCount);
  const contourPose = previewScore(diagnostic.visualScorePreview, diagnostic.visualRepCount);
  const visualScore = diagnostic.visualEvidencePreview;
  return [
    {
      key: 'peak', name: 'A · 姿态峰值', detail: '肩髋关键点的峰值',
      count: diagnostic.legacyRepCount ?? '—',
      poseScore: !isCycleFormal && poseScore != null ? String(poseScore) : '—',
      poseScoreHint: !isCycleFormal ? (poseScore != null ? '本次正式评分' : '未生成正式评分') : '未单独试算',
      visualScore: '—', visualScoreHint: '不适用', formal: !isCycleFormal,
    },
    {
      key: 'cycle', name: 'B · 姿态闭环', detail: '起伏并回到稳定位置',
      count: diagnostic.cycleRepCount ?? '—',
      poseScore: isCycleFormal ? (poseScore != null ? String(poseScore) : '—') : cyclePose.value,
      poseScoreHint: isCycleFormal ? (poseScore != null ? '本次正式评分' : '未生成正式评分') : cyclePose.hint,
      visualScore: '—', visualScoreHint: '不适用',
      formal: isCycleFormal,
    },
    {
      key: 'visual', name: 'C · 腹部轮廓', detail: '隆起—保持—回位',
      count: diagnostic.visualObservable ? diagnostic.visualRepCount ?? '—' : '—',
      poseScore: diagnostic.visualObservable ? contourPose.value : '—',
      poseScoreHint: diagnostic.visualObservable ? contourPose.hint : '轮廓不可观察',
      visualScore: visualScore?.score_available && typeof visualScore.average_score === 'number'
        ? String(visualScore.average_score) : '—',
      visualScoreHint: visualScore?.score_available ? '视觉规则试算' : visualScore?.reason || '未试算；旧记录请重新验证',
      formal: false,
    },
  ];
});

const segmentationModeLabel = computed(() => {
  const mode = segmentationDiagnostics.value?.mode;
  if (mode === 'shadow') return 'Shadow 对比中';
  if (mode === 'cycle_state_machine') return segmentationDiagnostics.value?.formalVersion?.startsWith('abdominal_cycle_')
    ? '闭环状态机正式生效' : '已回退峰值切分';
  return '峰值切分正式生效';
});

const segmentationModeTagType = computed(() => {
  const mode = segmentationDiagnostics.value?.mode;
  if (mode === 'shadow') return 'warning';
  if (mode === 'cycle_state_machine') return segmentationDiagnostics.value?.formalVersion?.startsWith('abdominal_cycle_')
    ? 'success' : 'warning';
  return 'info';
});

const accuracyHint = computed(() => {
  const detail = analysisDetail.value;
  if (!detail || !detail.summary) return '-';

  const total = detail.summary.totalReps || 0;
  const valid = detail.summary.validReps || 0;
  const validRate = total > 0 ? valid / total : 0;
  const confidence = Number(detail.summary.confidenceScore || 0);
  const invalidCount = detail.featureRows.filter((item) => item.compareLabel === 'invalid').length;

  if (confidence >= 0.8 && validRate >= 0.7 && invalidCount <= 2) {
    return '较高（可作为训练反馈）';
  }
  if (confidence >= 0.65 && validRate >= 0.5) {
    return '中等（建议结合视频复核）';
  }
  return '偏低（建议重录并复核）';
});

function unwrap<T>(payload: ApiEnvelope<T>): T {
  if (!payload?.success) {
    throw new Error(payload?.message || '请求失败');
  }
  return payload.data;
}

function appendLog(message: string) {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  logs.value.push(`[${time}] ${message}`);
}

function actionLabel(type: TrainingActionType) {
  return actionOptions.find((item) => item.value === type)?.label || type;
}

function statusLabel(status: AnalysisStatus | string) {
  return (ANALYSIS_STATUS_LABELS as Record<string, string>)[status] || status;
}

function formatFps(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value.toFixed(2)} fps` : '-';
}

function formatMilliseconds(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value} ms` : '-';
}

function formatAmplitude(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toFixed(4) : '-';
}

function segmentationStateLabel(state: string): string {
  const labels: Record<string, string> = {
    COMPLETE: '完整闭环',
    INCOMPLETE_TAIL: '尾部截断（计入）',
    REBOUND: '回落反弹（不计入）',
  };
  return labels[state] ? `${labels[state]}（${state}）` : state || '未知';
}

function formatVideoTime(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '-';
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function formatFrameTime(frame: number | null | undefined, time: number | null | undefined): string {
  if (typeof frame !== 'number') return '-';
  return `${frame} / ${formatVideoTime(time)}`;
}

function featureTagClass(label?: string | null) {
  if (label === 'normal') return 'analysis-tag--normal';
  if (label === 'warning') return 'analysis-tag--warning';
  if (label === 'invalid') return 'analysis-tag--invalid';
  return '';
}

function normalizeUploadUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith('/api/')) {
      return `${parsed.pathname}${parsed.search}`;
    }
    return url;
  } catch {
    return url;
  }
}


function adminAuthHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}`,
  };
}

function formatSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)}KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function revokeLocalPreview() {
  if (localPreviewUrl.value) {
    URL.revokeObjectURL(localPreviewUrl.value);
    localPreviewUrl.value = '';
  }
}

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const src = URL.createObjectURL(file);

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
      URL.revokeObjectURL(src);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(src);
      resolve(0);
    };

    video.src = src;
  });
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  selectedFile.value = file;
  selectedFileName.value = file.name;
  selectedFileSizeLabel.value = formatSize(file.size);
  videoDurationSeconds.value = await getVideoDuration(file);
  errorText.value = '';
  revokeLocalPreview();
  localPreviewUrl.value = URL.createObjectURL(file);

  appendLog(`选择视频：${file.name}（${selectedFileSizeLabel.value}）`);
}


async function fetchAnalysisDetail(videoId: number) {
  const response = await api.get<ApiEnvelope<AnalysisDetailData>>(`/videos/admin/${videoId}/analysis-detail`, {
    headers: adminAuthHeaders(),
  });
  analysisDetail.value = unwrap(response.data);
  appendLog(`评分明细已获取：reps=${analysisDetail.value.repScores.length}, features=${analysisDetail.value.featureRows.length}`);
}

async function fetchKeypoints(videoId: number) {
  const response = await api.get<ApiEnvelope<KeypointsData>>(`/videos/admin/${videoId}/keypoints`, {
    headers: adminAuthHeaders(),
  });
  keypointsData.value = unwrap(response.data);
  appendLog(`关键点已获取：frames=${keypointsData.value.total_frames}`);
}

async function loadKeypointsForCurrentVideo(showSuccessToast = true) {
  if (!currentVideoId.value) {
    ElMessage.warning('请先完成一次流程验证');
    return;
  }

  keypointsLoading.value = true;
  try {
    await fetchKeypoints(currentVideoId.value);
    if (showSuccessToast) {
      ElMessage.success('骨架数据加载完成，可切换到“纯骨架”模式查看');
    }
  } catch (error) {
    const msg = normalizeErrorMessage(error, '加载骨架数据失败');
    ElMessage.warning(msg);
  } finally {
    keypointsLoading.value = false;
  }
}

async function getStatus(videoId: number): Promise<VideoStatusData> {
const response = await api.get<ApiEnvelope<VideoStatusData>>(`/videos/admin/internal-samples/${videoId}/status`, {
headers: adminAuthHeaders(),
});
return unwrap(response.data);
}

function clearPollingTimer() {
  if (pollingTimer !== null) {
    window.clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}

function stopPolling() {
  polling.value = false;
  clearPollingTimer();
  appendLog('已停止轮询。');
}

async function pollUntilFinish(videoId: number) {
  const maxPollCount = 90;
  const intervalMs = 2000;

  polling.value = true;
  pollCount.value = 0;

  const loop = async () => {
    if (!polling.value) return;

    pollCount.value += 1;
    const statusData = await getStatus(videoId);
    currentStatus.value = statusData.status;
    reportReady.value = statusData.reportReady;

    appendLog(`轮询#${pollCount.value}：status=${statusData.status}, reportReady=${statusData.reportReady}`);

if (statusData.status === 'completed' && statusData.reportReady) {
  polling.value = false;
  await Promise.all([fetchAnalysisDetail(videoId), fetchKeypoints(videoId)]);
  ElMessage.success('流程验证完成，评分明细和骨架数据已获取');
  return;
}

    if (statusData.status === 'failed' || statusData.status === 'quality_insufficient') {
      polling.value = false;
      // 即使没有评分，也必须加载视频与终态诊断，供流程验证直接确认问题。
      await fetchAnalysisDetail(videoId);
      ElMessage.warning(`流程结束：${statusLabel(statusData.status)}，已加载问题详情`);
      return;
    }

    if (pollCount.value >= maxPollCount) {
      polling.value = false;
      errorText.value = '轮询超时，请检查分析服务或任务队列状态。';
      appendLog('轮询超时，流程中断。');
      ElMessage.warning('轮询超时');
      return;
    }

    pollingTimer = window.setTimeout(() => {
      loop().catch((error) => {
        polling.value = false;
        errorText.value = normalizeErrorMessage(error, '轮询失败');
        appendLog(`轮询失败：${errorText.value}`);
      });
    }, intervalMs);
  };

  await loop();
}

async function refreshStatus() {
  if (!currentVideoId.value) {
    ElMessage.warning('请先发起一次验证流程');
    return;
  }

  try {
    const statusData = await getStatus(currentVideoId.value);
    currentStatus.value = statusData.status;
    reportReady.value = statusData.reportReady;
    appendLog(`手动刷新状态：status=${statusData.status}`);

    if (statusData.status === 'completed' && statusData.reportReady) {
      await Promise.all([
        fetchAnalysisDetail(currentVideoId.value),
        fetchKeypoints(currentVideoId.value),
      ]);
    } else if (statusData.status === 'failed' || statusData.status === 'quality_insufficient') {
      await fetchAnalysisDetail(currentVideoId.value);
    }
  } catch (error) {
    const msg = normalizeErrorMessage(error, '刷新状态失败');
    errorText.value = msg;
    ElMessage.error(msg);
  }
}

function resetState() {
  stopPolling();
  errorText.value = '';
    analysisDetail.value = null;
  keypointsData.value = null;
  currentVideoId.value = null;
  currentStatus.value = 'pending';
  reportReady.value = false;
  pollCount.value = 0;
  logs.value = [];
  appendLog('状态已重置。');
}

function goToVideoDetail() {
  if (!currentVideoId.value) {
    ElMessage.warning('暂无可跳转的视频，请先完成一次流程验证');
    return;
  }
  router.push(`/videos/${currentVideoId.value}`);
}

async function startVerification() {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择视频');
    return;
  }

  running.value = true;
  errorText.value = '';
    analysisDetail.value = null;
  keypointsData.value = null;
  clearPollingTimer();

try {
appendLog('步骤1：创建流程验证内部样本');
const presignResponse = await api.get<ApiEnvelope<PresignData>>('/videos/admin/internal-samples/admin_flow_verify/presign-upload', {
params: { actionType: actionType.value },
headers: adminAuthHeaders(),
});
    const presign = unwrap(presignResponse.data);
    currentVideoId.value = presign.videoId;
    currentStatus.value = 'uploading';

    appendLog(`步骤2：上传视频（videoId=${presign.videoId}）`);
    const uploadUrl = normalizeUploadUrl(presign.uploadUrl);

    if (presign.uploadType === 's3_post' && presign.uploadFields) {
      appendLog('检测到直传模式（s3_post），使用预签名字段上传');
      const formData = new FormData();
      for (const [key, value] of Object.entries(presign.uploadFields)) {
        formData.append(key, value);
      }
      formData.append('file', selectedFile.value, selectedFile.value.name);

      await axios.post(uploadUrl, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 120_000,
      });
      appendLog(`上传完成：objectKey=${presign.objectKey}`);
    } else {
      const formData = new FormData();
      formData.append('file', selectedFile.value, selectedFile.value.name);

      const uploadResponse = await axios.post<ApiEnvelope<{ objectKey: string; size: number }>>(
        uploadUrl,
        formData,
        {
headers: {
...adminAuthHeaders(),
'Content-Type': 'multipart/form-data',
},
          timeout: 120_000,
        },
      );
      const uploadData = unwrap(uploadResponse.data);
      appendLog(`上传完成：objectKey=${uploadData.objectKey}`);
    }

    appendLog('步骤3：确认上传并创建分析任务（confirm-upload）');
    const duration = videoDurationSeconds.value > 0 ? videoDurationSeconds.value : 30;
    const confirmResponse = await api.post<ApiEnvelope<{ status: AnalysisStatus }>>(
      `/videos/admin/internal-samples/${presign.videoId}/confirm-upload`,
      {
        videoId: presign.videoId,
        actionType: actionType.value,
        duration,
      },
      {
        headers: adminAuthHeaders(),
      },
    );
    const confirmData = unwrap(confirmResponse.data);
    currentStatus.value = confirmData.status;
    appendLog(`任务已创建：status=${confirmData.status}`);

    appendLog('步骤4：开始轮询分析状态');
    await pollUntilFinish(presign.videoId);
  } catch (error) {
    const msg = normalizeErrorMessage(error, '流程执行失败');
    errorText.value = msg;
    appendLog(`流程失败：${msg}`);
    ElMessage.error(msg);
  } finally {
    running.value = false;
  }
}

onBeforeUnmount(() => {
  clearPollingTimer();
  revokeLocalPreview();
});

onUnmounted(() => {
  revokeLocalPreview();
});
</script>

<style scoped>
.verify-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.verify-form-item {
  display: grid;
  gap: 8px;
}

.verify-form-item--file {
  grid-column: 1 / -1;
}

.verify-form-item__label {
  color: var(--ink-700);
  font-size: 13px;
  font-weight: 700;
}

.verify-file-input {
  width: 100%;
  border: 1px dashed rgba(148, 180, 214, 0.45);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--ink-700);
  background: rgba(248, 251, 255, 0.7);
}

.verify-file-tip {
  color: var(--ink-500);
  font-size: 12px;
  line-height: 1.7;
}

.verify-file-tip--warn {
  color: #b26a2b;
}

.verify-toolbar {
  margin-top: 14px;
}

.verify-error {
  margin-top: 12px;
  border-radius: 12px;
  background: rgba(255, 113, 113, 0.12);
  color: #b03939;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.preview-card {
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
  background: rgba(248, 251, 255, 0.72);
  padding: 12px;
}

.preview-card__title {
  color: var(--ink-700);
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
}

.preview-card__video {
  width: 100%;
  max-height: 320px;
  border-radius: 10px;
  background: #0e1b2d;
}

.skeleton-inline {
  margin-top: 14px;
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
  background: rgba(248, 251, 255, 0.72);
  padding: 12px;
}

.skeleton-inline__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.skeleton-inline__title {
  color: var(--ink-700);
  font-size: 13px;
  font-weight: 700;
}

.verify-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

.report-grid {
  display: grid;
  gap: 10px;
}

.report-item {
  display: grid;
  gap: 6px;
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(248, 251, 255, 0.72);
}

.report-item__label {
  color: var(--ink-500);
  font-size: 12px;
}

.report-item__value {
  color: var(--ink-950);
  font-size: 14px;
  font-weight: 700;
}

.analysis-panel {
  display: grid;
  gap: 14px;
}

.analysis-explain {
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
  background: rgba(248, 251, 255, 0.72);
  padding: 12px 14px;
}

.analysis-explain__title {
  color: var(--ink-950);
  font-size: 14px;
  font-weight: 700;
}

.analysis-explain__line {
  margin-top: 8px;
  color: var(--ink-700);
  font-size: 13px;
  line-height: 1.8;
}

.analysis-explain__line--pure-skeleton {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(76, 140, 255, 0.12);
  color: #2a4d8f;
}

.analysis-chip {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  min-height: 24px;
  background: rgba(15, 40, 79, 0.08);
  color: var(--ink-700);
  margin-right: 8px;
}

.analysis-section-title {
  color: var(--ink-950);
  font-size: 14px;
  font-weight: 700;
}

.segmentation-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(76, 140, 255, 0.28);
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(237, 246, 255, 0.82), rgba(248, 251, 255, 0.72));
}

.segmentation-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.segmentation-panel__subtitle {
  margin-top: 6px;
  color: var(--ink-500);
  font-size: 14px;
  line-height: 1.6;
}

.segmentation-comparison {
  overflow: hidden;
  border: 1px solid rgba(148, 180, 214, 0.35);
  border-radius: 10px;
  background: #fff;
}

.segmentation-comparison__head,
.segmentation-comparison__row {
  display: grid;
  grid-template-columns: minmax(150px, 1.7fr) minmax(82px, 0.65fr) minmax(150px, 1.25fr) minmax(150px, 1.25fr) minmax(92px, 0.7fr);
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
}

.segmentation-comparison__head {
  background: #edf4fa;
  color: var(--ink-700);
  font-size: 13px;
  font-weight: 700;
}

.segmentation-comparison__row + .segmentation-comparison__row {
  border-top: 1px solid rgba(148, 180, 214, 0.28);
}

.segmentation-comparison__row:nth-child(even) {
  background: rgba(237, 244, 250, 0.36);
}

.segmentation-comparison__row strong,
.segmentation-comparison__score {
  color: var(--ink-950);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.segmentation-comparison__name {
  color: var(--ink-900);
  font-weight: 700;
}

.segmentation-comparison__name small,
.segmentation-comparison__score small {
  display: block;
  margin-top: 3px;
  color: var(--ink-600);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
}

.segmentation-candidates {
  display: grid;
  gap: 12px;
}

.segmentation-state-guide {
  display: grid;
  gap: 5px;
  padding: 10px 12px;
  border-left: 3px solid rgba(76, 140, 255, 0.55);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.62);
  color: var(--ink-600);
  font-size: 12px;
  line-height: 1.65;
}

.segmentation-state-guide strong,
.segmentation-state-guide b {
  color: var(--ink-800);
}

.segmentation-candidate-group {
  display: grid;
  gap: 8px;
}

.segmentation-candidate-group__title {
  color: var(--ink-700);
  font-size: 14px;
  font-weight: 700;
}

.segmentation-score-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 16px;
  padding: 10px 12px;
  border: 1px solid rgba(148, 180, 214, 0.3);
  border-radius: 8px;
  background: #fff;
  color: var(--ink-700);
  font-size: 13px;
}

.segmentation-score-summary strong {
  color: var(--ink-950);
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.segmentation-reason {
  min-width: 220px;
  max-width: 420px;
  white-space: normal !important;
}

.analysis-table-wrap {
  overflow: auto;
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
}

.analysis-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.analysis-table th,
.analysis-table td {
  border-bottom: 1px solid rgba(148, 180, 214, 0.18);
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
}

.analysis-table thead th {
  background: rgba(248, 251, 255, 0.95);
  color: var(--ink-700);
  font-weight: 700;
}

.analysis-tag {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(15, 40, 79, 0.08);
  color: var(--ink-700);
}

.analysis-tag--normal {
  background: rgba(53, 173, 116, 0.14);
  color: #1f8b5a;
}

.analysis-tag--warning {
  background: rgba(255, 189, 102, 0.2);
  color: #b96f10;
}

.analysis-tag--invalid {
  background: rgba(255, 113, 113, 0.2);
  color: #bf3434;
}

.analysis-note {
  border-radius: 12px;
  background: rgba(22, 111, 247, 0.08);
  color: #1e4d89;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.8;
}

.log-panel {
  max-height: 420px;
  overflow: auto;
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
  padding: 10px 12px;
  background: #0f1d2f;
}

.log-line {
  color: #cde6ff;
  font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.7;
  border-bottom: 1px dashed rgba(121, 215, 255, 0.12);
  padding: 6px 0;
}

.log-line:last-child {
  border-bottom: none;
}

.empty-state {
  color: var(--ink-500);
  font-size: 13px;
  line-height: 1.8;
}

@media (max-width: 900px) {
  .verify-form-grid,
  .preview-grid {
    grid-template-columns: 1fr;
  }

  .segmentation-comparison__head {
    display: none;
  }

  .segmentation-comparison__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .segmentation-comparison__row > .segmentation-comparison__score {
    font-size: 18px;
  }

  .segmentation-comparison__row > .segmentation-comparison__score:nth-of-type(2),
  .segmentation-comparison__row > .segmentation-comparison__score:nth-of-type(3) {
    grid-column: 1 / -1;
  }

  .segmentation-comparison__score::before {
    content: attr(data-label);
    display: inline-block;
    min-width: 100px;
    margin-right: 12px;
    color: var(--ink-600);
    font-size: 13px;
    font-weight: 500;
  }

  .segmentation-panel__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
