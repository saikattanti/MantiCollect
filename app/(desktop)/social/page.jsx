'use client';

import { Suspense, useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { api } from '@/lib/ipc.js';
import { Card, CardHeader, CapBadge, Spinner } from '@/components/ui.jsx';
import ProbeView from '@/components/ProbeView.jsx';

const SOCIAL_IDS = ['instagram', 'facebook', 'tiktok', 'x', 'reddit', 'threads', 'linkedin', 'pinterest', 'twitch'];

export default function SocialPage() {
  const [platforms, setPlatforms] = useState([]);
  useEffect(() => {
    api.platforms()
      .then((list) => setPlatforms(list.filter((p) => SOCIAL_IDS.includes(p.id))))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <header>
        <p className="overline">Download</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-t1">Social Platforms</h1>
        <p className="mt-1 max-w-2xl text-sm text-t2">
          Posts, reels, and videos from public content. Profile-wide collections require explicit authorization — where a platform needs it, you
          provide a cookies.txt from your own account (Settings → Authorization). Private accounts, messages, and gated content are never accessed.
        </p>
      </header>
      <Suspense
        fallback={
          <div className="flex items-center gap-3 py-10 text-sm text-t3">
            <Spinner /> Loading…
          </div>
        }
      >
        <ProbeView defaultCollectionMode />
      </Suspense>
      {platforms.length > 0 && (
        <Card>
          <CardHeader title="Capability overview" subtitle="From the live provider registry — partial means partial" icon={Share2} />
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 p-5">
            {platforms.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-t1">{p.name}</span>
                <span className="flex gap-1.5">
                  <CapBadge value={p.capabilities.video} />
                  <CapBadge value={p.capabilities.collections} />
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
