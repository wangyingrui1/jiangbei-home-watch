import { recordErrors, isDate, isPublicUrl } from './lib.mjs';

export const REVIEW_STATES = new Set(['pending', 'approved', 'rejected', 'promoted']);
export function candidateErrors(candidate, today = new Date().toISOString().slice(0, 10)) {
  if (!candidate || typeof candidate !== 'object') return ['candidate must be an object'];
  // Same strict price/date/layout/source rules as a transaction, without pretending
  // that an unknown community has already been vetted or an author is a platform.
  const errors = recordErrors({ ...candidate, communityId: 'candidate', verification: 'platform_reported' }, new Set(['candidate']), today);
  if (!['platform_reported', 'author_reported'].includes(candidate.verification)) errors.push('candidate verification must distinguish platform from author');
  if (!REVIEW_STATES.has(candidate.reviewStatus)) errors.push('invalid reviewStatus');
  if (!candidate.soldDate || !isDate(candidate.soldDate)) errors.push('exact soldDate required; publication date is not a substitute');
  if (candidate.publishedAt != null && !Number.isFinite(Date.parse(candidate.publishedAt))) errors.push('invalid publishedAt');
  if (candidate.verification === 'author_reported' && (!candidate.source?.author || candidate.source.author.trim().length < 1)) errors.push('author-reported candidate requires original author');
  if (candidate.verification === 'author_reported' && (typeof candidate.source?.dateEvidence !== 'string' || !/成交|签约/.test(candidate.source.dateEvidence))) errors.push('author report needs evidence of the exact transaction date, separately from publication');
  if (candidate.source?.evidenceUrl && !isPublicUrl(candidate.source.evidenceUrl)) errors.push('invalid evidence URL');
  if (candidate.reviewStatus === 'approved' && (!candidate.review?.reviewer || !candidate.review?.reviewedAt || !candidate.review?.note)) errors.push('approved candidate requires reviewer, time, and note');
  return errors;
}

export function mergeCandidates(existing, incoming, formalRecords = [], checkedAt = new Date().toISOString()) {
  const entries = new Map(existing.map(c => [c.id, { ...c }]));
  const byUrl = new Map(existing.map(c => [c.source.url, c.id]));
  let added = 0;
  for (const candidate of incoming) {
    const id = entries.has(candidate.id) ? candidate.id : byUrl.get(candidate.source.url);
    if (id) {
      const old = entries.get(id);
      // Preserve reviewed decisions, first evidence, and human-verified media.
      entries.set(id, { ...old, lastObservedAt: checkedAt });
    } else {
      entries.set(candidate.id, { ...candidate, firstObservedAt: candidate.firstObservedAt || checkedAt, lastObservedAt: checkedAt });
      byUrl.set(candidate.source.url, candidate.id); added++;
    }
  }
  const formal = new Map(formalRecords.map(r => [r.id, r]));
  for (const [id, candidate] of entries) if (formal.has(id) && candidate.verification === 'platform_reported') {
    entries.set(id, { ...candidate, reviewStatus: 'promoted', communityId: formal.get(id).communityId });
  }
  return { added, candidates: [...entries.values()].sort((a, b) => b.soldDate.localeCompare(a.soldDate) || a.id.localeCompare(b.id)) };
}

export function buildReviewedAliases(communities) {
  const aliases = {}, conflicts = new Set();
  for (const c of communities) for (const alias of new Set([c.name, ...(c.aliases || [])])) {
    if (!alias) continue;
    if (aliases[alias] && aliases[alias].id !== c.id) conflicts.add(alias);
    else aliases[alias] = { id: c.id, name: c.name, sector: c.sector || null };
  }
  // Ambiguous names are never silently assigned to one development.
  for (const conflict of conflicts) delete aliases[conflict];
  return { aliases, conflicts: [...conflicts] };
}