import type { CollectorConfig } from "../config.js";
import type { CollectorStore } from "../storage/store.js";

export class PromotionJob {
  private timer: NodeJS.Timeout | undefined;
  private currentRun: Promise<void> | null = null;
  private running = false;
  private rerunRequested = false;

  constructor(
    private readonly store: CollectorStore,
    private readonly config: CollectorConfig
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.requestCycle();
    }, this.config.promotionIntervalMs);
  }

  async requestCycle(): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      return;
    }

    this.running = true;
    this.currentRun = (async () => {
      try {
        do {
          this.rerunRequested = false;
          await this.store.runPromotionCycle();
        } while (this.rerunRequested);
      } finally {
        this.running = false;
        this.currentRun = null;
      }
    })();

    await this.currentRun;
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    if (this.currentRun) {
      await this.currentRun;
    }
  }
}
