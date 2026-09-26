import { useEffect, useRef, useState } from "react";

type DictationState =
  | "idle"
  | "listening"
  | "transcribing"
  | "unsupported"
  | "permission"
  | "error";

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function DictationButton({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<DictationState>("idle");
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const baseText = useRef("");
  const transcript = useRef("");

  useEffect(() => {
    return () => {
      recognition.current?.abort();
      recognition.current = null;
      recorder.current?.stop();
      recorder.current = null;
      mediaStream.current?.getTracks().forEach((track) => track.stop());
      mediaStream.current = null;
    };
  }, []);

  useEffect(() => {
    if (!disabled || state !== "listening") return;
    recognition.current?.abort();
    recognition.current = null;
    recorder.current?.stop();
    recorder.current = null;
    mediaStream.current?.getTracks().forEach((track) => track.stop());
    mediaStream.current = null;
    setState("idle");
  }, [disabled, state]);

  const transcribe = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1)
      binary += String.fromCharCode(bytes[index]);
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64: btoa(binary),
        mimeType: blob.type || "audio/webm",
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? data.code ?? "Transcription failed");
    const text = String(data.text ?? "").trim();
    if (text) onChange([baseText.current, text].filter(Boolean).join(" "));
  };

  const startRecorder = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";
      const next = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      baseText.current = value.trim();
      recordedChunks.current = [];
      mediaStream.current = stream;
      recorder.current = next;
      next.ondataavailable = (event) => {
        if (event.data.size) recordedChunks.current.push(event.data);
      };
      next.onerror = () => setState("error");
      next.onstop = () => {
        const blob = new Blob(recordedChunks.current, {
          type: next.mimeType || "audio/webm",
        });
        stream.getTracks().forEach((track) => track.stop());
        mediaStream.current = null;
        recorder.current = null;
        if (!blob.size) {
          setState("error");
          return;
        }
        setState("transcribing");
        void transcribe(blob)
          .then(() => setState("idle"))
          .catch((cause) => {
            setState("error");
            console.warn(cause);
          });
      };
      next.start();
      setState("listening");
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "permission" : "error");
    }
  };

  const start = () => {
    const speechWindow = window as SpeechWindow;
    const Recognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      void startRecorder();
      return;
    }

    recognition.current?.abort();
    const next = new Recognition();
    baseText.current = value.trim();
    transcript.current = "";
    next.continuous = true;
    next.interimResults = false;
    next.lang = navigator.language || "en-US";
    next.onstart = () => setState("listening");
    next.onresult = (event) => {
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalText += result[0].transcript;
      }
      if (!finalText.trim()) return;
      transcript.current = `${transcript.current} ${finalText}`.trim();
      onChange([baseText.current, transcript.current].filter(Boolean).join(" "));
    };
    next.onerror = (event) => {
      const reason = event.error ?? "";
      setState(
        reason === "not-allowed" || reason === "service-not-allowed"
          ? "permission"
          : "error",
      );
    };
    next.onend = () => {
      recognition.current = null;
      setState((current) => (current === "listening" ? "idle" : current));
    };
    recognition.current = next;
    try {
      next.start();
    } catch {
      recognition.current = null;
      setState("error");
    }
  };

  const stop = () => {
    if (recorder.current) {
      recorder.current.stop();
      setState("transcribing");
      return;
    }
    recognition.current?.stop();
    recognition.current = null;
    setState("idle");
  };

  const listening = state === "listening";
  const status =
    state === "listening"
      ? "Listening… click to stop"
      : state === "transcribing"
        ? "Transcribing…"
      : state === "unsupported"
        ? "Voice input unavailable"
        : state === "permission"
          ? "Allow microphone access"
          : state === "error"
            ? "Try microphone again"
            : "";

  return (
    <div className="dictation-control">
      <button
        type="button"
        className={`dictation-button ${listening ? "listening" : ""}`}
        aria-label={listening ? "Stop dictation" : "Start dictation"}
        aria-pressed={listening}
        title={status || "Dictate request"}
        disabled={(disabled && !listening) || state === "transcribing"}
        onClick={listening ? stop : start}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
          <path d="M9 4h6v9H9z" fill="currentColor" />
          <path d="M6 10v3a6 6 0 0 0 12 0v-3h-2v3a4 4 0 0 1-8 0v-3zM11 19h2v3h-2zM8 21h8v2H8z" fill="currentColor" />
        </svg>
      </button>
      {status && (
        <span className={`dictation-status ${state}`} role="status" aria-live="polite">
          {status}
        </span>
      )}
    </div>
  );
}
