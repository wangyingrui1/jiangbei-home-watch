import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { candidateErrors } from './discovery.mjs';
import { reportDatasetErrors } from './reports.mjs';
import { ROOT, readJson, recordErrors, isPublicUrl } from './lib.mjs';

export async function validate() {
  const [transactions, communities, sources] = await Promise.all([readJson('data/transactions.json'), readJson('data/communities.json'), readJson('data/sources.json')]);
  const issues = [];
  if (!Array.isArray(transactions.records)) issues.push('transactions.records must be an array');
  if (!Array.isArray(communities.communities)) issues.push('communities.communities must be an array');
  if (!Array.isArray(sources.sources)) issues.push('sources.sources must be an array');
  if (issues.length) throw new Error(issues.join('\n'));
  const communityIds = new Set();
  for (const c of communities.communities) {
    if (!c.id || !c.name || communityIds.has(c.id)) issues.push(`Invalid or duplicate community: ${c.id}`);
    communityIds.add(c.id);
  }
  const ids = new Set(), urls = new Set();
  for (const r of transactions.records) {
    issues.push(...recordErrors(r, communityIds).map(e => `${r.id}: ${e}`));
    if (ids.has(r.id)) issues.push(`Duplicate transaction id: ${r.id}`);
    if (urls.has(r.source?.url)) issues.push(`Duplicate transaction source URL: ${r.source?.url}`);
    ids.add(r.id); urls.add(r.source?.url);
    for (const key of ['image', 'floorplan']) {
      const media = r[key];
      const url = typeof media === 'string' ? media : media?.url;
      if (url?.startsWith('assets/')) try { await access(resolve(ROOT, url)); } catch { issues.push(`${r.id}: missing local ${key} ${url}`); }
    }
  }
  const sourceIds = new Set();
  for (const source of sources.sources) {
    if (!source.id || sourceIds.has(source.id) || !isPublicUrl(source.url)) issues.push(`Invalid source: ${source.id}`);
    sourceIds.add(source.id);
    for (const mapping of Object.values(source.communities || {})) if (!communityIds.has(mapping.id)) issues.push(`Source ${source.id}: unknown community ${mapping.id}`);
  }
  try {
    const discovery = await readJson('data/discovery.json');
    if (!Array.isArray(discovery.candidates)) issues.push('discovery.candidates must be an array');
    else {
      const candidateIds = new Set();
      for (const c of discovery.candidates) {
        issues.push(...candidateErrors(c).map(e => `${c.id}: candidate ${e}`));
        if (candidateIds.has(c.id)) issues.push(`Duplicate discovery ID: ${c.id}`);
        candidateIds.add(c.id);
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    const reports = await readJson('data/reports.json');
    issues.push(...reportDatasetErrors(reports, ids));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (issues.length) throw new Error(`Data validation failed:\n${issues.join('\n')}`);
  console.log(`Validated ${transactions.records.length} transactions, ${communities.communities.length} communities, ${sources.sources.length} source pages. All transaction totals are within 150万元.`);
  return true;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(ROOT, 'scripts/validate.mjs')) await validate();
