import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse5i5j } from '../parse-5i5j.mjs';
import { mergeRecords, recordErrors, isDate, isPublicUrl } from '../lib.mjs';
import { robotsDecision } from '../robots.mjs';

const html = await readFile(new URL('./fixtures/solds.html', import.meta.url), 'utf8');
const source = { name: '我爱我家', url: 'https://nj.5i5j.com/solds/test/', communities: { '测试小区一期': { id: 'test', name: '测试小区' } } };
const at = '2026-10-20T01:17:00.000Z';
const parse = (content = html, config = source) => parse5i5j(content, config, at);
const seed = parse().records[0];

test('extracts completed platform sale with date, layout, approved community, and original disclosed unit price', () => {
  const result = parse();
  assert.equal(result.candidateCount, 1);
  assert.equal(result.records.length, 1);
  assert.equal(seed.id, '5i5j-10000001');
  assert.equal(seed.totalPriceWan, 93);
  assert.equal(seed.areaSqm, 89.32);
  assert.equal(seed.soldDate, '2026-08-15');
  assert.equal(seed.layout, '2室2厅1卫');
  assert.equal(seed.platformCommunityName, '测试小区一期');
  assert.equal(seed.communityName, '测试小区');
  assert.equal(seed.platformUnitPriceYuan, 10405);
  assert.equal(seed.totalPricePrecision, 'platform_display_rounded');
  assert.equal(seed.verification, 'platform_reported');
  assert.match(seed.source.evidence, /2026-08-15/);
  assert.equal(seed.source.listUrl, source.url);
  assert.equal(seed.source.evidenceUrl, source.url);
  assert.match(seed.source.url, /\/sold\/10000001\.html$/);
});

test('never claims a list thumbnail is a verified floorplan or community photograph', () => {
  assert.equal(seed.image, null);
  assert.equal(seed.floorplan, null);
});

test('rejects listing pages and listing URLs even if price is under budget', () => {
  assert.throws(() => parse(html.replace('<title>南京测试小区二手房成交价格</title>', '<title>南京二手房出售</title>')));
  assert.throws(() => parse(html, { ...source, url: 'https://nj.5i5j.com/ershoufang/test/' }));
  assert.equal(parse(html.replace('/sold/10000001.html', '/ershoufang/10000001.html')).records.length, 0);
});

for (const price of ['**', '9*', '约93', '90-95', '93起', '93万', 'NaN', '-1', '93,000', '93.12345']) {
  test(`rejects non-exact or malformed total price ${price}`, () => {
    const result = parse(html.replace('<strong>93</strong>', `<strong>${price}</strong>`));
    assert.equal(result.records.length, 0);
    assert.equal(result.rejected.non_exact_price, 1);
  });
}

test('keeps strict budget and excludes rounded platform display at 150万元', () => {
  assert.equal(parse(html.replace('<strong>93</strong>', '<strong>149.99</strong>')).records.length, 1);
  const boundary = parse(html.replace('<strong>93</strong>', '<strong>150</strong>'));
  assert.equal(boundary.records.length, 0);
  assert.equal(boundary.rejected.budget_boundary_rounded, 1);
  const over = parse(html.replace('<strong>93</strong>', '<strong>150.01</strong>'));
  assert.equal(over.records.length, 0);
  assert.equal(over.rejected.outside_budget, 1);
  assert.equal(parse(html.replace('<strong>93</strong>', '<strong>0</strong>')).records.length, 0);
});

test('requires a specific valid completed date; never substitutes observedAt', () => {
  for (const value of ['挂牌日期：2026-08-15', '成交日期：2026-02-30', '成交日期：2027-01-01', '成交日期：近期']) {
    const result = parse(html.replace('成交日期：2026-08-15', value));
    assert.equal(result.records.length, 0, value);
    assert.equal(result.rejected.missing_or_invalid_sold_date, 1);
  }
});

test('matches exact reviewed community aliases and rejects conflicting layout fields', () => {
  assert.equal(parse(html, { ...source, communities: {} }).records.length, 0);
  assert.equal(parse(html.replace('测试小区一期', '测试小区一期旁')).rejected.community_not_approved, 1);
  const result = parse(html.replace('2室2厅 · 89.32', '3室2厅 · 89.32'));
  assert.equal(result.records.length, 0);
  assert.equal(result.rejected.conflicting_layout, 1);
});

test('a blocked or empty source cannot erase history or curated source media', () => {
  const curated = { ...seed, floorplan: { url: 'assets/verified-floorplan.jpg', sourceUrl: seed.source.url, caption: '已核查' } };
  const result = mergeRecords([curated], []);
  assert.equal(result.added, 0);
  assert.deepEqual(result.records, [curated]);
});

test('deduplicates both source IDs and source URLs and preserves first provenance', () => {
  const existing = { ...seed, source: { ...seed.source, evidence: '首次人工核查证据，保留该条及图片。' } };
  assert.equal(mergeRecords([existing], [seed]).added, 0);
  const byUrl = { ...seed, id: 'different-id' };
  assert.equal(mergeRecords([existing], [byUrl]).added, 0);
  assert.equal(mergeRecords([existing], [seed]).records[0].source.evidence, existing.source.evidence);
  const unique = { ...seed, id: '5i5j-10000003', source: { ...seed.source, url: 'https://nj.5i5j.com/sold/10000003.html' } };
  assert.equal(mergeRecords([existing], [unique]).added, 1);
});

test('schema refuses missing provenance, unknown community, >150, and future dates', () => {
  const ids = new Set(['test']);
  assert.deepEqual(recordErrors(seed, ids, '2026-10-20'), []);
  for (const bad of [{ ...seed, totalPriceWan: 151 }, { ...seed, totalPriceWan: 150 }, { ...seed, communityId: 'unknown' }, { ...seed, soldDate: '2027-01-01' }, { ...seed, source: {} }]) {
    assert.ok(recordErrors(bad, ids, '2026-10-20').length > 0);
  }
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2024-02-29'), true);
  assert.equal(isPublicUrl('http://example.com'), false);
  assert.equal(isPublicUrl('https://127.0.0.1/data'), false);
});

test('robots honors path restrictions, longest matching Allow, and product-specific groups', () => {
  const rules = 'User-agent: *\nDisallow: /solds/\nAllow: /solds/public/\nCrawl-delay: 3\n';
  assert.equal(robotsDecision(rules, source.url).allowed, false);
  assert.equal(robotsDecision(rules, 'https://nj.5i5j.com/solds/public/n2/').allowed, true);
  assert.equal(robotsDecision(rules, source.url).crawlDelaySeconds, 3);
  const specific = rules + '\nUser-agent: JiangbeiHomeWatch\nAllow: /solds/\nDisallow: /solds/private/\n';
  assert.equal(robotsDecision(specific, source.url).allowed, true);
  assert.equal(robotsDecision(specific, 'https://nj.5i5j.com/solds/private/').allowed, false);
});

test('robots handles wildcards and URL-ending rules', () => {
  const rules = 'User-agent: *\nDisallow: /*?secret=*\nDisallow: /exact$\n';
  assert.equal(robotsDecision(rules, 'https://nj.5i5j.com/solds/?secret=abc').allowed, false);
  assert.equal(robotsDecision(rules, 'https://nj.5i5j.com/exact').allowed, false);
  assert.equal(robotsDecision(rules, 'https://nj.5i5j.com/exact/more').allowed, true);
});