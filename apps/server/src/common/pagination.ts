export function pageParams(page?: string | number, pageSize?: string | number, max = 200) {
  const p = Math.max(1, Number(page) || 1);
  const s = Math.min(max, Math.max(1, Number(pageSize) || 20));
  return { page: p, pageSize: s, skip: (p - 1) * s, take: s };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
