import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  strokePath,
  touchedStroke,
  type InkStroke,
  type InkPoint,
  type InkTool,
  type PageSize,
} from "./ink";
import {
  isStylusTouch,
  pointerSamples,
  touchSample,
  type InkSample,
} from "./penInput";

type Gesture = {
  pointerId?: number;
  touchId?: number;
  lastTime: number;
  pointerType: string;
  tool: InkTool;
  stroke: InkStroke;
  erased: Set<string>;
  previous: InkPoint;
};
const SavedStroke = memo(function SavedStroke({
  stroke,
  size,
}: {
  stroke: InkStroke;
  size: PageSize;
}) {
  return (
    <path
      className="ink-stroke"
      data-stroke-id={stroke.id}
      data-tool={stroke.tool}
      d={strokePath(stroke, size)}
      fill={stroke.color}
      opacity={stroke.tool === "highlighter" ? 0.3 : 1}
    />
  );
});
export function PDFInkLayer({
  strokes,
  size,
  enabled,
  tool,
  color,
  width,
  drawWithTouch,
  onChange,
  onActive,
  onError,
}: {
  strokes: InkStroke[];
  size: PageSize;
  enabled: boolean;
  tool: InkTool;
  color: string;
  width: number;
  drawWithTouch: boolean;
  onChange: (strokes: InkStroke[]) => void;
  onActive: (active: boolean) => void;
  onError: (message: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null),
    draft = useRef<SVGPathElement>(null),
    gesture = useRef<Gesture | null>(null),
    frame = useRef(0),
    lastPen = useRef(-Infinity);
  const activeCallback = useRef(onActive);
  const currentStrokes = useRef(strokes);
  currentStrokes.current = strokes;
  activeCallback.current = onActive;
  const clear = useCallback(() => {
    cancelAnimationFrame(frame.current);
    gesture.current = null;
    draft.current?.setAttribute("d", "");
    svg.current
      ?.querySelectorAll<SVGPathElement>("[data-stroke-id]")
      .forEach((p) => p.style.removeProperty("visibility"));
    activeCallback.current(false);
  }, []);
  useEffect(() => {
    if (!enabled) clear();
    return clear;
  }, [enabled, clear]);
  useEffect(() => {
    const blur = () => clear();
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [clear]);
  const point = (event: InkSample, pen: boolean): InkPoint | null => {
    const bounds = svg.current!.getBoundingClientRect();
    if (
      !bounds.width ||
      !bounds.height ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    )
      return null;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      pressure:
        pen && Number.isFinite(event.pressure) && event.pressure > 0
          ? Math.min(1, event.pressure)
          : 0.5,
    };
  };
  const capture = (e: ReactPointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic events and interrupted pointers have no capture target. */
    }
  };
  const paint = () => {
    const g = gesture.current;
    if (!g || g.tool === "eraser") return;
    draft.current?.setAttribute("d", strokePath(g.stroke, size));
    draft.current?.setAttribute("fill", g.stroke.color);
    draft.current?.setAttribute(
      "opacity",
      g.tool === "highlighter" ? "0.3" : "1",
    );
  };
  const erase = (from: InkPoint, to: InkPoint) => {
    const g = gesture.current;
    if (!g) return;
    const radius =
      (7 / Math.max(1, svg.current!.getBoundingClientRect().width)) *
      size.width;
    for (const stroke of currentStrokes.current) {
      if (
        !g.erased.has(stroke.id) &&
        touchedStroke(stroke, from, to, size, radius)
      ) {
        g.erased.add(stroke.id);
        svg.current
          ?.querySelectorAll<SVGPathElement>("[data-stroke-id]")
          .forEach((p) => {
            if (p.dataset.strokeId === stroke.id) p.style.visibility = "hidden";
          });
      }
    }
  };
  const appendSample = (sample: InkSample) => {
    const g = gesture.current;
    if (!g || sample.timeStamp < g.lastTime) return;
    const next = point(sample, g.pointerType === "pen");
    if (!next) return;
    g.lastTime = sample.timeStamp;
    if (g.pointerType === "pen") lastPen.current = performance.now();
    if (g.tool === "eraser") erase(g.previous, next);
    else if (g.stroke.points.length < 10000) {
      const prev = g.stroke.points[g.stroke.points.length - 1];
      if (
        Math.hypot(
          (next.x - prev.x) * size.width,
          (next.y - prev.y) * size.height,
        ) > 0.1
      )
        g.stroke.points.push(next);
    }
    g.previous = next;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(paint);
  };
  const begin = (
    sample: InkSample,
    pointerType: string,
    pointerId?: number,
    touchId?: number,
    hardwareEraser = false,
  ) => {
    if (!enabled || gesture.current) return;
    const start = point(sample, pointerType === "pen");
    if (!start) return;
    window.getSelection()?.removeAllRanges();
    if (pointerType === "pen") lastPen.current = performance.now();
    gesture.current = {
      pointerId,
      touchId,
      lastTime: sample.timeStamp,
      pointerType,
      tool: hardwareEraser ? "eraser" : tool,
      stroke: {
        id:
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
                n.toString(16).padStart(2, "0"),
              ).join(""),
        tool: tool === "highlighter" ? "highlighter" : "pen",
        color,
        width: Math.max(0.0002, Math.min(0.1, width / size.width)),
        points: [start],
      },
      erased: new Set(),
      previous: start,
    };
    onActive(true);
    if (gesture.current.tool === "eraser") erase(start, start);
    else paint();
  };
  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (
      !enabled ||
      gesture.current ||
      (e.pointerType === "touch" &&
        (!drawWithTouch || performance.now() - lastPen.current < 650))
    )
      return;
    const hardwareEraser =
      e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32) !== 0);
    if (e.button !== 0 && !hardwareEraser) return;
    e.preventDefault();
    e.stopPropagation();
    begin(e.nativeEvent, e.pointerType, e.pointerId, undefined, hardwareEraser);
    if (gesture.current) capture(e);
  };
  const append = (native: PointerEvent) => {
    if (gesture.current?.pointerId !== native.pointerId) return;
    for (const sample of pointerSamples(native)) appendSample(sample);
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerId === gesture.current?.pointerId) {
      e.preventDefault();
      append(e.nativeEvent);
    }
  };
  const finish = () => {
    const g = gesture.current;
    if (!g) return;
    const strokes = currentStrokes.current;
    clear();
    if (g.tool === "eraser") {
      if (g.erased.size) {
        currentStrokes.current = strokes.filter((s) => !g.erased.has(s.id));
        onChange(currentStrokes.current);
      }
      return;
    }
    if (
      strokes.length >= 5000 ||
      strokes.reduce((n, s) => n + s.points.length, 0) +
        g.stroke.points.length >
        200000
    ) {
      onError(
        "This page has reached its handwriting limit. Erase some strokes before adding more.",
      );
      return;
    }
    currentStrokes.current = [...strokes, g.stroke];
    onChange(currentStrokes.current);
  };
  const up = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (gesture.current?.pointerId !== e.pointerId) return;
    append(e.nativeEvent);
    finish();
  };
  const touches = useRef<(event: TouchEvent) => void>(() => {});
  touches.current = (event) => {
    if (!enabled) return;
    const touch = Array.from(event.changedTouches).find(
      (t) => isStylusTouch(t) || t.identifier === gesture.current?.touchId,
    );
    if (!touch) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    if (event.type === "touchstart") {
      if (!gesture.current)
        begin(
          touchSample(touch, event.timeStamp),
          "pen",
          undefined,
          touch.identifier,
        );
      else if (gesture.current.pointerType === "pen")
        gesture.current.touchId = touch.identifier;
    } else if (gesture.current?.touchId === touch.identifier) {
      if (event.type === "touchcancel") clear();
      else {
        appendSample(touchSample(touch, event.timeStamp));
        if (event.type === "touchend") finish();
      }
    }
  };
  useEffect(() => {
    const node = svg.current!;
    const listener = (event: TouchEvent) => touches.current(event);
    const events = [
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
    ] as const;
    events.forEach((type) =>
      node.addEventListener(type, listener, { passive: false }),
    );
    return () =>
      events.forEach((type) => node.removeEventListener(type, listener));
  }, []);
  return (
    <svg
      ref={svg}
      className={`pdf-ink-layer ${enabled ? "ink-enabled" : ""} ink-tool-${tool}`}
      viewBox={`0 0 ${size.width} ${size.height}`}
      aria-label="PDF handwriting layer"
      role="img"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={(e) => {
        if (
          e.pointerId === gesture.current?.pointerId &&
          gesture.current.touchId === undefined
        )
          clear();
      }}
      onLostPointerCapture={(e) => {
        if (
          e.pointerId === gesture.current?.pointerId &&
          gesture.current.touchId === undefined
        )
          clear();
      }}
    >
      {strokes.map((s) => (
        <SavedStroke key={s.id} stroke={s} size={size} />
      ))}
      <path ref={draft} className="ink-draft" pointerEvents="none" />
    </svg>
  );
}
