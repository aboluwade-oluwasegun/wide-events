import type {
  ColumnInfo,
  QueryResult,
  QuerySource,
  StructuredQuery,
  EventsResult
} from "@wide-events/internal";

export interface WideEventsClientOptions {
  url: string;
  fetchImpl?: typeof fetch;
}

interface ColumnsResponse {
  columns: ColumnInfo[];
}

export class WideEventsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WideEventsClientOptions) {
    this.baseUrl = options.url.replace(/\/$/u, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async query(request: StructuredQuery): Promise<QueryResult> {
    return await this.postJson<QueryResult>("/query", request);
  }

  async sql(sql: string): Promise<QueryResult> {
    return await this.postJson<QueryResult>("/sql", { sql });
  }

  async getColumns(source: QuerySource = "events"): Promise<ColumnInfo[]> {
    const suffix = source === "events" ? "" : `?source=${encodeURIComponent(source)}`;
    const response = await this.getJson<ColumnsResponse>(`/columns${suffix}`);
    return response.columns;
  }

  async getEvents(correlationId: string): Promise<EventsResult> {
    return await this.getJson<EventsResult>(`/events/${encodeURIComponent(correlationId)}`);
  }

  private async getJson<TResponse>(path: string): Promise<TResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`);
    return await readJsonResponse<TResponse>(response);
  }

  private async postJson<TResponse>(
    path: string,
    body: unknown
  ): Promise<TResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    return await readJsonResponse<TResponse>(response);
  }
}

async function readJsonResponse<TResponse>(response: Response): Promise<TResponse> {
  if (!response.ok) {
    const body = await response.text();
    const payload = tryParseJson(body);
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : body
          ? body
        : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return (await response.json()) as TResponse;
}

function tryParseJson(value: string): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
