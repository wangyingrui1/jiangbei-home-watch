import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PRICE_CAP = 150;
export const USER_AGENT = 'JiangbeiHomeWatch/1.0 (+https://github.com/wangyingrui1/jiangbei-home-watch)';
export const readJson = async path => JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
export async function writeJson(path, value) {
  const target = resolve(ROOT, path);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temporary, target);
}

export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function isPublicUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password
      && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|::)/i.test(u.hostname)
      && !/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname);
  } catch { return false; }
}
export function decodeHtml(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:\d+|x[\da-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const point = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}
export const plainText = html => decodeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export function attr(html, name) {
  return decodeHtml(html.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))?.[2] || '');
}

export function recordErrors(record, communityIds, today = new Date().toISOString().slice(0, 10)) {
  const errors = [];
  if (!record || typeof record !== 'object') return ['record must be an object'];
  if (typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(record.id)) errors.push('invalid id');
  if (!communityIds.has(record.communityId)) errors.push('unknown communityId');
  if (typeof record.communityName !== 'string' || !record.communityName.trim()) errors.push('missing communityName');
  if (typeof record.totalPriceWan !== 'number' || !Number.isFinite(record.totalPriceWan) || record.totalPriceWan <= 0 || record.totalPriceWan > PRICE_CAP) errors.push('price outside (0,150]');
  if (record.totalPricePrecision === 'platform_display_rounded' && record.totalPriceWan === 150) errors.push('rounded platform total at budget boundary');
  if (record.platformUnitPriceYuan != null && (typeof record.platformUnitPriceYuan !== 'number' || !Number.isFinite(record.platformUnitPriceYuan) || record.platformUnitPriceYuan <= 0)) errors.push('invalid platform unit price');
  if (typeof record.areaSqm !== 'number' || !Number.isFinite(record.areaSqm) || record.areaSqm <= 0 || record.areaSqm > 2000) errors.push('invalid area');
  if (typeof record.layout !== 'string' || !/\d+室\d+厅/.test(record.layout)) errors.push('invalid layout');
  if (!isDate(record.soldDate) || record.soldDate > today) errors.push('invalid/future soldDate');
  if (!['platform_reported', 'official_registered'].includes(record.verification)) errors.push('unrecognized verification');
  if (!record.source || !isPublicUrl(record.source.url) || typeof record.source.name !== 'string' || !record.source.name.trim()) errors.push('missing attributable source');
  if (!record.source?.observedAt || !Number.isFinite(Date.parse(record.source.observedAt))) errors.push('invalid observedAt');
  if (typeof record.source?.evidence !== 'string' || record.source.evidence.length < 10) errors.push('missing evidence');
  for (const key of ['image', 'floorplan']) {
    const media = record[key];
    if (media == null) continue;
    const url = typeof media === 'string' ? media : media.url;
    if (typeof url !== 'string' || (!isPublicUrl(url) && !/^assets\/[a-zA-Z0-9_./-]+$/.test(url))) errors.push(`invalid ${key} URL`);
    if (typeof media === 'object' && media.sourceUrl && !isPublicUrl(media.sourceUrl)) errors.push(`invalid ${key} sourceUrl`);
  }
  return errors;
}

// Keep the first observation as the audit record. A source returning no rows
// must never erase history or replace a curated image with a placeholder.
export function mergeRecords(existing, incoming) {
  const records = [...existing];
  const ids = new Set(existing.map(r => r.id));
  const urls = new Set(existing.map(r => r.source.url.replace(/\/$/, '')));
  let added = 0;
  for (const record of incoming) {
    const url = record.source.url.replace(/\/$/, '');
    if (ids.has(record.id) || urls.has(url)) continue;
    records.push(record); ids.add(record.id); urls.add(url); added++;
  }
  records.sort((a, b) => b.soldDate.localeCompare(a.soldDate) || a.id.localeCompare(b.id));
  return { records, added };
}
