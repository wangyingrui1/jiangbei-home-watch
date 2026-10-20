const escape = text => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const matches = (pattern, path) => {
  const end = pattern.endsWith('$');
  const base = end ? pattern.slice(0, -1) : pattern;
  return new RegExp(`^${base.split('*').map(escape).join('.*')}${end ? '$' : ''}`).test(path);
};

export function robotsDecision(text, url, agent = 'JiangbeiHomeWatch') {
  const groups = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || current.directives) { current = { agents: [], rules: [], directives: false }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current && ['allow', 'disallow'].includes(key)) {
      current.directives = true;
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    } else if (current && key === 'crawl-delay') {
      current.directives = true;
      const seconds = Number(value); if (Number.isFinite(seconds) && seconds >= 0) current.delay = seconds;
    }
  }
  const product = agent.toLowerCase();
  const ranked = groups.map(g => ({ ...g, rank: Math.max(-1, ...g.agents.map(a => a === '*' ? 0 : product.includes(a) ? a.length : -1)) }));
  const rank = Math.max(-1, ...ranked.map(g => g.rank));
  const selected = ranked.filter(g => g.rank === rank && rank >= 0);
  const target = new URL(url), path = target.pathname + target.search;
  const rules = selected.flatMap(g => g.rules).filter(r => matches(r.path, path)).sort((a, b) => b.path.replace(/\*/g, '').length - a.path.replace(/\*/g, '').length || Number(b.allow) - Number(a.allow));
  return { allowed: rules[0]?.allow ?? true, crawlDelaySeconds: Math.max(0, ...selected.map(g => g.delay || 0)), rule: rules[0]?.path ?? null };
}
