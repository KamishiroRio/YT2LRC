import type { Schema } from '../../data/resource';
import { searchItunes } from './itunes';
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

  console.log('preview: title=', title, '| artist=', artist);

  // utanet scraping is blocked from the datacenter IP (and slow), so lyrics are
  // entered manually in the UI. Skip the scrape to keep preview fast.
  return {
    title,
    artist,
    lyrics: '',
    candidates: [],
  };
};
