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

/**
 * Prisma 的 contains 会直接拼成 LIKE '%值%'，不会转义通配符；
 * 搜索 \C[2]、50%、a_b 这类文本前需要先转义 \ % _。
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}
