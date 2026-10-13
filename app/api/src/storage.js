import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// File storage for attachments. The bucket stays private: uploads and downloads go
// through the API, which checks that the file belongs to the signed-in user.
export function createS3Storage({ bucket, region, endpoint, accessKeyId, secretAccessKey }) {
  const client = new S3Client({
    region,
    endpoint,
    // MinIO and most S3-compatible servers need path-style URLs (host/bucket/key).
    forcePathStyle: Boolean(endpoint),
    // Without explicit keys the SDK falls back to its default chain (env, role, profile).
    credentials: accessKeyId ? { accessKeyId, secretAccessKey } : undefined,
  });

  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return { body: object.Body, size: object.ContentLength, contentType: object.ContentType };
    },
    async remove(keys) {
      if (keys.length === 0) return;
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    },
  };
}
