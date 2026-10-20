export const MAX_MESSAGE_SIZE = 1024 * 1024; // 1 MB per Chromium Native Messaging spec

/**
 * Encodes a JavaScript object into a Chromium Native Messaging length-prefixed frame.
 * Format: 4-byte unsigned integer (little-endian) representing UTF-8 byte length,
 * followed by the UTF-8 JSON payload.
 */
export function encodeMessage(msg) {
  const json = JSON.stringify(msg);
  const bytes = Buffer.from(json, 'utf8');
  if (bytes.length > MAX_MESSAGE_SIZE) {
    throw new Error(`Message size ${bytes.length} exceeds maximum allowed (${MAX_MESSAGE_SIZE} bytes)`);
  }
  const frame = Buffer.allocUnsafe(4 + bytes.length);
  frame.writeUInt32LE(bytes.length, 0);
  bytes.copy(frame, 4);
  return frame;
}

/**
 * Creates a stateful stream chunk decoder for Chromium Native Messaging protocol.
 * Correctly handles partial chunks, multiple frames in a single chunk, and malformed inputs.
 *
 * @param {Function} onMessage - Called with parsed JSON message
 * @param {Function} onError - Called when an error occurs during decoding
 */
export function createNativeMessageDecoder(onMessage, onError = () => {}) {
  let accumulator = Buffer.alloc(0);

  return function handleChunk(chunk) {
    if (!chunk || chunk.length === 0) return;
    accumulator = Buffer.concat([accumulator, chunk]);

    while (accumulator.length >= 4) {
      const msgLen = accumulator.readUInt32LE(0);

      if (msgLen > MAX_MESSAGE_SIZE) {
        accumulator = Buffer.alloc(0);
        onError(new Error(`Oversized message: ${msgLen} bytes exceeds 1MB limit`));
        return;
      }

      // Check if complete message is present
      if (accumulator.length < 4 + msgLen) {
        // Need more data from stream
        break;
      }

      const msgBytes = accumulator.subarray(4, 4 + msgLen);
      accumulator = accumulator.subarray(4 + msgLen);

      try {
        const text = msgBytes.toString('utf8');
        const parsed = JSON.parse(text);
        onMessage(parsed);
      } catch (err) {
        onError(new Error(`Malformed JSON in native message: ${err.message}`));
      }
    }
  };
}
