// Data model for the Duskline streaming dashboard.
// Everything here is deterministic: a seeded PRNG drives all noise, so the
// dashboard shows the same numbers on every load.

export type PlanId = 'basic' | 'standard' | 'premium';
export type ChannelId = 'social' | 'search' | 'partner' | 'organic' | 'affiliate';

export const PLAN_IDS: PlanId[] = ['basic', 'standard', 'premium'];
export const CHANNEL_IDS: ChannelId[] = ['social', 'search', 'partner', 'organic', 'affiliate'];

export const PLANS: Record<PlanId, { name: string; short: string; desc: string }> = {
  basic: { name: 'Basic with ads', short: 'Basic', desc: 'HD, 2 streams, ~4 min of ads per hour' },
  standard: { name: 'Standard (ad-free)', short: 'Standard', desc: 'HD, 2 streams, no ads, downloads' },
  premium: { name: 'Premium', short: 'Premium', desc: '4K HDR, 4 streams, no ads, early-access premieres' },
};

export const CHANNELS: Record<ChannelId, { name: string; baseCac: number; share: number; churnMod: number; mixMod: [number, number, number] }> = {
  // mixMod multiplies the plan mix (basic, standard, premium) for signups from that channel
  social: { name: 'Paid social', baseCac: 54, share: 0.3, churnMod: 1.1, mixMod: [1.15, 0.92, 0.8] },
  search: { name: 'Paid search', baseCac: 43, share: 0.2, churnMod: 1.0, mixMod: [1, 1.02, 0.95] },
  partner: { name: 'Device & telco partners', baseCac: 31, share: 0.18, churnMod: 0.85, mixMod: [0.8, 1.0, 1.55] },
  organic: { name: 'Organic & referral', baseCac: 9, share: 0.22, churnMod: 0.9, mixMod: [0.92, 1.1, 1.05] },
  affiliate: { name: 'Affiliate & promo', baseCac: 37, share: 0.1, churnMod: 1.28, mixMod: [1.3, 0.85, 0.6] },
};

/** Key modelling assumptions, shown on the page. */
export const ASSUMPTIONS = {
  months: 24,
  startLabel: 'Oct 2024',
  contributionMargin: 0.4,
  standardIncreaseMonth: 12, // Oct 2025: Standard $14.99 -> $15.99
  legacyBase: { basic: 300_000, standard: 760_000, premium: 230_000 } as Record<PlanId, number>,
  legacyChurn: { basic: 0.052, standard: 0.03, premium: 0.021 } as Record<PlanId, number>,
  // Tenure hazard: churn(t) = floor + (start - floor) * exp(-(t-1)/decay), t = months since signup
  hazard: {
    basic: { start: 0.17, floor: 0.056 },
    standard: { start: 0.115, floor: 0.031 },
    premium: { start: 0.085, floor: 0.023 },
  } as Record<PlanId, { start: number; floor: number }>,
  hazardDecay: 2.2,
  burnIn: 12, // unseen months simulated before Oct 2024
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(i: number, short = false): string {
  const m = (9 + i) % 12; // index 0 = Oct 2024
  const y = 2024 + Math.floor((9 + i) / 12);
  return short ? `${MONTH_NAMES[m]} '${String(y).slice(2)}` : `${MONTH_NAMES[m]} ${y}`;
}

export function priceAt(plan: PlanId, month: number): number {
  if (plan === 'basic') return 7.99;
  if (plan === 'premium') return 21.99;
  return month >= ASSUMPTIONS.standardIncreaseMonth ? 15.99 : 14.99;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hazard(plan: PlanId, t: number): number {
  const h = ASSUMPTIONS.hazard[plan];
  return h.floor + (h.start - h.floor) * Math.exp(-(t - 1) / ASSUMPTIONS.hazardDecay);
}

/** Churn multiplier on Standard from the Oct 2025 price increase (calibrates the elasticity default). */
function standardPriceShock(month: number): number {
  const k = ASSUMPTIONS.standardIncreaseMonth;
  if (month === k) return 1.4;
  if (month === k + 1) return 1.12;
  if (month > k + 1) return 1.08;
  return 1;
}

interface Cohort {
  month: number;
  channel: ChannelId;
  plan: PlanId;
  size: number;
  quality: number; // churn multiplier for the whole cohort (seasonal intent, onboarding changes)
  alive: number;
  survivors: number[]; // survivors[k] = alive k months after signup
}

export interface MonthRow {
  index: number;
  label: string;
  subs: Record<PlanId, number>; // end of month
  startSubs: Record<PlanId, number>;
  signups: Record<PlanId, number>;
  churned: Record<PlanId, number>;
  signupsByChannel: Record<ChannelId, number>;
  cacByChannel: Record<ChannelId, number>;
  price: Record<PlanId, number>;
  adArpu: number; // ad revenue per Basic subscriber per month
  subRevenue: Record<PlanId, number>;
  adRevenue: number;
  spend: number;
}

export interface Dataset {
  months: MonthRow[];
  cohorts: Cohort[];
  /** cohortRetention[signupMonth][k] = share of that month's signups still active k months later (k>=1) */
  cohortRetention: (number | null)[][];
  channelStats: Record<ChannelId, { signups: number; spend: number; churn12: number; arpu: number; mix: Record<PlanId, number> }>;
}

export function generate(seed = 20241001): Dataset {
  const rand = mulberry32(seed);
  const noise = (amp: number) => 1 + (rand() * 2 - 1) * amp;
  const N = ASSUMPTIONS.months;
  const legacy: Record<PlanId, number> = { ...ASSUMPTIONS.legacyBase };
  const cohorts: Cohort[] = [];
  const months: MonthRow[] = [];

  // Run a burn-in year before the visible window so the base has a realistic tenure mix on day one.
  for (let m = -ASSUMPTIONS.burnIn; m < N; m++) {
    const calMonth = (((9 + m) % 12) + 12) % 12; // 0 = Jan
    const startSubs = { basic: 0, standard: 0, premium: 0 } as Record<PlanId, number>;
    const churned = { basic: 0, standard: 0, premium: 0 } as Record<PlanId, number>;

    // 1) churn on the existing base (legacy + earlier cohorts)
    for (const p of PLAN_IDS) {
      startSubs[p] += legacy[p];
      let c = ASSUMPTIONS.legacyChurn[p] * noise(0.04);
      if (p === 'standard') c *= standardPriceShock(m);
      if (calMonth === 0 || calMonth === 8) c *= 1.06; // post-holiday and back-to-school bumps
      const lost = legacy[p] * c;
      legacy[p] -= lost;
      churned[p] += lost;
    }
    for (const co of cohorts) {
      startSubs[co.plan] += co.alive;
      const t = m - co.month; // months since signup (>=1)
      let c = hazard(co.plan, t) * CHANNELS[co.channel].churnMod * co.quality * noise(0.04);
      if (co.plan === 'standard') c *= standardPriceShock(m);
      if (calMonth === 0 || calMonth === 8) c *= 1.06;
      const lost = co.alive * Math.min(c, 0.9);
      co.alive -= lost;
      co.survivors.push(co.alive);
      churned[co.plan] += lost;
    }

    // 2) new signups: trend + seasonality (tentpole releases in Nov/Dec, Mar, Jul)
    const season = [1.12, 0.92, 1.08, 0.95, 0.94, 0.98, 1.1, 0.96, 0.94, 1.0, 1.14, 1.2][calMonth];
    const gross = 142_000 * Math.pow(1.011, m) * season * noise(0.05);
    const tShare = m / (N - 1);
    const baseMix: Record<PlanId, number> = {
      basic: 0.44 + 0.11 * tShare,
      premium: 0.12 + 0.01 * tShare,
      standard: 0,
    };
    baseMix.standard = 1 - baseMix.basic - baseMix.premium;
    if (m >= ASSUMPTIONS.standardIncreaseMonth) {
      // price elasticity on acquisition: ~8% fewer Standard signups, half trade down to Basic
      const moved = baseMix.standard * 0.08;
      baseMix.standard -= moved;
      baseMix.basic += moved * 0.5;
    }

    // Cohort quality: holiday gift/deal signups and tentpole "binge and leave" signups churn faster;
    // the new onboarding flow shipped in Jan 2026 (month 15) improves early retention.
    const quality =
      [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.14, 1.04, 1.0, 1.0, 1.1, 1.2][calMonth] *
      (m >= 15 ? 0.9 : 1) *
      noise(0.03);

    const signups = { basic: 0, standard: 0, premium: 0 } as Record<PlanId, number>;
    const signupsByChannel = {} as Record<ChannelId, number>;
    const cacByChannel = {} as Record<ChannelId, number>;
    let spend = 0;
    let shareSum = 0;
    const shares = {} as Record<ChannelId, number>;
    for (const ch of CHANNEL_IDS) {
      let s = CHANNELS[ch].share * noise(0.08);
      if (ch === 'organic') s *= 1 + 0.25 * tShare; // referral program matures
      if (ch === 'social') s *= 1 - 0.1 * tShare;
      shares[ch] = s;
      shareSum += s;
    }
    for (const ch of CHANNEL_IDS) {
      const chSignups = (gross * shares[ch]) / shareSum;
      signupsByChannel[ch] = chSignups;
      const drift = ch === 'social' ? 1 + 0.011 * m : ch === 'search' ? 1 + 0.006 * m : 1 + 0.002 * m;
      const cac = CHANNELS[ch].baseCac * drift * noise(0.06);
      cacByChannel[ch] = cac;
      spend += cac * chSignups;
      const mm = CHANNELS[ch].mixMod;
      const w = [baseMix.basic * mm[0], baseMix.standard * mm[1], baseMix.premium * mm[2]];
      const wsum = w[0] + w[1] + w[2];
      PLAN_IDS.forEach((p, i) => {
        const size = (chSignups * w[i]) / wsum;
        signups[p] += size;
        cohorts.push({ month: m, channel: ch, plan: p, size, quality, alive: size, survivors: [size] });
      });
    }

    const subs = { basic: legacy.basic, standard: legacy.standard, premium: legacy.premium } as Record<PlanId, number>;
    for (const co of cohorts) if (co.month <= m) subs[co.plan] += co.alive;
    // Signups churn no earlier than their first renewal, so subs includes this month's adds.

    const adSeason = [0.86, 0.9, 0.97, 0.98, 1.0, 0.99, 0.96, 0.97, 1.02, 1.05, 1.16, 1.22][calMonth];
    const adArpu = 4.7 * Math.pow(1.009, m) * adSeason * noise(0.02);
    const price = { basic: priceAt('basic', m), standard: priceAt('standard', m), premium: priceAt('premium', m) };
    const subRevenue = { basic: subs.basic * price.basic, standard: subs.standard * price.standard, premium: subs.premium * price.premium };

    if (m >= 0) months.push({
      index: m,
      label: monthLabel(m),
      subs,
      startSubs,
      signups,
      churned,
      signupsByChannel,
      cacByChannel,
      price,
      adArpu,
      subRevenue,
      adRevenue: subs.basic * adArpu,
      spend,
    });
  }

  // Cohort retention, all plans and channels combined
  const cohortRetention: (number | null)[][] = [];
  for (let m = 0; m < N; m++) {
    const row: (number | null)[] = [];
    const cs = cohorts.filter((c) => c.month === m);
    const size = cs.reduce((a, c) => a + c.size, 0);
    for (let k = 1; k <= 12; k++) {
      if (m + k >= N) row.push(null);
      else row.push(cs.reduce((a, c) => a + c.survivors[k], 0) / size);
    }
    cohortRetention.push(row);
  }

  // Channel unit economics, using cohorts with a full 12 months of history (signed up months 0-11)
  const last = months[N - 1];
  const channelStats = {} as Dataset['channelStats'];
  for (const ch of CHANNEL_IDS) {
    const cs = cohorts.filter((c) => c.channel === ch && c.month >= 0);
    const signupsCh = cs.reduce((a, c) => a + c.size, 0);
    const spendCh = months.reduce((a, r) => a + r.signupsByChannel[ch] * r.cacByChannel[ch], 0);
    const mature = cs.filter((c) => c.month + 12 < N);
    const s0 = mature.reduce((a, c) => a + c.size, 0);
    const s12 = mature.reduce((a, c) => a + c.survivors[12], 0);
    const churn12 = 1 - Math.pow(s12 / s0, 1 / 12);
    const mix = { basic: 0, standard: 0, premium: 0 } as Record<PlanId, number>;
    for (const c of cs) mix[c.plan] += c.size / signupsCh;
    const arpu =
      mix.basic * (last.price.basic + last.adArpu) + mix.standard * last.price.standard + mix.premium * last.price.premium;
    channelStats[ch] = { signups: signupsCh, spend: spendCh, churn12, arpu, mix };
  }

  return { months, cohorts, cohortRetention, channelStats };
}
