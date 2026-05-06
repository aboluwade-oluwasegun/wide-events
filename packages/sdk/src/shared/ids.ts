function randomHex(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createCorrelationId(): string {
  return randomHex(32);
}

export function createEventId(): string {
  return randomHex(16);
}
