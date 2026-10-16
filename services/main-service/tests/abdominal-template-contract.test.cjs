const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });

const { ConfigService } = require('../src/config/config.service.ts');

function setup(sourceSchema, sourceOverrides = {}) {
  const video = {
    video_id: 7n, action_type: 'abdominal_crunch', source_type: 'gold_template',
    analysis_status: 'completed', video_key: 'gold.mp4',
    motion_feature_results: [
      { rep_id: 1, feature_code: 'abdominal_displacement', feature_value: 3.2 },
      { rep_id: 1, feature_code: 'displacement_velocity', feature_value: 0.6 },
      { rep_id: 1, feature_code: 'hold_duration', feature_value: 2.0 },
      { rep_id: 1, feature_code: 'trunk_angle_change', feature_value: 1.5 },
    ],
    rep_evaluation_results: [{ rep_id: 1, valid_flag: true }],
    video_evaluation_result: {
      total_reps: 1, valid_reps: 1,
      segmentation_snapshot: sourceSchema ? { feature_schema_version: sourceSchema } : {},
    },
    ...sourceOverrides,
  };
  const prisma = {
    trainingVideo: { findUnique: async () => video },
    standardActionTemplate: { findFirst: async () => null },
  };
  return new ConfigService(prisma);
}

test('old abdominal source cannot be relabeled as a current-angle template', async () => {
  await assert.rejects(
    setup(null).generateGoldTemplate({ actionType: 'abdominal_crunch', sourceVideoId: 7, sigmaMultiplier: 2 }),
    /同口径.*重新分析/,
  );
});

test('current-angle abdominal source generates a versioned unit contract', async () => {
  const result = await setup('abdominal_pose_v2').generateGoldTemplate({
    actionType: 'abdominal_crunch', sourceVideoId: 7, sigmaMultiplier: 2,
  });
  assert.equal(result.thresholdConfig._meta.feature_schema_version, 'abdominal_pose_v2');
  assert.equal(result.thresholdConfig.abdominal_displacement.unit, 'deg');
  assert.equal(result.thresholdConfig.displacement_velocity.unit, 'deg/s');
});

test('template-only review does not block rebuilding gold statistics from validated raw features', async () => {
  const source = setup('abdominal_pose_v2', {
    analysis_status: 'review_required', quality_status: 'passed',
    fail_reason: '当前缩腹金标准模板与本次分析的特征版本或单位不兼容，评分结果待复核',
    video_evaluation_result: { total_reps: 1, valid_reps: 1, confidence_score: 0.9,
      segmentation_snapshot: { feature_schema_version: 'abdominal_pose_v2' } },
  });
  const candidate = await source.generateGoldTemplate({ actionType: 'abdominal_crunch', sourceVideoId: 7 });
  assert.equal(candidate.thresholdConfig._meta.feature_schema_version, 'abdominal_pose_v2');
});

test('low-confidence reviewed gold source remains ineligible', async () => {
  const source = setup('abdominal_pose_v2', {
    analysis_status: 'review_required', quality_status: 'passed',
    fail_reason: '当前缩腹金标准模板与本次分析的特征版本或单位不兼容，评分结果待复核',
    video_evaluation_result: { total_reps: 1, valid_reps: 1, confidence_score: 0.5,
      segmentation_snapshot: { feature_schema_version: 'abdominal_pose_v2' } },
  });
  await assert.rejects(source.generateGoldTemplate({ actionType: 'abdominal_crunch', sourceVideoId: 7 }),
    /尚未完成分析|不满足提模条件/);
});

test('source picker includes only eligible reviewed abdominal gold videos', async () => {
  const reviewed = {
    video_id: 7n, source_type: 'gold_template', action_type: 'abdominal_crunch',
    analysis_status: 'review_required', quality_status: 'passed',
    fail_reason: '当前缩腹金标准模板与本次分析的特征版本或单位不兼容，评分结果待复核',
    created_at: new Date('2026-10-14T00:00:00Z'), duration: 12,
    video_evaluation_result: { total_reps: 1, confidence_score: 0.9, average_score: 0,
      grade: '待复核', segmentation_snapshot: { feature_schema_version: 'abdominal_pose_v2' } },
  };
  const service = new ConfigService({ trainingVideo: { findMany: async () => [reviewed, {
    ...reviewed, video_id: 8n, video_evaluation_result: { ...reviewed.video_evaluation_result, confidence_score: 0.5 },
  }] } });
  const result = await service.listGoldTemplateSourceVideos('abdominal_crunch');
  assert.deepEqual(result.items.map((item) => item.videoId), [7]);
});

const compatibleConfig = {
  _meta: { feature_schema_version: 'abdominal_pose_v2' },
  abdominal_displacement: { unit: 'deg' },
  displacement_velocity: { unit: 'deg/s' },
  hold_duration: { unit: 's' },
  trunk_angle_change: { unit: 'deg' },
};
const compatibleStats = Object.fromEntries(
  ['abdominal_displacement', 'displacement_velocity', 'hold_duration', 'trunk_angle_change']
    .map((code) => [code, { mean: 1, std: 0.1, n_cycles: 2 }]),
);

test('cannot save old-unit values as a new abdominal gold template', async () => {
  let created = false;
  const service = new ConfigService({ standardActionTemplate: {
    create: async () => { created = true; },
  } });
  await assert.rejects(service.saveGoldTemplateVersion({
    actionType: 'abdominal_crunch', version: 'candidate-v2', referenceStats: compatibleStats,
    thresholdConfig: { ...compatibleConfig, abdominal_displacement: { unit: '%' } },
  }, 'tester'), /特征版本或单位不兼容/);
  assert.equal(created, false);
});

test('cannot activate an incompatible new abdominal template', async () => {
  let activated = false;
  const service = new ConfigService({
    standardActionTemplate: {
      findUnique: async () => ({ template_id: 21n, action_type: 'abdominal_crunch', status: 0,
        ever_activated: false, threshold_config: { ...compatibleConfig, displacement_velocity: { unit: '%/s' } },
        reference_stats: compatibleStats }),
      updateMany: () => { activated = true; },
      update: () => { activated = true; },
    },
    $transaction: async () => { activated = true; },
  });
  await assert.rejects(service.updateGoldTemplateVersionStatus(21, 1), /特征版本或单位不兼容/);
  assert.equal(activated, false);
});

test('cannot create an active threshold tuning version from old template 19 values', async () => {
  let written = false;
  const service = new ConfigService({
    standardActionTemplate: {
      findFirst: async () => ({ template_id: 19n, action_type: 'abdominal_crunch', status: 1,
        threshold_config: { abdominal_displacement: { unit: '%' } }, reference_stats: compatibleStats }),
    },
    $transaction: async () => { written = true; },
  });
  await assert.rejects(service.createThresholdVersion({
    actionType: 'abdominal_crunch', thresholdConfig: { abdominal_displacement: { unit: '%' } },
    activate: true,
  }, 'tester'), /特征版本或单位不兼容/);
  assert.equal(written, false);
});
