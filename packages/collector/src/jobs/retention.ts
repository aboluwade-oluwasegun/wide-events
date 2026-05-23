import type { CollectorStore } from "../storage/store.js";

export class RetentionJob {
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly store: CollectorStore) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.store.runRetention().catch(() => undefined);
    }, 24 * 60 * 60 * 1_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
