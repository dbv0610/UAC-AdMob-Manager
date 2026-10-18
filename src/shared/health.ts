// Cờ “sức khỏe” cho từng camp / creative: hàm thuần, dùng ở danh sách (nhãn đếm) và ngăn chi tiết (lý do + gợi ý).
import type { CampaignRow } from './types';
import type { Creative } from './creative';

export type FlagLevel = 'danger' | 'warning' | 'info';
export interface HealthFlag {
  level: FlagLevel;
  message: string;
}

// days = số ngày của kỳ số liệu camp (7/14/30); pendingSuggestions = đề xuất rule đang chờ cho camp
export function campaignFlags(c: CampaignRow, days: number, pendingSuggestions = 0, fmtMoney: (micros: number) => string = (m) => String(m / 1e6)): HealthFlag[] {
  const out: HealthFlag[] = [];
  const perDay = c.costMicros / Math.max(1, days);
  const cpa = c.conversions > 0 ? c.costMicros / c.conversions : null;

  if (c.status === 'ENABLED' && c.costMicros === 0) {
    out.push({ level: 'warning', message: 'Đang bật nhưng không chi tiêu trong kỳ — kiểm tra quảng cáo bị từ chối, asset hoặc giá thầu quá thấp' });
  }
  const noConvBar = Math.max(2 * (c.targetCpaMicros ?? 0), 2 * c.budgetMicros);
  if (c.conversions === 0 && c.costMicros > 0 && c.costMicros >= noConvBar) {
    out.push({ level: 'danger', message: `Chi ${fmtMoney(c.costMicros)} mà chưa có chuyển đổi nào` });
  }
  if (cpa != null && c.targetCpaMicros && c.conversions >= 10 && cpa > c.targetCpaMicros * 1.3) {
    out.push({ level: 'warning', message: `CPA ${fmtMoney(cpa)} vượt tCPI ${fmtMoney(c.targetCpaMicros)} hơn 30%` });
  }
  if (c.status === 'ENABLED' && c.budgetMicros > 0 && perDay >= c.budgetMicros * 0.95) {
    out.push({ level: 'info', message: `Tiêu gần hết ngân sách mỗi ngày (${fmtMoney(perDay)}/${fmtMoney(c.budgetMicros)}) — có thể đang bị giới hạn ngân sách` });
  }
  if (c.budgetShared) out.push({ level: 'info', message: 'Ngân sách dùng chung với camp khác — đổi ngân sách sẽ ảnh hưởng cả nhóm' });
  if (pendingSuggestions > 0) out.push({ level: 'info', message: `${pendingSuggestions} đề xuất rule đang chờ duyệt` });
  return out;
}

// Tỉ lệ ngân sách đã dùng mỗi ngày (0..∞), null khi không có ngân sách
export const budgetPacing = (c: CampaignRow, days: number) => (c.budgetMicros > 0 ? c.costMicros / Math.max(1, days) / c.budgetMicros : null);

export function creativeFlags(c: Creative): HealthFlag[] {
  const out: HealthFlag[] = [];
  if (c.status === 'FAILED') out.push({ level: 'danger', message: c.error?.message ?? 'Upload lỗi' });
  if (c.status === 'LOCKED') out.push({ level: 'danger', message: c.error?.message ?? 'YouTube khóa video ở chế độ Private — Google Ads không dùng được' });
  if (c.kind === 'video' && !c.aspect) out.push({ level: 'warning', message: 'Chưa rõ tỉ lệ khung hình — Google Ads cần biết ngang/dọc/vuông' });
  if (c.kind === 'video' && c.durationS != null && c.durationS < 10) out.push({ level: 'warning', message: 'Video ngắn hơn 10 giây — App campaign yêu cầu tối thiểu 10 giây' });
  if (c.kind === 'video' && c.status === 'READY' && c.linkedCustomers === 0) out.push({ level: 'info', message: 'Sẵn sàng nhưng chưa gắn vào camp nào' });
  if (c.status === 'LOCAL' && c.kind === 'video' && c.source === 'file') out.push({ level: 'info', message: 'Chưa upload — cần upload trước khi gắn vào camp' });
  return out;
}
