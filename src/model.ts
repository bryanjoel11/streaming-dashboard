// The "what if" pricing model. Deliberately simple and explainable:
// every rule below is written out in the "How this model works" disclosure.

import { ASSUMPTIONS, Dataset, PlanId, PLAN_IDS } from './data';

export interface Scenario {
  dPrice: Record<PlanId, number>; // $ change per plan
  elasticity: number; // price elasticity of churn and acquisition
  downgrade: number; // share of price-driven Standard/Premium leavers who trade down instead (0..1)
  promoOn: boolean;
  promoPrice: number; // Basic intro price for new subs
  promoMonths: number; // how long each promo sub pays the intro price
  bundleOn: boolean;
  bundlePrice: number;
  bundleCost: number; // wholesale fee paid to the bundle partner per bundle sub per month
  bundleTake: number; // share of the Standard base that migrates to the bundle (0..1)
  bundleChurnCut: number; // relative churn reduction for bundle subs (0..1)
}

export const CONST = {
  spike: 5, // month-1 churn reaction is 5x the steady-state reaction (renewal shock)
  promoLift: 0.6, // Basic signups rise 0.6% for every 1% of intro discount
  promoCannibal: 0.2, // 20% of promo-driven extra signups would have bought Standard
  promoRolloff: 0.25, // extra churn when the intro price ends
  promoWindow: 3, // promo open to new signups in months 1-3 of the projection
  bundleNewShare: 0.15, // share of Standard gross adds that pick the bundle instead
  bundleIncremental: 0.06, // extra gross adds from the partner's marketing, % of baseline gross adds
  bundleRampMonths: 3, // base migration spread evenly over months 1-3
  horizon: 12,
};

export const DEFAULT_SCENARIO: Scenario = {
  dPrice: { basic: 0, standard: 0, premium: 0 },
  elasticity: 1.2,
  downgrade: 0.3,
  promoOn: false,
  promoPrice: 2.99,
  promoMonths: 3,
  bundleOn: false,
  bundlePrice: 19.99,
  bundleCost: 5.5,
  bundleTake: 0.12,
  bundleChurnCut: 0.25,
};

export interface Baseline {
  subs: Record<PlanId, number>;
  price: Record<PlanId, number>;
  churn: Record<PlanId, number>;
  gross: Record<PlanId, number>;
  adArpu: number;
}

export function baselineFrom(ds: Dataset): Baseline {
  const ms = ds.months;
  const last = ms[ms.length - 1];
  const tail = ms.slice(-3);
  const churn = {} as Record<PlanId, number>;
  const gross = {} as Record<PlanId, number>;
  for (const p of PLAN_IDS) {
    churn[p] = tail.reduce((a, r) => a + r.churned[p] / r.startSubs[p], 0) / tail.length;
    gross[p] = tail.reduce((a, r) => a + r.signups[p], 0) / tail.length;
  }
  const adArpu = ms.slice(-12).reduce((a, r) => a + r.adArpu, 0) / 12;
  return { subs: { ...last.subs }, price: { ...last.price }, churn, gross, adArpu };
}

export interface ProjMonth {
  m: number;
  subs: { basic: number; promo: number; standard: number; premium: number; bundle: number };
  total: number;
  start: number;
  churned: number;
  subRevenue: number;
  adRevenue: number;
  partnerCost: number;
  net: number;
}

export interface Projection {
  months: ProjMonth[];
  endSubs: number;
  avgChurn: number;
  subRevenue: number;
  adRevenue: number;
  partnerCost: number;
  net: number;
  arpu: number; // net revenue per sub, month 12
  exitChurn: number; // average churn months 10-12
  ltv: number;
}

export function project(b: Baseline, s: Scenario): Projection {
  const e = s.elasticity;
  const r = {} as Record<PlanId, number>;
  const price = {} as Record<PlanId, number>;
  for (const p of PLAN_IDS) {
    price[p] = Math.max(0.99, b.price[p] + s.dPrice[p]);
    r[p] = (price[p] - b.price[p]) / b.price[p];
  }
  const churnMult = (p: PlanId, m: number) => Math.max(0.5, 1 + e * r[p] * (m === 1 ? CONST.spike : 1));
  const grossMult = (p: PlanId) => Math.max(0, 1 - e * r[p]);
  const baseGrossTotal = b.gross.basic + b.gross.standard + b.gross.premium;
  const disc = s.promoOn ? Math.max(0, (price.basic - s.promoPrice) / price.basic) : 0;

  let basic = b.subs.basic;
  let standard = b.subs.standard;
  let premium = b.subs.premium;
  let bundle = 0;
  const promo: { start: number; alive: number }[] = [];
  const out: ProjMonth[] = [];
  const migrateTotal = s.bundleOn ? b.subs.standard * s.bundleTake : 0;

  for (let m = 1; m <= CONST.horizon; m++) {
    const promoAlive = promo.reduce((a, c) => a + c.alive, 0);
    const start = basic + standard + premium + bundle + promoAlive;

    // --- churn and trade-down on the opening base
    const leave = (n: number, p: PlanId) => {
      const base = n * b.churn[p];
      const scen = n * b.churn[p] * churnMult(p, m);
      const extra = Math.max(0, scen - base);
      const down = p === 'basic' ? 0 : extra * s.downgrade;
      return { churn: scen - down, down };
    };
    const lb = leave(basic, 'basic');
    const ls = leave(standard, 'standard');
    const lp = leave(premium, 'premium');
    const bundleChurn = bundle * b.churn.standard * (1 - s.bundleChurnCut);
    let promoChurn = 0;
    for (const c of promo) {
      const age = m - c.start; // months since joining
      let rate = b.churn.basic;
      if (age === s.promoMonths) rate += CONST.promoRolloff; // first full-price renewal
      else if (age > s.promoMonths) rate *= Math.max(0.5, 1 + e * r.basic);
      const lost = c.alive * Math.min(0.95, rate);
      c.alive -= lost;
      promoChurn += lost;
    }
    basic = basic - lb.churn + ls.down;
    standard = standard - ls.churn - ls.down + lp.down;
    premium = premium - lp.churn - lp.down;
    bundle -= bundleChurn;
    const churned = lb.churn + ls.churn + lp.churn + bundleChurn + promoChurn;

    // --- bundle migration of the existing Standard base (months 1-3)
    if (s.bundleOn && m <= CONST.bundleRampMonths) {
      const mv = Math.min(standard, migrateTotal / CONST.bundleRampMonths);
      standard -= mv;
      bundle += mv;
    }

    // --- new signups
    let gBasic = b.gross.basic * grossMult('basic');
    let gStandard = b.gross.standard * grossMult('standard');
    const gPremium = b.gross.premium * grossMult('premium');
    let gBundle = 0;
    if (s.bundleOn) {
      const shift = gStandard * CONST.bundleNewShare;
      gStandard -= shift;
      gBundle = shift + baseGrossTotal * CONST.bundleIncremental;
    }
    if (s.promoOn && disc > 0 && m <= CONST.promoWindow) {
      const lift = gBasic * CONST.promoLift * disc;
      const cannibal = Math.min(gStandard, lift * CONST.promoCannibal);
      gStandard -= cannibal;
      promo.push({ start: m, alive: gBasic + lift });
      gBasic = 0;
    }
    basic += gBasic;
    standard += gStandard;
    premium += gPremium;
    bundle += gBundle;

    // --- revenue on closing subscribers
    let promoRev = 0;
    let promoSubs = 0;
    for (const c of promo) {
      const age = m - c.start;
      promoRev += c.alive * (age < s.promoMonths ? s.promoPrice : price.basic);
      promoSubs += c.alive;
    }
    const subRevenue =
      basic * price.basic + standard * price.standard + premium * price.premium + bundle * s.bundlePrice + promoRev;
    const adRevenue = (basic + promoSubs) * b.adArpu;
    const partnerCost = bundle * s.bundleCost;
    const total = basic + standard + premium + bundle + promoSubs;
    out.push({
      m,
      subs: { basic, promo: promoSubs, standard, premium, bundle },
      total,
      start,
      churned,
      subRevenue,
      adRevenue,
      partnerCost,
      net: subRevenue + adRevenue - partnerCost,
    });
  }

  const sum = (f: (x: ProjMonth) => number) => out.reduce((a, x) => a + f(x), 0);
  const last = out[out.length - 1];
  const tail = out.slice(-3);
  const exitChurn = tail.reduce((a, x) => a + x.churned / x.start, 0) / tail.length;
  const arpu = last.net / last.total;
  return {
    months: out,
    endSubs: last.total,
    avgChurn: sum((x) => x.churned) / sum((x) => x.start),
    subRevenue: sum((x) => x.subRevenue),
    adRevenue: sum((x) => x.adRevenue),
    partnerCost: sum((x) => x.partnerCost),
    net: sum((x) => x.net),
    arpu,
    exitChurn,
    ltv: (arpu * ASSUMPTIONS.contributionMargin) / exitChurn,
  };
}

export function cloneScenario(s: Scenario): Scenario {
  return { ...s, dPrice: { ...s.dPrice } };
}
