import { request } from '@/utils/request';
import type { AnalysisStatus, TrainingActionType } from '@home-rehab-motion/shared-types';

export interface PatientListItem {
  patientId: number;
  name: string;
  openid: string;
  gender: string;
  age: number | null;
  registeredAt: string;
  totalTrainingCount: number;
  completedTrainingCount: number;
  averageScore: number | null;
  latestTrainingAt: string | null;
  latestGrade: string | null;
  latestVideoId: number | null;
}

export interface PatientListResponse {
  items: PatientListItem[];
  total: number;
  overview: {
    totalPatientCount: number;
    activeTrainingPatientCount: number;
    followUpPatientCount: number;
  };
  page: number;
  limit: number;
}

export interface PatientDetail {
  patientId: number;
  name: string;
  openid: string;
  gender: string;
  age: number | null;
  phone: string | null;
  registeredAt: string;
  trainingSummary: {
    totalTrainingCount: number;
    completedTrainingCount: number;
    averageScore: number | null;
    latestTrainingAt: string | null;
    latestGrade: string | null;
    pendingFeedbackCount: number;
  };
  videos: Array<{
    videoId: number;
    actionType: TrainingActionType;
    status: AnalysisStatus;
    uploadedAt: string;
    duration: number | null;
    averageScore: number | null;
    grade: string | null;
  }>;
  scoreTrend: Array<{
    videoId: number;
    actionType: TrainingActionType;
    uploadedAt: string;
    score: number;
    grade: string | null;
  }>;
}

export function getAdminPatientList(params: { keyword?: string; page?: number; limit?: number } = {}) {
  return request<PatientListResponse>({ url: '/admin/patients', method: 'GET', params });
}

export function getAdminPatientDetail(patientId: number) {
  return request<PatientDetail>({ url: `/admin/patients/${patientId}`, method: 'GET' });
}
