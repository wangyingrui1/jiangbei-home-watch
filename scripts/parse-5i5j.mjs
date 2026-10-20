import { plainText, isDate } from './lib.mjs';

/** Read only explicit public completed-sale cards; unknown communities go to a separate review queue. */
export function parse5i5j(html, source, observedAt = new Date().toISOString()) {
  const result = { records: [], discoveries: [], candidateCount: 0, rejected: {} };
  const reject = reason => { result.rejected[reason] = (result.rejected[reason] || 0) + 1; };
  const page = new URL(source.url);
  if (page.hostname !== 'nj.5i5j.com' || !/^\/solds\//.test(page.pathname)) throw new Error('Only approved Nanjing completed-sale list pages are accepted');
  const pageTitle = plainText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
  if (!/(?:成交|网签)/.test(pageTitle)) throw new Error('Page title does not identify a completed-sale page');
  if (source.expectedTitle && !pageTitle.includes(source.expectedTitle)) throw new Error(`Page scope mismatch: expected title to include ${source.expectedTitle}; got ${pageTitle}`);
  if (source.discoverUnknown && !source.expectedTitle) throw new Error('Unknown-community discovery requires an explicit checked page-title scope');
  const today = new Date(observedAt).toISOString().slice(0, 10);
  for (const li of html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)) {
    const card = li[0];
    const href = card.match(/<a\b[^>]*href\s*=\s*["'](\/sold\/(\d+)\.html)["']/i);
    if (!href) continue;
    result.candidateCount++;
    const text = plainText(card);
    const title = plainText(card.match(/<p\b[^>]*class=["'][^"']*\bsTit\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const titleMatch = title.match(/^(.+?)\s+(\d+室\s*\d+厅(?:\s*\d+卫)?)(?:\s|$)/);
    if (!titleMatch) { reject('unrecognized_title'); continue; }
    const platformCommunityName = titleMatch[1].trim();
    const mapping = source.communities?.[platformCommunityName];
    const mapped = mapping && typeof mapping === 'object' && mapping.id && mapping.name ? mapping : null;
    const priceBlock = card.match(/<div\b[^>]*class=["'][^"']*\bjiage\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const rawPrice = plainText(priceBlock.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || '');
    if (!/^\d+(?:\.\d{1,4})?$/.test(rawPrice) || !/<\/strong>\s*万/.test(priceBlock)) { reject('non_exact_price'); continue; }
    const totalPriceWan = Number(rawPrice);
    if (totalPriceWan <= 0 || totalPriceWan > 150) { reject('outside_budget'); continue; }
    if (totalPriceWan === 150) { reject('budget_boundary_rounded'); continue; }
    const soldDate = text.match(/成交日期\s*[：:]\s*(\d{4}-\d{2}-\d{2})(?:\s|$)/)?.[1];
    if (!isDate(soldDate) || soldDate > today) { reject('missing_or_invalid_sold_date'); continue; }
    const details = text.match(/(\d+室\s*\d+厅(?:\s*\d+卫)?)\s*[·|]\s*(\d+(?:\.\d+)?)\s*(?:平米|㎡|m²)\s*[·|]\s*([^\s]+)/i);
    if (!details) { reject('missing_area_layout'); continue; }
    const areaSqm = Number(details[2]);
    if (areaSqm <= 0 || areaSqm > 2000) { reject('invalid_area'); continue; }
    const layout = titleMatch[2].replace(/\s/g, '');
    if (details[1].replace(/\s/g, '').replace(/\d+卫$/, '') !== layout.replace(/\d+卫$/, '')) { reject('conflicting_layout'); continue; }
    const url = new URL(href[1], page.origin).href;
    const rawUnitPrice = plainText(priceBlock).match(/单价\s*(\d+(?:\.\d+)?)\s*元\s*\/\s*㎡/)?.[1];
    const record = {
      id: `5i5j-${href[2]}`, communityId: mapped?.id || null, communityName: mapped?.name || platformCommunityName,
      platformCommunityName, sector: mapped?.sector || source.sectorHint || null,
      totalPriceWan, totalPricePrecision: 'platform_display_rounded', platformUnitPriceYuan: rawUnitPrice ? Number(rawUnitPrice) : null,
      areaSqm, layout, soldDate, orientation: details[3],
      source: { name: source.name, url, listUrl: source.url, evidenceUrl: source.url, observedAt,
        evidence: `${platformCommunityName} ${layout}，${areaSqm}㎡，成交日期 ${soldDate}，平台披露成交总价（显示值） ${rawPrice}万元；采自 ${source.url}` },
      verification: 'platform_reported', image: null, floorplan: null
    };
    if (mapped) result.records.push(record);
    else if (source.discoverUnknown) result.discoveries.push({ ...record,
      publishedAt: null, reviewStatus: 'pending', reviewReason: 'unknown_community',
      firstObservedAt: observedAt, lastObservedAt: observedAt,
      scopeEvidence: { platform: '我爱我家南京', pageTitle, expectedTitle: source.expectedTitle, url: source.url },
      disclosureLabel: '平台披露 · 新小区待审核'
    });
    else reject('community_not_approved');
  }
  return result;
}