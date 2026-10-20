# 新小区发现与人工来源

`npm run discover` 仅更新 `data/discovery.json` 和检查状态，正式交易库不改；`npm run update` 同时续采已审核小区的正式平台记录。板块列表必须匹配配置的标题范围，未知小区即使资料完整也先进入候选，不自动猜小区属性或图片。默认覆盖浦口全板块、分价列表、高新和江浦分页；配置可继续补充已验证的公开板块入口。

`data/discovery.json` 的 `candidates` 保留 `platform_reported`（平台披露）和 `author_reported`（博主/作者自述）两种来源，`reviewStatus` 为 pending / approved / rejected / promoted。候选不进入正式平台统计。日期为明确的成交日，`publishedAt` 独立存发帖时间，不能拿发帖日补成交日。审核过的新小区加入 `communities.json` 的 name/aliases 后，下次采集会自动识别其平台记录，不再受最初7盘白名单限制。

贝壳/链家/小红书配置为 `public_watch`：每日先检查 robots，禁止则记录受限；不会冒充搜索引擎，也不会绕过验证码。该监测不是成交抓取接口。用户人工核查的原始公开材料可通过以下命令加入候选，仍按来源分类，不混为官方网签核验。

```bash
npm run import:review -- --file work/review.json --dry-run
npm run import:review -- --file work/review.json
```

输入为 `{ "items": [...] }`。新条目必须提供 communityName、totalPriceWan 数字、areaSqm 数字、layout、精确 soldDate（YYYY-MM-DD）、verification、source.name/url/evidence；博主来源另需 source.author 和 source.dateEvidence 说明原文成交日期证据。可以提供 publishedAt，但脚本不会自动转为 soldDate。总价为平台万元显示时请标 totalPricePrecision=platform_display_rounded，显示150万边界不会收录。

每条另需 review.decision=pending/approve/reject。批准须 reviewer、reviewedAt、至少10字的 note，以及 sourceChecked/priceChecked/dateChecked/geographyChecked 全部为 true。已在队列的条目只需 id 和 review 即可；审核不能悄悄改原始价格、日期、面积等事实。导入只写候选，绝不自动把博主自述升格为平台成交或修改正式社区档案。

图片必须人工实际查看，新增图片需 review.mediaChecked=true，图片对象 visuallyVerified=true，且含原始出处；文件名含 floorPlan 并不保证是真户型，也可能是平台占位图。缺图保持 null。