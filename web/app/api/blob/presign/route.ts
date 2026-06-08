/**
 * POST /api/blob/presign
 *
 * Returns a short-lived client token the browser can use to PUT a file
 * directly to Vercel Blob storage. The file never passes through this
 * serverless function, so there is no 4.5 MB body limit.
 *
 * Body: { pathname: string, contentType?: string }
 * Response: { clientToken: string }
 */
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { pathname, contentType } = await req.json() as { pathname: string; contentType?: string };

    if (!pathname) {
      return NextResponse.json({ error: "pathname required" }, { status: 400 });
    }

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.B2_READ_WRITE_TOKEN,
      pathname,
      allowedContentTypes: contentType
        ? [contentType]
        : [
            "image/png", "image/jpeg", "image/svg+xml", "image/webp",
            "audio/mpeg", "audio/wav", "audio/ogg",
            "video/mp4", "video/webm",
            "application/json", "text/plain", "application/octet-stream",
          ],
      maximumSizeInBytes: 500 * 1024 * 1024,
      addRandomSuffix: false,
    });

    return NextResponse.json({ clientToken });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate upload token" },
      { status: 500 },
    );
  }
}
