# Nightjar Subscriber Lab

An interactive subscription dashboard and pricing scenario lab for **Nightjar**, a fictional streaming service. It covers subscriber growth, cohort retention, unit economics by acquisition channel and a "what if" pricing model. It ends with a one-page pricing recommendation memo written from a product manager's point of view.

> **All data is synthetic.** Nightjar is invented. Every number is generated in the browser by a seeded model (24 months, Oct 2024 to Sep 2026), so the page is reproducible and contains no real company data, names or branding. The key assumptions are listed on the page.

## Why it matters (for a hiring manager)

Streaming product roles are commercial roles: pricing, packaging, retention and acquisition efficiency decide whether a subscriber is worth having. This project shows that thinking end to end:

- **Reading the business, not just charting it.** Every chart carries a "so what" line: the ad tier is ~37% of subscribers but a Basic subscriber with ads is worth ~85% of an ad-free one; paid social has fallen below a 3× LTV:CAC; holiday cohorts retain worst.
- **Calibrating from evidence.** The default price elasticity (1.2) comes from the service's own past price increase, visible in the churn chart.
- **Trading off options honestly.** The memo compares a blanket +$2 increase, an intro promo, a bundle and a combined package, shows the downside cases (higher elasticity, worse partner terms), and names the metrics and kill-switch to watch.
- **An explainable model.** The formulas are on the page, so a finance partner can challenge any number.

## Features

- **KPI row:** subscribers, MRR/ARR, ARPU (ads included), monthly churn, LTV, LTV:CAC and CAC payback, each with a year-over-year change.
- **Charts** (hand-rolled SVG, with hover tooltips and a data table for each):
  - Subscribers by plan, annotated with the Oct 2025 price increase
  - MRR stacked by plan, with ad revenue shown separately (hatched)
  - Monthly churn by plan and blended
  - Plan mix: subscribers, signups and revenue share
  - Cohort retention heatmap (signup month × months since signup)
  - CAC by channel over time, plus an LTV:CAC and payback table by channel
- **Pricing scenario lab:**
  - Levers: price change per plan, price elasticity, trade-down capture, an ad-tier intro promo (price and length) and a partner bundle launch (price, partner fee, switching rate, churn reduction)
  - Presets: Baseline, Ad-free +$2, Ad-tier promo, Bundle launch, My recommendation
  - Outputs: 12-month projected subscribers, average churn, net revenue (subscriptions, ads, partner fees) and LTV against the baseline, monthly projection charts and the month-12 plan mix
  - A "How this model works" section with every formula and its limits
- **Recommendation memo:** a one-page memo in Bryan's voice (context, options considered, recommendation, risks, metrics to watch). Its numbers are computed live from the same model, so they always match the lab.
- Dark "Stellar Forge" theme (Space Grotesk, Inter and JetBrains Mono). Works at phone width, and short reveal animations are switched off under `prefers-reduced-motion`.

## How the data is generated

`src/data.ts` simulates subscriber cohorts by month, plan and channel with a seeded PRNG (mulberry32):

- Plans: Basic with ads $7.99; Standard (ad-free) $14.99, raised to $15.99 in Oct 2025; Premium $21.99.
- Signups follow a trend with release-driven seasonality. Signups split across five channels, each with its own CAC, CAC inflation, plan mix and churn quality.
- Churn depends on tenure: each plan starts high and decays toward a floor. Holiday and July cohorts churn faster. An onboarding improvement in Jan 2026 lowers early churn.
- Ad revenue per Basic subscriber grows over time with Q4 peaks.
- LTV = ARPU × 40% contribution margin ÷ monthly churn.

The scenario model is in `src/model.ts`.

## Run locally

```bash
npm install
npm run dev       # local dev server
npm run build     # type-check (tsc) + production build to dist/
npm run preview   # serve the built dist/
```

The build uses `base: './'`, so `dist/` works from any path or subfolder.

## Deploy to Netlify

`netlify.toml` is included:

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

Connect the repository in Netlify, or drag the `dist/` folder into Netlify Drop. No environment variables are needed.

## Stack

Vite + TypeScript with no runtime dependencies. The charts are plain SVG, and fonts load from Google Fonts.
