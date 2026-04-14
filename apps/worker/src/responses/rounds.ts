import type { SourceLevel } from "@acai/shared";

export const responseRounds: Array<{
  round: 1 | 2 | 3 | 4;
  allowedSourceLevels: SourceLevel[];
}> = [
  { round: 1, allowedSourceLevels: ["L1"] },
  { round: 2, allowedSourceLevels: ["L1", "L2"] },
  { round: 3, allowedSourceLevels: ["L1", "L2", "L3"] },
  { round: 4, allowedSourceLevels: ["L1", "L2", "L3", "L4"] },
];

