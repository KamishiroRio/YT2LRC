const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja,en;q=0.8',
};

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: BROWSER_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return (await response.json()) as T;
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: BROWSER_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }
  return response.text();
}
