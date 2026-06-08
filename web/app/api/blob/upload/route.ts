/**
 * POST /api/blob/upload
 *
 * Two-phase client-side upload handler for Vercel Blob.
 * The browser calls this route to get a client token, then uploads
 * directly to Blob storage — bypassing the 4.5 MB API route body limit.
 *
 * Phase 1 (type=request): browser sends { type, pathname } → server returns clientToken
 * Phase 2 (type=event):   Blob SDK calls back with upload result
 *
 * Requires BLOB_READ_WRITE_TOKEN env var.
 */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN not configured" }, { status: 503 });
  }

  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: [
          "image/png", "image/jpeg", "image/svg+xml", "image/webp",
          "audio/mpeg", "audio/wav", "audio/ogg",
          "video/mp4", "video/webm",
          "application/json", "text/plain", "application/octet-stream",
        ],
        maximumSizeInBytes: 500 * 1024 * 1024, // 500 MB
        addRandomSuffix: false,
        pathname,
      }),
      onUploadCompleted: async ({ blob }) => {
        console.log("Blob upload completed:", blob.url);
      },
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 },
    );
  }
}
