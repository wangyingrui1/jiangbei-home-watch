import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readJson, writeJson, USER_AGENT, isPublicUrl, recordErrors, mergeRecords } from './lib.mjs';
import { parse5i5j } from './parse-5i5j.mjs';
import { parseFangDetail } from './parse-fang.mjs';
import { robotsDecision } from './robots.mjs';
import { candidateErrors, mergeCandidates, buildReviewedAliases } from './discovery.mjs';

const checkedAt = new Date().toISOString();
const discoveryOnly = process.argv.includes('--discovery-only');
let discoveryData = { schemaVersion: 1, candidates: [] };
try { discoveryData = await readJson('data/discovery.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const [settings, communityData, transactionData] = await Promise.all([
  readJson('data/sources.json'), readJson('data/communities.json'), readJson('data/transactions.json')
]);
let previous = {};
try { previous = await readJson('data/status.json'); } catch { /* first check */ }
const communityIds = new Set(communityData.communities.map(c => c.id));
const issues = transactionData.records.flatMap(r => recordErrors(r, communityIds).map(e => `${r.id}: ${e}`));
if (issues.length) throw new Error(`Existing data failed validation; no files changed:\n${issues.join('\n')}`);
const { aliases: reviewedAliases, conflicts: aliasConflicts } = buildReviewedAliases(communityData.communities);
const robotsCache = new Map(), lastRequest = new Map(), originBlocks = new Map();
let candidates = discoveryData.candidates || [];
let discoveryNewRecords = 0;
const runs = [];
let records = transactionData.records;
let newRecords = 0;

async function getPage(url, maximumBytes = 3_000_000) {
  if (!isPublicUrl(url)) throw new Error('Source must use a public HTTPS URL');
  const wait = Math.max(0, (lastRequest.get(new URL(url).origin) || 0) + 1500 - Date.now());
  if (wait) await delay(wait);
  lastRequest.set(new URL(url).origin, Date.now());
  // Reject redirects rather than following an unapproved domain or login wall.
  const response = await fetch(url, {
    redirect: 'manual', signal: AbortSignal.timeout(25_000),
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,text/plain;q=0.9', 'Accept-Language': 'zh-CN,zh;q=0.9' }
  });
  const declared = Number(response.headers.get('content-length'));
  if (declared > maximumBytes) throw new Error('Response exceeds configured size limit');
  const reader = response.body?.getReader();
  const pieces = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximumBytes) { await reader.cancel(); throw new Error('Response exceeds configured size limit'); }
      pieces.push(value);
    }
  }
  const buffer = Buffer.concat(pieces);
  return { status: response.status, text: buffer.toString('utf8'), hash: createHash('sha256').update(buffer).digest('hex'), contentType: response.headers.get('content-type') || '' };
}
async function checkRobots(url) {
  const origin = new URL(url).origin;
  if (!robotsCache.has(origin)) {
    const page = await getPage(`${origin}/robots.txt`, 512_000);
    if ([404, 410].includes(page.status)) robotsCache.set(origin, { missing: true, page });
    else if (page.status !== 200) throw new Error(`robots.txt returned HTTP ${page.status}; request skipped`);
    else if (/<!doctype\s+html|<html\b/i.test(page.text)) throw new Error('robots.txt returned an HTML challenge; request skipped');
    else robotsCache.set(origin, { missing: false, page });
  }
  const cached = robotsCache.get(origin);
  const decision = cached.missing ? { allowed: true, crawlDelaySeconds: 0, rule: null } : robotsDecision(cached.page.text, url);
  if (!decision.allowed) throw new Error(`robots.txt disallows this path (${decision.rule}); request skipped`);
  if (decision.crawlDelaySeconds > 60) throw new Error('robots.txt crawl-delay exceeds this job\'s safe wait budget; request skipped');
  const wait = Math.max(0, (lastRequest.get(origin) || 0) + Math.max(1500, decision.crawlDelaySeconds * 1000) - Date.now());
  if (wait) await delay(wait);
  return { status: cached.page.status, rule: decision.rule, crawlDelaySeconds: decision.crawlDelaySeconds };
}

for (const configuredSource of settings.sources || []) {
  const source = { ...configuredSource, communities: { ...reviewedAliases, ...(configuredSource.communities || {}) } };
  const run = { id: source.id, name: source.name, url: source.url, checkedAt, status: 'skipped', candidateCount: 0, acceptedCount: 0, newRecords: 0, discoveryCount: 0, discoveryNewRecords: 0, rejected: {} };
  runs.push(run);
  if (!source.enabled) { run.message = '来源尚未启用；未发送请求。'; continue; }
  try {
    const origin = new URL(source.url).origin;
    if (originBlocks.has(origin)) throw new Error('同域先前返回拒绝访问/验证，后续请求已停止；保留历史。' + originBlocks.get(origin));
    if (!['5i5j', 'fang_detail', 'public_watch'].includes(source.type)) throw new Error('Unsupported adapter; source requires human review before import');
    if (source.type === '5i5j' && new URL(source.url).hostname !== 'nj.5i5j.com') throw new Error('Adapter domain is not approved');
    for (const mapping of Object.values(source.communities)) if (!communityIds.has(mapping.id)) throw new Error(`Unknown community ID in source allowlist: ${mapping.id}`);
    run.robots = await checkRobots(source.url);
    const page = await getPage(source.url);
    run.httpStatus = page.status;
    run.responseSha256 = page.hash;
    if ([401, 403, 429].includes(page.status)) originBlocks.set(origin, ' HTTP ' + page.status);
    if (page.status !== 200) throw new Error(`公开页面返回 HTTP ${page.status}；未绕过登录、验证码或访问限制。`);
    if (!/text\/(?:html|plain)|application\/xhtml/i.test(page.contentType)) throw new Error('Source did not return a text/HTML page');
    const responseTitle = page.text.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
    if (/captcha|验证|访问过于频繁|access denied/i.test(responseTitle)) { originBlocks.set(origin, ' ' + responseTitle.slice(0, 80)); throw new Error('公开入口需要验证；后续同域请求停止，未绕过限制。'); }
    if (source.type === 'public_watch') {
      const title = page.text.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
      if (/captcha|验证|登录|访问过于频繁|access denied/i.test(title)) throw new Error(`公开入口需要验证或登录（${title.slice(0,100)}）；未读取成交内容。`);
      run.status = 'review_required';
      run.message = '公开页面可访问；此来源仅作访问规则监测，成交信息需人工核查导入，未自动计入统计。';
      console.log(`${run.id}: ${run.status}; ${run.message}`);
      continue;
    }
    const parsed = source.type === 'fang_detail' ? parseFangDetail(page.text, source, checkedAt) : parse5i5j(page.text, source, checkedAt);
    run.candidateCount = parsed.candidateCount;
    run.rejected = parsed.rejected;
    if (!parsed.candidateCount) throw new Error('未识别到成交卡片：可能为页面改版、空结果或访问限制；保留历史并等待核查。');
    const valid = [];
    for (const record of parsed.records) {
      const invalid = recordErrors(record, communityIds);
      if (invalid.length) run.rejected.schema_validation = (run.rejected.schema_validation || 0) + 1;
      else valid.push(record);
    }
    run.acceptedCount = valid.length;
    const merged = discoveryOnly ? { records, added: 0 } : mergeRecords(records, valid);
    records = merged.records;
    newRecords += merged.added;
    run.newRecords = merged.added;
    const formalIds = new Set(records.map(r => r.id));
    const pending = [...parsed.discoveries, ...(discoveryOnly ? valid.filter(r => !formalIds.has(r.id)).map(r => ({ ...r, publishedAt: null, reviewStatus: 'pending', reviewReason: 'new_transaction_requires_review', firstObservedAt: checkedAt, lastObservedAt: checkedAt, disclosureLabel: '平台披露 · 新记录待审核' })) : [])];
    const qualified = pending.filter(candidate => {
      const errors = candidateErrors(candidate);
      if (errors.length) run.rejected.discovery_schema_validation = (run.rejected.discovery_schema_validation || 0) + 1;
      return errors.length === 0 && !formalIds.has(candidate.id);
    });
    const discoveries = mergeCandidates(candidates, qualified, records, checkedAt);
    candidates = discoveries.candidates;
    discoveryNewRecords += discoveries.added;
    run.discoveryCount = qualified.length;
    run.discoveryNewRecords = discoveries.added;
    run.status = 'ok';
    run.message = `${discoveryOnly ? '发现模式，正式成交库未修改；' : ''}正式新增 ${merged.added} 条；发现 ${qualified.length} 条待审核候选（新入队 ${discoveries.added} 条）。`;
  } catch (error) {
    run.status = 'blocked';
    run.message = String(error.message).slice(0, 500);
  }
  console.log(`${run.id}: ${run.status}; candidates=${run.candidateCount}; accepted=${run.acceptedCount}; new=${run.newRecords}; ${run.message}`);
}
const active = runs.filter(run => run.status !== 'skipped');
const good = active.filter(run => run.status === 'ok');
const blocked = active.filter(run => run.status !== 'ok');
const overallStatus = !active.length ? 'not_configured' : !good.length ? 'blocked' : blocked.length ? 'partial' : newRecords ? 'updated' : 'checked_no_new';
// Only mutate transactions after every source has been evaluated. Preserve any
// optional curated fields from the existing dataset as well as all old records.
if (newRecords) await writeJson('data/transactions.json', { ...transactionData, records });
candidates = mergeCandidates(candidates, [], records, checkedAt).candidates;
await writeJson('data/discovery.json', {
  ...discoveryData, schemaVersion: 1, checkedAt,
  scope: '南京泛江北公开成交新小区发现；候选不等于正式收录。',
  policy: '候选必须明示成交日、总价、面积和户型；平台万元显示150边界排除。平台披露与博主自述分别标识，未经审核不混入正式平台成交统计。',
  newCandidates: discoveryNewRecords, totalCandidates: candidates.length,
  pendingCandidates: candidates.filter(c => c.reviewStatus === 'pending').length,
  latestCandidateSoldDate: candidates.filter(c => c.reviewStatus !== 'rejected').map(c => c.soldDate).sort().at(-1) || null,
  candidates,
  humanSources: runs.filter(run => settings.sources.find(s => s.id === run.id)?.type === 'public_watch').map(run => ({ id: run.id, name: run.name, url: run.url, status: run.status, checkedAt: run.checkedAt, message: run.message, httpStatus: run.httpStatus ?? null })),
  aliasConflicts
});
await writeJson('data/status.json', {
  schemaVersion: 1, checkedAt,
  lastSuccessfulCheckAt: good.length ? checkedAt : previous.lastSuccessfulCheckAt || null,
  latestSoldDate: records.map(r => r.soldDate).sort().at(-1) || null,
  totalRecords: records.length, newRecords, discoveryOnly, discoveryNewRecords, pendingCandidateCount: candidates.filter(c => c.reviewStatus === 'pending').length, latestCandidateSoldDate: candidates.map(c => c.soldDate).sort().at(-1) || null, coverage: 'partial_public_platform_sample',
  overallStatus, runs,
  disclaimer: '每日检查公开来源；平台公示成交未经政府网签核验。仅收录总价明确且不超过150万元的已成交样本，不代表全市场；来源延迟、隐藏价格或访问受限会导致缺漏。'
});
console.log(`Result: ${overallStatus}; ${newRecords} added; ${records.length} total. A successful check does not mean a new sale occurred today.`);
