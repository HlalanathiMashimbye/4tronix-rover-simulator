import 'server-only';

import { readFileSync } from 'node:fs';

import { readSetting, writeSetting } from '@/infrastructure/config/runtimeSettingsStore';
import { watchUrl } from '@/core/domain/services/youtubeLinking';

export { YouTubeNotConfiguredError } from '@/infrastructure/youtube/channelUploads';

export type YouTubeUploadPrivacy = 'private' | 'public' | 'unlisted';

export class AutoUploadNotConfiguredError extends Error {
  constructor() {
    super('Set the YouTube OAuth client settings to enable automatic uploads.');
    this.name = 'AutoUploadNotConfiguredError';
  }
}

export interface AutomaticUploadRequest {
  missionId: string;
  runId: string;
  yardId: string;
  file?: string | Blob | ArrayBuffer | Uint8Array | null;
  title?: string;
  description?: string;
  privacy?: YouTubeUploadPrivacy | string;
  madeForKids?: boolean;
}

export interface AutomaticUploadResult {
  status: 'uploaded' | 'not-configured' | 'failed';
  title?: string;
  description?: string;
  videoId?: string;
  url?: string;
  error?: string;
}

export function buildAutomaticUploadTitle(
  missionId: string,
  yardId: string,
  stamp: string,
): string {
  return `${missionId}__${yardId}__${stamp}`;
}

export function buildAutomaticUploadDescription(missionId: string, yardId: string): string {
  return [
    `MissionID: ${missionId}`,
    `Yard: ${yardId}`,
    '',
    'Uploaded automatically by the Mars Rover Cloud Platform.',
  ].join('\n');
}

export async function isAutoUploadConfigured(): Promise<boolean> {
  const [clientId, clientSecret, refreshToken, privacy, madeForKids] = await Promise.all([
    readSetting('youtubeClientId'),
    readSetting('youtubeClientSecret'),
    readSetting('youtubeRefreshToken'),
    readSetting('youtubeUploadPrivacy'),
    readSetting('youtubeMadeForKids'),
  ]);

  if (!clientId || !clientSecret || !refreshToken) return false;
  if (privacy && !['private', 'public', 'unlisted'].includes(privacy.toLowerCase())) {
    return false;
  }
  if (madeForKids && !['true', 'false'].includes(madeForKids.toLowerCase())) {
    return false;
  }
  return true;
}

export async function requireAutoUploadConfiguration(): Promise<void> {
  if (!(await isAutoUploadConfigured())) {
    throw new AutoUploadNotConfiguredError();
  }
}

async function resolveAccessToken(): Promise<string | null> {
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    readSetting('youtubeClientId'),
    readSetting('youtubeClientSecret'),
    readSetting('youtubeRefreshToken'),
  ]);

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`YouTube token refresh failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as { access_token?: string; refresh_token?: string };
  if (payload.refresh_token && payload.refresh_token !== refreshToken) {
    await writeSetting('youtubeRefreshToken', payload.refresh_token);
    if (process.env.YOUTUBE_REFRESH_TOKEN?.trim()) {
      throw new Error('YOUTUBE_REFRESH_TOKEN environment override must be removed after Google rotates the token.');
    }
  }
  return payload.access_token ?? null;
}

async function resolveUploadBytes(file: AutomaticUploadRequest['file']): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!file) {
    throw new Error('No recording file was supplied for the upload.');
  }

  if (file instanceof Blob) {
    const array = new Uint8Array(await file.arrayBuffer());
    return { bytes: array, contentType: file.type || 'video/mp4' };
  }

  if (file instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(file), contentType: 'video/mp4' };
  }

  if (ArrayBuffer.isView(file)) {
    return { bytes: new Uint8Array(file.buffer, file.byteOffset, file.byteLength), contentType: 'video/mp4' };
  }

  if (typeof file === 'string') {
    const trimmed = file.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const response = await fetch(trimmed, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Could not fetch recording from ${trimmed}: HTTP ${response.status}`);
      }
      const blob = await response.blob();
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        contentType: blob.type || 'video/mp4',
      };
    }

    const buffer = readFileSync(trimmed);
    return { bytes: new Uint8Array(buffer), contentType: 'video/mp4' };
  }

  throw new Error('Unsupported upload payload type.');
}

function buildMultipartUpload(
  payload: { bytes: Uint8Array; contentType: string },
  metadata: string,
): { boundary: string; body: Buffer } {
  const boundary = `MarsRoverUpload${Date.now()}`;
  const metadataBlock = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${payload.contentType}\r\n\r\n`,
    'utf8',
  );
  const trailer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { boundary, body: Buffer.concat([metadataBlock, Buffer.from(payload.bytes), trailer]) };
}

export async function maybeUploadRecording(
  request: AutomaticUploadRequest,
): Promise<AutomaticUploadResult> {
  const configured = await isAutoUploadConfigured();
  if (!configured) {
    return { status: 'not-configured' };
  }

  const title = request.title ?? buildAutomaticUploadTitle(
    request.missionId,
    request.yardId,
    new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
  );

  const description = request.description ?? buildAutomaticUploadDescription(
    request.missionId,
    request.yardId,
  );

  const privacy = (request.privacy ?? (await readSetting('youtubeUploadPrivacy')) ?? 'private').toLowerCase();
  const madeForKids = request.madeForKids ?? ((await readSetting('youtubeMadeForKids')) ?? 'false').toLowerCase() === 'true';

  try {
    const accessToken = await resolveAccessToken();
    if (!accessToken) {
      return { status: 'not-configured' };
    }

    const uploadBytes = await resolveUploadBytes(request.file);
    const metadata = JSON.stringify({
      snippet: {
        title,
        description,
        tags: ['mars', 'rover', 'mission', 'recording'],
        categoryId: '27',
      },
      status: {
        privacyStatus: privacy,
        selfDeclaredMadeForKids: madeForKids,
      },
    });

    const multipart = buildMultipartUpload(uploadBytes, metadata);
    const response = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary="${multipart.boundary}"`,
        },
        body: new Uint8Array(multipart.body).buffer,
        cache: 'no-store',
        signal: AbortSignal.timeout(180_000),
      },
    );

    if (!response.ok) {
      throw new Error(`YouTube upload failed with HTTP ${response.status}.`);
    }

    const result = (await response.json()) as { id?: string };
    if (!result.id) {
      throw new Error('YouTube accepted the upload but did not return a video id.');
    }

    return {
      status: 'uploaded',
      title,
      description,
      videoId: result.id,
      url: watchUrl(result.id),
    };
  } catch (error) {
    const message = error instanceof Error && (
      /^YouTube (?:token refresh|upload) failed with HTTP \d+\.$/.test(error.message) ||
      error.message === 'YOUTUBE_REFRESH_TOKEN environment override must be removed after Google rotates the token.'
    )
      ? error.message
      : 'Automatic upload failed. The recording remains available for manual upload.';
    return {
      status: 'failed',
      title,
      description,
      error: message,
    };
  }
}

export const uploadRecordedVideo = maybeUploadRecording;

export async function uploadVideoForRun(
  request: AutomaticUploadRequest,
): Promise<AutomaticUploadResult> {
  return maybeUploadRecording(request);
}
