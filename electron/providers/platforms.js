/**
 * Declarative platform registry for yt-dlp-backed providers.
 *
 * Capability values are HONEST claims about what yt-dlp extractors can do
 * with public content (plus cookies.txt authorization where noted):
 *   supported     — works for public content
 *   partial       — works in some cases (see notes)
 *   requires_auth — needs a user-provided cookies.txt (explicit opt-in in Settings)
 *   unsupported   — not available
 *
 * testStatus: 'untested' until a real integration run has been performed.
 * Never flip these without actually testing.
 */
export const PLATFORMS = [
  {
    id: 'youtube',
    name: 'YouTube',
    host: 'youtube.com',
    patterns: [
      /^https?:\/\/(?:[a-z]{1,3}\.)?(?:www\.)?(?:music\.youtube\.com|youtube\.com|youtube-nocookie\.com)\/(?:watch\?|shorts\/|live\/|embed\/|v\/|playlist\?|channel\/|@|video\/)/i,
      /^https?:\/\/youtu\.be\/[A-Za-z0-9_-]{4,}/i
    ],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'supported',
      images: 'partial',
      collections: 'supported',
      account_export: 'unsupported'
    },
    auth: { needs: 'none for public content', details: 'Age-restricted and members-only content require cookies.txt from an authorized Google account.' },
    notes: ['Images = thumbnails only.', 'Playlists: select items or download all.', 'Format list comes straight from the server report; nothing is fabricated.', 'Verified 2026-10-19 (e2e): probe + single-item 144p download of a public video. Playlist/collection path not yet exercised.'],
    testStatus: 'tested'
  },
  {
    id: 'instagram',
    name: 'Instagram',
    host: 'instagram.com',
    patterns: [/^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]{1,30}\/(?:p|reel|tv)\/|reel\/|p\/)/i],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'partial',
      images: 'supported',
      collections: 'requires_auth',
      account_export: 'unsupported'
    },
    auth: { needs: 'public posts and reels only', details: 'Profile-wide collections require cookies.txt from an authorized Instagram account. Media from private accounts is never accessible.' },
    notes: ['Audio = extraction from video (re-encoded).', 'Multi-image posts supported.'],
    testStatus: 'untested'
  },
  {
    id: 'facebook',
    name: 'Facebook',
    host: 'facebook.com',
    patterns: [/^https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch|fb\.com)\/.+/i],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'partial',
      images: 'partial',
      collections: 'requires_auth',
      account_export: 'unsupported'
    },
    auth: { needs: 'public videos and photos', details: 'Pages, groups, and profile collections require cookies.txt from an authorized account.' },
    notes: [],
    testStatus: 'untested'
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    host: 'tiktok.com',
    patterns: [/^https?:\/\/(?:www\.|m\.|vm\.)?tiktok\.com\/.+/i],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'supported',
      images: 'partial',
      collections: 'requires_auth',
      account_export: 'unsupported'
    },
    auth: { needs: 'public videos', details: 'Profile collections require cookies.txt from an authorized account.' },
    notes: ['Audio = original audio track where the server exposes it, otherwise extracted from video.'],
    testStatus: 'untested'
  },
  {
    id: 'x',
    name: 'X (Twitter)',
    host: 'x.com',
    patterns: [/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/(?!intent\/).+/i],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'partial',
      images: 'supported',
      collections: 'requires_auth',
      account_export: 'unsupported'
    },
    auth: { needs: 'public posts', details: 'Profile timelines require cookies.txt; the X extractor is frequently rate-limited.' },
    notes: [],
    testStatus: 'untested'
  },
  {
    id: 'reddit',
    name: 'Reddit',
    host: 'reddit.com',
    patterns: [/^https?:\/\/(?:www\.|old\.|np\.)?reddit\.com\/.+/i],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'partial',
      images: 'supported',
      collections: 'partial',
      account_export: 'unsupported'
    },
    auth: { needs: 'public posts', details: 'Most Reddit media is public; some subreddits gate content.' },
    notes: ['Collections = image/video sets inside a single post.'],
    testStatus: 'untested'
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    host: 'vimeo.com',
    patterns: [/^https?:\/\/(?:www\.|player\.)?vimeo\.com\/.+/i],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'supported',
      images: 'partial',
      collections: 'partial',
      account_export: 'unsupported'
    },
    auth: { needs: 'public videos', details: 'Private and premium content requires cookies.txt.' },
    notes: ['Collections = public channels and shows.'],
    testStatus: 'untested'
  },
  {
    id: 'dailymotion',
    name: 'Dailymotion',
    host: 'dailymotion.com',
    patterns: [/^https?:\/\/(?:www\.|dai\.ly\.)?(?:dailymotion\.com)\/.+/i, /^https?:\/\/dai\.ly\/[A-Za-z0-9]+/i],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'supported',
      images: 'partial',
      collections: 'partial',
      account_export: 'unsupported'
    },
    auth: { needs: 'none for public content' },
    notes: [],
    testStatus: 'untested'
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    host: 'pinterest.com',
    patterns: [/^https?:\/\/(?:www\.)?pinterest\.com\/.+/i, /^https?:\/\/pin\.it\/[A-Za-z0-9]+/i],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'unsupported',
      images: 'supported',
      collections: 'partial',
      account_export: 'unsupported'
    },
    auth: { needs: 'public pins and boards' },
    notes: ['Collections = public boards.'],
    testStatus: 'untested'
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    host: 'soundcloud.com',
    patterns: [/^https?:\/\/(?:www\.)?soundcloud\.com\/.+/i],
    capabilities: {
      metadata: 'supported',
      video: 'unsupported',
      audio: 'supported',
      images: 'unsupported',
      collections: 'supported',
      account_export: 'unsupported'
    },
    auth: { needs: 'public tracks, playlists, and profiles' },
    notes: ['Streams only (no original files); quality is limited to what the server serves.'],
    testStatus: 'untested'
  },
  {
    id: 'twitch',
    name: 'Twitch',
    host: 'twitch.tv',
    patterns: [/^https?:\/\/(?:www\.)?twitch\.tv\/.+/i],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'partial',
      images: 'partial',
      collections: 'partial',
      account_export: 'unsupported'
    },
    auth: { needs: 'public VODs and clips' },
    notes: ['Live channels are recorded continuously while downloading; cancel to stop.', 'Collections = channel VOD lists where public.'],
    testStatus: 'untested'
  },
  {
    id: 'bandcamp',
    name: 'Bandcamp',
    host: 'bandcamp.com',
    patterns: [/^https?:\/\/[a-z0-9][a-z0-9-]*\.bandcamp\.com\/.+/i, /^https?:\/\/(?:bandcamp\.com|bandcamp\.co)\/(album|track)\/.+/i],
    capabilities: {
      metadata: 'supported',
      video: 'unsupported',
      audio: 'supported',
      images: 'partial',
      collections: 'supported',
      account_export: 'unsupported'
    },
    auth: { needs: 'free/public tracks and albums' },
    notes: ['Paid tracks are not downloaded — paywalls are respected.'],
    testStatus: 'untested'
  },
  {
    id: 'flickr',
    name: 'Flickr',
    host: 'flickr.com',
    patterns: [/^https?:\/\/(?:www\.)?flickr\.com\/.+/i],
    capabilities: {
      metadata: 'supported',
      video: 'partial',
      audio: 'unsupported',
      images: 'supported',
      collections: 'partial',
      account_export: 'unsupported'
    },
    auth: { needs: 'public photos, sets, and user pages' },
    notes: ['Downloads the largest publicly served size.'],
    testStatus: 'untested'
  },
  {
    id: 'tumblr',
    name: 'Tumblr',
    host: 'tumblr.com',
    patterns: [/^https?:\/\/(?:[a-z0-9][a-z0-9-]*\.)+tumblr\.com\/.+/i],
    capabilities: {
      metadata: 'partial',
      video: 'partial',
      audio: 'partial',
      images: 'partial',
      collections: 'unsupported',
      account_export: 'unsupported'
    },
    auth: { needs: 'public posts' },
    notes: ['Limited extractor; some post types are not supported.'],
    testStatus: 'untested'
  },
  {
    id: 'threads',
    name: 'Threads',
    host: 'threads.com',
    patterns: [/^https?:\/\/(?:www\.)?threads\.com\/.+/i],
    capabilities: {
      metadata: 'supported',
      video: 'supported',
      audio: 'partial',
      images: 'supported',
      collections: 'unsupported',
      account_export: 'unsupported'
    },
    auth: { needs: 'public posts' },
    notes: [],
    testStatus: 'untested'
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    host: 'linkedin.com',
    patterns: [/^https?:\/\/(?:www\.)?linkedin\.com\/.+/i],
    capabilities: {
      metadata: 'partial',
      video: 'partial',
      audio: 'unsupported',
      images: 'partial',
      collections: 'unsupported',
      account_export: 'unsupported'
    },
    auth: { needs: 'public posts only', details: 'Most LinkedIn content sits behind login; no bulk access is provided.' },
    notes: ['Only a small subset of public content is downloadable.'],
    testStatus: 'untested'
  }
];
