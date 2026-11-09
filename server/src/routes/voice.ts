import express, { Router, type Response } from 'express';
import type { VoiceConfigInput, VoiceFormat, VoiceStartMode, VoiceTestInput } from '@shared';
import { sendOk } from '../lib/http';
import { isRecord, requireString } from '../lib/validate';
import { HttpError } from '../middleware/errors';
import {
  checkVoice,
  getVoiceSettings,
  speakMessage,
  startVoiceStudioManually,
  stopVoiceStudioManually,
  testSpeech,
  transcribeAudio,
  updateVoiceSettings,
  type VoiceAudio,
} from '../services/voiceService';
import { normalizeVoiceUrl, VoiceConfigError } from '../services/voiceConfigService';

export const voiceRouter = Router();

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be true or false.`);
  }
  return value;
}

function optionalUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'url must be a string.');
  }

  try {
    return normalizeVoiceUrl(value);
  } catch (cause) {
    if (cause instanceof VoiceConfigError) {
      throw new HttpError(400, 'VALIDATION_ERROR', cause.message);
    }
    throw cause;
  }
}

function optionalVoiceId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'voiceId must be a string.');
  }

  const id = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(id)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'voiceId contains characters CAERA does not accept.');
  }
  return id;
}

function optionalVoiceName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'voiceName must be a string.');
  }

  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 120) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'voiceName must be 1–120 characters.');
  }
  return name;
}

function optionalSpeed(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.25 || value > 4) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'speed must be a number between 0.25 and 4.');
  }
  return Math.round(value * 100) / 100;
}

function optionalFormat(value: unknown): VoiceFormat | undefined {
  if (value === undefined) return undefined;
  if (value !== 'mp3' && value !== 'wav') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'format must be mp3 or wav.');
  }
  return value;
}

function optionalStartMode(value: unknown): VoiceStartMode | undefined {
  if (value === undefined) return undefined;
  if (value !== 'startup' && value !== 'on-demand') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'startMode must be startup or on-demand.');
  }
  return value;
}

function optionalVoiceStudioDir(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'voiceStudioDir must be a path string or null.');
  }
  return value;
}

function sendAudio(res: Response, audio: VoiceAudio): void {
  const extension = audio.format === 'wav' ? 'wav' : 'mp3';

  res.status(200);
  res.setHeader('Content-Type', audio.contentType);
  res.setHeader('Content-Length', String(audio.bytes.length));
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Disposition', `inline; filename="caera-speech.${extension}"`);
  res.setHeader('X-Caera-Voice-Id', audio.voiceId);
  res.setHeader('X-Caera-Voice-Format', audio.format);
  res.setHeader('X-Caera-Voice-Truncated', audio.truncated ? 'true' : 'false');
  res.end(audio.bytes);
}

function abortOnDisconnect(res: Response): AbortController {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller;
}

voiceRouter.get('/config', async (_req, res) => {
  sendOk(res, await getVoiceSettings(false));
});

voiceRouter.put('/config', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const enabled = optionalBoolean(body.enabled, 'enabled');
  const autoSpeak = optionalBoolean(body.autoSpeak, 'autoSpeak');
  const url = optionalUrl(body.url);
  const voiceId = optionalVoiceId(body.voiceId);
  const voiceName = optionalVoiceName(body.voiceName);
  const speed = optionalSpeed(body.speed);
  const format = optionalFormat(body.format);
  const autoStart = optionalBoolean(body.autoStart, 'autoStart');
  const startMode = optionalStartMode(body.startMode);
  const voiceStudioDir = optionalVoiceStudioDir(body.voiceStudioDir);

  const input: VoiceConfigInput = {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(autoSpeak !== undefined ? { autoSpeak } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(voiceId !== undefined ? { voiceId } : {}),
    ...(voiceName !== undefined ? { voiceName } : {}),
    ...(speed !== undefined ? { speed } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(autoStart !== undefined ? { autoStart } : {}),
    ...(startMode !== undefined ? { startMode } : {}),
    ...(voiceStudioDir !== undefined ? { voiceStudioDir } : {}),
  };

  sendOk(res, await updateVoiceSettings(input));
});

voiceRouter.post('/check', async (_req, res) => {
  sendOk(res, await checkVoice());
});

voiceRouter.post('/service/start', async (_req, res) => {
  sendOk(res, await startVoiceStudioManually());
});

voiceRouter.post('/service/stop', async (_req, res) => {
  sendOk(res, await stopVoiceStudioManually());
});

voiceRouter.get('/voices', async (_req, res) => {
  const settings = await getVoiceSettings(false);
  sendOk(res, { voice: settings.voice, catalog: settings.catalog });
});

voiceRouter.post(
  '/transcribe',
  express.raw({
    type: ['audio/wav', 'audio/x-wav'],
    limit: '25mb',
  }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        'No WAV recording was uploaded.',
        'Hold the microphone, speak, and release to transcribe.',
      );
    }

    if (req.body.length > 25 * 1024 * 1024) {
      throw new HttpError(413, 'VALIDATION_ERROR', 'The recording is too large.');
    }

    if (req.body.length < 44 || req.body.toString('ascii', 0, 4) !== 'RIFF') {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        'The upload is not a WAV recording.',
        'CAERA records push-to-talk audio as WAV before sending it to VoiceStudio.',
      );
    }

    const controller = abortOnDisconnect(res);
    sendOk(res, await transcribeAudio(req.body, controller.signal));
  },
);

voiceRouter.post('/test', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const voiceId = optionalVoiceId(body.voiceId);
  const speed = optionalSpeed(body.speed);
  const format = optionalFormat(body.format);
  const input: VoiceTestInput = {
    ...(voiceId !== undefined ? { voiceId } : {}),
    ...(speed !== undefined ? { speed } : {}),
    ...(format !== undefined ? { format } : {}),
  };

  const controller = abortOnDisconnect(res);
  sendAudio(res, await testSpeech(input, controller.signal));
});

voiceRouter.post('/speech', async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const conversationId = requireString(body.conversationId, {
    field: 'conversationId',
    max: 100,
  });
  const messageId = requireString(body.messageId, { field: 'messageId', max: 100 });

  const controller = abortOnDisconnect(res);
  sendAudio(res, await speakMessage({ conversationId, messageId }, controller.signal));
});
