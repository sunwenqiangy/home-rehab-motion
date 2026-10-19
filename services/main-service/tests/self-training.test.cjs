const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
const { MotivationService } = require('../src/motivation/motivation.service.ts');

function setup() {
  const records = [];
  let enabled = false;
  let failBadges = false;
  const attendance = {
    findUnique: async ({ where }) => records.find(r => r.video_id === where.video_id) || null,
    findFirst: async ({ where }) => records.find(r => Object.entries(where).every(([key, value]) => value instanceof Date ? r[key].getTime() === value.getTime() : r[key] === value)) || null,
    create: async ({ data }) => {
      const row = { ...data, attendance_id: BigInt(records.length + 1), action_type: data.action_type || null };
      records.push(row);
      return row;
    },
  };
  const prisma = { trainingAttendance: attendance, $transaction: fn => fn({ $queryRaw: async () => [], trainingAttendance: attendance }) };
  const badge = { evaluateAndAwardBadges: async () => { if (failBadges) throw new Error('badge unavailable'); } };
  const config = { getPatientAppConfig: async () => ({ selfTrainingEnabled: enabled }) };
  const service = new MotivationService(prisma, badge, config);
  service.buildSummary = async () => ({ totalTrainingDays: records.filter(r => r.counted_for_training_day).length, consecutiveTrainingDays: 1 });
  service.logger.error = () => {};
  return { service, records, enable: () => { enabled = true; }, failBadges: () => { failBadges = true; } };
}

test('开关关闭时不能创建，开启后重复提交返回同一条记录', async () => {
  const state = setup();
  await assert.rejects(() => state.service.recordSelfTraining(1), /自主记录暂未开放/);
  state.enable();
  await assert.rejects(() => state.service.recordSelfTraining(1, 'invalid'), /不支持的动作类型/);
  const first = await state.service.recordSelfTraining(1);
  assert.equal((await state.service.recordSelfTraining(1)).id, first.id);
  assert.equal(state.records.length, 1);
  await assert.rejects(() => state.service.getSelfTraining(2, first.id), /练习记录不存在/);
});

test('自主记录和视频无论先后，同一天只计一个训练日', async () => {
  for (const selfFirst of [true, false]) {
    const state = setup(); state.enable();
    const self = () => state.service.recordSelfTraining(1);
    const video = () => state.service.recordConfirmedTraining(1, 11, new Date());
    if (selfFirst) { await self(); await video(); } else { await video(); await self(); }
    assert.equal(state.records.filter(r => r.counted_for_training_day).length, 1);
  }
});

test('徽章更新失败时已保存的记录仍返回成功，重复请求不会新增', async () => {
  const state = setup(); state.enable(); state.failBadges();
  const first = await state.service.recordSelfTraining(1);
  assert.equal((await state.service.recordSelfTraining(1)).id, first.id);
  assert.equal(state.records.length, 1);
});
