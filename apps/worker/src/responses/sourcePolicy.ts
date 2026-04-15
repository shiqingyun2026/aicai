import type { SourceLevel } from "@acai/shared";

const sourceDomainsByLevel: Record<SourceLevel, string[]> = {
  L1: [
    "cninfo.com.cn",
    "www.cninfo.com.cn",
    "sse.com.cn",
    "www.sse.com.cn",
    "szse.cn",
    "www.szse.cn",
  ],
  L2: [
    "cnstock.com",
    "www.cnstock.com",
    "cs.com.cn",
    "www.cs.com.cn",
    "stcn.com",
    "www.stcn.com",
  ],
  L3: [
    "eastmoney.com",
    "www.eastmoney.com",
    "finance.sina.com.cn",
    "jrj.com.cn",
    "www.jrj.com.cn",
  ],
  L4: [
    "xueqiu.com",
    "www.xueqiu.com",
    "guba.eastmoney.com",
    "stocktwits.com",
  ],
};

export function getAllowedDomainsForLevels(levels: SourceLevel[]): string[] {
  return Array.from(new Set(levels.flatMap((level) => sourceDomainsByLevel[level] ?? [])));
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  const raw = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;

  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "");
  }
}

export function inferSourceLevelForDomain(domain: string): SourceLevel | null {
  const normalizedDomain = normalizeDomain(domain);

  for (const [level, domains] of Object.entries(sourceDomainsByLevel) as Array<[SourceLevel, string[]]>) {
    if (domains.some((candidate) => normalizeDomain(candidate) === normalizedDomain)) {
      return level;
    }
  }

  return null;
}
