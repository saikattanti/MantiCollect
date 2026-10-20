'use client';

import ProbeView from './ProbeView.jsx';

const TITLES = {
  video: {
    overline: 'Download',
    title: 'Video Downloader',
    sub: 'Video-first view. Formats are exactly what the source reports; audio+video streams are merged with FFmpeg when the source splits them.'
  },
  audio: {
    overline: 'Download',
    title: 'Audio Downloader',
    sub: 'Audio-first view. Distinguishes original audio streams (no re-encode) from extracted/converted audio — conversion never improves source quality.'
  },
  image: {
    overline: 'Download',
    title: 'Image Downloader',
    sub: 'Image-first view. Direct image links and posts/albums that expose images. Direct downloads work for any publicly reachable media file.'
  }
};

export default function MediaPageInner({ kind }) {
  const t = TITLES[kind];
  return (
    <div className="space-y-5">
      <header>
        <p className="overline">{t.overline}</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">{t.title}</h1>
        <p className="mt-1 text-sm text-t2">{t.sub}</p>
      </header>
      <ProbeView focusKind={kind} />
    </div>
  );
}
