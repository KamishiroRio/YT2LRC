import * as cheerio from 'cheerio';
import { execFile } from 'node:child_process';
import type { Schema } from '../../data/resource';

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
async function fetchHtmlViaCurl(url: string): Promise<string> {
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

export const handler: Schema['fetchLyrics']['functionHandler'] = async (event) => {
  const url = event.arguments.url?.trim();
  if (!url) {
    throw new Error('url is required.');
  }

  const html = await fetchHtmlViaCurl(url);
  const $ = cheerio.load(html);
  const area = $('#kashi_area').first();
  if (!area.length) {
    return { lyrics: '' };
  }

  area.find('br').replaceWith('\n');
  const lyrics = area
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { lyrics };
};
