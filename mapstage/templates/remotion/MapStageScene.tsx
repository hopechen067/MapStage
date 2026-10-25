/**
 * MapStageScene —— 全片只放一个的共享地图组件（Remotion）。
 *
 * 地图跑在 MapStage 的 host.html 里（iframe），本组件只做一件事：
 * 每一帧 delayRender → postMessage seek(frame / fps) → 等 'seeked' → continueRender。
 * Scene 里的精灵、标签、弹窗、Canvas 特效叠在它上面（zIndex 比它高即可）。
 *
 *   <MapStageScene hostUrl="http://127.0.0.1:8770" story="examples/story-hexi.json" />
 *
 * 前提：`node site/serve.mjs`（或 Pages 上的 host.html）可访问；story 路径相对站点根。
 * 不依赖 maplibre-gl npm 包，也不在 Remotion 的 bundle 里跑 WebGL。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';

type HostMessage =
  | { source: 'mapstage'; type: 'ready'; duration: number; fps: number; width: number; height: number; hash: string | null }
  | { source: 'mapstage'; type: 'seeked'; id: number; t: number }
  | { source: 'mapstage'; type: 'error'; id: number; message: string };

export type MapStageSceneProps = {
  /** MapStage 站点根，例如 http://127.0.0.1:8770 */
  hostUrl: string;
  /** story.json，相对站点根，例如 examples/story-hexi.json */
  story: string;
  /** story 时间偏移（秒）：本 Sequence 的第 0 帧对应 story 的第几秒。默认 0 */
  offsetSec?: number;
  /** 宿主页就绪的最长等待（毫秒）。冷缓存 precache 可能很久。默认 300000 */
  readyTimeoutMs?: number;
  /** 单帧 seek 的最长等待（毫秒）。默认 60000 */
  seekTimeoutMs?: number;
  style?: React.CSSProperties;
};

export const MapStageScene: React.FC<MapStageSceneProps> = ({
  hostUrl,
  story,
  offsetSec = 0,
  readyTimeoutMs = 300000,
  seekTimeoutMs = 60000,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const pending = useRef(new Map<number, { resolve: () => void; reject: (e: Error) => void }>());
  const nextId = useRef(1);
  const origin = new URL(hostUrl).origin;
  const src = `${hostUrl.replace(/\/$/, '')}/host.html?story=${encodeURIComponent(story)}&precache=1`;

  // 宿主页就绪
  useEffect(() => {
    const handle = delayRender('mapstage host ready', { timeoutInMilliseconds: readyTimeoutMs });
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== origin) return;
      const d = ev.data as HostMessage | undefined;
      if (!d || d.source !== 'mapstage') return;
      if (d.type === 'ready') {
        setReady(true);
        continueRender(handle);
      } else if (d.type === 'seeked') {
        pending.current.get(d.id)?.resolve();
        pending.current.delete(d.id);
      } else if (d.type === 'error') {
        pending.current.get(d.id)?.reject(new Error(d.message));
        pending.current.delete(d.id);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      continueRender(handle);
    };
  }, [origin, readyTimeoutMs]);

  const seek = useCallback(
    (t: number) =>
      new Promise<void>((resolve, reject) => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return reject(new Error('mapstage iframe 不存在'));
        const id = nextId.current++;
        pending.current.set(id, { resolve, reject });
        win.postMessage({ source: 'mapstage-host', type: 'seek', id, t }, origin);
      }),
    [origin],
  );

  // 每一帧：等地图落定再放行
  useEffect(() => {
    if (!ready) return;
    const handle = delayRender(`mapstage seek frame ${frame}`, { timeoutInMilliseconds: seekTimeoutMs });
    seek(frame / fps + offsetSec).then(
      () => continueRender(handle),
      (e) => cancelRender(e),
    );
  }, [frame, fps, offsetSec, ready, seek, seekTimeoutMs]);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      width={width}
      height={height}
      style={{ border: 0, position: 'absolute', inset: 0, background: '#000', ...style }}
      title="mapstage"
    />
  );
};
