import * as cheerio from 'cheerio';
import type { Schema } from '../../data/resource';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en;q=0.8',
};

export const handler: Schema['fetchLyrics']['functionHandler'] = async (event) => {
  const url = event.arguments.url?.trim();
  if (!url) {
    throw new Error('url is required.');
  }

  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }

  const html = await response.text();
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
