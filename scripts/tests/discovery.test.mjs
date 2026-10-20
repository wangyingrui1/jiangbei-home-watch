import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse5i5j } from '../parse-5i5j.mjs';
import { candidateErrors, mergeCandidates, buildReviewedAliases } from '../discovery.mjs';
const html = await readFile(new URL('./fixtures/solds.html', import.meta.url), 'utf8');
const at = '2026-10-20T01:17:00.000Z';
const source = { name: '我爱我家', url: 'https://nj.5i5j.com/solds/test/', communities: {}, discoverUnknown: true, expectedTitle: '测试小区' };
const candidate = parse5i5j(html, source, at).discoveries[0];

test('unknown communities with complete explicit transactions enter review queue, not formal records', () => {
  const parsed = parse5i5j(html, source, at);
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.discoveries.length, 1);
  assert.equal(candidate.communityId, null);
  assert.equal(candidate.communityName, '测试小区一期');
  assert.equal(candidate.reviewStatus, 'pending');
  assert.equal(candidate.verification, 'platform_reported');
  assert.equal(candidate.publishedAt, null);
  assert.deepEqual(candidateErrors(candidate, '2026-10-20'), []);
});

test('discovery refuses unscoped or wrong-region fallback pages', () => {
  assert.throws(() => parse5i5j(html, { ...source, expectedTitle: undefined }, at), /explicit checked page-title scope/);
  assert.throws(() => parse5i5j(html, { ...source, expectedTitle: '浦口' }, at), /scope mismatch/);
});

test('discovery applies same masks, budget, date, and layout checks as official dataset', () => {
  for (const replacement of ['**', '150', '150.01']) assert.equal(parse5i5j(html.replace('<strong>93</strong>', `<strong>${replacement}</strong>`), source, at).discoveries.length, 0);
  assert.equal(parse5i5j(html.replace('成交日期：2026-08-15','发布日期：2026-08-15'), source, at).discoveries.length, 0);
  assert.equal(parse5i5j(html.replace('2室2厅 · 89.32','4室2厅 · 89.32'), source, at).discoveries.length, 0);
});

test('review merge deduplicates and preserves rejection, first evidence, and manual media', () => {
  const old = {...candidate, reviewStatus:'rejected', review:{note:'非目标板块，人工排除'},floorplan:{url:'assets/verified.webp'},source:{...candidate.source,evidence:'第一次观察到的完整明价成交证据保留。'}};
  const merged=mergeCandidates([old],[candidate],[], '2026-10-21T01:17:00Z');
  assert.equal(merged.added,0);
  assert.equal(merged.candidates.length,1);
  assert.equal(merged.candidates[0].reviewStatus,'rejected');
  assert.equal(merged.candidates[0].source.evidence,old.source.evidence);
  assert.deepEqual(merged.candidates[0].floorplan,old.floorplan);
  assert.equal(merged.candidates[0].lastObservedAt,'2026-10-21T01:17:00Z');
});

test('only a real matching formal platform record marks candidate as promoted', () => {
  const merged=mergeCandidates([candidate],[],[{...candidate,communityId:'reviewed-new-community'}]);
  assert.equal(merged.candidates[0].reviewStatus,'promoted');
  assert.equal(merged.candidates[0].communityId,'reviewed-new-community');
  const author={...candidate,id:'author-1',verification:'author_reported'};
  assert.equal(mergeCandidates([author],[],[{...author,communityId:'reviewed'}]).candidates[0].reviewStatus,'pending');
});

test('author reports require author identity and separate exact transaction date', () => {
  const report={...candidate,verification:'author_reported',source:{...candidate.source,author:'公开博主',dateEvidence:'原文明确说明2026年8月15日成交，不使用发帖日期'},publishedAt:'2026-09-01'};
  assert.deepEqual(candidateErrors(report,'2026-10-20'),[]);
  assert.ok(candidateErrors({...report,soldDate:null},'2026-10-20').length);
  assert.ok(candidateErrors({...report,source:{...report.source,author:null}},'2026-10-20').length);
  assert.ok(candidateErrors({...report,reviewStatus:'approved'},'2026-10-20').length);
});

test('all reviewed communities become renewable aliases; ambiguous names are withheld', () => {
  const result=buildReviewedAliases([{id:'old',name:'旧盘',aliases:['一期']},{id:'new',name:'新盘',aliases:['新盘一期','一期']}]);
  assert.equal(result.aliases['新盘一期'].id,'new');
  assert.equal(result.aliases['新盘'].id,'new');
  assert.equal(result.aliases['一期'],undefined);
  assert.deepEqual(result.conflicts,['一期']);
});