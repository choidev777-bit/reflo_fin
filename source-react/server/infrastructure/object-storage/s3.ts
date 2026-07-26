import { createHash } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type S3Config = {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

declare global {
  var __refloS3Client: S3Client | undefined;
  var __refloS3PublicClient: S3Client | undefined;
  var __refloS3BucketReady: Promise<void> | undefined;
}

function config(): S3Config {
  return {
    endpoint: process.env.REFLO_S3_ENDPOINT?.trim() || "http://127.0.0.1:9000",
    publicEndpoint:
      process.env.REFLO_S3_PUBLIC_ENDPOINT?.trim() ||
      process.env.REFLO_S3_ENDPOINT?.trim() ||
      "http://127.0.0.1:9000",
    region: process.env.REFLO_S3_REGION?.trim() || "us-east-1",
    bucket: process.env.REFLO_S3_BUCKET?.trim() || "reflo-local",
    accessKeyId: process.env.REFLO_S3_ACCESS_KEY?.trim() || "reflo_local",
    secretAccessKey:
      process.env.REFLO_S3_SECRET_KEY?.trim() || "reflo_local_change_me",
  };
}

function makeClient(endpoint: string): S3Client {
  const value = config();
  return new S3Client({
    endpoint,
    region: value.region,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: value.accessKeyId,
      secretAccessKey: value.secretAccessKey,
    },
  });
}

export function getObjectStoreClient(): S3Client {
  globalThis.__refloS3Client ??= makeClient(config().endpoint);
  return globalThis.__refloS3Client;
}

function getPublicObjectStoreClient(): S3Client {
  globalThis.__refloS3PublicClient ??= makeClient(config().publicEndpoint);
  return globalThis.__refloS3PublicClient;
}

export function objectStoreBucket(): string {
  return config().bucket;
}

export async function ensureObjectStoreBucket(): Promise<void> {
  globalThis.__refloS3BucketReady ??= (async () => {
    const client = getObjectStoreClient();
    const bucket = objectStoreBucket();
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })();
  return globalThis.__refloS3BucketReady;
}

export async function createUploadUrl(input: {
  objectKey: string;
  mediaType: string;
  filename: string;
  checksumSha256: string | null;
  expiresInSeconds: number;
}): Promise<{ uploadUrl: string; headers: Record<string, string> }> {
  await ensureObjectStoreBucket();
  // Keep the signed request deliberately small. The database is the source of
  // truth for filename/checksum and completion re-reads the object to verify
  // size, media type, and SHA-256 before promoting it out of quarantine.
  const command = new PutObjectCommand({
    Bucket: objectStoreBucket(),
    Key: input.objectKey,
  });
  const uploadUrl = await getSignedUrl(getPublicObjectStoreClient(), command, {
    expiresIn: input.expiresInSeconds,
  });
  const headers: Record<string, string> = {
    "Content-Type": input.mediaType,
  };
  return { uploadUrl, headers };
}

async function hashBody(body: NonNullable<GetObjectCommandOutput["Body"]>): Promise<{
  sha256: string;
  byteSize: number;
}> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const value of body as AsyncIterable<Uint8Array>) {
    const chunk = Buffer.from(value);
    byteSize += chunk.byteLength;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), byteSize };
}

export async function verifyUploadedObject(input: {
  objectKey: string;
  expectedByteSize: number;
  expectedMediaType: string;
  expectedSha256: string | null;
  expectedMetadata?: Record<string, string>;
}): Promise<{
  sha256: string;
  byteSize: number;
  mediaType: string;
  objectVersion: string;
}> {
  await ensureObjectStoreBucket();
  const client = getObjectStoreClient();
  const bucket = objectStoreBucket();
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: input.objectKey }),
  );
  const contentLength = Number(head.ContentLength ?? -1);
  if (contentLength !== input.expectedByteSize) {
    throw new Error("OBJECT_SIZE_MISMATCH");
  }
  const mediaType = head.ContentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== input.expectedMediaType.toLowerCase()) {
    throw new Error("OBJECT_MEDIA_TYPE_MISMATCH");
  }
  for (const [key, value] of Object.entries(input.expectedMetadata ?? {})) {
    if (head.Metadata?.[key.toLowerCase()] !== value) {
      throw new Error("OBJECT_METADATA_MISMATCH");
    }
  }
  const object = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: input.objectKey }),
  );
  if (!object.Body) throw new Error("OBJECT_BODY_MISSING");
  const measured = await hashBody(object.Body);
  if (
    measured.byteSize !== contentLength ||
    (input.expectedSha256 && measured.sha256 !== input.expectedSha256)
  ) {
    throw new Error("OBJECT_CHECKSUM_MISMATCH");
  }
  return {
    ...measured,
    mediaType,
    objectVersion: head.VersionId ?? head.ETag?.replaceAll('"', "") ?? "null",
  };
}

export async function createDownloadUrl(
  objectKey: string,
  expiresInSeconds = 300,
): Promise<string> {
  await ensureObjectStoreBucket();
  return getSignedUrl(
    getPublicObjectStoreClient(),
    new GetObjectCommand({ Bucket: objectStoreBucket(), Key: objectKey }),
    { expiresIn: expiresInSeconds },
  );
}

export async function createWorkerDownloadUrl(
  objectKey: string,
  expiresInSeconds = 300,
): Promise<string> {
  await ensureObjectStoreBucket();
  const endpoint =
    process.env.REFLO_S3_WORKER_ENDPOINT?.trim() ||
    "http://host.docker.internal:9000";
  return getSignedUrl(
    makeClient(endpoint),
    new GetObjectCommand({ Bucket: objectStoreBucket(), Key: objectKey }),
    { expiresIn: expiresInSeconds },
  );
}

export async function readObjectBytes(objectKey: string): Promise<Buffer> {
  await ensureObjectStoreBucket();
  const result = await getObjectStoreClient().send(
    new GetObjectCommand({ Bucket: objectStoreBucket(), Key: objectKey }),
  );
  if (!result.Body) throw new Error("OBJECT_BODY_MISSING");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function putImmutableObject(input: {
  objectKey: string;
  body: Uint8Array | string;
  mediaType: string;
  metadata?: Record<string, string>;
}): Promise<{ objectVersion: string }> {
  await ensureObjectStoreBucket();
  const result = await getObjectStoreClient().send(
    new PutObjectCommand({
      Bucket: objectStoreBucket(),
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.mediaType,
      Metadata: input.metadata,
      IfNoneMatch: "*",
    }),
  );
  return {
    objectVersion: result.VersionId ?? result.ETag?.replaceAll('"', "") ?? "null",
  };
}

export async function deleteObject(objectKey: string): Promise<void> {
  await ensureObjectStoreBucket();
  await getObjectStoreClient().send(
    new DeleteObjectCommand({ Bucket: objectStoreBucket(), Key: objectKey }),
  );
}
