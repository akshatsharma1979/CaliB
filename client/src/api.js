const API_URL = import.meta.env.VITE_API_URL ?? "";

export function makeQuery(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  return params.toString();
}

export async function getJson(path, filters = {}) {
  const query = makeQuery(filters);
  const response = await fetch(`${API_URL}${path}${query ? `?${query}` : ""}`);

  if (!response.ok) {
    const message = await getErrorMessage(response);
    throw new Error(message);
  }

  return response.json();
}

export function exportUrl(filters) {
  const query = makeQuery(filters);
  return `${API_URL}/api/export/top-items.csv${query ? `?${query}` : ""}`;
}

async function getErrorMessage(response) {
  const body = await response.text();

  if (body) {
    try {
      const parsed = JSON.parse(body);
      return parsed.error ?? `Request failed with status ${response.status}`;
    } catch {
      return body;
    }
  }

  return `Request failed with status ${response.status}`;
}
