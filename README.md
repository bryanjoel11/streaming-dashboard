# Afterglow Insights

An interactive subscription dashboard and pricing lab for **Afterglow**, a streaming service. It shows where subscriber growth comes from, how long subscribers stay, and what a price change would do to revenue, and it ends with a one-page pricing recommendation.

The data covers 24 months (Oct 2024 to Sep 2026) and comes from the cohort model described below. The model runs with a fixed seed, so the numbers are reproducible.

## Pages

- **Overview:** four KPIs (subscribers, MRR, monthly churn, LTV:CAC) and a short read of the business.
- **Subscribers:** subscribers by plan, annotated with the Oct 2025 price increase, and monthly churn by plan.
- **Retention:** a cohort retention heatmap and LTV:CAC by acquisition channel.
- **Pricing Lab:** presets and a price slider per plan, with customer response, promo and bundle levers under Advanced settings. It shows 12 months of revenue, churn and LTV against doing nothing.
- **Memo:** a one-page recommendation whose numbers are computed live from the same model.

The site has its own brand (a crescent-and-play logo mark, a near-black plum palette with one rose accent), works at phone width, and switches animations off under `prefers-reduced-motion`.

## Model assumptions

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
