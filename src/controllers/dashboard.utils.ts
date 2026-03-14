export type DashboardRange = "7D" | "30D" | "90D" | "1Y";

export const parseDashboardRange = (raw: unknown): DashboardRange => {
  const value = String(raw ?? "30D").toUpperCase();
  if (value === "7D" || value === "30D" || value === "90D" || value === "1Y") {
    return value;
  }
  return "30D";
};

export const rangeToDays = (range: DashboardRange): number => {
  if (range === "7D") return 7;
  if (range === "90D") return 90;
  if (range === "1Y") return 365;
  return 30;
};

export const getRangeStart = (range: DashboardRange) => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (rangeToDays(range) - 1));
  return start;
};

export const makeDayKey = (date: Date) => date.toISOString().slice(0, 10);

export const buildDayBuckets = (range: DashboardRange) => {
  const days = rangeToDays(range);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const labels: string[] = [];
  const map = new Map<string, number>();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = makeDayKey(d);
    labels.push(key);
    map.set(key, 0);
  }

  return { labels, map };
};

export const getChangePercent = (current: number, previous: number) => {
  if (previous <= 0) {
    return current > 0 ? 100 : 0;
  }
  return Number((((current - previous) / previous) * 100).toFixed(2));
};
