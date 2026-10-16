import { fetchJson } from './http';

type ItunesSearchResponse = {
  resultCount?: number;
  results?: Array<{
    trackName?: string;
    artistName?: string;
  }>;
};

export async function searchItunes(
  term: string,
): Promise<{ title: string; artist: string } | null> {
  const query = term.trim();
  if (!query) {
    return null;
  }

  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', query);
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '1');
  url.searchParams.set('country', 'jp');
  url.searchParams.set('lang', 'ja_jp');

  const data = await fetchJson<ItunesSearchResponse>(url.toString());
  const first = data.results?.[0];
  if (!first?.trackName) {
    return null;
  }

  return {
    title: first.trackName.trim(),
    artist: first.artistName?.trim() ?? '',
  };
}
