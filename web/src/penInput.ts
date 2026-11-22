export type InkSample = {
  clientX: number;
  clientY: number;
  pressure: number;
  timeStamp: number;
};

// WebKit exposes this on Pencil touches. An absent field is never treated as
// a pen: ordinary fingers must keep their normal navigation/drawing behavior.
export function isStylusTouch(touch: Touch) {
  return (touch as Touch & { touchType?: string }).touchType === "stylus";
}

export function touchSample(touch: Touch, timeStamp: number): InkSample {
  return {
    clientX: touch.clientX,
    clientY: touch.clientY,
    pressure: touch.force,
    timeStamp,
  };
}

export function pointerSamples(event: PointerEvent): PointerEvent[] {
  // Older WebKit and restricted contexts can omit or reject this API. Always
  // include the dispatched point as well as any available historical samples.
  try {
    return [...(event.getCoalescedEvents?.() || []), event];
  } catch {
    return [event];
  }
}
