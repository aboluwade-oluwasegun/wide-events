# @wide-events/pino

Optional Pino bridge for `wide-events`. Use it when you want Pino log records to carry active event context or when you want the SDK to emit through a Pino logger.

```bash
npm install @wide-events/pino pino
```

```ts
import pino from "pino";
import { WideEvents } from "@wide-events/sdk";
import { pinoEventSink, pinoMixin } from "@wide-events/pino";

const logger = pino();
const wideEvents = new WideEvents({
  serviceName: "orders-api",
  sink: pinoEventSink(logger),
});

const requestLogger = pino({
  mixin: pinoMixin(wideEvents),
});
```

`@wide-events/pino` is optional. The core SDK does not depend on Pino.
