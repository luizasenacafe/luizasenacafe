// Gera dist/hud.svg: painel de status do perfil (contribuições, streaks, linguagens).
// Roda no GitHub Actions com o GITHUB_TOKEN padrão. Sem dependências.
// Teste local sem rede: HUD_MOCK=1 node .github/scripts/hud.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const login = process.env.GH_LOGIN || process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.GITHUB_TOKEN;
const out = process.env.HUD_OUT || "dist/hud.svg";

async function gql(query, variables) {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "profile-hud" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors || j));
  return j.data;
}

async function load() {
  if (process.env.HUD_MOCK) {
    const days = [];
    for (let i = 400; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      days.push({ date: d, contributionCount: i % 9 === 0 || (i > 3 && i < 30 && i % 4 === 0) ? 0 : (i * 7) % 5 });
    }
    return { days, commits: 412, prs: 9, issues: 4, stars: 12, repos: 8, followers: 21,
      langs: [["Python", 52000], ["JavaScript", 31000], ["TypeScript", 22000], ["HTML", 14000], ["CSS", 9000], ["C", 2000]] };
  }
  const base = await gql(`query($login:String!){ user(login:$login){
    createdAt followers{totalCount} pullRequests{totalCount} issues{totalCount}
    contributionsCollection{ totalCommitContributions }
    repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
      totalCount nodes{ stargazerCount languages(first:10, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name } } } } } } }`, { login });
  const u = base.user;
  const days = [];
  const now = new Date();
  for (let y = new Date(u.createdAt).getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
    const from = `${y}-01-01T00:00:00Z`;
    const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
    const d = await gql(`query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){
      contributionsCollection(from:$from,to:$to){ contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`, { login, from, to });
    for (const w of d.user.contributionsCollection.contributionCalendar.weeks) days.push(...w.contributionDays);
  }
  const langs = new Map();
  let stars = 0;
  for (const r of u.repositories.nodes) {
    stars += r.stargazerCount;
    for (const e of r.languages.edges) langs.set(e.node.name, (langs.get(e.node.name) || 0) + e.size);
  }
  return { days, commits: u.contributionsCollection.totalCommitContributions,
    prs: u.pullRequests.totalCount, issues: u.issues.totalCount, stars, repos: u.repositories.totalCount,
    followers: u.followers.totalCount, langs: [...langs.entries()].sort((a, b) => b[1] - a[1]) };
}

function streaks(days) {
  const seen = new Map();
  for (const d of days) seen.set(d.date, d.contributionCount);
  const list = [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const today = new Date().toISOString().slice(0, 10);
  let total = 0, longest = 0, run = 0;
  for (const [date, c] of list) {
    if (date > today) break;
    total += c;
    if (c > 0) { run++; longest = Math.max(longest, run); }
    else if (date !== today) run = 0; // hoje ainda zerado não quebra o streak
  }
  return { total, longest, current: run };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => n.toLocaleString("pt-BR");

function render(d) {
  const s = streaks(d.days);
  const level = Math.floor(Math.sqrt(s.total));          // LV = √(contribuições totais)
  const lo = level ** 2, hi = (level + 1) ** 2;
  const xp = hi > lo ? (s.total - lo) / (hi - lo) : 0;
  const sum = d.langs.reduce((a, [, v]) => a + v, 0) || 1;
  const top = d.langs.slice(0, 5).map(([n, v]) => [n, (v / sum) * 100]);
  const W = 880, H = 330, RED = "#e11d2e", INK = "#f4f4f5", SIL = "#b9b9be", DIM = "#6a6a70", LINE = "#26262a";
  const mono = `ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace`;
  const sans = `'Segoe UI',system-ui,-apple-system,Helvetica,Arial,sans-serif`;

  const big = [["CONTRIBUIÇÕES", fmt(s.total), "desde o início"], ["STREAK ATUAL", fmt(s.current), s.current === 1 ? "dia seguido" : "dias seguidos"], ["MAIOR STREAK", fmt(s.longest), s.longest === 1 ? "dia" : "dias"]];
  const bigSvg = big.map(([l, v, sub], i) => {
    const x = 40 + i * 176;
    return `<g transform="translate(${x} 112)">${i ? `<path d="M-20 -6 V78" stroke="${LINE}"/>` : ""}
<text font-family="${mono}" font-size="10.5" letter-spacing="2" fill="${DIM}">${l}</text>
<text y="50" font-family="${sans}" font-size="46" font-weight="700" fill="${i === 1 ? RED : INK}">${v}</text>
<text y="72" font-family="${mono}" font-size="10.5" fill="${DIM}">${sub}</text></g>`;
  }).join("");

  const rows = [["COMMITS (12 MESES)", d.commits], ["PULL REQUESTS", d.prs], ["ISSUES", d.issues], ["STARS", d.stars], ["REPOS PÚBLICOS", d.repos], ["SEGUIDORES", d.followers]];
  const rowSvg = rows.map(([l, v], i) => {
    const x = 40 + (i % 3) * 176, y = 232 + Math.floor(i / 3) * 44;
    return `<g transform="translate(${x} ${y})"><text font-family="${mono}" font-size="9.5" letter-spacing="1.5" fill="${DIM}">${l}</text>
<text y="22" font-family="${mono}" font-size="17" font-weight="600" fill="${INK}">${fmt(v)}</text></g>`;
  }).join("");

  const bx = 598, bw = 242;
  const langSvg = top.length ? top.map(([n, p], i) => {
    const y = 110 + i * 40, w = Math.max(3, (p / 100) * bw);
    return `<g transform="translate(${bx} ${y})"><text font-family="${mono}" font-size="11.5" fill="${SIL}">${esc(n)}</text>
<text x="${bw}" text-anchor="end" font-family="${mono}" font-size="11.5" fill="${DIM}">${p.toFixed(1).replace(".", ",")}%</text>
<rect y="9" width="${bw}" height="7" rx="1" fill="#141417"/>
<rect class="bar" style="animation-delay:${i * 0.12}s" y="9" width="${w.toFixed(1)}" height="7" rx="1" fill="${i === 0 ? RED : ["#f4f4f5", "#b9b9be", "#8a8a90", "#5f5f66"][i - 1]}"/></g>`;
  }).join("") : `<text x="${bx}" y="130" font-family="${mono}" font-size="11.5" fill="${DIM}">sem dados de linguagem</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Status do GitHub: ${fmt(s.total)} contribuições, streak atual ${s.current}, maior streak ${s.longest}">
<defs><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#fff" opacity=".03"/></pattern></defs>
<style>.bar{transform-origin:0 0;animation:g 1.1s cubic-bezier(.2,.8,.2,1) both}@keyframes g{from{transform:scaleX(0)}}
.xp{transform-origin:40px 0;animation:g 1.4s cubic-bezier(.2,.8,.2,1) both}.dot{animation:b 1.6s steps(1) infinite}@keyframes b{50%{opacity:.15}}
@media (prefers-reduced-motion:reduce){.bar,.xp,.dot{animation:none}}</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="#08080a" stroke="${LINE}"/>
<rect width="${W}" height="${H}" rx="12" fill="url(#scan)"/>
<g fill="none" stroke="#4a4a50" stroke-width="1.5"><path d="M14 34 V14 H34"/><path d="M${W - 34} 14 H${W - 14} V34"/><path d="M14 ${H - 34} V${H - 14} H34"/><path d="M${W - 34} ${H - 14} H${W - 14} V${H - 34}"/></g>
<text x="40" y="50" font-family="${mono}" font-size="12" letter-spacing="3" fill="${SIL}">STATUS <tspan fill="${DIM}">// @${esc(login)}</tspan></text>
<text x="40" y="74" font-family="${mono}" font-size="12" font-weight="700" fill="${RED}">LV ${level}</text>
<rect x="100" y="66" width="390" height="6" rx="1" fill="#141417"/>
<g transform="translate(60 0)"><rect class="xp" x="40" y="66" width="${(xp * 390).toFixed(1)}" height="6" rx="1" fill="${RED}"/></g>
<text x="528" y="74" text-anchor="end" font-family="${mono}" font-size="9.5" fill="${DIM}">XP</text>
<circle class="dot" cx="${W - 44}" cy="46" r="4" fill="${RED}"/><text x="${W - 56}" y="50" text-anchor="end" font-family="${mono}" font-size="10.5" letter-spacing="2" fill="${DIM}">LIVE</text>
${bigSvg}
<path d="M40 206 H528" stroke="${LINE}"/>
${rowSvg}
<path d="M563 40 V${H - 40}" stroke="${LINE}"/>
<text x="${bx}" y="74" font-family="${mono}" font-size="10.5" letter-spacing="2" fill="${DIM}">LINGUAGENS MAIS USADAS</text>
${langSvg}
</svg>`;
}

mkdirSync(out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
try {
  writeFileSync(out, render(await load()));
  console.log(`ok: ${out}`);
} catch (e) {
  // Sem dados: grava um painel "sem sinal" para o README não ficar com imagem quebrada.
  console.error(e);
  writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 120" width="880" height="120" role="img" aria-label="Status indisponível no momento"><rect x=".5" y=".5" width="879" height="119" rx="12" fill="#08080a" stroke="#26262a"/><text x="440" y="66" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="13" letter-spacing="4" fill="#6a6a70">SEM SINAL // TENTANDO RECONECTAR</text></svg>`);
  process.exitCode = 1;
}
