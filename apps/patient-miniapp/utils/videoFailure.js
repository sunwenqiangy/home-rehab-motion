"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVideoFailurePresentation = getVideoFailurePresentation;

function getVideoFailurePresentation(status, failReason) {
  const reason = `${failReason || ''}`.toLowerCase();
  if (status === 'quality_insufficient') {
    const uploadIncomplete = reason.includes('视频上传不完整')
      || reason.includes('视频文件信息不一致')
      || reason.includes('缺少原视频文件大小')
      || reason.includes('视频文件尚未上传');
    if (uploadIncomplete) {
      return { title: '视频文件未完整上传', tip: '训练记录已保留，但这段文件无法开始分析。', action: '请检查网络后重新选择手机里的原视频上传，不要使用聊天软件转发或剪辑过程中的临时文件。', canRetryUpload: true, showGuidanceAction: false };
    }
    const incompleteDecode = reason.includes('视频解码不完整') || reason.includes('video_decode_incomplete');
    if (incompleteDecode) {
      return { title: '视频文件暂时无法读取', tip: '训练记录已保留，但视频画面不完整，暂时无法可靠分析。', action: '请确认原视频可以完整播放后再上传；如仍无法读取，可稍后从训练记录查看。', canRetryUpload: true, showGuidanceAction: false };
    }
    const trunkKeypointsUnstable = reason.includes('关键躯干点') || reason.includes('肩髋');
    if (trunkKeypointsUnstable) {
      return { title: '拍摄画面暂不适合评估', tip: '训练记录已保留，但部分画面未能稳定识别到肩部或髋部。', action: '先查看拍摄要求，调整取景范围、光线和遮挡后再决定是否重新上传。', canRetryUpload: true, showGuidanceAction: true };
    }
    return { title: '暂未生成可靠的动作观察', tip: '训练记录已保留，这段视频暂时无法给出可靠的动作建议。', action: '先查看拍摄要求；如果方便，再重新拍摄一段完整、清晰的动作。', canRetryUpload: true, showGuidanceAction: true };
  }
  if (status === 'failed') {
    if (reason.includes('quality') || reason.includes('姿势') || reason.includes('角度') || reason.includes('关键躯干点') || reason.includes('肩髋')) {
      return { title: '拍摄画面暂不适合评估', tip: '训练记录已保留，但这段视频暂时无法给出可靠的动作观察。', action: '先查看拍摄要求，调整取景范围、光线和遮挡后再决定是否重新上传。', canRetryUpload: true, showGuidanceAction: true };
    }
    if (reason.includes('analysis_queue_unavailable') || reason.includes('分析服务') || reason.includes('timeout')) {
      return { title: '分析服务暂时繁忙', tip: '训练记录已保留，暂时没有生成动作观察。', action: '建议稍后从训练记录查看，不需要立即重新上传。', canRetryUpload: false, showGuidanceAction: false };
    }
    return { title: '本次训练已记录', tip: '视频已经保存，但本次动作观察没有完成。', action: '不影响训练记录；稍后可从训练记录查看，必要时再重新上传。', canRetryUpload: true, showGuidanceAction: false };
  }
  return { title: '本次训练已记录', tip: '视频已经保存，但本次动作观察没有完成。', action: '不影响训练记录；稍后可从训练记录查看。', canRetryUpload: false, showGuidanceAction: false };
}
