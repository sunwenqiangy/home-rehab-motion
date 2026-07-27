<template>
  <div class="skeleton-overlay">
    <div class="skeleton-overlay__compare" v-if="videoUrl || keypointsData?.frames?.length">
      <section class="preview-panel">
        <div class="preview-panel__title">原视频</div>
        <div class="preview-panel__media">
          <video
            v-if="videoUrl"
            ref="videoRef"
            :src="videoUrl"
            controls
            @loadedmetadata="onVideoMeta"
            @timeupdate="onTimeUpdate"
            @error="onVideoError"
            @play="isPlaying = true"
            @pause="isPlaying = false"
            preload="metadata"
            playsinline
          />
          <div v-else class="preview-panel__fallback">暂无可播放视频，仍可查看右侧骨架</div>
        </div>
      </section>

      <section class="preview-panel">
        <div class="preview-panel__title">分析视图 <span v-if="drawablePointCount">已识别 {{ drawablePointCount }} 个关键点</span></div>
        <div class="preview-panel__media">
          <canvas ref="analysisCanvasRef" class="preview-panel__analysis-canvas" />
        </div>
      </section>
    </div>

    <el-alert
      v-if="videoLoadError"
      class="skeleton-overlay__load-error"
      type="warning"
      :closable="false"
      title="原视频无法加载，右侧仍可查看纯骨架"
      description="视频预览地址可能已过期或对象文件不可访问；骨架视图不依赖视频加载。"
    />

    <div class="skeleton-overlay__controls" v-if="videoUrl || keypointsData?.frames?.length">
      <div class="skeleton-overlay__toolbar-row">
        <el-button-group>
          <el-button size="small" @click="togglePlay">
            {{ isPlaying ? '暂停' : '播放' }}
          </el-button>
          <el-button size="small" @click="stepBackward">← 上一帧</el-button>
          <el-button size="small" @click="stepForward">下一帧 →</el-button>
        </el-button-group>

        <el-tag
          v-if="loopRepId !== null"
          size="small"
          type="warning"
          closable
          @close="loopRepId = null"
          style="cursor: pointer"
        >
          🔁 循环 rep {{ loopRepId }}
        </el-tag>

        <el-radio-group v-model="analysisViewMode" size="small">
          <el-radio-button label="skeleton">纯骨架</el-radio-button>
          <el-radio-button label="overlay">骨架 + 视频</el-radio-button>
        </el-radio-group>

        <el-tag
          size="small"
          :type="showSkeleton ? 'success' : 'info'"
          @click="showSkeleton = !showSkeleton"
          style="cursor: pointer"
        >
          {{ showSkeleton ? '骨架: 显示' : '骨架: 隐藏' }}
        </el-tag>
      </div>

      <el-slider
        v-model="progressPercent"
        :show-tooltip="false"
        :step="0.1"
        class="skeleton-overlay__slider"
        @input="onSliderInput"
      />

      <div class="skeleton-overlay__rep-track" v-if="totalRepCount > 0">
        <div
          v-for="seg in repSegments"
          :key="seg.rep_id"
          class="skeleton-overlay__rep-segment"
          :class="{
            'is-completed': seg.end_time <= currentTime,
            'is-active': isRepActive(seg),
            'is-loop': loopRepId === seg.rep_id,
          }"
          :style="repSegmentStyle(seg)"
          :title="`rep ${seg.rep_id}: ${seg.start_time.toFixed(2)}s ~ ${seg.end_time.toFixed(2)}s（单击跳转，双击循环）`"
          @click="jumpToRep(seg)"
          @dblclick="toggleLoopRep(seg)"
        />
        <div class="skeleton-overlay__rep-cursor" :style="{ left: `${progressPercent}%` }" />
      </div>
      <div v-else class="skeleton-overlay__rep-meta skeleton-overlay__rep-meta--warn">
        <span v-if="displayTotalRepCount > 0">
          当前视频暂无周期切片数据，周期数来自评分汇总（{{ displayCompletedRepCount }} / {{ displayTotalRepCount }}）。
        </span>
        <span v-else>当前视频暂无周期切片数据，请用最新分析结果复测。</span>
      </div>
      <div class="skeleton-overlay__rep-meta" v-if="totalRepCount > 0">
        当前周期：{{ currentRepLabel }}
        <span v-if="loopRepId !== null" style="margin-left: 6px; color: #e6a23c;">🔁 循环中</span>
        <span style="margin-left: 6px; opacity: 0.7;">单击色块跳转 · 双击色块循环</span>
      </div>

      <div class="skeleton-overlay__rep-list" v-if="totalRepCount > 0">
        <span
          v-for="seg in repSegments"
          :key="seg.rep_id"
          class="skeleton-overlay__rep-chip"
          :class="{
            'is-completed': seg.end_time <= currentTime,
            'is-active': isRepActive(seg),
            'is-loop': loopRepId === seg.rep_id,
          }"
          @click="jumpToRep(seg)"
          @dblclick="toggleLoopRep(seg)"
          :title="`rep ${seg.rep_id}: ${seg.start_time.toFixed(2)}s ~ ${seg.end_time.toFixed(2)}s\n单击跳转 · 双击循环`"
        >
          {{ seg.rep_id }}
        </span>
      </div>

      <div class="skeleton-overlay__info">
        <span>帧: {{ currentFrameIndex }} / {{ totalFrames }}</span>
        <span>时间: {{ currentTime.toFixed(2) }}s</span>
        <span>可见关键点: {{ visibleKeypointCount }} / {{ keypointCount }}</span>
        <span>骨架连线: {{ connectionCount }}</span>
        <span>
          检测周期: {{ displayCompletedRepCount }} / {{ displayTotalRepCount }}
          <template v-if="repCountSourceLabel">（{{ repCountSourceLabel }}）</template>
        </span>
        <span v-if="loopRepId !== null" style="color: #e6a23c;">🔁 循环 rep {{ loopRepId }}</span>
      </div>

      <div class="skeleton-overlay__analysis-note">
        分析过程：1) 每帧提取人体关键点；2) 通过骨架连线跟踪动作轨迹；3) 结合稳定性、控制度与持续度输出质量分和评分。
      </div>
    </div>

    <div class="skeleton-overlay__empty" v-else>
      <el-empty description="暂无视频或关键点数据，无法预览骨架" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { KeypointFrame, KeypointRepSegment, KeypointsData } from '@/services/video';

type AnalysisViewMode = 'skeleton' | 'overlay';

const props = defineProps<{
  videoUrl: string | null;
  keypointsData: KeypointsData | null;
  summaryTotalReps?: number | null;
  summaryValidReps?: number | null;
}>();

const videoRef = ref<HTMLVideoElement | null>(null);
const analysisCanvasRef = ref<HTMLCanvasElement | null>(null);

const isPlaying = ref(false);
const videoLoadError = ref(false);
const currentTime = ref(0);
const progressPercent = ref(0);
const currentFrameIndex = ref(0);
const totalFrames = ref(0);
const visibleKeypointCount = ref(0);
const showSkeleton = ref(true);
const analysisViewMode = ref<AnalysisViewMode>('skeleton');
const loopRepId = ref<number | null>(null);

const keypointCount = computed(() => props.keypointsData?.keypoint_names?.length || 0);
const connectionCount = computed(() => props.keypointsData?.skeleton_connections?.length || 0);
const drawableFrame = computed(() =>
  props.keypointsData?.frames?.find((frame) => Object.values(frame.keypoints || {}).some(isVisiblePoint)) || null,
);
const drawablePointCount = computed(() =>
  drawableFrame.value ? Object.values(drawableFrame.value.keypoints || {}).filter(isVisiblePoint).length : 0,
);
function getCoordinateBounds(frame: KeypointFrame) {
  const validPoints = Object.values(frame.keypoints || {}).filter(isVisiblePoint);
  if (!validPoints.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1, normalized: true };
  const xs = validPoints.map((point) => Number(point.x));
  const ys = validPoints.map((point) => Number(point.y));
  const normalized = Math.min(...xs) >= -0.05 && Math.max(...xs) <= 1.05 && Math.min(...ys) >= -0.05 && Math.max(...ys) <= 1.05;
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), normalized };
}

function isVisiblePoint(point: unknown): point is { x: number; y: number; visibility?: number } {
  if (!point || typeof point !== 'object') return false;
  const candidate = point as { x?: unknown; y?: unknown; visibility?: unknown };
  const visibility = candidate.visibility === undefined ? 1 : Number(candidate.visibility);
  return Number.isFinite(Number(candidate.x)) && Number.isFinite(Number(candidate.y)) && Number.isFinite(visibility) && visibility > 0;
}
const repSegments = computed(() =>
  [...(props.keypointsData?.rep_segments || [])].sort((a, b) => a.start_time - b.start_time),
);
const totalRepCount = computed(() => repSegments.value.length);
const completedRepCount = computed(() =>
  repSegments.value.filter((seg) => seg.end_time <= currentTime.value).length,
);
const fallbackTotalRepCount = computed(() => Math.max(0, Number(props.summaryTotalReps || 0)));
const fallbackValidRepCount = computed(() => Math.max(0, Number(props.summaryValidReps || 0)));
const displayTotalRepCount = computed(() =>
  totalRepCount.value > 0 ? totalRepCount.value : fallbackTotalRepCount.value,
);
const displayCompletedRepCount = computed(() => {
  if (totalRepCount.value > 0) return completedRepCount.value;
  return Math.min(fallbackValidRepCount.value, displayTotalRepCount.value);
});
const repCountSourceLabel = computed(() => {
  if (totalRepCount.value > 0) return '';
  if (displayTotalRepCount.value > 0) return '评分汇总';
  return '';
});
const currentRep = computed(() =>
  repSegments.value.find((seg) => isRepActive(seg)) || null,
);
const currentRepLabel = computed(() => {
  if (!currentRep.value) return '未进入周期区间';
  return `rep ${currentRep.value.rep_id}（${currentRep.value.start_time.toFixed(1)}s ~ ${currentRep.value.end_time.toFixed(1)}s）`;
});
const effectiveDuration = computed(() => {
  const fromVideo = Number(videoRef.value?.duration || 0);
  const frames = props.keypointsData?.frames || [];
  const fromFrames = frames.length ? Number(frames[frames.length - 1].timestamp || 0) : 0;
  return Math.max(fromVideo, fromFrames, 0.001);
});

let animationFrameId: number | null = null;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function isRepActive(seg: KeypointRepSegment) {
  return seg.start_time <= currentTime.value && currentTime.value <= seg.end_time;
}

function repSegmentStyle(seg: KeypointRepSegment) {
  const duration = effectiveDuration.value;
  const startRatio = clamp01(seg.start_time / duration);
  const endRatio = clamp01(seg.end_time / duration);
  const leftRatio = Math.min(startRatio, endRatio);
  const widthRatio = Math.max(0.004, Math.abs(endRatio - startRatio));
  return {
    left: `${leftRatio * 100}%`,
    width: `${widthRatio * 100}%`,
  };
}

function findFrameByTime(time: number): KeypointFrame | null {
  if (!props.keypointsData?.frames?.length) return null;
  const frames = props.keypointsData.frames;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timestamp <= time) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return hi >= 0 ? frames[hi] : null;
}

function updateFrameInfo() {
  const video = videoRef.value;
  if (video) {
    currentTime.value = video.currentTime;
    progressPercent.value = (video.currentTime / (video.duration || effectiveDuration.value || 1)) * 100;
  }

  const frame = findFrameByTime(currentTime.value);
  if (!frame) {
    currentFrameIndex.value = 0;
    visibleKeypointCount.value = 0;
    return;
  }

  currentFrameIndex.value = frame.frame_index;
  visibleKeypointCount.value = Object.values(frame.keypoints || {}).filter(isVisiblePoint).length;
}

function onVideoMeta() {
  videoLoadError.value = false;
  totalFrames.value = props.keypointsData?.total_frames || 0;
  updateFrameInfo();
}

function onCanvasResize() {
  drawAnalysisView();
}

function onVideoError() {
  videoLoadError.value = true;
}

function onTimeUpdate() {
  updateFrameInfo();
  enforceLoop();
}

function enforceLoop() {
  if (loopRepId.value === null) return;
  const video = videoRef.value;
  if (!video || video.paused) return;
  const seg = repSegments.value.find((s) => s.rep_id === loopRepId.value);
  if (!seg) return;
  if (video.currentTime >= seg.end_time) {
    video.currentTime = seg.start_time;
  }
}

function togglePlay() {
  const video = videoRef.value;
  if (!video) return;
  if (video.paused) {
    void video.play();
  } else {
    video.pause();
  }
}

function stepForward() {
  const video = videoRef.value;
  if (!video || !props.keypointsData?.frames?.length) return;
  video.pause();

  const currentFrame = findFrameByTime(video.currentTime);
  if (!currentFrame) return;

  const frames = props.keypointsData.frames;
  const idx = frames.findIndex((frame) => frame.frame_index === currentFrame.frame_index);
  if (idx < frames.length - 1) {
    video.currentTime = frames[idx + 1].timestamp;
  }
}

function stepBackward() {
  const video = videoRef.value;
  if (!video || !props.keypointsData?.frames?.length) return;
  video.pause();

  const currentFrame = findFrameByTime(video.currentTime);
  if (!currentFrame) return;

  const frames = props.keypointsData.frames;
  const idx = frames.findIndex((frame) => frame.frame_index === currentFrame.frame_index);
  if (idx > 0) {
    video.currentTime = frames[idx - 1].timestamp;
  }
}

function onSliderInput(val: number) {
  const video = videoRef.value;
  if (!video) return;
  video.currentTime = (val / 100) * (video.duration || 0);
}

function jumpToRep(seg: KeypointRepSegment) {
  const video = videoRef.value;
  if (!video) return;
  video.currentTime = Math.max(0, Number(seg.start_time || 0));
  if (video.paused) {
    void video.play();
  }
  updateFrameInfo();
}

function toggleLoopRep(seg: KeypointRepSegment) {
  if (loopRepId.value === seg.rep_id) {
    loopRepId.value = null;
  } else {
    loopRepId.value = seg.rep_id;
  }
}

function drawHintText(ctx: CanvasRenderingContext2D, text: string, width: number, height: number) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2);
}

interface ContentRect { x: number; y: number; width: number; height: number; }

function getVideoContentRect(canvasWidth: number, canvasHeight: number): ContentRect {
  const video = videoRef.value;
  const sourceWidth = Number(video?.videoWidth || 0);
  const sourceHeight = Number(video?.videoHeight || 0);
  if (!sourceWidth || !sourceHeight) return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };

  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (canvasWidth - width) / 2, y: (canvasHeight - height) / 2, width, height };
}

function projectPoint(x: number, y: number, content: ContentRect, bounds: ReturnType<typeof getCoordinateBounds>) {
  if (bounds.normalized) {
    // 原始 MediaPipe 坐标已经是视频画面的 0–1 比例，不再额外加内边距，否则会与人体产生系统性偏移。
    return { x: content.x + x * content.width, y: content.y + y * content.height };
  }
  const padding = 0.10;
  const rangeX = Math.max(bounds.maxX - bounds.minX, 0.001);
  const rangeY = Math.max(bounds.maxY - bounds.minY, 0.001);
  return {
    x: content.x + (padding + ((x - bounds.minX) / rangeX) * (1 - padding * 2)) * content.width,
    y: content.y + (padding + ((y - bounds.minY) / rangeY) * (1 - padding * 2)) * content.height,
  };
}

function drawMidpoint(
  ctx: CanvasRenderingContext2D,
  mid: number[],
  content: ContentRect,
  color: string,
  bounds: ReturnType<typeof getCoordinateBounds>,
) {
  const point = projectPoint(Number(mid[0]), Number(mid[1]), content, bounds);
  const x = point.x;
  const y = point.y;

  ctx.beginPath();
  ctx.arc(x, y, 5, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawAnalysisView() {
  const video = videoRef.value;
  const canvas = analysisCanvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = canvas.parentElement?.getBoundingClientRect();
  const width = Math.round(rect?.width || canvas.clientWidth || 640);
  const height = Math.round(rect?.height || canvas.clientHeight || 360);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, width, height);
  const content = getVideoContentRect(width, height);
  if (analysisViewMode.value === 'overlay' && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    try {
      ctx.drawImage(video, content.x, content.y, content.width, content.height);
      ctx.fillStyle = 'rgba(4, 10, 18, 0.35)';
      ctx.fillRect(content.x, content.y, content.width, content.height);
    } catch (_error) {
      // 画布保留黑底，骨架仍可在等比例内容区域渲染。
    }
  }

  if (!showSkeleton.value) {
    drawHintText(ctx, '骨架显示已关闭', width, height);
    return;
  }

  const renderTime = Number(video?.currentTime ?? currentTime.value);
  const timedFrame = findFrameByTime(renderTime);
  const frame = timedFrame && Object.values(timedFrame.keypoints || {}).some(isVisiblePoint)
    ? timedFrame
    : drawableFrame.value;
  if (!frame) {
    drawHintText(ctx, '当前暂无可绘制的关键点数据', width, height);
    return;
  }

  const keypoints = frame.keypoints;
  const bounds = getCoordinateBounds(frame);
  const connections = props.keypointsData?.skeleton_connections || [];
  const visiblePoints = Object.entries(keypoints).filter(([, point]) => isVisiblePoint(point));

  ctx.strokeStyle = 'rgba(79, 215, 255, 0.92)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';

  for (const [fromName, toName] of connections) {
    const fromPoint = keypoints[fromName];
    const toPoint = keypoints[toName];
    if (!isVisiblePoint(fromPoint) || !isVisiblePoint(toPoint)) continue;

    const fromProjected = projectPoint(Number(fromPoint.x), Number(fromPoint.y), content, bounds);
    const toProjected = projectPoint(Number(toPoint.x), Number(toPoint.y), content, bounds);
    ctx.beginPath();
    ctx.moveTo(fromProjected.x, fromProjected.y);
    ctx.lineTo(toProjected.x, toProjected.y);
    ctx.stroke();
  }

  for (const name of Object.keys(keypoints)) {
    const point = keypoints[name];
    if (!isVisiblePoint(point)) continue;

    const projected = projectPoint(Number(point.x), Number(point.y), content, bounds);
    const x = projected.x;
    const y = projected.y;

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(79, 215, 255, 0.35)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#79d7ff';
    ctx.fill();
  }

  if (visiblePoints.length === 0) {
    drawHintText(ctx, '当前帧关键点置信度不足，已自动切换至首个可绘制帧', width, height);
    return;
  }

  if (frame.hip_mid?.length >= 2 && Number.isFinite(Number(frame.hip_mid[0])) && Number.isFinite(Number(frame.hip_mid[1]))) {
    drawMidpoint(ctx, frame.hip_mid, content, 'rgba(255, 196, 0, 0.85)', bounds);
  }
  if (frame.shoulder_mid?.length >= 2 && Number.isFinite(Number(frame.shoulder_mid[0])) && Number.isFinite(Number(frame.shoulder_mid[1]))) {
    drawMidpoint(ctx, frame.shoulder_mid, content, 'rgba(255, 196, 0, 0.85)', bounds);
  }

  // --- Draw rep segment start/end markers on canvas ---
  const dur = effectiveDuration.value;
  if (dur > 0 && repSegments.value.length > 0) {
    const progress = renderTime / dur;
    for (const seg of repSegments.value) {
      const startRatio = seg.start_time / dur;
      const endRatio = seg.end_time / dur;
      const isActive = isRepActive(seg);
      const isLoop = loopRepId.value === seg.rep_id;
      // Start marker (green)
      const sx = startRatio * width;
      ctx.strokeStyle = isActive || isLoop ? 'rgba(255, 196, 0, 0.9)' : 'rgba(0, 255, 170, 0.55)';
      ctx.lineWidth = isActive ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, height - 28);
      ctx.lineTo(sx, height - 6);
      ctx.stroke();

      // End marker (red)
      const ex = endRatio * width;
      ctx.strokeStyle = isActive || isLoop ? 'rgba(255, 100, 100, 0.9)' : 'rgba(255, 100, 100, 0.4)';
      ctx.lineWidth = isActive ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(ex, height - 28);
      ctx.lineTo(ex, height - 6);
      ctx.stroke();

      // Rep label
      if (isActive || isLoop) {
        const labelX = ((startRatio + endRatio) / 2) * width;
        ctx.fillStyle = isLoop ? 'rgba(230, 162, 60, 0.95)' : 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(isLoop ? `🔁 ${seg.rep_id}` : `rep ${seg.rep_id}`, labelX, height - 14);
      }

      // Shaded region for active segment
      if (isActive) {
        ctx.fillStyle = 'rgba(0, 255, 170, 0.06)';
        ctx.fillRect(startRatio * width, 0, (endRatio - startRatio) * width, height);
      }
    }

    // Current playback cursor on the bottom bar
    const cx = progress * width;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, height - 28);
    ctx.lineTo(cx, height - 6);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(8, 21, 37, 0.78)';
  ctx.fillRect(10, 10, 238, 76);
  ctx.fillStyle = '#ffffff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'start';
  ctx.fillText(`frame: ${frame.frame_index}`, 18, 28);
  ctx.fillText(`time: ${Number(frame.timestamp || 0).toFixed(2)}s`, 18, 44);
  ctx.fillText(`keypoints: ${visiblePoints.length} · reps: ${displayCompletedRepCount.value}/${displayTotalRepCount.value}`, 18, 60);
  if (loopRepId.value !== null) {
    ctx.fillStyle = '#e6a23c';
    ctx.fillText(`🔁 loop rep ${loopRepId.value}`, 18, 76);
  }
}

function animationLoop() {
  drawAnalysisView();
  animationFrameId = requestAnimationFrame(animationLoop);
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  totalFrames.value = props.keypointsData?.total_frames || 0;
  updateFrameInfo();
  nextTick(() => {
    if (analysisCanvasRef.value?.parentElement) {
      resizeObserver = new ResizeObserver(onCanvasResize);
      resizeObserver.observe(analysisCanvasRef.value.parentElement);
    }
    drawAnalysisView();
    animationLoop();
  });
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
  }
});

watch(
  () => props.keypointsData,
  (value) => {
    totalFrames.value = value?.total_frames || 0;
    updateFrameInfo();
  },
);

watch(
  () => props.videoUrl,
  () => {
    videoLoadError.value = false;
  },
);
</script>

<style scoped>
.skeleton-overlay {
  width: 100%;
}

.skeleton-overlay__compare {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.preview-panel {
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 10px;
  background: rgba(248, 251, 255, 0.72);
  overflow: hidden;
}

.preview-panel__title { display:flex; align-items:center; justify-content:space-between; gap:8px; padding: 10px 12px; font-size: 13px; font-weight: 700; color: var(--el-text-color-primary); border-bottom: 1px solid rgba(148, 180, 214, 0.2); }.preview-panel__title span { color:var(--brand-500); font-size:11px; font-weight:600; }

.preview-panel__media {
  position: relative;
  width: 100%;
  height: 320px;
  background: #000;
}

.preview-panel__media video,
.preview-panel__analysis-canvas {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: #000;
  object-fit: contain;
}

.preview-panel__fallback {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
}

.skeleton-overlay__load-error {
  margin-top: 12px;
}

.skeleton-overlay__controls {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-overlay__toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.skeleton-overlay__slider {
  width: 100%;
}

.skeleton-overlay__rep-track {
  position: relative;
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: rgba(148, 180, 214, 0.25);
  overflow: hidden;
}

.skeleton-overlay__rep-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 999px;
  background: rgba(0, 255, 170, 0.25);
  border: 1px solid rgba(0, 255, 170, 0.55);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.skeleton-overlay__rep-segment:hover {
  transform: scaleY(1.12);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35) inset;
}

.skeleton-overlay__rep-segment.is-completed {
  background: rgba(64, 158, 255, 0.32);
  border-color: rgba(64, 158, 255, 0.7);
}

.skeleton-overlay__rep-segment.is-active {
  background: rgba(255, 196, 0, 0.5);
  border-color: rgba(255, 196, 0, 0.95);
}

.skeleton-overlay__rep-segment.is-loop {
  background: rgba(230, 162, 60, 0.45);
  border-color: rgba(230, 162, 60, 0.95);
  box-shadow: 0 0 0 1px rgba(230, 162, 60, 0.25);
}

.skeleton-overlay__rep-cursor {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.65);
}

.skeleton-overlay__rep-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.skeleton-overlay__rep-meta--warn {
  color: #b26a2b;
}

.skeleton-overlay__rep-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
}

.skeleton-overlay__rep-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 24px;
  padding: 0 7px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  background: rgba(148, 180, 214, 0.15);
  border: 1px solid rgba(148, 180, 214, 0.3);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.skeleton-overlay__rep-chip:hover {
  background: rgba(148, 180, 214, 0.3);
  border-color: rgba(148, 180, 214, 0.6);
  transform: translateY(-1px);
}

.skeleton-overlay__rep-chip.is-completed {
  background: rgba(64, 158, 255, 0.15);
  border-color: rgba(64, 158, 255, 0.45);
  color: #409eff;
}

.skeleton-overlay__rep-chip.is-active {
  background: rgba(255, 196, 0, 0.2);
  border-color: rgba(255, 196, 0, 0.7);
  color: #e6a23c;
  box-shadow: 0 0 0 1px rgba(255, 196, 0, 0.25);
}

.skeleton-overlay__rep-chip.is-loop {
  background: rgba(230, 162, 60, 0.25);
  border-color: #e6a23c;
  color: #e6a23c;
  box-shadow: 0 0 6px rgba(230, 162, 60, 0.35);
}

.skeleton-overlay__info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.skeleton-overlay__analysis-note {
  font-size: 13px;
  line-height: 1.6;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.08);
  color: var(--el-text-color-primary);
}

.skeleton-overlay__empty {
  padding: 40px 0;
}

@media (max-width: 980px) {
  .skeleton-overlay__compare {
    grid-template-columns: 1fr;
  }
}
</style>
