import fs from 'node:fs';

export const DEFAULT_SEGMENTS = 4;
export const MIN_SEGMENT_SIZE = 256 * 1024; // 256 KB minimum per segment
export const MAX_SEGMENTS = 8;

/**
 * Plan non-overlapping integer byte ranges for a file of totalBytes.
 * Every byte from 0 to totalBytes - 1 belongs to exactly one segment.
 *
 * @param {number} totalBytes - Positive integer representing total resource size.
 * @param {number} desiredConnections - Preferred concurrency (clamped between 1 and MAX_SEGMENTS).
 * @param {number} [minSegmentSize=MIN_SEGMENT_SIZE] - Optional minimum segment size in bytes.
 * @returns {Array<{index: number, start: number, end: number, total: number}>|null}
 */
export function planSegments(totalBytes, desiredConnections = DEFAULT_SEGMENTS, minSegmentSize = MIN_SEGMENT_SIZE) {
  if (
    typeof totalBytes !== 'number' ||
    !Number.isFinite(totalBytes) ||
    !Number.isInteger(totalBytes) ||
    totalBytes <= 0
  ) {
    return null;
  }

  if (desiredConnections != null) {
    const num = Number(desiredConnections);
    if (!Number.isFinite(num) || num <= 0) return null;
  }

  const conns = Math.min(MAX_SEGMENTS, Math.max(1, Math.floor(Number(desiredConnections) || DEFAULT_SEGMENTS)));
  
  // If file is smaller than minimum segment size or single connection requested, use single segment
  if (totalBytes < minSegmentSize || conns <= 1) {
    return [
      { index: 0, start: 0, end: totalBytes - 1, total: totalBytes }
    ];
  }

  // Calculate maximum segments feasible without segments being smaller than minSegmentSize
  const maxFeasible = Math.floor(totalBytes / minSegmentSize);
  const numSegments = Math.max(1, Math.min(conns, maxFeasible));

  if (numSegments <= 1) {
    return [
      { index: 0, start: 0, end: totalBytes - 1, total: totalBytes }
    ];
  }

  const baseSize = Math.floor(totalBytes / numSegments);
  const remainder = totalBytes % numSegments;

  const segments = [];
  let currentStart = 0;

  for (let i = 0; i < numSegments; i++) {
    // Distribute remainder 1 byte at a time to early segments
    const segmentSize = baseSize + (i < remainder ? 1 : 0);
    const segmentEnd = currentStart + segmentSize - 1;

    segments.push({
      index: i,
      start: currentStart,
      end: segmentEnd,
      total: segmentSize
    });

    currentStart = segmentEnd + 1;
  }

  // Verify core invariants
  if (segments[0].start !== 0) {
    throw new Error(`Segment plan invariant violated: first segment must start at 0 (got ${segments[0].start})`);
  }
  if (segments[segments.length - 1].end !== totalBytes - 1) {
    throw new Error(
      `Segment plan invariant violated: final segment must end at ${totalBytes - 1} (got ${segments[segments.length - 1].end})`
    );
  }

  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].end + 1 !== segments[i + 1].start) {
      throw new Error(`Segment plan gap/overlap between segment ${i} and ${i + 1}`);
    }
  }

  return segments;
}

/**
 * Returns the path on disk for an individual segment.
 */
export function segmentFilePath(basePartPath, index) {
  return `${basePartPath}.seg${index}`;
}

/**
 * Inspects existing segment files on disk to determine authoritative progress per segment.
 *
 * @param {string} basePartPath - Path to the parent .part file.
 * @param {Array<{index: number, start: number, end: number, total: number}>} plan - The planned segments.
 * @returns {Array<{index: number, start: number, end: number, total: number, downloaded: number, done: boolean, path: string}>}
 */
export function inspectSegments(basePartPath, plan) {
  if (!Array.isArray(plan)) return [];

  return plan.map((seg) => {
    const sPath = segmentFilePath(basePartPath, seg.index);
    let downloaded = 0;

    if (fs.existsSync(sPath)) {
      try {
        const stats = fs.statSync(sPath);
        downloaded = stats.size;
        // Corrupted segment larger than planned total: truncate to 0
        if (downloaded > seg.total) {
          try {
            fs.writeFileSync(sPath, Buffer.alloc(0));
          } catch {}
          downloaded = 0;
        }
      } catch {
        downloaded = 0;
      }
    }

    return {
      index: seg.index,
      start: seg.start,
      end: seg.end,
      total: seg.total,
      downloaded,
      done: downloaded === seg.total,
      path: sPath
    };
  });
}

/**
 * Cleans up all segment files associated with a base .part path.
 */
export function cleanupSegmentFiles(basePartPath, segmentsCount = MAX_SEGMENTS) {
  for (let i = 0; i < segmentsCount; i++) {
    const sPath = segmentFilePath(basePartPath, i);
    try {
      if (fs.existsSync(sPath)) fs.unlinkSync(sPath);
    } catch {}
  }
}
