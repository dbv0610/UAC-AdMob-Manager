// Bảng quốc gia/ngôn ngữ dùng chung main + renderer.
// geo target constant của quốc gia = 2000 + mã số ISO 3166-1 (US 840 → 2840).
// language constant lấy theo bảng Google Ads (SELECT language_constant.id, language_constant.code FROM language_constant);
// nếu Google đổi ID, validate_only ở bước Kiểm tra sẽ báo lỗi ngay trên ô ngôn ngữ.

export interface Language {
  code: string; // mã Google Ads (zh_CN, iw…)
  id: number; // languageConstants/<id>
  name: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en', id: 1000, name: 'Tiếng Anh' },
  { code: 'de', id: 1001, name: 'Tiếng Đức' },
  { code: 'fr', id: 1002, name: 'Tiếng Pháp' },
  { code: 'es', id: 1003, name: 'Tiếng Tây Ban Nha' },
  { code: 'it', id: 1004, name: 'Tiếng Ý' },
  { code: 'ja', id: 1005, name: 'Tiếng Nhật' },
  { code: 'da', id: 1009, name: 'Tiếng Đan Mạch' },
  { code: 'nl', id: 1010, name: 'Tiếng Hà Lan' },
  { code: 'fi', id: 1011, name: 'Tiếng Phần Lan' },
  { code: 'ko', id: 1012, name: 'Tiếng Hàn' },
  { code: 'no', id: 1013, name: 'Tiếng Na Uy' },
  { code: 'pt', id: 1014, name: 'Tiếng Bồ Đào Nha' },
  { code: 'sv', id: 1015, name: 'Tiếng Thụy Điển' },
  { code: 'zh_CN', id: 1017, name: 'Tiếng Trung giản thể' },
  { code: 'zh_TW', id: 1018, name: 'Tiếng Trung phồn thể' },
  { code: 'ar', id: 1019, name: 'Tiếng Ả Rập' },
  { code: 'bg', id: 1020, name: 'Tiếng Bulgaria' },
  { code: 'cs', id: 1021, name: 'Tiếng Séc' },
  { code: 'el', id: 1022, name: 'Tiếng Hy Lạp' },
  { code: 'hi', id: 1023, name: 'Tiếng Hindi' },
  { code: 'hu', id: 1024, name: 'Tiếng Hungary' },
  { code: 'id', id: 1025, name: 'Tiếng Indonesia' },
  { code: 'iw', id: 1027, name: 'Tiếng Do Thái' },
  { code: 'pl', id: 1030, name: 'Tiếng Ba Lan' },
  { code: 'ru', id: 1031, name: 'Tiếng Nga' },
  { code: 'ro', id: 1032, name: 'Tiếng Romania' },
  { code: 'sk', id: 1033, name: 'Tiếng Slovakia' },
  { code: 'uk', id: 1036, name: 'Tiếng Ukraina' },
  { code: 'tr', id: 1037, name: 'Tiếng Thổ Nhĩ Kỳ' },
  { code: 'hr', id: 1039, name: 'Tiếng Croatia' },
  { code: 'vi', id: 1040, name: 'Tiếng Việt' },
  { code: 'ur', id: 1041, name: 'Tiếng Urdu' },
  { code: 'tl', id: 1042, name: 'Tiếng Filipino' },
  { code: 'th', id: 1044, name: 'Tiếng Thái' },
  { code: 'bn', id: 1056, name: 'Tiếng Bengal' },
  { code: 'fa', id: 1064, name: 'Tiếng Ba Tư' },
  { code: 'ms', id: 1102, name: 'Tiếng Mã Lai' },
];

export interface Country {
  code: string; // ISO-2
  numeric: number; // ISO 3166-1 numeric
  name: string;
  languages: string[]; // mặc định khi thêm vào kế hoạch
}

const C = (code: string, numeric: number, name: string, ...languages: string[]): Country => ({ code, numeric, name, languages });

export const COUNTRIES: Country[] = [
  // Bắc Mỹ, châu Đại Dương
  C('US', 840, 'Hoa Kỳ', 'en'),
  C('CA', 124, 'Canada', 'en', 'fr'),
  C('AU', 36, 'Úc', 'en'),
  C('NZ', 554, 'New Zealand', 'en'),
  // Châu Âu
  C('GB', 826, 'Vương quốc Anh', 'en'),
  C('IE', 372, 'Ireland', 'en'),
  C('DE', 276, 'Đức', 'de'),
  C('FR', 250, 'Pháp', 'fr'),
  C('IT', 380, 'Ý', 'it'),
  C('ES', 724, 'Tây Ban Nha', 'es'),
  C('PT', 620, 'Bồ Đào Nha', 'pt'),
  C('NL', 528, 'Hà Lan', 'nl'),
  C('BE', 56, 'Bỉ', 'nl', 'fr'),
  C('AT', 40, 'Áo', 'de'),
  C('CH', 756, 'Thụy Sĩ', 'de', 'fr', 'it'),
  C('SE', 752, 'Thụy Điển', 'sv'),
  C('NO', 578, 'Na Uy', 'no'),
  C('DK', 208, 'Đan Mạch', 'da'),
  C('FI', 246, 'Phần Lan', 'fi'),
  C('PL', 616, 'Ba Lan', 'pl'),
  C('CZ', 203, 'Séc', 'cs'),
  C('SK', 703, 'Slovakia', 'sk'),
  C('HU', 348, 'Hungary', 'hu'),
  C('RO', 642, 'Romania', 'ro'),
  C('BG', 100, 'Bulgaria', 'bg'),
  C('HR', 191, 'Croatia', 'hr'),
  C('GR', 300, 'Hy Lạp', 'el'),
  C('UA', 804, 'Ukraina', 'uk', 'ru'),
  C('TR', 792, 'Thổ Nhĩ Kỳ', 'tr'),
  // Đông Á
  C('JP', 392, 'Nhật Bản', 'ja'),
  C('KR', 410, 'Hàn Quốc', 'ko'),
  C('TW', 158, 'Đài Loan', 'zh_TW'),
  C('HK', 344, 'Hồng Kông', 'zh_TW', 'en'),
  // Đông Nam Á
  C('VN', 704, 'Việt Nam', 'vi'),
  C('TH', 764, 'Thái Lan', 'th'),
  C('ID', 360, 'Indonesia', 'id'),
  C('PH', 608, 'Philippines', 'en', 'tl'),
  C('MY', 458, 'Malaysia', 'ms', 'en'),
  C('SG', 702, 'Singapore', 'en', 'zh_CN'),
  C('KH', 116, 'Campuchia', 'en'),
  C('MM', 104, 'Myanmar', 'en'),
  // Nam Á
  C('IN', 356, 'Ấn Độ', 'en', 'hi'),
  C('PK', 586, 'Pakistan', 'en', 'ur'),
  C('BD', 50, 'Bangladesh', 'bn', 'en'),
  C('LK', 144, 'Sri Lanka', 'en'),
  // Trung Đông, châu Phi
  C('SA', 682, 'Ả Rập Xê Út', 'ar', 'en'),
  C('AE', 784, 'UAE', 'ar', 'en'),
  C('QA', 634, 'Qatar', 'ar', 'en'),
  C('KW', 414, 'Kuwait', 'ar', 'en'),
  C('IL', 376, 'Israel', 'iw', 'en'),
  C('EG', 818, 'Ai Cập', 'ar'),
  C('MA', 504, 'Maroc', 'ar', 'fr'),
  C('DZ', 12, 'Algeria', 'ar', 'fr'),
  C('NG', 566, 'Nigeria', 'en'),
  C('KE', 404, 'Kenya', 'en'),
  C('ZA', 710, 'Nam Phi', 'en'),
  // Mỹ Latinh
  C('BR', 76, 'Brazil', 'pt'),
  C('MX', 484, 'Mexico', 'es'),
  C('AR', 32, 'Argentina', 'es'),
  C('CO', 170, 'Colombia', 'es'),
  C('CL', 152, 'Chile', 'es'),
  C('PE', 604, 'Peru', 'es'),
  C('EC', 218, 'Ecuador', 'es'),
  C('UY', 858, 'Uruguay', 'es'),
  C('PY', 600, 'Paraguay', 'es'),
  C('BO', 68, 'Bolivia', 'es'),
  C('GT', 320, 'Guatemala', 'es'),
  C('CR', 188, 'Costa Rica', 'es'),
  C('PA', 591, 'Panama', 'es'),
  C('DO', 214, 'CH Dominica', 'es'),
];

export const COUNTRY_GROUPS: { id: string; name: string; codes: string[] }[] = [
  { id: 'tier1', name: 'Tier 1', codes: ['US', 'CA', 'GB', 'AU', 'NZ', 'DE', 'FR', 'JP', 'KR', 'CH', 'NL', 'SE', 'NO', 'DK'] },
  { id: 'sea', name: 'SEA', codes: ['VN', 'TH', 'ID', 'PH', 'MY', 'SG', 'KH', 'MM'] },
  { id: 'latam', name: 'LATAM', codes: ['BR', 'MX', 'AR', 'CO', 'CL', 'PE', 'EC', 'UY', 'PY', 'BO', 'GT', 'CR', 'PA', 'DO'] },
  {
    id: 'eu',
    name: 'EU',
    codes: ['DE', 'FR', 'IT', 'ES', 'PT', 'NL', 'BE', 'AT', 'IE', 'SE', 'DK', 'FI', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'GR'],
  },
  { id: 'mena', name: 'MENA', codes: ['SA', 'AE', 'QA', 'KW', 'IL', 'EG', 'MA', 'DZ', 'TR'] },
];

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
const langByCode = new Map(LANGUAGES.map((l) => [l.code, l]));
const countryByGeoId = new Map(COUNTRIES.map((c) => [2000 + c.numeric, c]));

export const getCountry = (code: string) => byCode.get(code.toUpperCase());
export const getLanguage = (code: string) => langByCode.get(code);

export function geoTargetId(code: string): number {
  const c = getCountry(code);
  if (!c) throw new Error(`Quốc gia không có trong bảng geo: ${code}`);
  return 2000 + c.numeric;
}

export function languageId(code: string): number {
  const l = getLanguage(code);
  if (!l) throw new Error(`Ngôn ngữ không có trong bảng: ${code}`);
  return l.id;
}

// Dùng ở Module 3: geographic_view.country_criterion_id → ISO-2
export const countryFromGeoId = (id: number | string) => countryByGeoId.get(Number(id))?.code ?? null;

// Cờ emoji từ mã ISO (Windows không vẽ cờ, nên UI luôn hiện kèm mã)
export const flag = (code: string) =>
  String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

export function searchCountries(q: string): Country[] {
  const s = q.trim().toLowerCase();
  if (!s) return COUNTRIES;
  const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd');
  const fs = fold(s);
  return COUNTRIES.filter((c) => c.code.toLowerCase() === s || fold(c.name).includes(fs) || c.code.toLowerCase().startsWith(s));
}
