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
  let candidates = await searchUtaNet(searchKeyword).catch(() => []);
  if (candidates.length === 0 && artist && title) {
    candidates = await searchUtaNet(`${title} ${artist}`).catch(() => []);
  }

  const best = pickBestCandidate(candidates, title, artist);
  const lyrics = best ? await fetchUtaNetLyrics(best.url).catch(() => '') : '';

  return {
    title,
    artist,
    lyrics,
    candidates,
  };
};
