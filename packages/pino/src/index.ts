import type { WideEvent } from "@wide-events/internal";
import type { Logger } from "pino";

export interface WideEventsLike {
  current(): WideEvent | undefined;
}

export interface WideEventSink {
  write(events: WideEvent[]): Promise<void> | void;
}

export function pinoMixin(wide: WideEventsLike) {
  return function mixin(): Record<string, unknown> {
    const event = wide.current();
    if (!event) {
      return {};
    }

    return {
      event_id: event.event_id,
      correlation_id: event.correlation_id,
      "service.name": event["service.name"],
    };
  };
}

export function pinoEventSink(logger: Logger): WideEventSink {
  return {
    write(events) {
      for (const event of events) {
        logger.info(flattenWideEvent(event), event.name ?? "wide_event");
      }
    },
  };
}

export function createWideEventsLogger(options: { logger: Logger }) {
  return {
    info(event: WideEvent, message = "wide_event") {
      options.logger.info(flattenWideEvent(event), message);
    },
    error(event: WideEvent, message = "wide_event") {
      options.logger.error(flattenWideEvent(event), message);
    },
  };
}

export function flattenWideEvent(event: WideEvent): Record<string, unknown> {
  const { attributes, promote, ...base } = event;
  return {
    wide_event: true,
    ...base,
    ...(attributes ?? {}),
    promote,
  };
}
