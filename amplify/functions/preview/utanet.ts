import * as cheerio from 'cheerio';
import { fetchText } from './http';

export type UtaNetCandidate = {
  title: string;
  artist: string;
  url: string;
};

const UTA_NET_ORIGIN = 'https://www.uta-net.com';

export async function searchUtaNet(
  keyword: string,
): Promise<UtaNetCandidate[]> {
  const query = keyword.trim();
  if (!query) {
    return [];
  }

  const url = new URL(`${UTA_NET_ORIGIN}/search/`);
  url.searchParams.set('Aselect', '2');
  url.searchParams.set('Keyword', query);
  url.searchParams.set('Bselect', '3');

  const html = await fetchText(url.toString());
  return parseSearchResults(html);
}

export async function fetchUtaNetLyrics(songUrl: string): Promise<string> {
  const html = await fetchText(songUrl);
  return parseLyrics(html);
}

export function parseSearchResults(html: string): UtaNetCandidate[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const candidates: UtaNetCandidate[] = [];

  $('a[href*="/song/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) {
      return;
    }

    const match = href.match(/\/song\/(\d+)\//);
    if (!match) {
      return;
    }

    const url = new URL(href, UTA_NET_ORIGIN).href;
    if (seen.has(url)) {
      return;
    }

    const title = $(el).text().replace(/\s+/g, ' ').trim();
    if (!title) {
      return;
    }

    const row = $(el).closest('tr');
    const artistLink = row.find('a[href*="/artist/"]').first();
    const artist = artistLink.text().replace(/\s+/g, ' ').trim();

    seen.add(url);
    candidates.push({ title, artist, url });
  });

  return candidates.slice(0, 10);
}

export function parseLyrics(html: string): string {
  const $ = cheerio.load(html);
  const area = $('#kashi_area').first();
  const source = area.length ? area : $('[itemprop="text"]').first();
  if (!source.length) {
    return '';
  }

  source.find('br').replaceWith('\n');
  return source
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function pickBestCandidate(
  candidates: UtaNetCandidate[],
  title: string,
  artist: string,
): UtaNetCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  let best = candidates[0];
  let bestScore = scoreCandidate(best, title, artist);
  for (const candidate of candidates.slice(1)) {
    const nextScore = scoreCandidate(candidate, title, artist);
    if (nextScore > bestScore) {
      best = candidate;
      bestScore = nextScore;
    }
  }

  if (candidates.length === 1 || bestScore >= 3) {
    return best;
  }

  return null;
}

function scoreCandidate(
  candidate: UtaNetCandidate,
  title: string,
  artist: string,
): number {
  let score = 0;
  const wantedTitle = normalize(title);
  const foundTitle = normalize(candidate.title);
  if (wantedTitle && foundTitle) {
    if (foundTitle === wantedTitle) {
      score += 4;
    } else if (foundTitle.includes(wantedTitle) || wantedTitle.includes(foundTitle)) {
      score += 2;
    }
  }

  const wantedArtist = normalize(artist);
  const foundArtist = normalize(candidate.artist);
  if (wantedArtist && foundArtist) {
    if (foundArtist === wantedArtist) {
      score += 4;
    } else if (
      foundArtist.includes(wantedArtist) ||
      wantedArtist.includes(foundArtist)
    ) {
      score += 2;
    }
  }

  return score;
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s"'「」『』【】()（）]/g, '');
}
