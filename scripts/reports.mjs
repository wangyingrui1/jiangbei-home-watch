import { isDate, isPublicUrl } from './lib.mjs';

// Social-media rows may truthfully lack a layout. They remain author reports,
// with their own dates and attribution, never promoted by this validator.
export function reportDatasetErrors(data, formalIds = new Set(), today = new Date().toISOString().slice(0, 10)) {
  if (!data || !Array.isArray(data.reports)) return ['reports.reports must be an array'];
  const errors = [], reportIds = new Set(), rowIds = new Set();
  for (const report of data.reports) {
    const prefix = report?.id || 'report';
    if (!report || typeof report !== 'object') { errors.push('report must be an object'); continue; }
    if (typeof report.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(report.id) || reportIds.has(report.id)) errors.push(`${prefix}: invalid/duplicate report id`);
    reportIds.add(report.id);
    if (report.verification !== 'author_reported') errors.push(`${prefix}: social report must remain author_reported`);
    if (typeof report.author !== 'string' || !report.author.trim()) errors.push(`${prefix}: missing original author`);
    if (typeof report.title !== 'string' || !report.title.trim() || !isPublicUrl(report.url)) errors.push(`${prefix}: missing original title/URL`);
    if (!isDate(report.publishedAt) || report.publishedAt > today) errors.push(`${prefix}: invalid publication date`);
    if (!Number.isFinite(Date.parse(report.observedAt))) errors.push(`${prefix}: invalid observation time`);
    if (report.soldDate != null && (!isDate(report.soldDate) || report.soldDate > today)) errors.push(`${prefix}: invalid report transaction date`);
    if (typeof report.evidenceNote !== 'string' || report.evidenceNote.length < 10) errors.push(`${prefix}: missing review/evidence note`);
    if (!Array.isArray(report.records)) { errors.push(`${prefix}: records must be an array`); continue; }
    for (const row of report.records) {
      const label = `${prefix}/${row?.id || 'row'}`;
      if (!row || typeof row !== 'object') { errors.push(`${label}: row must be an object`); continue; }
      if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(row.id) || rowIds.has(row.id)) errors.push(`${label}: invalid/duplicate row id`);
      rowIds.add(row.id);
      if (formalIds.has(row.id)) errors.push(`${label}: social row also appears in formal transaction statistics`);
      if (row.verification !== 'author_reported') errors.push(`${label}: row must remain author_reported`);
      if (typeof row.communityName !== 'string' || !row.communityName.trim()) errors.push(`${label}: missing community`);
      if (typeof row.totalPriceWan !== 'number' || !Number.isFinite(row.totalPriceWan) || row.totalPriceWan <= 0 || row.totalPriceWan > 150) errors.push(`${label}: total outside (0,150]`);
      if (row.totalPriceWan === 150 && row.totalPricePrecision !== 'exact') errors.push(`${label}: displayed 150 needs exact precision to satisfy budget`);
      if (typeof row.areaSqm !== 'number' || !Number.isFinite(row.areaSqm) || row.areaSqm <= 0 || row.areaSqm > 2000) errors.push(`${label}: invalid disclosed area`);
      if (row.layout != null && (typeof row.layout !== 'string' || !/^\d+室\d+厅(?:\d+卫)?$/.test(row.layout))) errors.push(`${label}: layout must be disclosed layout or null`);
      if (!isDate(row.soldDate) || row.soldDate > today) errors.push(`${label}: explicit transaction date required; publication is not a substitute`);
      if (report.soldDate && row.soldDate !== report.soldDate) errors.push(`${label}: row date disagrees with report's stated transaction day`);
      const source = row.source;
      if (!source || !isPublicUrl(source.url) || typeof source.name !== 'string' || !source.name.trim()) errors.push(`${label}: missing original source`);
      if (!Number.isFinite(Date.parse(source?.observedAt))) errors.push(`${label}: invalid source observation time`);
      if (typeof source?.evidence !== 'string' || source.evidence.length < 10) errors.push(`${label}: missing row evidence`);
      if (source?.publishedAt != null && !isDate(source.publishedAt)) errors.push(`${label}: invalid source publication date`);
    }
  }
  return errors;
}