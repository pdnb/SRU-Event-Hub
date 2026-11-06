'use client';

import { CameraOutlined, StopOutlined, SwapOutlined } from '@ant-design/icons';
import { Alert, Button, Flex, Typography } from 'antd';
import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

const SAME_CODE_COOLDOWN_MS = 2500;
const FRAME_INTERVAL_MS = 120;

/**
 * Camera QR scanner. Uses the browser's BarcodeDetector where available (Chrome/Edge on Android,
 * macOS, ChromeOS) and falls back to jsQR on canvas frames elsewhere. The same code is reported at
 * most once per 2.5 s so a QR held in front of the camera is not scanned repeatedly.
 * Camera access needs HTTPS (or localhost).
 */
export function QrScanner({ onCode, paused = false }: { onCode: (text: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const last = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const onCodeRef = useRef(onCode);
  const pausedRef = useRef(paused);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');

  useEffect(() => {
    onCodeRef.current = onCode;
    pausedRef.current = paused;
  });

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('เบราว์เซอร์นี้ใช้กล้องไม่ได้ (ต้องเปิดผ่าน HTTPS) — ใช้เครื่องสแกนหรือพิมพ์รหัสแทน');
      return;
    }
    try {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play();
      }
      setRunning(true);
    } catch (e) {
      const name = (e as DOMException).name;
      setError(name === 'NotAllowedError' ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง — อนุญาตในการตั้งค่าเบราว์เซอร์แล้วลองใหม่' : 'เปิดกล้องไม่สำเร็จ');
      setRunning(false);
    }
  }, [facing]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!running) return;
    let alive = true;
    let detector: Detector | null = null;
    if (window.BarcodeDetector) {
      try {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        detector = null;
      }
    }
    const emit = (text: string) => {
      const now = Date.now();
      if (text === last.current.text && now - last.current.at < SAME_CODE_COOLDOWN_MS) return;
      last.current = { text, at: now };
      onCodeRef.current(text);
    };
    const tick = async () => {
      if (!alive) return;
      const v = video.current;
      if (v && v.readyState >= 2 && !pausedRef.current) {
        try {
          if (detector) {
            const found = await detector.detect(v);
            if (found[0]?.rawValue) emit(found[0].rawValue);
          } else {
            const c = (canvas.current ??= document.createElement('canvas'));
            // Downscale: jsQR is CPU-bound and badges are large in frame.
            const scale = Math.min(1, 640 / v.videoWidth);
            c.width = Math.round(v.videoWidth * scale);
            c.height = Math.round(v.videoHeight * scale);
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, c.width, c.height);
              const img = ctx.getImageData(0, 0, c.width, c.height);
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
              if (code?.data) emit(code.data);
            }
          }
        } catch {
          /* a failed frame is simply skipped */
        }
      }
      if (alive) setTimeout(() => void tick(), FRAME_INTERVAL_MS);
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [running]);

  return (
    <div>
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 3',
          background: '#0f172a',
          borderRadius: 8,
          overflow: 'hidden',
          display: running ? 'block' : 'none',
        }}
      >
        <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: '18%',
            border: `3px solid ${paused ? '#f59e0b' : '#22c55e'}`,
            borderRadius: 12,
            boxShadow: '0 0 0 2000px rgba(0,0,0,0.25)',
          }}
        />
      </div>
      {error && <Alert type="warning" showIcon title={error} style={{ marginTop: 8 }} />}
      <Flex gap={8} style={{ marginTop: 8 }} wrap>
        {running ? (
          <>
            <Button icon={<StopOutlined />} onClick={stop}>
              ปิดกล้อง
            </Button>
            <Button
              icon={<SwapOutlined />}
              onClick={() => {
                setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
                stop();
              }}
            >
              สลับกล้อง
            </Button>
          </>
        ) : (
          <Button type="primary" icon={<CameraOutlined />} onClick={() => void start()}>
            เปิดกล้องสแกน QR
          </Button>
        )}
        {running && (
          <Typography.Text type="secondary" style={{ alignSelf: 'center' }}>
            {paused ? 'หยุดชั่วคราว' : 'หันกล้องไปที่ QR ของผู้เข้าร่วม'}
          </Typography.Text>
        )}
      </Flex>
    </div>
  );
}
