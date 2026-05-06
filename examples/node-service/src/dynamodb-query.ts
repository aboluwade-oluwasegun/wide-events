import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { instrumentAwsSdkV3 } from "@wide-events/sdk/instrumentation/aws-sdk-v3";
import type { WideEvents } from "@wide-events/sdk";

export interface OrdersQueryExampleOptions {
  /**
   * Inject a prepared document client (for tests).
   * If omitted, builds a regional client plus optional {@link instrumentAwsSdkV3}.
   */
  client?: DynamoDBDocumentClient;
  ordersByCustomerIndexName?: string;
  region?: string;
  tableName?: string;
}

export function createOrdersQueryExample(
  wideEvents: WideEvents,
  options: OrdersQueryExampleOptions = {},
): {
  listCustomerOrders(customerId: string, monthPrefix: string): Promise<unknown>;
} {
  const docClient =
    options.client ??
    (() => {
      const dynamoBase = new DynamoDBClient({
        region: options.region ?? process.env["AWS_REGION"] ?? "us-east-1",
      });
      instrumentAwsSdkV3(dynamoBase, wideEvents);
      return DynamoDBDocumentClient.from(dynamoBase);
    })();
  const tableName = options.tableName ?? "orders";
  const indexName =
    options.ordersByCustomerIndexName ?? "by_customer_created_at";

  return {
    async listCustomerOrders(customerId: string, monthPrefix: string) {
      wideEvents.annotate({
        "dynamodb.query_name": "listCustomerOrders",
      });

      return await docClient.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: indexName,
          KeyConditionExpression:
            "#customerId = :customerId AND begins_with(#createdAt, :monthPrefix)",
          ExpressionAttributeNames: {
            "#customerId": "customer_id",
            "#createdAt": "created_at",
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":customerId": customerId,
            ":monthPrefix": monthPrefix,
            ":status": "PAID",
          },
          FilterExpression: "#status = :status",
          ProjectionExpression: "order_id, #status, total, created_at",
          ScanIndexForward: false,
        }),
      );
    },
  };
}
