export async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown
): Promise<void> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Telemetry export failed (${response.status}): ${payload}`);
  }
}

export async function getJson(
  fetchImpl: typeof fetch,
  url: string
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Project config fetch failed (${response.status}): ${payload}`);
  }

  const payload: unknown = await response.json();
  return payload;
}
