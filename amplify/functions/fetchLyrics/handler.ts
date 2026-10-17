import * as cheerio from 'cheerio';
import { execFile } from 'node:child_process';
import type { Schema } from '../../data/resource';

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
async function fetchHtmlViaCurl(url: string): Promise<string> {
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
