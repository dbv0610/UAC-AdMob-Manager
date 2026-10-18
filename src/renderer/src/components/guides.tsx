import { useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { cx } from './ui';

// Hướng dẫn lấy từng thông tin cần nhập, đặt ngay cạnh ô nhập. Mỗi bước có nút mở đúng trang Google
// (domain nằm trong whitelist openExternal của main).

interface GuideStep {
  text: ReactNode;
  link?: { label: string; url: string };
}
interface GuideDef {
  title: string;
  intro?: ReactNode;
  steps: GuideStep[];
  note?: ReactNode;
}

const C = 'https://console.cloud.google.com';
const code = (s: string) => <code className="rounded bg-surface-2 px-1 font-mono text-[12px]">{s}</code>;

export const GUIDES = {
  cloudSetup: {
    title: 'Chuẩn bị Google Cloud (làm 1 lần, ~5 phút)',
    intro: 'Cần một project Google Cloud để Google cho app đăng nhập và gọi API. Nên tạo project riêng tên dễ nhận — tên project hiện trên màn đăng nhập Google.',
    steps: [
      { text: <>Tạo project mới (ví dụ “AppOps Studio”), rồi chọn project đó ở thanh trên cùng của Google Cloud.</>, link: { label: 'Tạo project', url: `${C}/projectcreate` } },
      { text: <>Bật <b>Google Ads API</b> (rồi xin mức Explorer — xem hướng dẫn mức truy cập bên dưới).</>, link: { label: 'Bật Google Ads API', url: `${C}/apis/library/googleads.googleapis.com` } },
      { text: <>Bật <b>AdMob API</b>.</>, link: { label: 'Bật AdMob API', url: `${C}/apis/library/admob.googleapis.com` } },
      { text: <>Bật <b>YouTube Data API v3</b> (nếu dùng upload video).</>, link: { label: 'Bật YouTube Data API', url: `${C}/apis/library/youtube.googleapis.com` } },
      { text: <>Bật <b>Google Play Android Developer API</b> và <b>Google Play Developer Reporting API</b> (nếu dùng màn Google Play).</>, link: { label: 'Bật Play Developer API', url: `${C}/apis/library/androidpublisher.googleapis.com` } },
      { text: <>Cấu hình màn đồng ý OAuth: <b>Get started</b> → nhập tên app, email hỗ trợ → Audience chọn <b>External</b> → nhập email liên hệ → Create.</>, link: { label: 'Mở OAuth consent', url: `${C}/auth/overview` } },
      {
        text: <>Vào <b>Audience</b>: hoặc bấm <b>Publish app</b> (khuyên dùng — token không hết hạn sau 7 ngày; khi đăng nhập bấm “Nâng cao → Đi tới …” để qua cảnh báo chưa xác minh), hoặc giữ Testing và <b>Add users</b> thêm <u>mọi email</u> sẽ đăng nhập (Ads, AdMob, YouTube).</>,
        link: { label: 'Mở Audience / Test users', url: `${C}/auth/audience` },
      },
    ],
    note: <>Lỗi “<i>… chưa hoàn tất quy trình xác minh của Google … 403 access_denied</i>” = email đăng nhập không có trong Test users của <b>đúng project</b> chứa OAuth client bên dưới. Đối chiếu project number hiện ở ô “Đang dùng”.</>,
  },
  oauthClient: {
    title: 'Lấy Client ID và Client secret',
    steps: [
      { text: <>Mở <b>Clients</b> → <b>Create client</b>.</>, link: { label: 'Tạo OAuth client', url: `${C}/auth/clients/create` } },
      { text: <>Application type chọn <b>Desktop app</b> (không chọn Web application), đặt tên bất kỳ → <b>Create</b>.</> },
      { text: <>Sao chép <b>Client ID</b> (dạng {code('123…-abc.apps.googleusercontent.com')}) và <b>Client secret</b> (dạng {code('GOCSPX-…')}) dán vào hai ô bên dưới. Có thể dán nguyên nội dung file JSON tải về vào ô Client ID — app tự tách.</> },
    ],
    note: 'Client secret loại Desktop không phải bí mật tuyệt đối theo Google, nhưng app vẫn mã hóa bằng keychain của máy.',
  },
  adsAccess: {
    title: 'Mức truy cập Google Ads API (theo Cloud project)',
    intro: <>Từ 9/9/2026 Google bỏ developer token: mức truy cập do <b>Google Cloud project chứa OAuth client</b> quyết định (project number hiện ở ô “Đang dùng” phía trên). Không xin quyền ở API Center trong MCC nữa — yêu cầu từ đó không được xử lý.</>,
    steps: [
      { text: <>Bật <b>Google Ads API</b> trong đúng project đó. Bật xong project tự ở mức <b>Test</b>: chỉ dùng được tài khoản test.</>, link: { label: 'Bật Google Ads API', url: `${C}/apis/library/googleads.googleapis.com` } },
      { text: <>Mở <b>Google Ads API → Overview</b> của project → mục <b>Upgrade access level</b> → mức tiếp theo là <b>Explorer</b> → <b>Apply for access</b>. Thường được nâng tự động ngay. Explorer dùng được tài khoản thật, tối đa 2.880 thao tác/ngày — đủ cho app này.</>, link: { label: 'Mở Google Ads API Overview', url: `${C}/apis/api/googleads.googleapis.com/overview` } },
      { text: <>Cần nhiều hơn (<b>Basic</b>: 15.000 thao tác/ngày): hoàn tất <b>xác minh thương hiệu</b> ở Google Auth Platform → Branding (tên app, logo, trang chủ, chính sách bảo mật, xác minh tên miền trong Search Console), rồi quay lại Overview bấm Apply cho Basic — duyệt tự động sau vài phút.</>, link: { label: 'Mở Branding', url: `${C}/auth/branding` } },
      { text: <>Cần quyền <b>Owner, Editor, Quota Administrator</b> hoặc <b>Service Usage Admin</b> trên project để đổi mức truy cập.</> },
    ],
    note: <>Bị từ chối Explorer/Basic dù đã xác minh: thường do project dùng gói <b>Free Trial</b> hoặc tài khoản thanh toán bị tạm ngưng — nâng lên gói trả phí rồi nộp lại, hoặc gỡ billing nếu project chỉ dùng cho Google Ads API. API chỉ đọc được tài khoản Google Ads <b>đã thiết lập xong</b> (đã nhập thanh toán).{' '}
      <LinkButton url="https://developers.google.com/google-ads/api/docs/access-levels">Tài liệu mức truy cập</LinkButton></>,
  },
  adsSignIn: {
    title: 'Đăng nhập Google Ads',
    steps: [
      { text: <>Dùng email có quyền <b>quản trị hoặc chuẩn</b> trên MCC (hoặc trên tài khoản quảng cáo). App tự đọc cả cây tài khoản dưới MCC, không cần nhập customer ID.</> },
      { text: <>Google hỏi chọn tài khoản → chọn đúng email → cho phép quyền “Quản lý chiến dịch Google Ads”.</> },
      { text: <>Báo lỗi CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION → Cloud project còn ở mức Test; xin Explorer theo hướng dẫn “Mức truy cập Google Ads API” ở bước 0.</> },
    ],
  },
  admobSignIn: {
    title: 'Đăng nhập AdMob',
    steps: [
      { text: <>Dùng email là <b>chủ sở hữu hoặc có quyền xem báo cáo</b> trong AdMob. Publisher ID ({code('pub-…')}) được đọc tự động.</>, link: { label: 'Mở AdMob', url: 'https://admob.google.com/' } },
      { text: <>Kiểm tra quyền: AdMob → <b>Cài đặt → Truy cập và ủy quyền</b>; email phải có trong danh sách người dùng.</> },
      { text: <>Email AdMob khác email Google Ads thì phải thêm cả hai vào Test users (nếu project đang Testing).</> },
    ],
  },
  youtube: {
    title: 'YouTube: có cần không?',
    intro: <>Thường <b>không cần</b>: Creatives → Upload video → chọn <b>Qua Google Ads</b> sẽ đưa video lên kênh YouTube do Google quản lý của tài khoản Ads, chỉ cần đã đăng nhập Google Ads. Chỉ đăng nhập YouTube khi muốn video nằm trên kênh của chính bạn.</>,
    steps: [
      { text: <>Đăng nhập email quản lý kênh sẽ chứa video quảng cáo (kênh thương hiệu: chọn đúng kênh khi Google hỏi).</> },
      { text: <>Project chưa qua <b>YouTube API Audit</b> thì video upload qua API bị ép <b>Private</b> và không gắn vào quảng cáo được. Gửi form audit (miễn phí, duyệt vài tuần).</>, link: { label: 'Form YouTube API Audit', url: 'https://support.google.com/youtube/contact/yt_api_form' } },
      { text: <>Trong lúc chờ: upload tay trên YouTube Studio (chế độ Unlisted), rồi dùng <b>Creatives → Nhập ID YouTube</b>.</>, link: { label: 'Mở YouTube Studio', url: 'https://studio.youtube.com/' } },
    ],
  },
  playSignIn: {
    title: 'Đăng nhập Google Play',
    steps: [
      { text: <>Bật <b>Google Play Android Developer API</b> trong đúng project Google Cloud của OAuth client.</>, link: { label: 'Bật Play Developer API', url: `${C}/apis/library/androidpublisher.googleapis.com` } },
      { text: <>Bật <b>Google Play Developer Reporting API</b> (tab Vitals: crash/ANR). Tài khoản Play đã đăng nhập trước khi có Vitals cần đăng nhập lại một lần để cấp thêm quyền.</>, link: { label: 'Bật Reporting API', url: `${C}/apis/library/playdeveloperreporting.googleapis.com` } },
      { text: <>Play Console → <b>Người dùng và quyền</b> → cấp cho email đăng nhập đúng quyền cần dùng: <b>Quản lý sự hiện diện trên cửa hàng</b> (Store listing), <b>Phát hành ứng dụng</b> (Release), <b>Trả lời bài đánh giá</b> (Review), <b>Xem thông tin ứng dụng</b> (Vitals).</>, link: { label: 'Mở Play Console', url: 'https://play.google.com/console' } },
      { text: <>App phải đã được tạo trên Play Console và upload ít nhất một APK/AAB — API không sửa được app chưa có bản build nào.</> },
      { text: <>Map app ở <b>Cài đặt → App</b> với package name (cửa hàng Google Play). Nhiều tài khoản Play: app tự dò tài khoản có quyền với từng app.</> },
    ],
  },
  firebaseSignIn: {
    title: 'Đăng nhập Firebase (Remote Config)',
    steps: [
      { text: <>Bật <b>Firebase Remote Config API</b> và <b>Firebase Management API</b> trong đúng Cloud project của OAuth client.</>, link: { label: 'Bật Remote Config API', url: `${C}/apis/library/firebaseremoteconfig.googleapis.com` } },
      { text: <>Bật Firebase Management API (để liệt kê project và app).</>, link: { label: 'Bật Management API', url: `${C}/apis/library/firebase.googleapis.com` } },
      { text: <>Email đăng nhập cần vai trò <b>Owner / Editor</b> hoặc <b>Remote Config Admin</b> ở từng project Firebase (Firebase Console → Project settings → Users and permissions).</>, link: { label: 'Mở Firebase Console', url: 'https://console.firebase.google.com/' } },
      { text: <>Khi đăng nhập, Google hỏi quyền “Xem, sửa, cấu hình dữ liệu Google Cloud” (scope <code className="font-mono text-[12px]">cloud-platform</code> — Remote Config API yêu cầu quyền này với tài khoản người dùng). App chỉ gọi Remote Config và Firebase Management.</> },
      { text: <>Đăng nhập xong app tự đọc mọi project + app Android/iOS; vào màn <b>Remote Config</b> để làm việc.</> },
    ],
  },
  aiKey: {
    title: 'Lấy API key Claude cho AI dịch',
    steps: [
      { text: <>Đăng nhập Claude Console, vào <b>API Keys</b> → <b>Create Key</b>.</>, link: { label: 'Mở Claude Console', url: 'https://console.anthropic.com/settings/keys' } },
      { text: <>Nạp credit ở <b>Billing</b> (dịch 1 bộ text sang 20 ngôn ngữ tốn khoảng vài cent).</>, link: { label: 'Mở Billing', url: 'https://console.anthropic.com/settings/billing' } },
      { text: <>Dán key (dạng {code('sk-ant-…')}) vào ô bên dưới. Key được mã hóa bằng keychain của máy, chỉ main process dùng để gọi API.</> },
    ],
  },
  telegram: {
    title: 'Tạo bot Telegram để nhận thông báo',
    steps: [
      { text: <>Mở Telegram, chat với <b>@BotFather</b>, gửi {code('/newbot')}, đặt tên và username (kết thúc bằng {code('bot')}).</>, link: { label: 'Mở @BotFather', url: 'https://t.me/BotFather' } },
      { text: <>BotFather trả về <b>token</b> dạng {code('123456789:AAH…')}. Dán vào ô bên dưới rồi bấm <b>Lưu token</b>. Token mã hóa bằng keychain của máy, chỉ main process dùng.</> },
      { text: <>Mở chat với bot vừa tạo, bấm <b>Start</b> (hoặc gửi một tin bất kỳ), rồi bấm <b>Tìm chat</b> ở đây để app biết gửi tin cho ai.</> },
      { text: <>Bấm <b>Gửi thử</b>: bot nhắn bản tin số liệu hiện tại về điện thoại.</> },
    ],
  },
  appIds: {
    title: 'Lấy package name và AdMob app ID',
    steps: [
      { text: <><b>Package name</b> (Google Play): phần sau {code('id=')} trong link Play Store, ví dụ {code('play.google.com/store/apps/details?id=com.streamwave.tv')} → {code('com.streamwave.tv')}. Hoặc Play Console → chọn app → dưới tên app.</>, link: { label: 'Mở Play Console', url: 'https://play.google.com/console' } },
      { text: <><b>App Store ID</b> (iOS): dãy số sau {code('id')} trong link App Store, ví dụ {code('apps.apple.com/app/id1234567890')} → {code('1234567890')}.</> },
      { text: <><b>AdMob app ID</b>: AdMob → <b>Ứng dụng → Xem tất cả ứng dụng</b> → cột App ID, dạng {code('ca-app-pub-1234567890123456~1234567890')} (có dấu {code('~')}, khác ad unit ID có dấu {code('/')}).</>, link: { label: 'Mở danh sách app AdMob', url: 'https://admob.google.com/v2/apps/list' } },
      { text: <><b>Tài khoản Google Ads</b>: chọn trong danh sách — có sau khi đăng nhập Google Ads ở bước 1.</> },
    ],
  },
} satisfies Record<string, GuideDef>;

export type GuideId = keyof typeof GUIDES;

function LinkButton({ url, children }: { url: string; children: ReactNode }) {
  return (
    <button type="button" className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline" onClick={() => void api.app.openExternal(url)}>
      {children} <ExternalLink className="size-3" aria-hidden />
    </button>
  );
}

export function Guide({ id, defaultOpen = false }: { id: GuideId; defaultOpen?: boolean }) {
  const g: GuideDef = GUIDES[id];
  // null = người dùng chưa bấm: theo defaultOpen (có thể đổi khi trạng thái cấu hình tải xong)
  const [toggled, setOpen] = useState<boolean | null>(null);
  const open = toggled ?? defaultOpen;
  return (
    <div className="rounded-lg border border-info/30 bg-info/5 text-sm">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-info">
        <BookOpen className="size-4 shrink-0" aria-hidden />
        <span className="flex-1">Hướng dẫn: {g.title}</span>
        <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2 border-t border-info/20 px-3 py-3">
          {g.intro && <p className="text-muted">{g.intro}</p>}
          <ol className="space-y-2">
            {g.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="num flex size-5 shrink-0 items-center justify-center rounded-full bg-info/15 text-xs font-semibold text-info">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p>{s.text}</p>
                  {s.link && <LinkButton url={s.link.url}>{s.link.label}</LinkButton>}
                </div>
              </li>
            ))}
          </ol>
          {g.note && <p className="rounded-sm bg-surface p-2 text-xs text-muted">{g.note}</p>}
        </div>
      )}
    </div>
  );
}
