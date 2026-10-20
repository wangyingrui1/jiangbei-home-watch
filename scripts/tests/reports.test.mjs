import test from 'node:test';
import assert from 'node:assert/strict';
import {reportDatasetErrors} from '../reports.mjs';
const row={id:'test-author-row',communityName:'测试小区',totalPriceWan:137,areaSqm:89,layout:null,soldDate:'2026-09-28',verification:'author_reported',source:{name:'测试作者公开披露',url:'https://example.com/public-report',observedAt:'2026-10-20T01:00:00Z',publishedAt:'2026-10-19',evidence:'原表明确标注20260928成交，测试小区89平方米，137万元；户型未知。'}};
const report={id:'test-author-report',author:'测试作者',title:'9月28日公开成交整理',url:row.source.url,publishedAt:'2026-10-19',observedAt:'2026-10-20T01:00:00Z',soldDate:'2026-09-28',verification:'author_reported',evidenceNote:'已核对公开原文和原图；属于作者整理披露，未经交易平台逐套确认。',records:[row]};
const check=r=>reportDatasetErrors({reports:[r]},new Set(),'2026-10-20');

test('social reports allow missing layout and preserve independent publication/transaction days',()=>{
 assert.deepEqual(check(report),[]);assert.equal(row.layout,null);assert.notEqual(row.soldDate,report.publishedAt);
});
test('social rows cannot masquerade as platform verification or join official record IDs',()=>{
 assert.ok(check({...report,verification:'platform_reported'}).length);
 assert.ok(check({...report,records:[{...row,verification:'platform_reported'}]}).length);
 assert.ok(reportDatasetErrors({reports:[report]},new Set([row.id]),'2026-10-20').length);
});
test('social rows require explicit transaction date rather than inheriting publication time',()=>{
 assert.ok(check({...report,records:[{...row,soldDate:null}]}).length);
 assert.ok(check({...report,records:[{...row,soldDate:report.publishedAt}]}).length);
 assert.ok(check({...report,publishedAt:'2026-02-30'}).length);
});
test('social reports retain budget and provenance guards',()=>{
 for(const price of [0,150,151,'137'])assert.ok(check({...report,records:[{...row,totalPriceWan:price}]}).length);
 assert.deepEqual(check({...report,records:[{...row,totalPriceWan:150,totalPricePrecision:'exact'}]}),[]);
 assert.ok(check({...report,records:[{...row,source:{...row.source,url:'javascript:alert(1)'}}]}).length);
 assert.ok(check({...report,records:[row,{...row}]}).length);
});