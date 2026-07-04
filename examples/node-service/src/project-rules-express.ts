import {
  WideEvents,
  type ExpressRequestLike,
  type ProjectRulesDocument,
} from "@wide-events/sdk";

type ExpressMiddlewareLike = ReturnType<WideEvents["expressMiddleware"]>;

interface ExpressLike {
  use(middleware: ExpressMiddlewareLike): void;
  post(
    path: string,
    handler: (
      request: CheckoutRequest,
      response: CheckoutResponse,
    ) => Promise<void> | void,
  ): void;
}

interface CheckoutRequestBody {
  cart: {
    itemCount: number;
    couponApplied: boolean;
  };
  order: {
    currency: string;
    subtotal: number;
  };
  user: {
    id: string;
  };
}

interface CheckoutRequest extends ExpressRequestLike {
  body: CheckoutRequestBody;
}

interface CheckoutResponseBody {
  order: {
    currency: string;
    status: "confirmed";
    total: number;
  };
}

interface CheckoutResponse {
  status(statusCode: number): CheckoutResponse;
  json(body: CheckoutResponseBody): CheckoutResponse;
}

export interface CheckoutProjectEventsOptions {
  collectorUrl: string;
  environment?: string | undefined;
  projectRulesUrl: string;
}

export const checkoutProjectRules = {
  version: 1,
  rules: [
    {
      project_id: "project_checkout",
      project_rule_version: "2026-07-01",
      match: {
        method: "POST",
        path: "/checkout",
      },
      fields: [
        {
          field: "cart.item_count",
          source: "request.body",
          path: "cart.itemCount",
          type: "BIGINT",
          optional: false,
        },
        {
          field: "coupon.applied",
          source: "request.body",
          path: "cart.couponApplied",
          type: "BOOLEAN",
          optional: false,
        },
        {
          field: "order.currency",
          source: "request.body",
          path: "order.currency",
          type: "VARCHAR",
          optional: false,
        },
        {
          field: "order.total",
          source: "response.body",
          path: "order.total",
          type: "DOUBLE",
          optional: false,
        },
        {
          field: "order.status",
          source: "response.body",
          path: "order.status",
          type: "VARCHAR",
          optional: false,
        },
        {
          field: "response.status",
          source: "response.status",
          type: "BIGINT",
          optional: false,
        },
      ],
    },
  ],
} satisfies ProjectRulesDocument;

export function configureCheckoutProjectEvents(
  app: ExpressLike,
  options: CheckoutProjectEventsOptions,
): WideEvents {
  const wideEvents = new WideEvents({
    serviceName: "checkout-api",
    environment: options.environment ?? "production",
    collectorUrl: options.collectorUrl,
    projects: ["project_checkout"],
    projectRules: {
      url: options.projectRulesUrl,
      refreshIntervalMs: 60_000,
    },
  });

  app.use(wideEvents.expressMiddleware());

  app.post("/checkout", (request, response) => {
    const total = applyCheckoutAdjustments(request.body.order.subtotal);

    response.status(201).json({
      order: {
        currency: request.body.order.currency,
        status: "confirmed",
        total,
      },
    });
  });

  return wideEvents;
}

function applyCheckoutAdjustments(subtotal: number): number {
  return Number.parseFloat(subtotal.toFixed(2));
}
