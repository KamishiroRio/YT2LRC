import { fetchJson } from './http';

type OEmbedResponse = {
  title?: string;
  author_name?: string;
};

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export function isYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return YOUTUBE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export async function fetchYouTubeOEmbed(youtubeUrl: string): Promise<{
  rawTitle: string;
  channel: string;
}> {
  const oembedUrl = new URL('https://www.youtube.com/oembed');
  oembedUrl.searchParams.set('url', youtubeUrl);
  oembedUrl.searchParams.set('format', 'json');
  const data = await fetchJson<OEmbedResponse>(oembedUrl.toString());
  return {
    rawTitle: data.title?.trim() ?? '',
    channel: data.author_name?.trim() ?? '',
  };
}

export function parseYouTubeTitle(rawTitle: string): {
  title: string;
  artist: string;
} {
  let cleaned = rawTitle
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*(official|mv|pv|lyrics?|audio|video)[^)]*\)/gi, ' ')
    .replace(/（[^）]*(official|mv|pv|歌詞)[^）]*）/gi, ' ')
    .replace(/\b(official\s*)?(music\s*)?video\b/gi, ' ')
    .replace(/\b(official\s*)?audio\b/gi, ' ')
    .replace(/\blyric\s*video\b/gi, ' ')
    .replace(/歌詞付き?/g, ' ')
    .replace(/\b(MV|PV)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const jpQuoted = cleaned.match(/^(.+?)\s*[「『](.+?)[」』]/);
  if (jpQuoted) {
    return { artist: jpQuoted[1].trim(), title: jpQuoted[2].trim() };
  }

  const slashParts = cleaned.split(/\s+[\/／]\s+/);
  if (slashParts.length >= 2) {
    return {
      title: slashParts[0].trim(),
      artist: slashParts.slice(1).join(' / ').trim(),
    };
  }

  const dashParts = cleaned.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    return {
      artist: dashParts[0].trim(),
      title: dashParts.slice(1).join(' - ').trim(),
    };
  }

  return { title: cleaned, artist: '' };
}
