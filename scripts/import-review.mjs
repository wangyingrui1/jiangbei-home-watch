import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, readJson, writeJson } from './lib.mjs';
import { candidateErrors, mergeCandidates } from './discovery.mjs';

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
if (fileIndex < 0 || !args[fileIndex + 1]) throw new Error('Usage: npm run import:review -- --file path/to/review.json [--dry-run]');
const input = JSON.parse(await readFile(resolve(ROOT, args[fileIndex + 1]), 'utf8'));
if (!Array.isArray(input.items) || !input.items.length) throw new Error('Review file must contain a non-empty items array; no sample data is imported automatically');
const now = new Date().toISOString();
let data = { schemaVersion: 1, candidates: [] };
try { data = await readJson('data/discovery.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const candidates = [...data.candidates];
for (const item of input.items) {
  const existing = candidates.find(c => c.id === item.id || (item.source?.url && c.source.url === item.source.url));
  const review = item.review;
  if (!review || !['pending', 'approve', 'reject'].includes(review.decision)) throw new Error('Each item needs review.decision: pending / approve / reject');
  const approved = review.decision === 'approve';
  if (approved && (!review.reviewer || !Number.isFinite(Date.parse(review.reviewedAt)) || typeof review.note !== 'string' || review.note.length < 10 || !['sourceChecked', 'priceChecked', 'dateChecked', 'geographyChecked'].every(key => review[key] === true))) throw new Error('Approval requires reviewer, reviewedAt, a substantive note, and explicit source/price/date/geography checks');
  const original = existing || item;
  // A review decision cannot silently alter a previously observed price/date.
  if (existing) for (const key of ['totalPriceWan', 'soldDate', 'areaSqm', 'layout', 'verification']) if (item[key] != null && item[key] !== existing[key]) throw new Error(`${existing.id}: a review may not silently rewrite ${key}; keep original evidence and record a separate correction`);
  const source = { ...original.source, observedAt: original.source?.observedAt || now };
  const verification = original.verification;
  if (verification === 'platform_reported' && !/(^|\.)(5i5j|ke|lianjia|fang)\.com$/i.test(new URL(source.url).hostname)) throw new Error('platform_reported requires an original transaction-platform URL; a post or news report must remain author_reported');
  const id = existing?.id || original.id || `human-${createHash('sha256').update(source.url + '|' + original.soldDate + '|' + original.totalPriceWan).digest('hex').slice(0, 16)}`;
  const candidate = {
    id, communityId: original.communityId || null, communityName: original.communityName,
    platformCommunityName: original.platformCommunityName || original.communityName,
    sector: original.sector || null, totalPriceWan: original.totalPriceWan,
    totalPricePrecision: original.totalPricePrecision || 'source_display',
    platformUnitPriceYuan: original.platformUnitPriceYuan || null,
    areaSqm: original.areaSqm, layout: original.layout, soldDate: original.soldDate,
    // Never derive a transaction date from publication time or import time.
    publishedAt: original.publishedAt || null, orientation: original.orientation || null,
    source, verification, image: original.image || null, floorplan: original.floorplan || null,
    reviewStatus: approved ? 'approved' : review.decision === 'reject' ? 'rejected' : 'pending',
    reviewReason: original.reviewReason || 'human_source_requires_review', review,
    firstObservedAt: original.firstObservedAt || now, lastObservedAt: now,
    disclosureLabel: verification === 'author_reported' ? '博主/作者披露 · 独立待审核线索' : '平台披露 · 人工来源核查'
  };
  if (verification === 'author_reported' && !source.dateEvidence) throw new Error('Author report requires source.dateEvidence explaining the exact soldDate; the post date is insufficient');
  for (const mediaKey of ['image', 'floorplan']) if (item[mediaKey] && (!existing || item[mediaKey] !== original[mediaKey])) {
    if (review.mediaChecked !== true || item[mediaKey].visuallyVerified !== true) throw new Error('New media requires mediaChecked and visuallyVerified, not a filename guess');
    candidate[mediaKey] = item[mediaKey];
  }
  const errors = candidateErrors(candidate);
  if (errors.length) throw new Error(`${id}: ${errors.join('; ')}`);
  const index = candidates.findIndex(c => c.id === existing?.id);
  if (index >= 0) candidates[index] = candidate; else candidates.push(candidate);
}
const ordered = mergeCandidates(candidates, [], []).candidates;
if (!args.includes('--dry-run')) await writeJson('data/discovery.json', {
  ...data, schemaVersion: 1, lastHumanImportAt: now, totalCandidates: ordered.length,
  pendingCandidates: ordered.filter(c => c.reviewStatus === 'pending').length,
  latestCandidateSoldDate: ordered.filter(c => c.reviewStatus !== 'rejected').map(c => c.soldDate).sort().at(-1) || null,
  candidates: ordered
});
console.log(`${args.includes('--dry-run') ? 'Validated without writing' : 'Imported review decisions for'} ${input.items.length} item(s). Formal transactions and communities were not modified. Author reports remain separate from platform statistics.`);