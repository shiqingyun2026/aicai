export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function makeUuid(): string {
  return crypto.randomUUID();
}
