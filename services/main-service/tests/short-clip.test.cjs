const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });

const { VideoService } = require('../src/video/video.service.ts');
const { ReportService } = require('../src/report/report.service.ts');
const { HistoryService } = require('../src/history/history.service.ts');
const { MotivationService } = require('../src/motivation/motivation.service.ts');
const { getVideoLimits } = require('../../../apps/patient-miniapp/services/appConfig.js');

function setupConfirmation(actionType = 'abdominal_crunch', actualDuration = 20, submittedDuration = 20) {
  const video = {
    video_id: 1n, user_id: 7n, action_type: actionType, source_type: 'miniapp',
    video_key: 'videos/1.mp4', upload_size_bytes: 100, duration: submittedDuration,
    analysis_status: 'uploading', confirmed_at: null,
  };
  const runs = [];
  let analysisTask;
  const prisma = {
    trainingVideo: {
      findUnique: async () => ({ ...video }),
      findUniqueOrThrow: async () => ({ ...video }),
      findMany: async () => [],
      updateMany: async ({ where, data }) => {
        if (where.analysis_status !== video.analysis_status || (where.confirmed_at === null && video.confirmed_at)) return { count: 0 };
        Object.assign(video, data);
        return { count: 1 };
      },
    },
    analysisRun: { create: async ({ data }) => { runs.push(data); return data; } },
    analysisTask: {
      upsert: async ({ update, create }) => {
        analysisTask = { ...analysisTask, ...(analysisTask ? update : create) };
        return analysisTask;
      },
      updateMany: async ({ where, data }) => {
        if (analysisTask?.task_status !== where.task_status || (analysisTask.provider_task_id ?? null) !== where.provider_task_id) return { count: 0 };
        Object.assign(analysisTask, data);
        return { count: 1 };
      },
    },
  };
  prisma.$transaction = async (operation) => {
    if (Array.isArray(operation)) return Promise.all(operation);
    // Tests here model the happy-path transaction; failure injection happens outside the transaction.
    return operation(prisma);
  };
  const motivation = {
    attempts: 0,
    handleConfirmedTraining: async function () { this.attempts += 1; return []; },
  };
  const analysis = { enqueueVideo: async () => ({ task_id: 'worker-1', status: 'queued' }) };
  const storage = {
    getObjectMetadata: async () => ({ size: 100 }),
    probeVideoDuration: async () => actualDuration,
  };
  const service = new VideoService(prisma, analysis, storage, {}, {
    getPatientAppConfig: async () => ({ videoMinDurationSeconds: 8, videoMaxDurationSeconds: 60 }),
  }, motivation, { requireActiveConsent: async () => {} });
  const payload = { videoId: 1, actionType, duration: submittedDuration, fileSizeBytes: 100 };
  return { video, runs, prisma, motivation, analysis, storage, service, payload, getTask: () => analysisTask };
}

test('miniapp limits use an 8-second minimum for abdominal and pelvic clips', () => {
  const config = { videoMinDurationSeconds: 8, videoMaxDurationSeconds: 300,
    videoRecordMaxDurationSeconds: 120, videoMaxSizeMB: 1024 };
  assert.deepEqual(getVideoLimits('abdominal_crunch', config), {
    minDuration: 8, maxDuration: 30, recordMaxDuration: 30, maxSizeMB: 200,
  });
  assert.deepEqual(getVideoLimits('pelvic_tilt', config), {
    minDuration: 8, maxDuration: 30, recordMaxDuration: 30, maxSizeMB: 200,
  });
  assert.deepEqual(getVideoLimits('knee_rotation', config), {
    minDuration: 10, maxDuration: 60, recordMaxDuration: 60, maxSizeMB: 200,
  });
});

test('an 8-second abdominal clip passes server confirmation', async () => {
  const ctx = setupConfirmation('abdominal_crunch', 8, 8);
  assert.equal((await ctx.service.confirmUpload(7, ctx.payload)).status, 'queued');
  assert.equal(ctx.video.duration, 8);
});

test('a 10-second knee clip passes server confirmation and a 9-second clip does not', async () => {
  const accepted = setupConfirmation('knee_rotation', 10, 10);
  assert.equal((await accepted.service.confirmUpload(7, accepted.payload)).status, 'queued');
  const rejected = setupConfirmation('knee_rotation', 9, 9);
  await assert.rejects(() => rejected.service.confirmUpload(7, rejected.payload), /10 至 60 秒/);
});

test('confirmation persists a short clip and a recoverable task even when motivation fails', async () => {
  const ctx = setupConfirmation();
  ctx.motivation.handleConfirmedTraining = async function () {
    this.attempts += 1;
    if (this.attempts === 1) throw new Error('badge unavailable');
    return [];
  };
  assert.equal((await ctx.service.confirmUpload(7, ctx.payload)).status, 'queued');
  assert.equal(ctx.video.short_clip, true);
  assert.equal(ctx.video.duration, 20);
  assert.equal(ctx.runs.length, 1);
  assert.equal(ctx.getTask().provider_task_id, 'worker-1');
  await ctx.service.confirmUpload(7, ctx.payload);
  assert.equal(ctx.runs.length, 1);
  assert.equal(ctx.motivation.attempts, 2);
});

test('recovery retries missing attendance for confirmed short clips', async () => {
  const ctx = setupConfirmation();
  ctx.prisma.trainingVideo.findMany = async ({ where }) => {
    if (where.training_attendance?.is === null) return [{ video_id: 1n, user_id: 7n, confirmed_at: new Date() }];
    return [];
  };
  await ctx.service.recoverUploadedVideos();
  assert.equal(ctx.motivation.attempts, 1);
});

test('an enqueue failure leaves a persisted task for reconciliation', async () => {
  const ctx = setupConfirmation();
  ctx.analysis.enqueueVideo = async () => { throw new Error('worker offline'); };
  assert.equal((await ctx.service.confirmUpload(7, ctx.payload)).status, 'queued');
  assert.equal(ctx.runs.length, 1);
  assert.equal(ctx.getTask().callback_status, 'enqueue_retry_pending');
  assert.equal(ctx.video.analysis_status, 'queued');
});

test('enqueue error cannot demote a task already started by the worker', async () => {
  const ctx = setupConfirmation();
  ctx.analysis.enqueueVideo = async () => {
    Object.assign(ctx.getTask(), { task_status: 'processing', provider_task_id: 'worker-1' });
    throw new Error('response lost');
  };
  await ctx.service.confirmUpload(7, ctx.payload);
  assert.equal(ctx.getTask().task_status, 'processing');
  assert.notEqual(ctx.getTask().callback_status, 'enqueue_retry_pending');
});

test('confirmation rejects real duration exceeding the action limit without counting training', async () => {
  const ctx = setupConfirmation('abdominal_crunch', 31);
  await assert.rejects(ctx.service.confirmUpload(7, ctx.payload), /视频真实时长/);
  assert.equal(ctx.video.confirmed_at, null);
  assert.equal(ctx.runs.length, 0);
  assert.equal(ctx.motivation.attempts, 0);
});

test('knee rotation permits a 60-second real video when its submitted duration matches', async () => {
  const ctx = setupConfirmation('knee_rotation', 60);
  ctx.video.duration = 60;
  ctx.payload.duration = 60;
  await ctx.service.confirmUpload(7, ctx.payload);
  assert.equal(ctx.video.duration, 60);
  assert.equal(ctx.video.short_clip, true);
});

test('an integrity failure cannot overwrite a video confirmed by a concurrent request', async () => {
  const ctx = setupConfirmation();
  ctx.payload.fileSizeBytes = 101;
  ctx.prisma.trainingVideo.updateMany = async ({ where, data }) => {
    if (data.analysis_status === 'quality_insufficient') {
      ctx.video.confirmed_at = new Date();
      ctx.video.analysis_status = 'queued';
    }
    if (where.analysis_status !== ctx.video.analysis_status || (where.confirmed_at === null && ctx.video.confirmed_at)) return { count: 0 };
    Object.assign(ctx.video, data);
    return { count: 1 };
  };
  await assert.rejects(ctx.service.confirmUpload(7, ctx.payload), /视频文件信息不一致/);
  assert.equal(ctx.video.analysis_status, 'queued');
});

test('a confirmed local video cannot be uploaded again', async () => {
  const ctx = setupConfirmation();
  ctx.video.analysis_status = 'queued';
  ctx.video.confirmed_at = new Date();
  let saved = false;
  ctx.storage.saveVideoFile = async () => { saved = true; };
  await assert.rejects(ctx.service.uploadVideoFile(7, 1, { buffer: Buffer.from('x') }), /不能再次覆盖/);
  assert.equal(saved, false);
});

test('short clip report compares only the same action and algorithm versions, including non-manual reviews', async () => {
  const current = {
    video_id: 1n, created_at: new Date('2026-10-01'), analysis_version: 'a1', template_version: 't1',
    segmentation_version: 's1', confidence_score: 0.9, average_score: 80, valid_reps: 1, total_reps: 1,
    grade: '合格', video: {
      user_id: 7n, source_type: 'miniapp', action_type: 'pelvic_tilt', short_clip: true,
      analysis_status: 'completed', quality_status: 'passed', manual_review: null,
      upload_time: new Date('2026-10-01'), video_key: null,
    },
  };
  let comparisonFilter;
  const prisma = {
    videoEvaluationResult: {
      findUnique: async () => current,
      findFirst: async ({ where }) => {
        comparisonFilter = where;
        return { average_score: 70 };
      },
    },
    trainingAttendance: { count: async () => 1 },
    userBadge: { findMany: async () => [] },
  };
  const report = new ReportService(prisma, { getPatientAppConfig: async () => ({ weeklyTarget: 7 }) }, {
    buildSummary: async () => ({ stage: 'corrective' }), getSnapshotBadges: async () => [],
  }, {});
  const result = await report.getReport(1, 7);
  assert.equal(result.compareToLast, '较上次 +10 分');
  assert.equal(comparisonFilter.video.short_clip, true);
  assert.equal(comparisonFilter.video.action_type, 'pelvic_tilt');
  assert.equal(comparisonFilter.segmentation_version, 's1');
  assert.deepEqual(comparisonFilter.video.OR, [
    { manual_review: { is: null } }, { manual_review: { is: { use_manual_result: false } } },
  ]);
  current.video.quality_status = 'warning';
  assert.equal((await report.getReport(1, 7)).compareToLast, undefined);
});

test('an uncertain zero-rep abdominal clip keeps attendance and withholds scores', async () => {
  const upload = setupConfirmation();
  await upload.service.confirmUpload(7, upload.payload);
  assert.equal(upload.motivation.attempts, 1);

  const current = {
    video_id: 1n, created_at: new Date('2026-10-01'), analysis_version: 'a1', template_version: 't1',
    segmentation_version: 's1', confidence_score: 0.3, average_score: 0, valid_reps: 0, total_reps: 0,
    grade: '待复核', video: {
      user_id: 7n, source_type: 'miniapp', action_type: 'abdominal_crunch', short_clip: true,
      analysis_status: 'review_required', quality_status: 'passed', manual_review: null,
      upload_time: new Date('2026-10-01'), video_key: null,
    },
  };
  const prisma = {
    videoEvaluationResult: { findUnique: async () => current, findFirst: async () => null },
    trainingAttendance: { count: async () => 1 },
    userBadge: { findMany: async () => [] },
  };
  const report = new ReportService(prisma, { getPatientAppConfig: async () => ({ weeklyTarget: 7 }) }, {
    buildSummary: async () => ({ stage: 'corrective' }), getSnapshotBadges: async () => [],
  }, {});
  const result = await report.getReport(1, 7);
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.grade, '待复核');
  assert.equal(result.averageScore, 0);
  assert.equal(result.totalReps, 0);
  assert.equal(result.validReps, 0);
  assert.equal(result.accuracyAvg, undefined);
  assert.match(result.reviewMessage, /不代表您没有完成练习/);
  assert.equal(result.compareToLast, undefined);
});

test('a counted abdominal clip with incompatible template exposes count but not score', async () => {
  const current = {
    video_id: 425n, created_at: new Date('2026-10-14'), analysis_version: 'a1',
    template_version: '缩腹-20260801-152620', segmentation_version: 'abdominal_peak_v1',
    confidence_score: 0.904, average_score: 88.2, valid_reps: 1, total_reps: 1,
    grade: '待复核', segmentation_snapshot: { scoring_contract: { compatible: false } },
    video: {
      user_id: 7n, source_type: 'miniapp', action_type: 'abdominal_crunch', short_clip: true,
      analysis_status: 'review_required', quality_status: 'passed', manual_review: null,
      upload_time: new Date('2026-10-14'), video_key: null,
    },
  };
  const prisma = {
    videoEvaluationResult: { findUnique: async () => current, findFirst: async () => null },
    trainingAttendance: { count: async () => 1 },
    userBadge: { findMany: async () => [] },
  };
  const report = new ReportService(prisma, { getPatientAppConfig: async () => ({ weeklyTarget: 7 }) }, {
    buildSummary: async () => ({ stage: 'corrective' }), getSnapshotBadges: async () => [],
  }, {});
  const result = await report.getReport(425, 7);
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.observedReps, 1);
  assert.equal(result.averageScore, 0);
  assert.equal(result.grade, '待复核');
  assert.match(result.reviewMessage, /识别到 1 次.*评分模板/);
  assert.equal(result.accuracyAvg, undefined);
});

test('an over-segmented abdominal clip explains uncertainty without exposing raw score as a result', async () => {
  const current = {
    video_id: 427n, created_at: new Date('2026-10-14'), analysis_version: 'a1',
    template_version: 't25', segmentation_version: 'abdominal_peak_v1',
    confidence_score: 0.909, average_score: 95.4, valid_reps: 3, total_reps: 3,
    grade: '待复核', segmentation_snapshot: { scoring_contract: { compatible: true }, visual_rep_count: 2 },
    video: {
      user_id: 7n, source_type: 'miniapp', action_type: 'abdominal_crunch', short_clip: true,
      analysis_status: 'review_required', quality_status: 'passed', manual_review: null,
      upload_time: new Date('2026-10-14'), video_key: null,
    },
  };
  const prisma = {
    videoEvaluationResult: { findUnique: async () => current, findFirst: async () => null },
    trainingAttendance: { count: async () => 1 },
    userBadge: { findMany: async () => [] },
  };
  const report = new ReportService(prisma, { getPatientAppConfig: async () => ({ weeklyTarget: 7 }) }, {
    buildSummary: async () => ({ stage: 'corrective' }), getSnapshotBadges: async () => [],
  }, {});
  const result = await report.getReport(427, 7);
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.observedReps, undefined);
  assert.equal(result.averageScore, 0);
  assert.equal(result.grade, '待复核');
  assert.match(result.reviewMessage, /动作切分结果不够可靠/);
  assert.match(result.reviewMessage, /1～2 个完整动作/);
});

test('visual practice report keeps pose dimensions separate and accepts same-version evidence preview', async () => {
  const current = {
    video_id: 428n, created_at: new Date('2026-10-14'), analysis_version: 'abdominal_visual_practice_v1',
    template_version: 'abdominal_visual_practice_v1', segmentation_version: 'abdominal_visual_v1',
    confidence_score: 0.91, average_score: 94.5, valid_reps: 2, total_reps: 2,
    avg_hold_duration: 1.5, accuracy_avg: 99, stability_avg: 90,
    grade: '练习完成', segmentation_snapshot: { score_type: 'visual_practice', score_available: true, count_source: 'visual',
      visual_accepted_cycles: [
        { start_time: 1, peak_start_time: 3, peak_end_time: 4, return_time: 6 },
        { start_time: 7, peak_start_time: 10, peak_end_time: 11, return_time: 13 },
      ] },
    video: {
      user_id: 7n, source_type: 'miniapp', action_type: 'abdominal_crunch', short_clip: true,
      analysis_status: 'completed', quality_status: 'passed', manual_review: null,
      upload_time: new Date('2026-10-14'), video_key: null,
    },
  };
  const prisma = {
    videoEvaluationResult: { findUnique: async () => current, findFirst: async () => null },
    trainingAttendance: { count: async () => 1 },
    userBadge: { findMany: async () => [] },
  };
  const report = new ReportService(prisma, { getPatientAppConfig: async () => ({ weeklyTarget: 7 }) }, {
    buildSummary: async () => ({ stage: 'corrective' }), getSnapshotBadges: async () => [],
  }, {});
  const result = await report.getReport(428, 7);
  assert.equal(result.scoreType, 'visual_practice');
  assert.equal(result.countSource, 'visual');
  assert.equal(result.scoreAvailable, true);
  assert.equal(result.totalReps, 2);
  assert.equal(result.averageScore, 94.5);
  assert.equal(result.accuracyAvg, undefined);
  assert.equal(result.stabilityAvg, undefined);
  assert.deepEqual(result.visualPhaseMetrics, {
    riseSeconds: 2.5, holdSeconds: 1, returnSeconds: 2, smoothnessPercent: 90,
  });
  assert.equal(result.requiresManualReview, false);

  current.segmentation_snapshot.score_type = 'visual_evidence';
  current.analysis_version = 'abdominal_visual_evidence_v1';
  const evidenceResult = await report.getReport(428, 7);
  assert.equal(evidenceResult.scoreType, 'visual_evidence');
  assert.deepEqual(evidenceResult.visualPhaseMetrics, result.visualPhaseMetrics);
  assert.equal(evidenceResult.averageScore, 94.5);

  current.segmentation_snapshot.score_type = 'visual_practice';
  current.segmentation_snapshot.visual_evidence_preview = {
    version: 'abdominal_visual_evidence_v1', score_available: true,
    average_score: 86.4, rep_scores: [84.8, 88.0],
  };
  const previewResult = await report.getReport(428, 7);
  assert.equal(previewResult.scoreType, 'visual_evidence');
  assert.equal(previewResult.averageScore, 86.4);
  assert.equal(previewResult.grade, '本段完成');
  current.segmentation_snapshot.score_mode = 'evidence_shadow';
  const shadowResult = await report.getReport(428, 7);
  assert.equal(shadowResult.scoreType, 'visual_practice');
  assert.equal(shadowResult.averageScore, 94.5);
  delete current.segmentation_snapshot.score_mode;
  current.segmentation_snapshot.visual_evidence_preview.rep_scores = [84.8];
  const incompletePreview = await report.getReport(428, 7);
  assert.equal(incompletePreview.scoreType, 'visual_practice');
  assert.equal(incompletePreview.averageScore, 94.5);
});

test('unobservable visual practice clip stays completed without presenting zero as a score', async () => {
  const current = {
    video_id: 429n, created_at: new Date('2026-10-14'), analysis_version: 'abdominal_visual_practice_v1',
    template_version: 'abdominal_visual_practice_v1', segmentation_version: 'abdominal_visual_v1',
    confidence_score: 0.42, average_score: 0, valid_reps: 0, total_reps: 0,
    grade: '未评分', segmentation_snapshot: { score_type: 'visual_practice', score_available: false, count_source: 'visual' },
    video: {
      user_id: 7n, source_type: 'miniapp', action_type: 'abdominal_crunch', short_clip: true,
      analysis_status: 'completed', quality_status: 'passed', manual_review: null,
      upload_time: new Date('2026-10-14'), video_key: null,
    },
  };
  const prisma = {
    videoEvaluationResult: { findUnique: async () => current, findFirst: async () => null },
    trainingAttendance: { count: async () => 1 },
    userBadge: { findMany: async () => [] },
  };
  const report = new ReportService(prisma, { getPatientAppConfig: async () => ({ weeklyTarget: 7 }) }, {
    buildSummary: async () => ({ stage: 'corrective' }), getSnapshotBadges: async () => [],
  }, {});
  const result = await report.getReport(429, 7);
  assert.equal(result.scoreAvailable, false);
  assert.equal(result.requiresManualReview, false);
  assert.equal(result.grade, '未评分');
  assert.match(result.reportFocusText, /训练已记录/);
  assert.equal(result.accuracyAvg, undefined);
  assert.equal(result.visualPhaseMetrics, undefined);
});

test('history does not present an unavailable visual practice score as zero points', async () => {
  const prisma = {
    trainingVideo: { findMany: async () => [{
      video_id: 429n, action_type: 'abdominal_crunch', analysis_status: 'completed',
      upload_time: new Date('2026-10-14'), duration: 20, fail_reason: null,
      video_evaluation_result: {
        average_score: 0, grade: '未评分',
        segmentation_snapshot: { score_type: 'visual_practice', score_available: false },
      },
      manual_review: null,
    }] },
  };
  const [item] = await new HistoryService(prisma).listHistoryVideos(7);
  assert.equal(item.status, 'completed');
  assert.equal(item.scoreType, 'visual_practice');
  assert.equal(item.scoreAvailable, false);
  assert.equal(item.averageScore, undefined);
});

test('history keeps validated visual evidence separate from legacy practice results', async () => {
  const prisma = {
    trainingVideo: { findMany: async () => [{
      video_id: 430n, action_type: 'abdominal_crunch', analysis_status: 'completed',
      upload_time: new Date('2026-10-14'), duration: 20, fail_reason: null,
      video_evaluation_result: {
        average_score: 91.6, grade: '本段完成',
        segmentation_snapshot: { score_type: 'visual_evidence', score_available: true },
      },
      manual_review: null,
    }] },
  };
  const [item] = await new HistoryService(prisma).listHistoryVideos(7);
  assert.equal(item.scoreType, 'visual_evidence');
  assert.equal(item.scoreAvailable, true);
  assert.equal(item.averageScore, 92);
});

test('history shows saved same-version preview but hides unsupported legacy score', async () => {
  const snapshot = {
    score_type: 'visual_practice', score_available: true,
    visual_evidence_preview: {
      version: 'abdominal_visual_evidence_v1', score_available: true,
      average_score: 87.6, rep_scores: [87.6],
    },
  };
  const prisma = {
    trainingVideo: { findMany: async () => [{
      video_id: 433n, action_type: 'abdominal_crunch', analysis_status: 'completed',
      upload_time: new Date('2026-10-14'), duration: 20, fail_reason: null,
      video_evaluation_result: {
        average_score: 99.9, grade: '练习完成', total_reps: 1,
        segmentation_snapshot: snapshot,
      },
      manual_review: null,
    }] },
  };
  const service = new HistoryService(prisma);
  const [previewItem] = await service.listHistoryVideos(7);
  assert.equal(previewItem.scoreType, 'visual_evidence');
  assert.equal(previewItem.averageScore, 88);
  snapshot.score_mode = 'evidence_shadow';
  const [shadowItem] = await service.listHistoryVideos(7);
  assert.equal(shadowItem.scoreType, 'visual_practice');
  assert.equal(shadowItem.averageScore, undefined);
  delete snapshot.score_mode;
  delete snapshot.visual_evidence_preview;
  const [legacyItem] = await service.listHistoryVideos(7);
  assert.equal(legacyItem.scoreType, 'visual_practice');
  assert.equal(legacyItem.averageScore, undefined);
});

test('motivation compares short clips only against reliable same-version results', async () => {
  const current = {
    video_id: 1n, created_at: new Date('2026-10-01'), average_score: 80, stability_avg: 80,
    avg_hold_duration: null, valid_reps: 1, grade: '合格', analysis_version: 'a1',
    template_version: 't1', segmentation_version: 's1', confidence_score: 0.9,
    video: { action_type: 'pelvic_tilt', short_clip: true, analysis_status: 'completed', quality_status: 'passed', manual_review: null },
  };
  let comparisonFilter;
  const prisma = { videoEvaluationResult: { findFirst: async ({ where }) => {
    comparisonFilter = where;
    return { average_score: 70, stability_avg: 70, avg_hold_duration: null, valid_reps: 10 };
  } } };
  const service = new MotivationService(prisma, {}, {
    getMotivationRules: async () => ({ scoreSlightDelta: 3, scoreClearDelta: 8,
      stabilitySlightDelta: 3, stabilityClearDelta: 8, durationSlightDelta: 0.5, durationClearDelta: 1.5 }),
  });
  const result = await service.compareWithPrevious(7, current);
  assert.equal(result.type, 'stability');
  assert.equal(result.validRepsDelta, undefined);
  assert.equal(comparisonFilter.video.short_clip, true);
  assert.equal(comparisonFilter.confidence_score.gte, 0.75);
  assert.deepEqual(comparisonFilter.video.OR, [
    { manual_review: { is: null } }, { manual_review: { is: { use_manual_result: false } } },
  ]);
  current.confidence_score = 0.5;
  assert.equal((await service.compareWithPrevious(7, current)).level, 'none');
});
