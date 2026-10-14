import './style.css';
import { ASSUMPTIONS, CHANNEL_IDS, CHANNELS, generate, monthLabel, PLAN_IDS, PLANS, PlanId } from './data';
import { baselineFrom, cloneScenario, CONST, DEFAULT_SCENARIO, project, Projection, Scenario } from './model';
import { heatmap, lineChart, tipRow, wireHtmlTips } from './charts';
import { esc, fmtCompact, fmtMoney, fmtPct, fmtPrice, pts, signed } from './format';

// ---------------------------------------------------------------- data
const COLORS: Record<PlanId | 'bundle' | 'total' | 'accent', string> = {
  basic: '#A8820F',
  standard: '#E8457F',
  premium: '#2E9FD8',
  bundle: '#1E9E9A',
  total: '#D9CFE0',
  accent: '#FF4F8B',
};

const ds = generate();
const M = ds.months;
const N = M.length;
const L = M[N - 1];
const Y = M[N - 13]; // same month last year
const MARGIN = ASSUMPTIONS.contributionMargin;

const totSubs = (r: (typeof M)[number]) => r.subs.basic + r.subs.standard + r.subs.premium;
const subRev = (r: (typeof M)[number]) => r.subRevenue.basic + r.subRevenue.standard + r.subRevenue.premium;
const revenue = (r: (typeof M)[number]) => subRev(r) + r.adRevenue;
const churnRate = (r: (typeof M)[number]) =>
  (r.churned.basic + r.churned.standard + r.churned.premium) / (r.startSubs.basic + r.startSubs.standard + r.startSubs.premium);
const gross = (r: (typeof M)[number]) => r.signups.basic + r.signups.standard + r.signups.premium;
const cac = (r: (typeof M)[number]) => r.spend / gross(r);
const arpu = (r: (typeof M)[number]) => revenue(r) / totSubs(r);
const ltv = (r: (typeof M)[number]) => (arpu(r) * MARGIN) / churnRate(r);

const labels = M.map((r) => r.label);
const moneyAxis = (v: number) => (v === 0 ? '$0' : `$${+(v / 1e6).toFixed(1)}M`);
const short = M.map((_, i) => monthLabel(i, true));

// ---------------------------------------------------------------- page skeleton
const app = document.querySelector<HTMLDivElement>('#app')!;

function kpi(label: string, value: string, delta: string, good: boolean | null, foot: string) {
  const cls = good == null ? 'neutral' : good ? 'good' : 'bad';
  const icon = good == null ? '' : good ? '▲' : '▼';
  return `<div class="kpi reveal">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-delta ${cls}"><span aria-hidden="true">${icon}</span> ${delta}</div>
    <div class="kpi-foot">${foot}</div>
  </div>`;
}

const yoySubs = totSubs(L) / totSubs(Y) - 1;
const yoyMrr = revenue(L) / revenue(Y) - 1;
const dChurn = churnRate(L) - churnRate(Y);
const ratio = ltv(L) / cac(L);
const ratioY = ltv(Y) / cac(Y);
const vsY = 'YoY';

const kpis = [
  kpi('Subscribers', fmtCompact(totSubs(L)), `${signed(yoySubs, (x) => fmtPct(x))} ${vsY}`, yoySubs > 0, 'Paying, end of month'),
  kpi('MRR', fmtMoney(revenue(L)), `${signed(yoyMrr, (x) => fmtPct(x))} ${vsY}`, yoyMrr > 0, `ARR ${fmtMoney(revenue(L) * 12)} · fees + ads`),
  kpi('Monthly churn', fmtPct(churnRate(L), 2), `${signed(dChurn, (x) => pts(x))} ${vsY}`, dChurn < 0, 'Cancels ÷ opening subs'),
  kpi('LTV : CAC', `${ratio.toFixed(1)}×`, `${signed(ratio - ratioY, (x) => x.toFixed(1) + '×')} ${vsY}`, ratio > ratioY, `Blended CAC ${fmtPrice(cac(L))}`),
];

// ---------------- insights computed from the data
const adArpu12 = M.slice(-12).reduce((a, r) => a + r.adArpu, 0) / 12;
const basicValue12 = L.price.basic + adArpu12;
const grossMixBasicL = M.slice(-3).reduce((a, r) => a + r.signups.basic, 0) / M.slice(-3).reduce((a, r) => a + gross(r), 0);
const stdPreChurn = M.slice(9, 12).reduce((a, r) => a + r.churned.standard / r.startSubs.standard, 0) / 3;
const stdShock = M[12].churned.standard / M[12].startSubs.standard;
const stdAfter = M.slice(14, 24).reduce((a, r) => a + r.churned.standard / r.startSubs.standard, 0) / 10;

const ch = CHANNEL_IDS.map((id) => {
  const s = ds.channelStats[id];
  const c = s.spend / s.signups;
  const l = (s.arpu * MARGIN) / s.churn12;
  return { id, name: CHANNELS[id].name, signups: s.signups, cac: c, churn: s.churn12, arpu: s.arpu, ltv: l, ratio: l / c, payback: c / (s.arpu * MARGIN), spend: s.spend };
});
const social = ch.find((c) => c.id === 'social')!;
const partner = ch.find((c) => c.id === 'partner')!;

// Holiday vs. non-holiday cohort M3 retention
const ret3 = (i: number) => ds.cohortRetention[i][2] ?? 0;
const onboardBefore = [3, 4, 5, 6, 7, 8].reduce((a, i) => a + ret3(i), 0) / 6;
const onboardAfter = [15, 16, 17, 18, 19, 20].reduce((a, i) => a + ret3(i), 0) / 6;

// ---------------------------------------------------------------- site chrome
const ROUTES = [
  { id: 'overview', label: 'Overview' },
  { id: 'subscribers', label: 'Subscribers' },
  { id: 'retention', label: 'Retention' },
  { id: 'pricing', label: 'Pricing Lab' },
  { id: 'memo', label: 'Memo' },
] as const;
type RouteId = (typeof ROUTES)[number]['id'];

// Logo mark: a crescent moon with a play button in its hollow.
const logo = (k: string) => `<svg class="mark" width="34" height="34" viewBox="0 0 40 40" aria-hidden="true">
  <defs><mask id="nj-crescent-${k}"><rect width="40" height="40" fill="#fff"/><circle cx="26.5" cy="13" r="13" fill="#000"/></mask></defs>
  <circle cx="18" cy="21.5" r="16" fill="#FF4F8B" mask="url(#nj-crescent-${k})"/>
  <path d="M23 14.5v9.5l8-4.75z" fill="#F6F0F7"/>
</svg>`;

const HERO_ART = `<svg viewBox="0 0 420 320" width="100%" height="100%">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FF4F8B" stop-opacity=".35"/><stop offset="1" stop-color="#FF4F8B" stop-opacity="0"/></radialGradient>
    <mask id="hero-crescent"><rect width="420" height="320" fill="#fff"/><circle cx="262" cy="118" r="98" fill="#000"/></mask>
  </defs>
  <circle cx="210" cy="160" r="160" fill="url(#glow)"/>
  <circle cx="200" cy="168" r="118" fill="#FF4F8B" mask="url(#hero-crescent)"/>
  <path d="M262 88v62l52-31z" fill="#F6F0F7"/>
  <g fill="#F6F0F7" opacity=".7"><circle cx="70" cy="60" r="1.6"/><circle cx="352" cy="232" r="1.4"/><circle cx="96" cy="250" r="1.2"/><circle cx="372" cy="70" r="1.8"/><circle cx="320" cy="290" r="1.1"/><circle cx="40" cy="170" r="1.3"/></g>
</svg>`;

function pageHeader(kicker: string, title: string, lede: string) {
  return `<header class="page-head"><div class="wrap"><p class="eyebrow">${kicker}</p><h1>${title}</h1>${lede}</div></header>`;
}

function pager(id: RouteId) {
  const i = ROUTES.findIndex((r) => r.id === id);
  const prev = ROUTES[i - 1];
  const next = ROUTES[i + 1];
  return `<nav class="pager wrap" aria-label="Pages">${prev ? `<a href="#/${prev.id}" class="prev"><span>Previous</span>${prev.label}</a>` : '<span></span>'}${
    next ? `<a href="#/${next.id}" class="next"><span>Next</span>${next.label}</a>` : ''
  }</nav>`;
}

app.innerHTML = `
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="hdr">
    <a class="logo" href="#/overview" aria-label="Duskline Insights, overview">${logo('h')}<span class="wordmark">duskline</span><span class="logo-sub">Insights</span></a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav"><span class="sr">Menu</span><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    <nav id="site-nav" aria-label="Main">
      ${ROUTES.map((r) => `<a href="#/${r.id}" data-route="${r.id}">${r.label}</a>`).join('')}
    </nav>
  </div>
</header>

<main id="main" tabindex="-1">

<div class="view" data-view="overview">
  <section class="hero">
    <div class="wrap hero-grid">
      <div>
        <p class="eyebrow">Duskline Insights</p>
        <h1>Subscription health and pricing at Duskline</h1>
        <p class="lede">Where growth comes from, how long subscribers stay, and what a price change would really do to revenue.</p>
        <div class="cta">
          <a class="btn primary" href="#/pricing">Open the Pricing Lab</a>
          <a class="btn ghost" href="#/memo">Read the pricing memo</a>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">${HERO_ART}</div>
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      <div class="sec-head"><h2>Where we are, ${L.label}</h2><p>Changes are year over year.</p></div>
      <div class="kpis">${kpis.join('')}</div>
    </div>
  </section>

  <section>
    <div class="wrap">
      <div class="sec-head"><h2>Three things that matter</h2></div>
      <div class="highlights" id="highlights"></div>
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      <article class="card reveal">
        <header><h3>Monthly recurring revenue</h3><p>Subscription fees plus ad revenue, all plans</p></header>
        <div class="chart" id="c-ov"></div>
      </article>
    </div>
  </section>

  <section id="assumptions">
    <div class="wrap narrow">
      <details class="how card assumptions-box">
      <summary><span>How the numbers are built</span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg></summary>
      <div class="how-body assumptions">
      <ul>
        <li><strong>Plans:</strong> Basic with ads $7.99 · Standard (ad-free) $14.99, raised to $15.99 in Oct 2025 · Premium (4K, 4 streams) $21.99. No plan switching in the history.</li>
        <li><strong>Starting base:</strong> ${fmtCompact(ASSUMPTIONS.legacyBase.basic)} Basic, ${fmtCompact(ASSUMPTIONS.legacyBase.standard)} Standard, ${fmtCompact(ASSUMPTIONS.legacyBase.premium)} Premium long-tenured subscribers churning at ${PLAN_IDS.map((p) => fmtPct(ASSUMPTIONS.legacyChurn[p])).join(' / ')} a month, plus a hidden ${ASSUMPTIONS.burnIn}-month warm-up before Oct 2024 so the base starts with a realistic mix of new and tenured subscribers.</li>
        <li><strong>Signups:</strong> ~142K a month growing ~1.1% monthly, with tentpole-release seasonality (Nov–Jan, Mar, Jul). Basic share of signups drifts from 44% to ~55%, as it has across the industry.</li>
        <li><strong>Channels &amp; CAC:</strong> ${CHANNEL_IDS.map((c) => `${CHANNELS[c].name} ~$${CHANNELS[c].baseCac}`).join(', ')}. Paid social and search CAC inflate ~1.1% and ~0.6% a month.</li>
        <li><strong>Churn by tenure:</strong> each plan's monthly churn starts high and decays toward a floor (Basic ${fmtPct(ASSUMPTIONS.hazard.basic.start, 0)}→${fmtPct(ASSUMPTIONS.hazard.basic.floor)}, Standard ${fmtPct(ASSUMPTIONS.hazard.standard.start)}→${fmtPct(ASSUMPTIONS.hazard.standard.floor)}, Premium ${fmtPct(ASSUMPTIONS.hazard.premium.start)}→${fmtPct(ASSUMPTIONS.hazard.premium.floor)}), scaled by channel quality. Holiday and July cohorts churn faster; a new onboarding flow from Jan 2026 lowers early churn ~10%.</li>
        <li><strong>Ads:</strong> ad revenue per Basic subscriber starts at ~$4.70/month, grows ~0.9% a month, peaks in Q4 and dips in January.</li>
        <li><strong>Margin:</strong> LTV uses a ${MARGIN * 100}% contribution margin (after payment fees, delivery, partner share and variable royalties). LTV = ARPU × margin ÷ monthly churn; no discounting.</li>
        <li><strong>Data model:</strong> the monthly figures come from the cohort model these assumptions describe, run with a fixed random seed so every number is reproducible.</li>
      </ul>
      </div>
      </details>
    </div>
  </section>
  ${pager('overview')}
</div>

<div class="view" data-view="subscribers" hidden>
  ${pageHeader('Subscribers', 'Growth is shifting to the ad tier, and that is fine', `<p class="ph-lede">With ads, a Basic subscriber is worth about <strong>${fmtPrice(basicValue12)} a month</strong>, ${fmtPct(basicValue12 / L.price.standard, 0)} of a Standard subscriber.</p>`)}
  <section>
    <div class="wrap">
    <div class="grid2">
      <article class="card reveal">
        <header><h3>Subscribers by plan</h3><p>Month-end paying subscribers</p></header>
        ${legend(PLAN_IDS.map((p) => ({ name: PLANS[p].short, color: COLORS[p] })))}
        <div class="chart" id="c-subs"></div>
      </article>
      <article class="card reveal">
        <header><h3>Monthly churn</h3><p>Cancels ÷ subscribers at the start of the month</p></header>
        ${legend([...PLAN_IDS.map((p) => ({ name: PLANS[p].short, color: COLORS[p] })), { name: 'Blended', color: COLORS.total, dash: true }])}
        <div class="chart" id="c-churn"></div>
        <p class="note">The Oct 2025 Standard increase is our elasticity read: Standard churn went from ${fmtPct(stdPreChurn)} to ${fmtPct(stdShock)} in the renewal month, then settled around ${fmtPct(stdAfter)}.</p>
      </article>
    </div>

    </div>
  </section>
  ${pager('subscribers')}
</div>

<div class="view" data-view="retention" hidden>
  ${pageHeader('Retention', 'Cohorts: who we keep, and when we lose them', `<p class="ph-lede">Each row is a signup month, and each cell is the share still paying N months later. The Jan 2026 onboarding change lifted month-3 retention from ${fmtPct(onboardBefore, 0)} to ${fmtPct(onboardAfter, 0)}.</p>`)}
  <section>
    <div class="wrap">
    <article class="card reveal">
      <header><h3>Cohort retention</h3><p>Signup month × months since signup, all plans and channels</p></header>
      <div class="heat-legend"><span>Lower</span><span class="ramp" aria-hidden="true"></span><span>Higher retention</span></div>
      <div class="chart" id="c-heat"></div>
    </article>

    </div>
  </section>
  <section class="band">
    <div class="wrap">
      <div class="sec-head"><h2>What a subscriber is worth vs. what it costs to win one</h2><p class="sub-lede">Blended LTV:CAC is ${ratio.toFixed(1)}×, but the blend hides a split. ${esc(social.name)} is our biggest paid channel and sits at <strong>${social.ratio.toFixed(1)}×</strong>, below the 3× rule of thumb, while ${esc(partner.name.toLowerCase())} return <strong>${partner.ratio.toFixed(1)}×</strong>.</p></div>
    <div class="econ">
      <article class="card reveal">
        <header><h3>LTV : CAC by channel</h3><p>All 24 months of signups. Churn from cohorts with 12 months of history.</p></header>
        <div class="table-wrap"><table class="econ-table">
          <thead><tr><th>Channel</th><th>Signups</th><th>CAC</th><th>Churn / mo</th><th>LTV</th><th>LTV:CAC</th><th>Payback</th></tr></thead>
          <tbody>${ch
            .map(
              (c) => `<tr><th scope="row">${esc(c.name)}</th><td>${fmtCompact(c.signups)}</td><td>${fmtPrice(c.cac)}</td><td>${fmtPct(c.churn)}</td><td>${fmtPrice(c.ltv).replace(/\.\d+$/, '')}</td>
              <td><div class="ratio"><span class="ratio-bar"><i style="width:${Math.min(100, (c.ratio / 6) * 100)}%" class="${c.ratio >= 3 ? 'ok' : 'low'}"></i><b style="left:50%"></b></span><span>${c.ratio.toFixed(1)}×</span></div></td><td>${c.payback.toFixed(1)} mo</td></tr>`,
            )
            .join('')}</tbody>
        </table></div>
        <p class="note">Bar scale 0–6×; the tick marks 3×. Organic is cheap but cannot be bought at scale. The lever is moving paid budget from social toward device and telco partners.</p>
      </article>
    </div>

    </div>
  </section>
  ${pager('retention')}
</div>

<div class="view" data-view="pricing" hidden>
  ${pageHeader('Pricing Lab', 'What would a price change really do?', `<p class="ph-lede">Pick a scenario or move a price, and see the next 12 months against doing nothing.</p>`)}
  <section class="lab-section">
    <div class="wrap">
    <div class="presets" role="group" aria-label="Scenario presets">
      <button data-preset="base">Baseline</button>
      <button data-preset="adfree2">Ad-free +$2</button>
      <button data-preset="promo">Ad-tier promo</button>
      <button data-preset="bundle">Bundle launch</button>
      <button data-preset="rec" class="rec">My recommendation</button>
    </div>
    <div class="lab">
      <form class="controls card" id="controls" onsubmit="return false">
        <div class="mini" id="mini" aria-hidden="true"></div>
        <fieldset><legend>Price change per plan</legend>
          ${PLAN_IDS.map((p) => slider(`d-${p}`, `${PLANS[p].short} <small>now ${fmtPrice(L.price[p])}</small>`, -3, 4, 0.5, 0)).join('')}
        </fieldset>
        <details class="adv"><summary>Advanced settings</summary>
        <fieldset><legend>Customer response</legend>
          ${slider('elasticity', 'Price elasticity <small>calibrated 1.2</small>', 0, 3, 0.1, DEFAULT_SCENARIO.elasticity)}
          ${slider('downgrade', 'Trade-down capture <small>leavers who drop a tier</small>', 0, 0.6, 0.05, DEFAULT_SCENARIO.downgrade)}
        </fieldset>
        <fieldset><legend><label class="toggle"><input type="checkbox" id="promoOn"><span></span>Ad-tier intro promo</label></legend>
          <div class="sub" data-for="promoOn">
          ${slider('promoPrice', 'Intro price <small>Basic, new subs only</small>', 0.99, 6.99, 0.5, DEFAULT_SCENARIO.promoPrice)}
          ${slider('promoMonths', 'Intro length', 1, 6, 1, DEFAULT_SCENARIO.promoMonths)}
          </div>
        </fieldset>
        <fieldset><legend><label class="toggle"><input type="checkbox" id="bundleOn"><span></span>Launch a partner bundle</label></legend>
          <div class="sub" data-for="bundleOn">
          <p class="hint">Standard + a partner music &amp; audiobook service, billed by Duskline.</p>
          ${slider('bundlePrice', 'Bundle price', 16.99, 24.99, 0.5, DEFAULT_SCENARIO.bundlePrice)}
          ${slider('bundleCost', 'Partner fee per sub', 3, 9, 0.25, DEFAULT_SCENARIO.bundleCost)}
          ${slider('bundleTake', 'Standard base that switches', 0, 0.3, 0.01, DEFAULT_SCENARIO.bundleTake)}
          ${slider('bundleChurnCut', 'Churn reduction for bundlers', 0, 0.5, 0.05, DEFAULT_SCENARIO.bundleChurnCut)}
          </div>
        </fieldset>
        </details>
      </form>
      <div class="results">
        <div class="res-cards" id="res-cards" aria-live="polite"></div>
        <div class="card">
          <header><h3>Net revenue per month</h3><p>Subscriptions + ads − partner fees</p></header>
          ${legend([{ name: 'Scenario', color: COLORS.accent }, { name: 'Baseline', color: COLORS.total, dash: true }])}
          <div class="chart" id="c-proj-rev"></div>
        </div>
      </div>
    </div>
    <details class="how card" id="how">
      <summary><span>How this model works</span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg></summary>
      <div class="how-body">
        <p>A monthly simulation over 12 months, per plan. Inputs are taken from the last months of history:</p>
        <ul class="facts" id="facts"></ul>
        <h4>Price changes</h4>
        <pre><code>r          = Δprice ÷ current price            (e.g. Standard +$2 → r = 12.5%)
churn′     = churn × (1 + e × r)              steady state, e = elasticity
churn′(m1) = churn × (1 + ${CONST.spike} × e × r)          renewal shock in the first month
signups′   = signups × (1 − e × r)</code></pre>
        <p>The default e = 1.2 is calibrated on our own Oct 2025 Standard increase (+6.7%): churn jumped ~40% in the renewal month, then settled ~8% higher. Of the <em>extra</em> leavers a price rise creates, the trade-down share moves one tier down (Premium → Standard, Standard → Basic) instead of cancelling.</p>
        <h4>Ad-tier promo</h4>
        <pre><code>discount   = (Basic price − intro price) ÷ Basic price
lift       = ${CONST.promoLift} × discount           extra Basic signups, months 1–${CONST.promoWindow}
cannibal   = ${CONST.promoCannibal * 100}% of the lift comes out of Standard signups
roll-off   = +${CONST.promoRolloff * 100} pts churn in the first full-price month</code></pre>
        <p>Every new Basic signup in the window gets the intro price, including people who would have paid full price. Ads are still served, so promo subscribers still earn ad revenue.</p>
        <h4>Bundle</h4>
        <pre><code>switchers  = take rate × Standard base, spread over months 1–${CONST.bundleRampMonths}
new bundle = ${CONST.bundleNewShare * 100}% of Standard signups + ${CONST.bundleIncremental * 100}% extra gross adds (partner marketing)
churn      = Standard churn × (1 − churn reduction)
net        = bundle price − partner fee</code></pre>
        <h4>Outputs</h4>
        <pre><code>revenue    = Σ subs × price + Basic subs × ad ARPU − bundle subs × partner fee
avg churn  = Σ cancels ÷ Σ subscribers at month start  (12 months)
LTV        = month-12 net ARPU × ${MARGIN * 100}% ÷ churn (avg months 10–12)</code></pre>
        <p class="caveat"><strong>What it leaves out:</strong> seasonality, competitor reactions, tenure mix inside a plan (churn is a plan average), marketing spend changes, and any long-run brand cost of repeated increases. It is a decision aid for ranking options, not a forecast.</p>
      </div>
    </details>

    </div>
  </section>
  ${pager('pricing')}
</div>

<div class="view" data-view="memo" hidden>
  ${pageHeader('Memo', 'Pricing recommendation', `<p class="ph-lede">A one-page recommendation built on the baseline data and the Pricing Lab model.</p>`)}
  <section>
    <div class="wrap narrow">
      <article class="memo card" id="memo-body"></article>
    </div>
  </section>
  ${pager('memo')}
</div>

</main>

<footer class="site-footer">
  <div class="wrap foot-grid">
    <div class="foot-brand">
      <a class="logo" href="#/overview" aria-label="Duskline Insights, overview">${logo('f')}<span class="wordmark">duskline</span><span class="logo-sub">Insights</span></a>
      <p>Subscriber growth, retention and pricing for Duskline, in one place. Built by Bryan.</p>
    </div>
    <div>
      <h4>Insights</h4>
      <ul>${ROUTES.map((r) => `<li><a href="#/${r.id}">${r.label}</a></li>`).join('')}</ul>
    </div>
  </div>
  <div class="wrap foot-base">
    <span>Built by Bryan · ${ASSUMPTIONS.startLabel} to ${L.label}</span>
  </div>
</footer>
`;

// ---------------------------------------------------------------- helpers used in the template
function legend(items: { name: string; color: string; pattern?: boolean; dash?: boolean }[]) {
  return `<div class="legend">${items
    .map((i) => `<span><i class="sw${i.pattern ? ' sw-hatch' : ''}${i.dash ? ' sw-dash' : ''}" style="--c:${i.color}"></i>${esc(i.name)}</span>`)
    .join('')}</div>`;
}

function slider(id: string, label: string, min: number, max: number, step: number, value: number) {
  return `<div class="field"><label for="${id}">${label}</label><div class="range"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><output for="${id}" id="${id}-out"></output></div></div>`;
}

// ---------------------------------------------------------------- charts
function drawHistory() {
  lineChart(document.getElementById('c-ov')!, {
    labels,
    shortLabels: short,
    series: [{ name: 'MRR', color: COLORS.accent, values: M.map(revenue) }],
    yFmt: (v) => fmtMoney(v),
    axisFmt: moneyAxis,
    yMin: 0,
    endLabels: false,
    height: 240,
    annotations: [{ i: ASSUMPTIONS.standardIncreaseMonth, text: 'Standard +$1' }],
    tipExtra: (i) => tipRow(null, 'Subscribers', fmtCompact(totSubs(M[i]))),
  });
  lineChart(document.getElementById('c-subs')!, {
    labels,
    shortLabels: short,
    series: PLAN_IDS.map((p) => ({ name: PLANS[p].short, color: COLORS[p], values: M.map((r) => r.subs[p]) })),
    yFmt: (v) => fmtCompact(v),
    yMin: 0,
    annotations: [{ i: ASSUMPTIONS.standardIncreaseMonth, text: 'Standard +$1' }],
    tipExtra: (i) => tipRow(null, 'Total', fmtCompact(totSubs(M[i]))) + tipRow(null, 'Signups', fmtCompact(gross(M[i]))),
  });
  lineChart(document.getElementById('c-churn')!, {
    labels,
    shortLabels: short,
    series: [
      ...PLAN_IDS.map((p) => ({ name: PLANS[p].short, color: COLORS[p], values: M.map((r) => r.churned[p] / r.startSubs[p]) })),
      { name: 'Blended', color: COLORS.total, values: M.map(churnRate), dash: true },
    ],
    yFmt: (v) => fmtPct(v, 1),
    yMin: 0,
    annotations: [{ i: ASSUMPTIONS.standardIncreaseMonth, text: 'Standard +$1' }],
  });
  heatmap(document.getElementById('c-heat')!, {
    rows: M.slice(0, N - 1).map((_, i) => monthLabel(i, true)),
    cols: Array.from({ length: 12 }, (_, k) => `${k + 1}`),
    values: ds.cohortRetention.slice(0, N - 1),
    min: 0.38,
    max: 0.9,
    fmt: (v) => Math.round(v * 100).toString(),
    tip: (r, c, v) =>
      `<div class="tip-t">${esc(M[r].label)} cohort</div>${tipRow(null, `Retained at month ${c + 1}`, fmtPct(v, 1))}${tipRow(null, 'Signups', fmtCompact(gross(M[r])))}`,
  });
}

// ---------------------------------------------------------------- what-if
const base = baselineFrom(ds);
const baseProj = project(base, DEFAULT_SCENARIO);
let scen: Scenario = cloneScenario(DEFAULT_SCENARIO);

const REC: Scenario = (() => {
  const s = cloneScenario(DEFAULT_SCENARIO);
  s.dPrice.standard = 1;
  s.dPrice.premium = 2;
  s.bundleOn = true;
  return s;
})();

const PRESETS: Record<string, () => Scenario> = {
  base: () => cloneScenario(DEFAULT_SCENARIO),
  adfree2: () => {
    const s = cloneScenario(DEFAULT_SCENARIO);
    s.dPrice.standard = 2;
    return s;
  },
  promo: () => ({ ...cloneScenario(DEFAULT_SCENARIO), promoOn: true }),
  bundle: () => ({ ...cloneScenario(DEFAULT_SCENARIO), bundleOn: true }),
  rec: () => cloneScenario(REC),
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const numInputs: [string, (s: Scenario, v: number) => void, (s: Scenario) => number, (v: number) => string][] = [
  ['d-basic', (s, v) => (s.dPrice.basic = v), (s) => s.dPrice.basic, (v) => `${signed(v, (x) => '$' + x.toFixed(2))} → ${fmtPrice(base.price.basic + v)}`],
  ['d-standard', (s, v) => (s.dPrice.standard = v), (s) => s.dPrice.standard, (v) => `${signed(v, (x) => '$' + x.toFixed(2))} → ${fmtPrice(base.price.standard + v)}`],
  ['d-premium', (s, v) => (s.dPrice.premium = v), (s) => s.dPrice.premium, (v) => `${signed(v, (x) => '$' + x.toFixed(2))} → ${fmtPrice(base.price.premium + v)}`],
  ['elasticity', (s, v) => (s.elasticity = v), (s) => s.elasticity, (v) => v.toFixed(1)],
  ['downgrade', (s, v) => (s.downgrade = v), (s) => s.downgrade, (v) => fmtPct(v, 0)],
  ['promoPrice', (s, v) => (s.promoPrice = v), (s) => s.promoPrice, (v) => fmtPrice(v)],
  ['promoMonths', (s, v) => (s.promoMonths = v), (s) => s.promoMonths, (v) => `${v} mo`],
  ['bundlePrice', (s, v) => (s.bundlePrice = v), (s) => s.bundlePrice, (v) => fmtPrice(v)],
  ['bundleCost', (s, v) => (s.bundleCost = v), (s) => s.bundleCost, (v) => fmtPrice(v)],
  ['bundleTake', (s, v) => (s.bundleTake = v), (s) => s.bundleTake, (v) => fmtPct(v, 0)],
  ['bundleChurnCut', (s, v) => (s.bundleChurnCut = v), (s) => s.bundleChurnCut, (v) => fmtPct(v, 0)],
];

function syncControls() {
  for (const [id, , get, f] of numInputs) {
    $<HTMLInputElement>(id).value = String(get(scen));
    $<HTMLOutputElement>(`${id}-out`).textContent = f(get(scen));
  }
  $<HTMLInputElement>('promoOn').checked = scen.promoOn;
  $<HTMLInputElement>('bundleOn').checked = scen.bundleOn;
  if (scen.promoOn || scen.bundleOn) document.querySelector<HTMLDetailsElement>('.adv')!.open = true;
  document.querySelectorAll<HTMLElement>('.sub').forEach((el) => {
    const on = $<HTMLInputElement>(el.dataset.for!).checked;
    el.classList.toggle('off', !on);
    el.querySelectorAll('input').forEach((i) => ((i as HTMLInputElement).disabled = !on));
  });
}

function resCard(title: string, value: string, baseline: string, delta: string, good: boolean | null, foot = '') {
  const cls = good == null ? 'neutral' : good ? 'good' : 'bad';
  const icon = good == null ? '•' : good ? '▲' : '▼';
  return `<div class="res"><div class="kpi-label">${title}</div><div class="res-value">${value}</div>
  <div class="kpi-delta ${cls}"><span aria-hidden="true">${icon}</span> ${delta} vs baseline</div>
  <div class="kpi-foot">Baseline ${baseline}${foot ? ` · ${foot}` : ''}</div></div>`;
}

function renderWhatIf() {
  const p = project(base, scen);
  const b = baseProj;
  const eps = 1e-6;
  const dSubs = p.endSubs - b.endSubs;
  const dChurnP = p.avgChurn - b.avgChurn;
  const dNet = p.net - b.net;
  const dLtv = p.ltv - b.ltv;
  const tri = (d: number, invert = false) => (Math.abs(d) < eps ? null : invert ? d < 0 : d > 0);
  $('res-cards').innerHTML = [
    resCard('Subscribers, month 12', fmtCompact(p.endSubs), fmtCompact(b.endSubs), signed(dSubs, (x) => fmtCompact(x)), tri(Math.round(dSubs))),
    resCard('Avg monthly churn', fmtPct(p.avgChurn, 2), fmtPct(b.avgChurn, 2), signed(dChurnP, (x) => pts(x)), tri(+dChurnP.toFixed(5), true)),
    resCard(
      '12-month net revenue',
      fmtMoney(p.net),
      fmtMoney(b.net),
      `${signed(dNet, (x) => fmtMoney(x))} (${signed(dNet / b.net, (x) => fmtPct(x))})`,
      tri(Math.round(dNet / 1e4)),
      `subs ${fmtMoney(p.subRevenue)} · ads ${fmtMoney(p.adRevenue)}${p.partnerCost > 0 ? ` · partner −${fmtMoney(p.partnerCost)}` : ''}`,
    ),
    resCard('LTV per subscriber', `$${p.ltv.toFixed(0)}`, `$${b.ltv.toFixed(0)}`, signed(Math.round(dLtv * 10) / 10, (x) => `$${x.toFixed(1)}`), tri(+dLtv.toFixed(1)), `ARPU ${fmtPrice(p.arpu)}`),
  ].join('');

  $('mini').innerHTML = `<span>Net revenue <b class="${dNet >= 0 ? 'good' : 'bad'}">${signed(dNet, (x) => fmtMoney(x))}</b></span><span>Subs <b class="${dSubs >= 0 ? 'good' : 'bad'}">${signed(dSubs, (x) => fmtCompact(x))}</b></span><span>Churn <b class="${dChurnP <= 0 ? 'good' : 'bad'}">${signed(dChurnP, (x) => pts(x))}</b></span>`;
  const pl = p.months.map((x) => monthLabel(N + x.m - 1));
  const ps = p.months.map((x) => monthLabel(N + x.m - 1, true));
  lineChart($('c-proj-rev'), {
    labels: pl,
    shortLabels: ps,
    series: [
      { name: 'Scenario', color: COLORS.accent, values: p.months.map((x) => x.net) },
      { name: 'Baseline', color: COLORS.total, values: b.months.map((x) => x.net), dash: true },
    ],
    yFmt: (v) => fmtMoney(v),
    axisFmt: moneyAxis,
    height: 210,
    tipExtra: (i) => tipRow(null, 'Difference', signed(p.months[i].net - b.months[i].net, (x) => fmtMoney(x))),
  });


  document.querySelectorAll<HTMLButtonElement>('.presets button').forEach((btn) => {
    const s = PRESETS[btn.dataset.preset!]();
    btn.setAttribute('aria-pressed', String(JSON.stringify(s) === JSON.stringify(scen)));
  });
}

function wireControls() {
  for (const [id, set] of numInputs) {
    $<HTMLInputElement>(id).addEventListener('input', (e) => {
      set(scen, +(e.target as HTMLInputElement).value);
      syncControls();
      renderWhatIf();
    });
  }
  for (const id of ['promoOn', 'bundleOn'] as const) {
    $<HTMLInputElement>(id).addEventListener('change', (e) => {
      scen[id] = (e.target as HTMLInputElement).checked;
      syncControls();
      renderWhatIf();
    });
  }
  document.querySelectorAll<HTMLButtonElement>('.presets button').forEach((btn) =>
    btn.addEventListener('click', () => {
      scen = PRESETS[btn.dataset.preset!]();
      syncControls();
      renderWhatIf();
    }),
  );
  $('facts').innerHTML = [
    `Starting subscribers: ${PLAN_IDS.map((p) => `${PLANS[p].short} ${fmtCompact(base.subs[p])}`).join(', ')}`,
    `Monthly churn (avg of last 3 months): ${PLAN_IDS.map((p) => `${PLANS[p].short} ${fmtPct(base.churn[p], 2)}`).join(', ')}`,
    `Monthly signups (avg of last 3 months): ${PLAN_IDS.map((p) => `${PLANS[p].short} ${fmtCompact(base.gross[p])}`).join(', ')}`,
    `Ad revenue per Basic subscriber: ${fmtPrice(base.adArpu)} a month (12-month average, held flat)`,
    'Baseline = prices, churn and signups held at today’s levels for 12 months',
  ]
    .map((t) => `<li>${esc(t)}</li>`)
    .join('');
}

// ---------------------------------------------------------------- memo (numbers come from the same model)
function renderMemo() {
  const run = (s: Scenario) => project(base, s);
  const d = (p: Projection) => ({
    net: p.net - baseProj.net,
    subs: p.endSubs - baseProj.endSubs,
    churn: p.avgChurn - baseProj.avgChurn,
    ltv: p.ltv - baseProj.ltv,
  });
  const o1 = d(run(PRESETS.adfree2()));
  const o2 = d(run(PRESETS.promo()));
  const o3 = d(run(PRESETS.bundle()));
  const rec = d(run(REC));
  const recHighE = d(run({ ...cloneScenario(REC), elasticity: 2 }));
  const recFee = d(run({ ...cloneScenario(REC), bundleCost: REC.bundleCost + 1.5 }));
  const recLowTake = d(run({ ...cloneScenario(REC), bundleTake: 0.06 }));
  const recLowCut = d(run({ ...cloneScenario(REC), bundleChurnCut: 0.1 }));
  const bundleNet = REC.bundlePrice - REC.bundleCost;
  const stdNew = base.price.standard + REC.dPrice.standard;
  const o1HighE = d(run({ ...PRESETS.adfree2(), elasticity: 2 }));
  const money = (x: number) => signed(x, (v) => fmtMoney(v));
  const subsS = (x: number) => signed(x, (v) => fmtCompact(v));
  const pct = (x: number) => signed(x / baseProj.net, (v) => fmtPct(v));

  $('memo-body').innerHTML = `
  <div class="memo-meta">
    <div><span>To</span>Head of Product &amp; Finance, Duskline</div>
    <div><span>From</span>Bryan</div>
    <div><span>Date</span>${monthLabel(N)}</div>
    <div><span>Re</span>Pricing and packaging for the next 12 months</div>
  </div>
  <h3>The recommendation in one line</h3>
  <p class="bottom-line">Launch a $${REC.bundlePrice.toFixed(2)} Standard + partner bundle, pair it with a $1 Standard and $2 Premium increase, and hold Basic at $${base.price.basic.toFixed(2)}. Modeled impact: <strong>${money(rec.net)} net revenue (${pct(rec.net)})</strong> over 12 months with subscribers roughly flat (${subsS(rec.subs)}).</p>

  <h3>Context</h3>
  <p>We closed ${L.label} at ${fmtCompact(totSubs(L))} subscribers (${signed(yoySubs, (x) => fmtPct(x, 0))} YoY) and ${fmtMoney(revenue(L))} MRR. Underneath, three things matter. First, growth now runs through Basic with ads (${fmtPct(grossMixBasicL, 0)} of signups). That is healthy: with ads, a Basic subscriber is worth about ${fmtPrice(basicValue12)} a month. Second, blended churn ${Math.abs(dChurn) < 0.001 ? `is flat YoY at ${fmtPct(churnRate(L), 2)} even after the onboarding fix` : `${dChurn > 0 ? 'rose' : 'fell'} ${pts(Math.abs(dChurn))} YoY to ${fmtPct(churnRate(L), 2)}`}, because more of the base sits on Basic, which churns about twice as fast as Standard. Third, paid social, our largest paid channel, now returns only ${social.ratio.toFixed(1)}× LTV:CAC. Our Oct 2025 Standard increase gave us a real elasticity read (about 1.2), which is what the model below is calibrated on.</p>

  <h3>Options considered <small>(12 months vs. do nothing)</small></h3>
  <table class="memo-t">
    <thead><tr><th>Option</th><th>Net revenue</th><th>Subscribers</th><th>Churn</th></tr></thead>
    <tbody>
      <tr><th scope="row">A. Ad-free +$2 (Standard $${(base.price.standard + 2).toFixed(2)})</th><td>${money(o1.net)}</td><td>${subsS(o1.subs)}</td><td>${signed(o1.churn, (x) => pts(x))}</td></tr>
      <tr><th scope="row">B. Basic intro promo ($${DEFAULT_SCENARIO.promoPrice} × ${DEFAULT_SCENARIO.promoMonths} mo)</th><td>${money(o2.net)}</td><td>${subsS(o2.subs)}</td><td>${signed(o2.churn, (x) => pts(x))}</td></tr>
      <tr><th scope="row">C. Partner bundle at $${REC.bundlePrice.toFixed(2)}</th><td>${money(o3.net)}</td><td>${subsS(o3.subs)}</td><td>${signed(o3.churn, (x) => pts(x))}</td></tr>
      <tr class="hl"><th scope="row">D. C + Standard +$1 + Premium +$2</th><td>${money(rec.net)}</td><td>${subsS(rec.subs)}</td><td>${signed(rec.churn, (x) => pts(x))}</td></tr>
    </tbody>
  </table>
  <p><strong>A</strong> is the obvious move and it does make money, but it buys revenue with ${fmtCompact(-o1.subs)} fewer subscribers, and if elasticity is closer to 2 it ${o1HighE.net < 0 ? `turns into a ${fmtMoney(-o1HighE.net)} loss` : `shrinks to ${money(o1HighE.net)}`}. <strong>B</strong> loses money: the discount goes to every new Basic signup, including people who would have paid full price, and roll-off churn takes back most of the lift. <strong>C</strong> grows both revenue and subscribers because bundlers churn less, but on its own it leaves price headroom on the table.</p>

  <h3>Recommendation</h3>
  <ul>
    <li><strong>Bundle first, aimed at new and at-risk subscribers.</strong> Announce it before the price notice, so the increase email offers a better-value option instead of only a higher bill. After the partner fee a bundler nets ${fmtPrice(bundleNet)} vs ${fmtPrice(stdNew)} for Standard, so the bundle pays through lower churn and new signups, not through migrating happy Standard subscribers. Lead with it in acquisition and cancel flows.</li>
    <li><strong>Smaller, tiered increases:</strong> Standard +$1 to $${(base.price.standard + 1).toFixed(2)}, Premium +$2 to $${(base.price.premium + 2).toFixed(2)}. Premium has our lowest churn (${fmtPct(base.churn.premium)} a month), and leavers from both plans have a cheaper tier to trade down to instead of cancelling.</li>
    <li><strong>Keep Basic at $${base.price.basic.toFixed(2)}</strong>. It is the catch net for trade-downs and the engine of ad revenue.</li>
    <li><strong>No blanket promo.</strong> Test a targeted win-back offer to lapsed subscribers instead, with a holdout group.</li>
    <li><strong>Rebalance acquisition:</strong> move 15–20% of paid social budget into device and telco partners (${partner.ratio.toFixed(1)}× vs ${social.ratio.toFixed(1)}×).</li>
  </ul>

  <h3>Risks</h3>
  <ul>
    <li><strong>Elasticity is higher than calibrated.</strong> At e = 2.0 the package still returns ${money(recHighE.net)}, but subscribers move ${subsS(recHighE.subs)}.</li>
    <li><strong>Partner economics.</strong> A fee $1.50 higher than assumed cuts the gain to ${money(recFee.net)}. Negotiate a fee that steps up with volume.</li>
    <li><strong>Bundlers churn less than hoped.</strong> At a 10% churn reduction instead of 25%, the gain falls to ${money(recLowCut.net)}. Migration is not the risk: at half the assumed switching (6%) the package returns ${money(recLowTake.net)}, because each switcher nets less.</li>
    <li><strong>Ad market softness</strong> hits the trade-down safety net, and a second increase in 12 months carries brand and press risk the model cannot price.</li>
  </ul>

  <h3>Metrics to watch</h3>
  <ul class="cols">
    <li>Standard and Premium churn in the first two renewal cycles. Pause if the month-1 spike runs above +50%.</li>
    <li>Trade-down rate to Basic and Standard</li>
    <li>Bundle take rate and bundle churn vs. Standard</li>
    <li>Ad revenue per Basic subscriber and fill rate</li>
    <li>Net revenue per subscriber, after partner fees</li>
    <li>LTV:CAC and payback by channel, monthly</li>
  </ul>
  <p class="sign">Bryan</p>
  <p class="memo-note">All figures come from the dashboard data and the Pricing Lab model. Click “My recommendation” in the lab to inspect them.</p>`;
}

// ---------------------------------------------------------------- overview highlights
function renderHighlights() {
  const rec = project(base, REC);
  const dNet = rec.net - baseProj.net;
  const card = (kicker: string, big: string, text: string, href: string, cta: string) =>
    `<a class="hl-card reveal" href="${href}"><span class="hl-k">${kicker}</span><span class="hl-big">${big}</span><span class="hl-t">${text}</span><span class="hl-cta">${cta} <span aria-hidden="true">→</span></span></a>`;
  $('highlights').innerHTML = [
    card(
      'The ad tier pays its way',
      `${fmtPrice(basicValue12)}<small>/mo</small>`,
      `A Basic subscriber with ads earns ${fmtPct(basicValue12 / L.price.standard, 0)} of a Standard subscriber, and Basic is now ${fmtPct(grossMixBasicL, 0)} of signups.`,
      '#/subscribers',
      'Subscribers',
    ),
    card(
      'Paid social is underwater',
      `${social.ratio.toFixed(1)}×<small> LTV:CAC</small>`,
      `Our largest paid channel sits below the 3× rule of thumb, while device and telco partners return ${partner.ratio.toFixed(1)}×.`,
      '#/retention',
      'Retention & unit economics',
    ),
    card(
      'The recommendation',
      `${signed(dNet, (x) => fmtMoney(x))}<small> / 12 mo</small>`,
      `A partner bundle plus smaller tiered increases beats a blanket +$2, with subscribers roughly flat.`,
      '#/memo',
      'Read the memo',
    ),
  ].join('');
}

// ---------------------------------------------------------------- router (hash-based, static-site friendly)
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const io =
  !reduceMotion && 'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) =>
          entries.forEach((en) => {
            if (en.isIntersecting) {
              en.target.classList.add('in');
              io!.unobserve(en.target);
            }
          }),
        { threshold: 0.12 },
      )
    : null;

function armReveals(root: Element) {
  root.querySelectorAll('.reveal:not(.in)').forEach((el, i) => {
    if (!io) {
      el.classList.add('in');
      return;
    }
    const grid = el.parentElement?.classList.contains('kpis') || el.parentElement?.classList.contains('highlights');
    (el as HTMLElement).style.transitionDelay = grid ? `${(i % 7) * 70}ms` : '0ms';
    io.observe(el);
  });
}

const menuBtn = document.querySelector<HTMLButtonElement>('.menu-btn')!;
const header = document.querySelector<HTMLElement>('.site-header')!;
menuBtn.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') !== 'true';
  menuBtn.setAttribute('aria-expanded', String(open));
  header.classList.toggle('open', open);
});

let current: RouteId | null = null;
function route() {
  const [id, anchor] = location.hash.replace(/^#\/?/, '').split('/');
  const r: RouteId = ROUTES.find((x) => x.id === id)?.id ?? 'overview';
  const changed = r !== current;
  current = r;
  document.querySelectorAll<HTMLElement>('.view').forEach((v) => (v.hidden = v.dataset.view !== r));
  document.querySelectorAll<HTMLAnchorElement>('#site-nav a').forEach((a) => {
    if (a.dataset.route === r) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const label = ROUTES.find((x) => x.id === r)!.label;
  document.title = r === 'overview' ? 'Duskline Insights · Subscriptions and pricing' : `${label} · Duskline Insights`;
  menuBtn.setAttribute('aria-expanded', 'false');
  header.classList.remove('open');
  drawHistory();
  renderWhatIf();
  armReveals(document.querySelector(`.view[data-view="${r}"]`)!);
  const target = anchor ? document.getElementById(anchor) : null;
  if (target) {
    if (target instanceof HTMLDetailsElement) target.open = true;
    requestAnimationFrame(() => target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }));
  } else if (changed) {
    window.scrollTo(0, 0);
  }
}

document.querySelector<HTMLAnchorElement>('.skip')!.addEventListener('click', (e) => {
  e.preventDefault();
  $('main').focus();
});

// ---------------------------------------------------------------- boot
wireControls();
syncControls();
renderMemo();
renderHighlights();
wireHtmlTips(document.body);
window.addEventListener('hashchange', route);
route();

let rt = 0;
let lastW = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastW) return;
  lastW = window.innerWidth;
  cancelAnimationFrame(rt);
  rt = requestAnimationFrame(() => {
    drawHistory();
    renderWhatIf();
  });
});
