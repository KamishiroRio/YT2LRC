import { execFile } from 'node:child_process';

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

const CURL_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}

// utanet blocks Node's fetch (TLS fingerprint) but accepts curl's system TLS stack.
export async function fetchHtmlViaCurl(url: string): Promise<string> {
  return execFileAsync('curl', [
    '-s',
    '-L',
    '--max-time',
    '20',
    '-A',
    CURL_USER_AGENT,
    url,
  ]);
}
