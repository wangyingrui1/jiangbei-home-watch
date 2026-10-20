import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseFangDetail} from '../parse-fang.mjs';
import {candidateErrors} from '../discovery.mjs';
const html=await readFile(new URL('./fixtures/fang-detail.html',import.meta.url),'utf8');
const source={name:'房天下南京',url:'https://m.fang.com/chengjiao/nanjing/EX_999999.html',expectedTitle:'浦口',communities:{}};
const at='2026-10-20T01:17:00.000Z';
const parse=h=>parseFangDetail(h,source,at);

test('Fang parses visible main completed-sale facts and keeps market information pending',()=>{
 const r=parse(html);assert.equal(r.records.length,0);assert.equal(r.discoveries.length,1);
 const c=r.discoveries[0];assert.equal(c.communityName,'测试新社区');assert.equal(c.totalPriceWan,93);assert.equal(c.areaSqm,89.32);assert.equal(c.layout,'2室2厅');assert.equal(c.soldDate,'2026-06-03');assert.equal(c.platformUnitPriceYuan,10405);assert.equal(c.source.upstreamClassification,'市场信息');assert.equal(c.reviewReason,'market_information_requires_review');assert.equal(c.communityHints.builtYear,2017);assert.equal(c.floorplan,null);assert.deepEqual(candidateErrors(c,'2026-10-20'),[]);
});

test('Fang does not infer a newer price/date from masked related records, listings, or hidden inputs',()=>{
 const c=parse(html).discoveries[0];assert.notEqual(c.soldDate,'2026-10-01');assert.notEqual(c.totalPriceWan,108);assert.notEqual(c.totalPriceWan,149);
 const masked=parse(html.replace('>93</span>','>**</span>'));assert.equal(masked.discoveries.length,0);assert.equal(masked.rejected.non_exact_price,1);
});

test('Fang excludes zero, overbudget, rounded150 and invalid dates',()=>{
 for(const price of ['0','150','151'])assert.equal(parse(html.replace('>93</span>',`>${price}</span>`)).discoveries.length,0);
 assert.equal(parse(html.replace('2026-06-03','2026-02-30')).discoveries.length,0);
 assert.equal(parse(html.replace('2026-06-03','2027-01-01')).discoveries.length,0);
});

test('Fang rejects wrong geography, listing pages and missing upstream source',()=>{
 assert.throws(()=>parse(html.replaceAll('南京浦口','南京江宁')),/geography/);
 assert.throws(()=>parse(html.replaceAll('成交二手房','在售二手房')),/completed-sale/);
 assert.throws(()=>parseFangDetail(html,{...source,url:'https://m.fang.com/esf/nanjing/JUHE_999999.html'},at));
 assert.equal(parse(html.replace('<p>市场信息</p>','<p></p>')).rejected.missing_upstream_source,1);
});