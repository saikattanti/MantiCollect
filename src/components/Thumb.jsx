'use client';

import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { api } from '@/lib/ipc.js';
import { Skeleton } from './ui/skeleton.jsx';

// Module-level cache: url -> data: URI ('' = failed). In-flight dedupe so
// the same thumbnail is fetched once no matter how many cards render it.
const cache = new Map();
const inflight = new Map();

function loadRemote(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (inflight.has(url)) return inflight.get(url);
  const p = api
    .mediaThumbnail(url)
    .then((r) => (r && r.uri ? r.uri : ''))
    .catch(() => '')
    .then((uri) => {
      cache.set(url, uri);
      inflight.delete(url);
      return uri;
    });
  inflight.set(url, p);
  return p;
}

/**
 * Media thumbnail with real loading behavior:
 *  - remote http(s) URLs are proxied through the main process (CSP allows
 *    only same-origin/data/blob images in the renderer)
 *  - data: URIs render directly
 *  - skeleton while loading, fallback icon on error/empty
 */
export default function Thumb({ src, alt = '', className = '', style }) {
  const isRemote = !!src && !src.startsWith('data:');
  const [state, setState] = useState({ phase: isRemote ? 'loading' : src ? 'ok' : 'empty', uri: isRemote ? null : src });

  useEffect(() => {
    if (!src) {
      setState({ phase: 'empty', uri: null });
      return;
    }
    if (!src.startsWith('data:')) {
      setState({ phase: 'loading', uri: null });
      let live = true;
      loadRemote(src).then((uri) => {
        if (live) setState({ phase: uri ? 'ok' : 'error', uri });
      });
      return () => {
        live = false;
      };
    }
    setState({ phase: 'ok', uri: src });
  }, [src]);

  if (!src || state.phase === 'error' || state.phase === 'empty') {
    return (
      <div className={`flex items-center justify-center overflow-hidden border border-line bg-surface-2/60 select-none ${className}`} style={style}>
        <ImageOff className="text-t3/70" style={{ width: 18, height: 18 }} />
      </div>
    );
  }
  if (state.phase === 'loading') {
    return <Skeleton className={`overflow-hidden border border-line ${className}`} style={style} />;
  }
  return (
    <img
      src={state.uri}
      alt={alt}
      className={`overflow-hidden border border-line/80 object-cover shadow-xs ${className}`}
      style={style}
      referrerPolicy="no-referrer"
      loading="lazy"
    />
  );
}
