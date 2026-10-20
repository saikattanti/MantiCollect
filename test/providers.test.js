import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider, allProviders, capabilityMatrix } from '../electron/providers/registry.js';

const SAMPLES = [
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
  ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
  ['https://m.youtube.com/watch?v=abc12345', 'youtube'],
  ['https://music.youtube.com/watch?v=V-8t-DnVHn0', 'youtube'],
  ['https://www.instagram.com/p/Cxyz123abc/', 'instagram'],
  ['https://www.instagram.com/reel/AbC123/', 'instagram'],
  ['https://www.facebook.com/watch?v=1234567890', 'facebook'],
  ['https://fb.watch/jAbCdEf/', 'facebook'],
  ['https://www.tiktok.com/@user/video/1234567890', 'tiktok'],
  ['https://x.com/user/status/1234567890', 'x'],
  ['https://twitter.com/user/status/1234567890', 'x'],
  ['https://www.reddit.com/r/videos/comments/abc123/title/', 'reddit'],
  ['https://vimeo.com/123456789', 'vimeo'],
  ['https://www.dailymotion.com/video/x8abcde', 'dailymotion'],
  ['https://dai.ly/x8abcde', 'dailymotion'],
  ['https://www.pinterest.com/pin/1234567890/', 'pinterest'],
  ['https://pin.it/abC123', 'pinterest'],
  ['https://soundcloud.com/artist/track-name', 'soundcloud'],
  ['https://www.twitch.tv/videos/1234567890', 'twitch'],
  ['https://artist.bandcamp.com/album/some-album', 'bandcamp'],
  ['https://www.flickr.com/photos/user/1234567890/', 'flickr'],
  ['https://blog.example.tumblr.com/post/123456', 'tumblr'],
  ['https://www.threads.com/@user/post/AbC123', 'threads'],
  ['https://www.linkedin.com/posts/somepost-1234567890', 'linkedin']
];

test('resolveProvider maps sample URLs to the right platform', () => {
  for (const [url, expected] of SAMPLES) {
    const p = resolveProvider(url);
    assert.ok(p, `no provider for ${url}`);
    assert.equal(p.id, expected, `${url} -> ${p.id}, expected ${expected}`);
  }
});

test('direct file URLs win over host patterns', () => {
  const p = resolveProvider('https://www.youtube.com/ab/cd/video.mp4');
  assert.equal(p.id, 'direct');
  const p2 = resolveProvider('https://cdn.example.com/pic.png?sig=123');
  assert.equal(p2.id, 'direct');
});

test('unrecognized http(s) URLs fall back to generic', () => {
  const p = resolveProvider('https://some-random-site.example/media/123');
  assert.ok(p, 'expected generic fallback');
  assert.equal(p.id, 'generic');
});

test('invalid URLs resolve to null', () => {
  assert.equal(resolveProvider('not a url'), null);
  assert.equal(resolveProvider(''), null);
});

test('capability matrix is complete and honest', () => {
  const matrix = capabilityMatrix();
  assert.ok(matrix.length >= 17, `expected >=17 providers, got ${matrix.length}`);
  const ops = ['metadata', 'video', 'audio', 'images', 'collections', 'account_export'];
  const valid = new Set(['supported', 'partial', 'requires_auth', 'unsupported']);
  for (const row of matrix) {
    assert.ok(row.id && row.name, 'row needs id/name');
    for (const op of ops) {
      assert.ok(valid.has(row.capabilities[op]), `${row.id}.${op} = ${row.capabilities[op]} is not a valid capability value`);
    }
    // no provider may claim full account export
    assert.notEqual(row.capabilities.account_export, 'supported', `${row.id} must not claim account export`);
    assert.ok(['untested', 'tested', 'manual'].includes(row.testStatus), `bad testStatus on ${row.id}`);
  }
  // platforms that require auth for collections must say so (not 'supported')
  const ig = matrix.find((r) => r.id === 'instagram');
  assert.equal(ig.capabilities.collections, 'requires_auth');
});

test('all providers implement the required interface', () => {
  for (const p of allProviders()) {
    assert.equal(typeof p.canHandleUrl, 'function');
    assert.equal(typeof p.getCapabilities, 'function');
    if (p.isYtDlp || p.isGeneric) {
      assert.equal(typeof p.getMetadata, 'function');
      assert.equal(typeof p.startDownload, 'function');
    }
    if (p.isDirect) {
      assert.equal(typeof p.getMetadata, 'function');
      assert.equal(typeof p.download, 'function');
    }
  }
});
