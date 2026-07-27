<template>
  <div class="asset-uploader">
    <div class="upload-area">
      <el-upload
        :http-request="handleUpload"
        :show-file-list="false"
        accept="image/*,video/*"
        :before-upload="beforeUpload"
        multiple
      >
        <el-button type="primary" :loading="uploading">上传文件</el-button>
      </el-upload>
      <span class="upload-tip">支持图片（JPG/PNG/GIF）和视频（MP4），单文件最大 20MB</span>
    </div>

    <div class="asset-list" v-if="modelValue.length">
      <div v-for="(url, idx) in modelValue" :key="idx" class="asset-item">
        <el-image
          v-if="isImageUrl(url)"
          :src="url"
          fit="cover"
          class="asset-preview"
          :preview-src-list="modelValue.filter(isImageUrl)"
          :initial-index="idx"
        />
        <div v-else class="asset-video">
          <video :src="url" class="asset-preview" />
          <el-icon class="video-icon"><VideoCamera /></el-icon>
        </div>
        <div class="asset-actions">
          <el-button type="danger" :icon="Delete" circle size="small" @click="removeItem(idx)" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Delete, VideoCamera } from '@element-plus/icons-vue';
import { presignUpload } from '@/services/guidance';
import http from '@/utils/request';

const props = defineProps<{
  modelValue: string[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: string[]): void;
}>();

const uploading = ref(false);

const MAX_SIZE = 20 * 1024 * 1024;

function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(url);
}

function beforeUpload(file: File) {
  if (file.size > MAX_SIZE) {
    ElMessage.error('文件大小不能超过 20MB');
    return false;
  }
  return true;
}

async function handleUpload(options: any) {
  uploading.value = true;
  try {
    const presign = await presignUpload();

    if (presign.uploadType === 's3_post') {
      const formData = new FormData();
      const fields = presign.uploadFields || {};
      Object.keys(fields).forEach((key) => {
        formData.append(key, fields[key]);
      });
      formData.append('file', options.file);

      await fetch(presign.uploadUrl, {
        method: 'POST',
        body: formData,
      });

      const newList = [...props.modelValue, presign.assetUrl];
      emit('update:modelValue', newList);
      ElMessage.success('上传成功');
      return;
    }

    const formData = new FormData();
    formData.append('objectKey', presign.objectKey);
    formData.append('file', options.file);

    const result = await http.post<{ assetUrl: string }>(presign.uploadUrl, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    const assetUrl = result.data.assetUrl;
    const newList = [...props.modelValue, assetUrl];
    emit('update:modelValue', newList);

    ElMessage.success('上传成功');
  } catch (err: any) {
    ElMessage.error('上传失败：' + (err?.message || '未知错误'));
  } finally {
    uploading.value = false;
  }
}

function removeItem(index: number) {
  const newList = [...props.modelValue];
  newList.splice(index, 1);
  emit('update:modelValue', newList);
}
</script>

<style scoped>
.upload-area {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 16px;
  border-radius: 18px;
  background: rgba(232, 242, 250, 0.72);
  border: 1px solid rgba(148, 180, 214, 0.2);
}

.upload-tip {
  font-size: 12px;
  color: var(--ink-500);
}

.asset-list {
  display: flex;
  gap: 12px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.asset-item {
  position: relative;
  width: 104px;
  height: 104px;
  border-radius: 18px;
  border: 1px solid rgba(148, 180, 214, 0.24);
  overflow: hidden;
  background: rgba(248, 251, 255, 0.9);
  box-shadow: 0 12px 30px rgba(15, 40, 79, 0.08);
}

.asset-preview {
  width: 104px;
  height: 104px;
  object-fit: cover;
}

.asset-video {
  position: relative;
  width: 104px;
  height: 104px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #dbefff, #eef6fb);
}

.asset-video video {
  width: 104px;
  height: 104px;
  object-fit: cover;
}

.video-icon {
  position: absolute;
  font-size: 24px;
  color: #fff;
  text-shadow: 0 0 8px rgba(0, 0, 0, 0.35);
}

.asset-actions {
  position: absolute;
  top: 8px;
  right: 8px;
}
</style>
