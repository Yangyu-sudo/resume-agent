import { useEffect, useRef, useState } from "react";

/**
 * 打字机效果：DSH 的消息在「完成时才提交整段文本」，
 * 前端按字逐段显示，让回复的呈现节奏接近流式输出，而不是突然整段出现。
 */
export function useTypewriter(target: string, enabled: boolean): string {
  const [shown, setShown] = useState(enabled ? "" : target);
  const shownRef = useRef(enabled ? "" : target);

  useEffect(() => {
    if (!enabled) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    if (!target.startsWith(shownRef.current)) {
      shownRef.current = "";
      setShown("");
    }
    if (shownRef.current === target) return;

    let cancelled = false;
    let timer = 0;

    const tick = (): void => {
      if (cancelled) return;
      const remaining = target.length - shownRef.current.length;
      if (remaining <= 0) return;
      // 剩余越多每帧吐得越快，长文也不会等太久
      const step = Math.max(1, Math.ceil(remaining / 18));
      shownRef.current = target.slice(0, shownRef.current.length + step);
      setShown(shownRef.current);
      timer = window.setTimeout(tick, 18);
    };

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [target, enabled]);

  return enabled ? shown : target;
}
