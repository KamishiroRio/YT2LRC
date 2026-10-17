import type { Schema } from '../../data/resource';
import { searchItunes } from './itunes';
import { fetchUtaNetLyrics, pickBestCandidate, searchUtaNet } from './utanet';
import {
  fetchYouTubeOEmbed,
  isYouTubeUrl,
  parseYouTubeTitle,
} from './youtube';

export const handler: Schema['preview']['functionHandler'] = async (event) => {
  const youtubeUrl = event.arguments.youtubeUrl?.trim();
  if (!youtubeUrl || !isYouTubeUrl(youtubeUrl)) {
    throw new Error('A valid YouTube URL is required.');
  }

  const oembed = await fetchYouTubeOEmbed(youtubeUrl);
  const parsed = parseYouTubeTitle(oembed.rawTitle);

  let title = parsed.title || oembed.rawTitle;
  let artist = parsed.artist;

  const itunesQuery = [artist, title].filter(Boolean).join(' ');
  const itunes = await searchItunes(itunesQuery).catch(() => null);
  if (itunes) {
    title = itunes.title || title;
    artist = itunes.artist || artist;
  }

  if (!artist) {
    artist = oembed.channel;
  }

  const searchKeyword = title || itunesQuery;
  console.log('preview: title=', title, '| artist=', artist, '| keyword=', searchKeyword);

  // Search with "title + artist" first for more accurate matches, then fall back to title only.
  let candidates = (title && artist)
    ? await searchUtaNet(`${title} ${artist}`).catch((e) => {
        console.error('preview: searchUtaNet(title+artist) failed:', e instanceof Error ? e.message : e);
        return [];
      })
    : [];
  if (candidates.length === 0) {
    candidates = await searchUtaNet(searchKeyword).catch((e) => {
      console.error('preview: searchUtaNet(title) failed:', e instanceof Error ? e.message : e);
      return [];
    });
  }

  console.log('preview: candidates count =', candidates.length, '| sample =', JSON.stringify(candidates.slice(0, 3)));

  const best = pickBestCandidate(candidates, title, artist);
  const lyrics = best
    ? await fetchUtaNetLyrics(best.url).catch((e) => {
        console.error('preview: fetchUtaNetLyrics failed:', e instanceof Error ? e.message : e);
        return '';
      })
    : '';

  return {
    title,
    artist,
    lyrics,
    candidates,
  };
};
