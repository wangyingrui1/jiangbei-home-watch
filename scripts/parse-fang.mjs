import { plainText, isDate } from './lib.mjs';

/** Visible 房天下 completed-sale detail fields only. Market information remains a review candidate. */
export function parseFangDetail(html, source, observedAt = new Date().toISOString()) {
  const result = { records: [], discoveries: [], candidateCount: 1, rejected: {} };
  const reject = reason => { result.rejected[reason] = 1; return result; };
  const url = new URL(source.url);
  const id = url.pathname.match(/^\/chengjiao\/nanjing\/(EX_\d+)\.html$/)?.[1];
  if (url.hostname !== 'm.fang.com' || !id) throw new Error('Only original Nanjing Fang completed-sale detail URLs are accepted');
  const pageTitle = plainText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
  if (!/南京.*成交二手房/.test(pageTitle)) throw new Error('Fang page is not an explicit Nanjing completed-sale detail');
  if (!source.expectedTitle || !pageTitle.includes(source.expectedTitle)) throw new Error('Fang page geography does not match reviewed source scope');
  const caption = html.match(/<section\b[^>]*class=["'][^"']*\bxqCaption\b[^"']*["'][^>]*>[\s\S]*?<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
  const heading = plainText(caption).match(/^(.+?)\s+(\d+室\s*\d+厅(?:\s*\d+卫)?)\s+(\d+(?:\.\d+)?)\s*㎡$/);
  if (!heading) return reject('unrecognized_community_layout_area');
  const platformCommunityName = heading[1], layout = heading[2].replace(/\s/g, ''), areaSqm = Number(heading[3]);
  const priceSection = html.match(/<section\b[^>]*class=["'][^"']*\btrend-white\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i)?.[1] || '';
  let rawPrice = '', rawUnit = '';
  for (const item of priceSection.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const label = plainText(item[1].match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const amount = plainText(item[1].match(/<span\b[^>]*class=["'][^"']*\bnumb\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    if (label === '成交总价') rawPrice = amount;
    if (label === '单价') rawUnit = amount;
  }
  if (!/^\d+(?:\.\d{1,4})?$/.test(rawPrice)) return reject('non_exact_price');
  const totalPriceWan = Number(rawPrice);
  if (totalPriceWan <= 0 || totalPriceWan > 150) return reject('outside_budget');
  if (totalPriceWan === 150) return reject('budget_boundary_rounded');
  const table = html.match(/<ul\b[^>]*class=["'][^"']*\bflextable\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] || '';
  const fields = {};
  for (const item of table.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const key = plainText(item[1].match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '').replace(/[：:]$/, '');
    fields[key] = plainText(item[1].match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
  }
  const soldDate = fields['日期'];
  if (!isDate(soldDate) || soldDate > observedAt.slice(0, 10)) return reject('missing_or_invalid_sold_date');
  if (!fields['来源']) return reject('missing_upstream_source');
  if (!(areaSqm > 0 && areaSqm <= 2000)) return reject('invalid_area');
  const mapped = source.communities?.[platformCommunityName];
  const builtYear = Number(plainText(html).match(/建筑年代\s*[：:]?\s*(\d{4})年建/)?.[1]) || null;
  result.discoveries.push({
    id: `fang-${id.replace('_','-')}`, communityId: mapped?.id || null, communityName: mapped?.name || platformCommunityName,
    platformCommunityName, sector: mapped?.sector || source.sectorHint || null,
    totalPriceWan, totalPricePrecision: 'platform_display_rounded', platformUnitPriceYuan: /^\d+(?:\.\d+)?$/.test(rawUnit) ? Number(rawUnit) : null,
    areaSqm, layout, soldDate, orientation: fields['朝向'] || null, publishedAt: null,
    source: { name: source.name, url: source.url, evidenceUrl: source.url, observedAt, upstreamClassification: fields['来源'],
      evidence: `${platformCommunityName} ${layout} ${areaSqm}㎡；可见成交总价${rawPrice}万元；日期${soldDate}；页面来源标注“${fields['来源']}”。平台市场信息，非合同或官方网签逐套核验。` },
    verification: 'platform_reported', reviewStatus: 'pending', reviewReason: 'market_information_requires_review',
    firstObservedAt: observedAt, lastObservedAt: observedAt,
    scopeEvidence: { platform: source.name, pageTitle, expectedTitle: source.expectedTitle, url: source.url },
    communityHints: { builtYear, sourceUrl: source.url },
    disclosureLabel: '房天下披露 · 市场信息待审核', image: null, floorplan: null
  });
  return result;
}