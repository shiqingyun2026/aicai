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
