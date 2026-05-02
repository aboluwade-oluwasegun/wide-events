# @wide-events/pino

Optional Pino bridge for `wide-events`.

```ts
import pino from "pino";
import { WideEvents } from "@wide-events/sdk";
import { pinoEventSink, pinoMixin } from "@wide-events/pino";

const logger = pino();
const wide = new WideEvents({
  serviceName: "orders-api",
  sink: pinoEventSink(logger),
});

const requestLogger = pino({
  mixin: pinoMixin(wide),
});
```

`@wide-events/pino` is optional. The core SDK does not depend on Pino.
