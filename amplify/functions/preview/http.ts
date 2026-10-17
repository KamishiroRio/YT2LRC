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
    execFile(cmd, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr ? String(stderr).trim() : '';
        reject(new Error(`${error.message}${detail ? ' | stderr: ' + detail : ''}`));
      } else {
        resolve(String(stdout));
      }
    });
  });
}

// utanet blocks Node's fetch (TLS fingerprint) and the Lambda's IP, so fall
// back to a non-AWS proxy when a direct request fails.
export async function fetchHtmlViaCurl(url: string): Promise<string> {
  try {
    return await execFileAsync('curl', [
      '-s', '-f', '-L', '--max-time', '20', '-A', CURL_USER_AGENT, url,
    ]);
  } catch (error) {
    console.error('fetchHtmlViaCurl: direct request failed, falling back to proxy:', error instanceof Error ? error.message : error);
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    return await execFileAsync('curl', [
      '-s', '-f', '-L', '--max-time', '30', '-A', CURL_USER_AGENT, proxyUrl,
    ]);
  }
}
