import type { LipSync } from '../animation/lipSync';
import type { TtsAudioFormat } from '../storage/settings';

/** Maps a TTS audio format to the MIME type of the audio it produces. */
const MIME_TYPES: Record<TtsAudioFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  opus: 'audio/ogg; codecs=opus',
  pcm: 'audio/wav',
};

export interface PlaybackHandle {
  /** The underlying audio element, e.g. for tracking playback progress. */
  audio: HTMLAudioElement;
  /** Stops playback immediately and resolves `finished`. */
  stop(): void;
  /** Resolves once playback has finished (or been stopped/errored). */
  finished: Promise<void>;
}

/**
 * Plays back a TTS audio response, starting playback as soon as enough data
 * has buffered (via `MediaSource`/`SourceBuffer` streaming where supported,
 * falling back to a full `Blob` otherwise), and drives `lipSync` from the
 * resulting `<audio>` element while it plays.
 */
export function playAudioResponse(
  response: Response,
  speed: number,
  responseFormat: TtsAudioFormat,
  lipSync: LipSync,
): PlaybackHandle {
  const audio = new Audio();
  audio.playbackRate = speed;

  const mimeType = MIME_TYPES[responseFormat];

  let stopped = false;
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  if (window.MediaSource && MediaSource.isTypeSupported(mimeType) && response.body) {
    const mediaSource = new MediaSource();
    audio.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
      if (stopped) return;

      const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      const reader = response.body!.getReader();
      const queue: Uint8Array[] = [];
      let readerDone = false;

      const pump = (): void => {
        if (stopped) return;
        if (sourceBuffer.updating) return;

        if (queue.length > 0) {
          sourceBuffer.appendBuffer(queue.shift() as BufferSource);
          return;
        }

        if (readerDone) {
          if (mediaSource.readyState === 'open') {
            try {
              mediaSource.endOfStream();
            } catch {
              // Already closed/ended — ignore.
            }
          }
          return;
        }

        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              readerDone = true;
              pump();
              return;
            }
            if (value) queue.push(value);
            pump();
          })
          .catch((error) => {
            console.error('TTS stream read error:', error);
            readerDone = true;
            pump();
          });
      };

      sourceBuffer.addEventListener('updateend', pump);
      pump();
    });
  } else {
    void response
      .arrayBuffer()
      .then((buffer) => {
        if (stopped) return;
        audio.src = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
      })
      .catch((error) => {
        console.error('Failed to read TTS response:', error);
        finish();
      });
  }

  const finish = (): void => {
    lipSync.stop();
    resolveFinished();
  };

  audio.addEventListener(
    'canplay',
    () => {
      if (stopped) return;
      lipSync.attach(audio);
      void audio.play().catch((error) => {
        console.error('Audio playback failed:', error);
        finish();
      });
    },
    { once: true },
  );

  audio.addEventListener('ended', finish);
  audio.addEventListener('error', finish);

  return {
    audio,
    stop(): void {
      if (stopped) return;
      stopped = true;
      audio.pause();
      finish();
    },
    finished,
  };
}
