import { app, dialog, nativeTheme, net, safeStorage, shell, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import { handle } from './register';
import { openExternalSafe } from '../security';
import { deleteSecret, getPrefs, setPrefs, setSecret, storageBackend } from '../services/settingsStore';
import { secretsStatus } from '../services/auth/clientConfig';
import { getAccount, listAccounts, signIn, signOut } from '../services/auth/accounts';
import { listAdmobPublishers, listAdsCustomers, listYoutubeChannels, syncDirectory } from '../services/directory';
import { listApps, removeApp, saveApp } from '../services/appsStore';
import { lookupApp, refreshAppIcons } from '../services/appLookup';
import { APP_NAME } from '@shared/brand';
import { enqueue, listJobs, runJob } from '../jobs/queue';
import { quotaToday } from '../services/quota';
import { executePlan, getDraft, getPlan, listPlans, previewNames, saveDraft, startPlan, validatePlan } from '../services/plans';
import { applyChanges, listCampaigns, listConversionActions } from '../services/googleAds/campaigns';
import { PlanSchema } from '@shared/plan';
import { addYoutubeIds, getRow, importPaths, listCreatives, patchCreatives, removeCreatives } from '../services/creatives/library';
import { cancelUploads, pauseUploads, pollProcessing, pump, requestUpload, startPolling, uploaderState } from '../services/youtube/uploads';
import { attachVideos, previewAttach, replaceVideos, scanLowVideos } from '../services/googleAds/videos';
import { getJson } from '../services/settingsStore';
import { ReplaceVideosSchema, AttachVideosSchema, CreativePatchSchema, ImportPathsSchema, ManualIdsSchema, UploadRequestSchema } from '@shared/creative';
import { z } from 'zod';
import { adUnitDetail, alertPrefs, breakdown, campaignDetail, pacing, setMonthlyBudget, countryDetail, exportAnalytics, getAnalytics, setAlertPrefs, syncStatus, wasExported } from '../services/analytics';
import { reschedule, syncAndRunRules } from '../scheduler';
import { exportDiagnostics, wasDiagnosticsExport } from '../diagnostics';
import { installUpdate, updateReady } from '../updater';
import { approveSuggestions, dismissSuggestions, listRules, listSuggestions, pendingCount, removeRule, runRules, saveRule, testRule } from '../services/rules';
import { RuleSchema } from '@shared/rules';
import { TranslateRequestSchema } from '@shared/adtext';
import { saveApprovedTexts, textLibrary, translateTexts } from '../services/ai/translate';
import { AlertPrefsSchema, AnalyticsRangeSchema } from '@shared/analytics';
import { ListingTextSchema, PackageNameSchema, PLAY_LANGUAGES, PushListingSchema } from '@shared/listing';
import { exportListingXlsx, importListingXlsx, listImages, pickImages, pullListing, pushListing, wasListingExport } from '../services/play/listings';
import { ReplySchema, ReplyTemplatesSchema, UpdateReleaseSchema, VitalsAlertPrefsSchema, describeAction, trackLabel } from '@shared/playOps';
import { listTracks, updateRelease } from '../services/play/releases';
import { alertVitals, setVitalsAlertPrefs, syncVitals, vitalsAlertPrefs, vitalsCached } from '../services/play/vitals';
import { listReviews, replyReview, replyTemplates, setReplyTemplates, suggestReply } from '../services/play/reviews';
import { resolvePlayAccount } from '../services/play/client';
import { buildOverview, overviewCached } from '../services/play/overview';
import { ApplyReplaceSchema, ProjectIdSchema, PublishSchema, ReplaceQuerySchema, type RcTemplate } from '@shared/remoteConfig';
import { applyReplace, getTemplate, getVersion, listFirebaseProjects, listVersions, planReplaceAll, publishTemplate, rollback } from '../services/firebase/remoteConfig';
import {
  AccountKindSchema,
  AiKeySchema,
  AppMappingSchema,
  BulkEditSchema,
  CustomerIdSchema,
  DeveloperTokenSchema,
  IdSchema,
  OAuthClientSchema,
  PrefsPatchSchema,
} from '@shared/schemas';
import type { Prefs } from '@shared/types';

const KIND_LABEL = { ads: 'Google Ads', admob: 'AdMob', youtube: 'YouTube', play: 'Google Play', firebase: 'Firebase' } as const;

export function applyPrefs(win: BrowserWindow | null, prefs: Prefs) {
  nativeTheme.themeSource = prefs.theme;
  win?.webContents.setZoomFactor(prefs.zoom);
}

import { scanVideoPerf, videoPerfCached } from '../services/googleAds/videoPerf';
import { listChanges } from '../services/googleAds/changes';
import { aiSummary, aiSummaryCached } from '../services/ai/summary';
import { detectTelegramChat, sendTelegram, setTelegramConfig, setTelegramToken, telegramStatus } from '../services/notify/telegram';
import { dailyDigestText } from '../services/notify/digest';
import { ADS_ALL_TIME_FROM, MAX_SYNC_DAYS, resolveRange as resolveAnalyticsRange } from '@shared/analytics';

export function registerIpc(getWin: () => BrowserWindow | null) {
  handle('app', 'info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    safeStorage: { available: safeStorage.isEncryptionAvailable(), backend: storageBackend() },
    online: net.isOnline(),
  }));
  handle('app', 'openExternal', (url) => openExternalSafe(IdSchema.parse(url)));
  handle('app', 'exportDiagnostics', () => exportDiagnostics(getWin()));
  handle('app', 'revealDiagnostics', (p) => {
    if (!wasDiagnosticsExport(IdSchema.parse(p))) throw new Error('Chỉ mở được file vừa xuất');
    shell.showItemInFolder(p);
  });
  handle('app', 'updateReady', () => updateReady());
  handle('app', 'installUpdate', () => installUpdate());

  handle('prefs', 'get', () => getPrefs());
  handle('prefs', 'set', (patch) => {
    const parsed = PrefsPatchSchema.parse(patch);
    const next = setPrefs(parsed);
    applyPrefs(getWin(), next);
    if (parsed.autoSync !== undefined || parsed.syncHour !== undefined) reschedule();
    return next;
  });

  handle('secrets', 'status', () => secretsStatus());
  handle('secrets', 'setOAuthClient', (input) => {
    setSecret('oauthClient', JSON.stringify(OAuthClientSchema.parse(input)));
    return secretsStatus();
  });
  handle('secrets', 'setAiKey', (key) => {
    if (key === null) deleteSecret('anthropicApiKey');
    else setSecret('anthropicApiKey', AiKeySchema.parse(key));
    return secretsStatus();
  });
  handle('secrets', 'setDeveloperToken', (token) => {
    setSecret('developerToken', DeveloperTokenSchema.parse(token));
    return secretsStatus();
  });

  handle('auth', 'signIn', async (kind) => {
    const account = await signIn(AccountKindSchema.parse(kind));
    if (account.kind === 'youtube') pump(); // hàng đợi upload đang chờ tài khoản
    if (account.kind === 'play') return account; // Play không có danh mục để đọc
    // Đăng nhập xong thì đọc luôn customer/publisher/kênh ở nền
    enqueue('syncDirectory', `Đọc danh mục ${KIND_LABEL[account.kind]} · ${account.email}`, (ctx) =>
      syncDirectory(account.id, ctx),
    );
    return account;
  });
  handle('auth', 'listAccounts', () => listAccounts());
  handle('auth', 'signOut', (id) => signOut(IdSchema.parse(id)));

  handle('directory', 'adsCustomers', () => listAdsCustomers());
  handle('directory', 'admobPublishers', () => listAdmobPublishers());
  handle('directory', 'youtubeChannels', () => listYoutubeChannels());
  handle('directory', 'refresh', (accountId) => {
    const acc = getAccount(IdSchema.parse(accountId));
    const jobId = enqueue('syncDirectory', `Đọc danh mục ${KIND_LABEL[acc.kind]} · ${acc.email}`, (ctx) =>
      syncDirectory(acc.id, ctx),
    );
    return { jobId };
  });

  handle('apps', 'list', () => listApps());
  handle('apps', 'save', (input) => {
    const parsed = AppMappingSchema.parse(input);
    return saveApp({ ...parsed, id: parsed.id });
  });
  handle('apps', 'remove', (id) => removeApp(IdSchema.parse(id)));
  handle('apps', 'lookup', (link) => lookupApp(z.string().trim().min(1).max(500).parse(link)));
  handle('apps', 'refreshIcons', (force) => refreshAppIcons(z.boolean().parse(force)));

  handle('jobs', 'list', () => listJobs());
  handle('quota', 'today', () => quotaToday());

  // ── Kế hoạch tạo camp ─────────────────────────────────────────────────────
  handle('plans', 'getDraft', () => getDraft());
  handle('plans', 'saveDraft', (d) => saveDraft(d)); // bản nháp chưa hoàn chỉnh, chỉ lưu
  handle('plans', 'list', () => listPlans());
  handle('plans', 'get', (id) => getPlan(IdSchema.parse(id)));
  handle('plans', 'previewNames', (plan) => previewNames(PlanSchema.parse(plan)));
  handle('plans', 'validate', (input) => {
    const plan = PlanSchema.parse(input); // lớp 2: không tin dữ liệu từ renderer
    return runJob('validatePlan', `Kiểm tra ${plan.rows.length} quốc gia với Google`, (ctx) => validatePlan(plan, ctx)).result;
  });
  handle('plans', 'create', (input) => {
    const plan = PlanSchema.parse(input);
    const rec = startPlan(plan);
    const codes = plan.rows.map((r) => r.countryCode);
    const jobId = enqueue('createCampaigns', `Tạo ${codes.length} camp · ${rec.appName}`, (ctx) => executePlan(rec, codes, ctx), { planId: rec.id });
    return { jobId, plan: rec };
  });
  handle('plans', 'retry', (id) => {
    const rec = getPlan(IdSchema.parse(id));
    const codes = Object.entries(rec.results).filter(([, r]) => r.state === 'failed' || r.state === 'pending').map(([c]) => c);
    const jobId = enqueue('createCampaigns', `Thử lại ${codes.length} quốc gia · ${rec.appName}`, (ctx) => executePlan(rec, codes, ctx), { planId: rec.id });
    return { jobId };
  });

  // ── Google Ads ────────────────────────────────────────────────────────────
  handle('ads', 'campaigns', (cid, range) => listCampaigns(CustomerIdSchema.parse(cid), PrefsPatchSchema.shape.range.unwrap().parse(range)));
  handle('ads', 'conversionActions', (cid) => listConversionActions(CustomerIdSchema.parse(cid)));
  handle('ads', 'applyChanges', (input) => {
    const { customerId, changes } = BulkEditSchema.parse(input);
    return applyChanges(customerId, changes);
  });

  // ── AI dịch ────────────────────────────────────────────────────────────────
  handle('ai', 'translate', (input) => {
    const req = TranslateRequestSchema.parse(input);
    return runJob('translate', `AI dịch text sang ${req.langs.length} ngôn ngữ`, (ctx) => translateTexts(req, ctx)).result;
  });
  handle('ai', 'saveTexts', (input) => {
    const { appId, lang, items } = z
      .object({ appId: IdSchema, lang: z.string().min(2).max(10), items: z.array(z.object({ field: z.enum(['headline', 'description']), text: z.string().trim().min(1).max(200) })).max(20) })
      .parse(input);
    saveApprovedTexts(appId, lang, items);
  });
  handle('ai', 'library', (appId) => textLibrary(IdSchema.parse(appId)).map((t) => ({ lang: t.lang, field: t.field, text: t.text })));

  // ── Rules ─────────────────────────────────────────────────────────────────
  handle('rules', 'list', () => listRules());
  handle('rules', 'save', (r) => saveRule(RuleSchema.parse(r)));
  handle('rules', 'remove', (id) => removeRule(IdSchema.parse(id)));
  handle('rules', 'test', (r) => testRule(RuleSchema.parse(r)));
  handle('rules', 'run', () => ({ jobId: enqueue('runRules', 'Chạy rule', async (ctx) => void (await runRules(ctx))) }));
  handle('rules', 'suggestions', (scope) => listSuggestions(z.enum(['pending', 'history']).parse(scope)));
  handle('rules', 'pendingCount', () => pendingCount());
  handle('rules', 'approve', (ids) => approveSuggestions(Ids.parse(ids)));
  handle('rules', 'dismiss', (ids) => dismissSuggestions(Ids.parse(ids)));

  // ── Analytics ─────────────────────────────────────────────────────────────
  const Range = AnalyticsRangeSchema;
  const AppIdOrAll = z.string().min(1).nullable();
  const Country = z.string().regex(/^[A-Z]{2}$/);
  const DimSchema = z.enum(['country', 'campaign', 'app', 'format', 'source', 'adUnit']);
  handle('analytics', 'get', (appId, range) => getAnalytics(AppIdOrAll.parse(appId), Range.parse(range)));
  handle('analytics', 'country', (appId, range, country) => countryDetail(AppIdOrAll.parse(appId), Range.parse(range), Country.parse(country)));
  handle('analytics', 'breakdown', (appId, range, dim, country) =>
    breakdown(AppIdOrAll.parse(appId), Range.parse(range), DimSchema.parse(dim), Country.nullable().parse(country)));
  handle('analytics', 'adUnit', (appId, range, unitId) =>
    adUnitDetail(AppIdOrAll.parse(appId), Range.parse(range), z.string().regex(/^ca-app-pub-\d+\/\d+$/).parse(unitId)));
  handle('analytics', 'campaign', (appId, range, id) => campaignDetail(AppIdOrAll.parse(appId), Range.parse(range), z.string().regex(/^\d+$/).parse(id)));
  handle('analytics', 'changes', (appId, range, campaignId) => {
    const id = AppIdOrAll.parse(appId);
    const r = resolveAnalyticsRange(Range.parse(range), undefined, syncStatus().earliest);
    const scoped = listApps().filter((a) => !id || a.id === id);
    const customers = [...new Set(scoped.map((a) => a.adsCustomerId).filter((x): x is string => !!x))];
    const cur = getPrefs().currentAdsCustomerId;
    if (!customers.length && cur) customers.push(cur);
    return listChanges({ customerIds: customers, from: r.from, to: r.to, campaignId: z.string().regex(/^\d+$/).nullable().parse(campaignId) });
  });
  handle('analytics', 'pacing', (cid) => pacing(CustomerIdSchema.parse(cid)));
  handle('analytics', 'setMonthlyBudget', (cid, amount) => setMonthlyBudget(CustomerIdSchema.parse(cid), z.number().positive().max(1e12).nullable().parse(amount)));
  handle('analytics', 'syncStatus', () => syncStatus());
  handle('analytics', 'sync', (days) => {
    const n = z.number().int().min(1).max(MAX_SYNC_DAYS).parse(days);
    return { jobId: enqueue('syncReports', `Đồng bộ báo cáo ${n} ngày + chạy rule`, (ctx) => syncAndRunRules(n, ctx)) };
  });
  handle('analytics', 'export', (appId, range, format, dim) =>
    exportAnalytics(getWin(), AppIdOrAll.parse(appId), Range.parse(range), z.enum(['csv', 'xlsx']).parse(format), DimSchema.optional().parse(dim)));
  handle('analytics', 'revealExport', (p) => {
    if (!wasExported(IdSchema.parse(p))) throw new Error('Chỉ mở được file vừa xuất');
    shell.showItemInFolder(p);
  });
  handle('analytics', 'alertPrefs', () => alertPrefs());
  handle('analytics', 'setAlertPrefs', (p) => setAlertPrefs(AlertPrefsSchema.parse(p)));

  // ── Hiệu quả video ────────────────────────────────────────────────────────
  handle('creatives', 'videoPerf', (cid, range) => {
    // Gọi thẳng Google Ads: “từ trước đến nay” không giới hạn bởi dữ liệu đã đồng bộ trên máy
    const r = resolveAnalyticsRange(PrefsPatchSchema.shape.range.unwrap().parse(range), undefined, ADS_ALL_TIME_FROM);
    return scanVideoPerf(CustomerIdSchema.parse(cid), r.from, r.to);
  });
  handle('creatives', 'videoPerfCached', (cid) => videoPerfCached(CustomerIdSchema.parse(cid)));

  // ── AI tóm tắt, Telegram ──────────────────────────────────────────────────
  handle('ai', 'summary', (appId, range, refresh) => aiSummary(AppIdOrAll.parse(appId), Range.parse(range), z.boolean().parse(refresh)));
  handle('ai', 'summaryCached', (appId, range) => aiSummaryCached(AppIdOrAll.parse(appId), Range.parse(range)));
  handle('notify', 'status', () => telegramStatus());
  handle('notify', 'setToken', (t) => setTelegramToken(z.string().max(200).nullable().parse(t)));
  handle('notify', 'detectChat', () => detectTelegramChat());
  handle('notify', 'setConfig', (c) =>
    setTelegramConfig(z.object({ enabled: z.boolean(), events: z.object({ red: z.boolean(), digest: z.boolean(), weekly: z.boolean() }) }).parse(c)));
  handle('notify', 'test', async () => {
    await sendTelegram(`✅ Kết nối thành công với ${APP_NAME}\n\n${dailyDigestText()}`, { force: true });
  });

  // ── Google Play: trang thông tin cửa hàng ─────────────────────────────────
  const PlayLang = z.enum(PLAY_LANGUAGES.map((l) => l.code) as [string, ...string[]]);
  handle('play', 'pull', (acc, pkg) => pullListing(IdSchema.parse(acc), PackageNameSchema.parse(pkg)));
  handle('play', 'images', (acc, pkg, lang) => listImages(IdSchema.parse(acc), PackageNameSchema.parse(pkg), PlayLang.parse(lang)));
  handle('play', 'push', (input) => {
    const req = PushListingSchema.parse(input);
    const n = new Set([...req.upsert.map((t) => t.language), ...req.remove, ...req.images.map((s) => s.language)]).size;
    return runJob('pushListing', `Đẩy trang thông tin ${n} ngôn ngữ · ${req.packageName}`, (ctx) => pushListing(req, ctx)).result;
  });
  handle('play', 'pickImages', () => pickImages(getWin()));
  handle('play', 'importXlsx', () => importListingXlsx(getWin()));
  // Xuất cho người dịch: không chặn text đang dở (trống/quá dài), chỉ giới hạn kích thước
  const LooseText = ListingTextSchema.extend({ title: z.string().max(200), shortDescription: z.string().max(500), fullDescription: z.string().max(10000), video: z.string().max(200) });
  handle('play', 'exportXlsx', (pkg, texts) => exportListingXlsx(getWin(), PackageNameSchema.parse(pkg), z.array(LooseText).max(PLAY_LANGUAGES.length).parse(texts)));
  handle('play', 'revealExport', (p) => {
    if (!wasListingExport(IdSchema.parse(p))) throw new Error('Chỉ mở được file vừa xuất');
    shell.showItemInFolder(p);
  });
  handle('play', 'tracks', (acc, pkg) => listTracks(IdSchema.parse(acc), PackageNameSchema.parse(pkg)));
  handle('play', 'updateRelease', (input) => {
    const req = UpdateReleaseSchema.parse(input);
    return runJob('playRelease', `${describeAction(req.action)} · ${trackLabel(req.track)} · ${req.packageName}`, () => updateRelease(req)).result;
  });
  handle('play', 'vitals', (pkg) => vitalsCached(PackageNameSchema.parse(pkg)));
  handle('play', 'syncVitals', (acc, pkg) => {
    const p = PackageNameSchema.parse(pkg);
    const a = IdSchema.parse(acc);
    return runJob('syncVitals', `Đọc Vitals · ${p}`, async () => {
      const data = await syncVitals(a, p);
      await alertVitals(listApps().find((x) => x.storeAppId === p)?.name ?? p, a, data);
      return data;
    }).result;
  });
  handle('play', 'reviews', (acc, pkg) => listReviews(IdSchema.parse(acc), PackageNameSchema.parse(pkg)));
  handle('play', 'reply', (input) => replyReview(ReplySchema.parse(input)));
  handle('play', 'suggestReply', (input) =>
    suggestReply(z.object({ appName: z.string().max(100).nullable(), rating: z.number().int().min(1).max(5), text: z.string().max(5000), language: z.string().max(20).nullable() }).parse(input)));
  handle('play', 'overview', () => runJob('playOverview', 'Tổng quan app Google Play', (ctx) => buildOverview(ctx)).result);
  handle('play', 'overviewCached', () => overviewCached());
  handle('play', 'resolveAccount', (pkg) => resolvePlayAccount(PackageNameSchema.parse(pkg)));
  handle('play', 'vitalsAlerts', () => vitalsAlertPrefs());
  handle('play', 'setVitalsAlerts', (p) => setVitalsAlertPrefs(VitalsAlertPrefsSchema.parse(p)));
  handle('play', 'replyTemplates', () => replyTemplates());
  handle('play', 'setReplyTemplates', (t) => setReplyTemplates(ReplyTemplatesSchema.parse(t)));

  // ── Firebase Remote Config ────────────────────────────────────────────────
  const VersionNo = z.string().regex(/^\d{1,12}$/);
  handle('rc', 'projects', () => listFirebaseProjects());
  handle('rc', 'template', (acc, pid) => getTemplate(IdSchema.parse(acc), ProjectIdSchema.parse(pid)));
  handle('rc', 'publish', (input) => {
    const req = PublishSchema.parse(input);
    return runJob('rcPublish', `Publish Remote Config · ${req.projectId}`, () => publishTemplate({ ...req, template: req.template as RcTemplate })).result;
  });
  handle('rc', 'planReplace', (input) => {
    const { targets, query } = z.object({ targets: z.array(z.object({ accountId: IdSchema, projectId: ProjectIdSchema })).min(1).max(100), query: ReplaceQuerySchema }).parse(input);
    return runJob('rcReplace', `Tìm “${query.find.slice(0, 30)}” trong ${targets.length} project`, (ctx) => planReplaceAll(targets, query, ctx)).result;
  });
  handle('rc', 'applyReplace', (input) => {
    const req = ApplyReplaceSchema.parse(input);
    const n = req.targets.reduce((s, t) => s + t.changes.length, 0);
    return runJob('rcReplace', `Thay ${n} giá trị trong ${req.targets.length} project`, (ctx) => applyReplace(req, ctx)).result;
  });
  handle('rc', 'versions', (acc, pid) => listVersions(IdSchema.parse(acc), ProjectIdSchema.parse(pid)));
  handle('rc', 'version', (acc, pid, v) => getVersion(IdSchema.parse(acc), ProjectIdSchema.parse(pid), VersionNo.parse(v)));
  handle('rc', 'rollback', (acc, pid, v) => {
    const p = ProjectIdSchema.parse(pid);
    const n = VersionNo.parse(v);
    return runJob('rcPublish', `Khôi phục Remote Config về bản ${n} · ${p}`, () => rollback(IdSchema.parse(acc), p, n)).result;
  });

  // ── Creatives / YouTube ───────────────────────────────────────────────────
  const Ids = z.array(IdSchema).min(1).max(1000);
  const runImport = (paths: string[], appId: string | null) =>
    runJob('importCreatives', `Nhập ${paths.length === 1 ? 'thư mục/file' : `${paths.length} mục`} vào thư viện`, (ctx) => importPaths(paths, appId, ctx)).result;

  handle('creatives', 'list', () => listCreatives());
  handle('creatives', 'pick', async (mode, appId) => {
    const win = getWin();
    const opts: Electron.OpenDialogOptions = {
      title: mode === 'folder' ? 'Chọn thư mục creative' : 'Chọn video / ảnh',
      properties: mode === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
      filters: mode === 'files' ? [{ name: 'Video / ảnh', extensions: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'jpg', 'jpeg', 'png', 'gif', 'webp'] }] : undefined,
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths.length) return null;
    return runImport(res.filePaths, z.string().nullable().parse(appId));
  });
  handle('creatives', 'importPaths', (input) => {
    const { paths, appId } = ImportPathsSchema.parse(input);
    // Chỉ nhận đường dẫn tuyệt đối đang tồn tại (file kéo thả từ hệ điều hành)
    const ok = paths.filter((p) => p.startsWith('/') || /^[A-Za-z]:\\/.test(p)).filter((p) => fs.existsSync(p));
    return runImport(ok, appId);
  });
  handle('creatives', 'addYoutubeIds', (input) => {
    const parsed = ManualIdsSchema.parse(input);
    const hasYt = listAccounts().some((a) => a.kind === 'youtube' && a.status === 'active');
    const out = addYoutubeIds(parsed, hasYt);
    if (hasYt) {
      startPolling();
      void pollProcessing();
    }
    return out;
  });
  handle('creatives', 'patch', (p) => patchCreatives(CreativePatchSchema.parse(p)));
  handle('creatives', 'remove', (ids) => removeCreatives(Ids.parse(ids)));
  handle('creatives', 'reveal', (id) => {
    const row = getRow(IdSchema.parse(id)); // đường dẫn lấy từ DB, không nhận từ renderer
    if (row.path) shell.showItemInFolder(row.path);
  });
  handle('creatives', 'upload', (input) => {
    const r = UploadRequestSchema.parse(input);
    return requestUpload(r.ids, r.kind === 'ads' ? { kind: 'ads', customerId: r.customerId } : { kind: 'youtube', accountId: r.accountId });
  });
  handle('creatives', 'pause', (ids) => pauseUploads(Ids.parse(ids)));
  handle('creatives', 'cancel', (ids) => cancelUploads(Ids.parse(ids)));
  handle('creatives', 'uploaderState', () => uploaderState());
  handle('creatives', 'refreshStatus', () => pollProcessing());
  handle('creatives', 'previewAttach', (input) => {
    const { customerId, campaignIds, videoIds } = AttachVideosSchema.parse(input);
    return previewAttach(customerId, campaignIds, videoIds);
  });
  handle('creatives', 'scanLow', (cid) => {
    const customerId = CustomerIdSchema.parse(cid);
    return runJob('replaceCreatives', 'Quét video hiệu quả thấp (LOW)', () => scanLowVideos(customerId)).result;
  });
  handle('creatives', 'lowCached', (cid) => getJson(`lowVideos:${CustomerIdSchema.parse(cid)}`));
  handle('creatives', 'replace', (input) => {
    const { customerId, items } = ReplaceVideosSchema.parse(input);
    return replaceVideos(customerId, items);
  });
  handle('creatives', 'attach', (input) => {
    const { customerId, campaignIds, videoIds } = AttachVideosSchema.parse(input);
    return attachVideos(customerId, campaignIds, videoIds);
  });
}
