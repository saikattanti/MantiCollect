import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  S3StorageProvider
} from '../electron/remoteStorage.js';
import {
  PutObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
} from '@aws-sdk/client-s3';

function createMockS3Client({
  onHeadBucket = async () => ({}),
  onHeadObject = async () => { throw new Error('NotFound'); },
  onPutObject = async (input) => {
    if (input.Body && typeof input.Body.resume === 'function') {
      input.Body.resume();
      await new Promise((r) => input.Body.on('end', r));
    }
    return { ETag: '"mock-etag"' };
  },
  onCreateMultipart = async () => ({ UploadId: 'mock-upload-123' }),
  onUploadPart = async (cmd) => ({ ETag: `"mock-part-etag-${cmd.PartNumber}"` }),
  onCompleteMultipart = async () => ({ Location: 'https://s3.mock/bucket/key' }),
  onAbortMultipart = async () => ({})
} = {}) {
  return {
    send: async (cmd, _opts) => {
      if (cmd instanceof HeadBucketCommand) return onHeadBucket(cmd.input);
      if (cmd instanceof HeadObjectCommand) return onHeadObject(cmd.input);
      if (cmd instanceof PutObjectCommand) return onPutObject(cmd.input);
      if (cmd instanceof CreateMultipartUploadCommand) return onCreateMultipart(cmd.input);
      if (cmd instanceof UploadPartCommand) return onUploadPart(cmd.input);
      if (cmd instanceof CompleteMultipartUploadCommand) return onCompleteMultipart(cmd.input);
      if (cmd instanceof AbortMultipartUploadCommand) return onAbortMultipart(cmd.input);
      throw new Error(`Unhandled mock command: ${cmd.constructor.name}`);
    }
  };
}

test('s3: provider validation requires bucket name', () => {
  const provider = new S3StorageProvider({ bucket: null });
  assert.throws(() => provider.createClient(), /Bucket name is required/i);
});

test('s3: rejects embedded credentials in endpoint URL (SSRF prevention)', async () => {
  const provider = new S3StorageProvider({
    bucket: 'test-bucket',
    endpoint: 'https://user:pass@s3.example.com'
  });
  await assert.rejects(
    async () => provider.validateEndpoint(),
    /Embedded credentials in S3 endpoint URL are prohibited/i
  );
});

test('s3: rejects insecure http unless explicitly allowed', async () => {
  const provider = new S3StorageProvider({
    bucket: 'test-bucket',
    endpoint: 'http://s3.example.com',
    allowInsecureHttp: false
  });
  await assert.rejects(
    async () => provider.validateEndpoint(),
    /Insecure HTTP is not permitted/i
  );

  const allowedProvider = new S3StorageProvider({
    bucket: 'test-bucket',
    endpoint: 'http://localhost:9000',
    allowInsecureHttp: true,
    allowLocalNetwork: true
  });
  await allowedProvider.validateEndpoint(); // should not throw
});

test('s3: testConnection returns success when HeadBucket succeeds', async () => {
  let headBucketCalled = false;
  const mockClient = createMockS3Client({
    onHeadBucket: async (input) => {
      headBucketCalled = true;
      assert.equal(input.Bucket, 'my-vault-bucket');
      return {};
    }
  });

  const provider = new S3StorageProvider({
    bucket: 'my-vault-bucket',
    clientFactory: () => mockClient
  });

  const res = await provider.testConnection();
  assert.equal(res.ok, true);
  assert.equal(headBucketCalled, true);
  assert.match(res.message, /Successfully connected/i);
});

test('s3: testConnection maps 403 / AccessDenied to clear error without secret leakage', async () => {
  const mockClient = createMockS3Client({
    onHeadBucket: async () => {
      const err = new Error('Access Denied to my-vault-bucket');
      err.name = 'AccessDenied';
      throw err;
    }
  });

  const provider = new S3StorageProvider({
    bucket: 'my-vault-bucket',
    accessKeyId: 'AKIA_SECRET_123',
    secretAccessKey: 'VERY_SECRET_KEY_NEVER_LEAK',
    clientFactory: () => mockClient
  });

  const res = await provider.testConnection();
  assert.equal(res.ok, false);
  assert.match(res.message, /Access denied/i);
  assert.ok(!res.message.includes('VERY_SECRET_KEY_NEVER_LEAK'));
});

test('s3: single-part streaming upload for files < 10MB with size verification', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's3-upload-test-'));
  const testFile = path.join(tmpDir, 'test_media_日本語.mp4');
  const fileContent = Buffer.alloc(50 * 1024, 0xfe); // 50 KB
  fs.writeFileSync(testFile, fileContent);

  let putCalled = false;
  let putKey = null;
  let putBytes = 0;

  const mockClient = createMockS3Client({
    onPutObject: async (input) => {
      putCalled = true;
      putKey = input.Key;
      putBytes = input.ContentLength;
      if (input.Body && typeof input.Body.resume === 'function') {
        input.Body.resume();
        await new Promise((r) => input.Body.on('end', r));
      }
      return { ETag: '"mock-etag"' };
    },
    onHeadObject: async (input) => {
      assert.equal(input.Key, putKey);
      return { ContentLength: fileContent.length };
    }
  });

  const provider = new S3StorageProvider({
    bucket: 'my-media-bucket',
    keyPrefix: 'backups/2026',
    clientFactory: () => mockClient
  });

  const progressEvents = [];
  const res = await provider.transferFile({
    sourcePath: testFile,
    targetSubdir: 'videos',
    onProgress: (p) => progressEvents.push(p)
  });

  assert.equal(res.ok, true);
  assert.equal(res.bytesTransferred, 50 * 1024);
  assert.equal(putCalled, true);
  assert.equal(putKey, 'backups/2026/videos/test_media_日本語.mp4');
  assert.equal(putBytes, 50 * 1024);
  assert.ok(progressEvents.length > 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('s3: multipart upload for large files (>= 10MB) with parts verification and progress', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's3-mp-test-'));
  const testFile = path.join(tmpDir, 'large_media.mkv');
  // 12 MB file (triggers multipart threshold >= 10MB)
  const fileSize = 12 * 1024 * 1024;
  const chunk = Buffer.alloc(1024 * 1024, 0x55);
  const fd = fs.openSync(testFile, 'w');
  for (let i = 0; i < 12; i++) {
    fs.writeSync(fd, chunk);
  }
  fs.closeSync(fd);

  let mpCreated = false;
  let mpCompleted = false;
  const uploadedParts = [];

  const mockClient = createMockS3Client({
    onCreateMultipart: async (input) => {
      mpCreated = true;
      assert.equal(input.Bucket, 'mp-bucket');
      return { UploadId: 'test-mp-id-456' };
    },
    onUploadPart: async (input) => {
      uploadedParts.push({ PartNumber: input.PartNumber, size: input.ContentLength });
      return { ETag: `"etag-${input.PartNumber}"` };
    },
    onCompleteMultipart: async (input) => {
      mpCompleted = true;
      assert.equal(input.MultipartUpload.Parts.length, 2); // 8MB + 4MB
      return {};
    },
    onHeadObject: async () => {
      return { ContentLength: fileSize };
    }
  });

  const provider = new S3StorageProvider({
    bucket: 'mp-bucket',
    clientFactory: () => mockClient
  });

  const progressEvents = [];
  const res = await provider.transferFile({
    sourcePath: testFile,
    onProgress: (p) => progressEvents.push(p)
  });

  assert.equal(res.ok, true);
  assert.equal(res.bytesTransferred, fileSize);
  assert.equal(mpCreated, true);
  assert.equal(mpCompleted, true);
  assert.equal(uploadedParts.length, 2);
  assert.equal(uploadedParts[0].size, 8 * 1024 * 1024);
  assert.equal(uploadedParts[1].size, 4 * 1024 * 1024);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('s3: multipart upload aborts and cleans up on cancellation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's3-abort-test-'));
  const testFile = path.join(tmpDir, 'cancel_me.mp4');
  const fileSize = 11 * 1024 * 1024;
  const chunk = Buffer.alloc(1024 * 1024, 0x66);
  const fd = fs.openSync(testFile, 'w');
  for (let i = 0; i < 11; i++) {
    fs.writeSync(fd, chunk);
  }
  fs.closeSync(fd);

  let abortCalled = false;
  const controller = new AbortController();

  const mockClient = createMockS3Client({
    onCreateMultipart: async () => {
      // Abort right after creation
      controller.abort();
      return { UploadId: 'abort-id-999' };
    },
    onAbortMultipart: async (input) => {
      abortCalled = true;
      assert.equal(input.UploadId, 'abort-id-999');
      return {};
    }
  });

  const provider = new S3StorageProvider({
    bucket: 'mp-bucket',
    clientFactory: () => mockClient
  });

  await assert.rejects(
    async () => provider.transferFile({
      sourcePath: testFile,
      abortSignal: controller.signal
    }),
    /aborted/i
  );

  assert.equal(abortCalled, true);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('s3: capability matrix is honest and supported', () => {
  const provider = new S3StorageProvider({ bucket: 'test' });
  const caps = provider.getCapabilities();

  assert.equal(caps.supportsStreaming, true);
  assert.equal(caps.supportsCancellation, true);
  assert.equal(caps.supportsMultipart, true);
  assert.equal(caps.supportsMultipartResume, true);
  assert.equal(caps.supportsSizeVerification, true);
  assert.equal(caps.supportsChecksumVerification, true);
});
