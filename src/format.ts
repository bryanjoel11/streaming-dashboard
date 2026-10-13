export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export function fmtCompact(n: number, digits = 2): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `${sign}${a.toFixed(0)}`;
}

export function fmtMoney(n: number, digits = 2): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(digits)}`;
}

export const fmtPrice = (n: number) => `$${n.toFixed(2)}`;
export const fmtPct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

export function signed(n: number, f: (x: number) => string): string {
  if (Math.abs(n) < 1e-9) return '±0';
  return n > 0 ? `+${f(n)}` : `−${f(-n)}`;
}

export const pts = (n: number, digits = 2) => `${(n * 100).toFixed(digits)} pts`;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
