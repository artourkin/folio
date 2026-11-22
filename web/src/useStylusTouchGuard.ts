import { useEffect, useRef } from "react";
import { isStylusTouch } from "./penInput";

// iPadOS Scribble observes Touch Events independently of Pointer Events.
// Cancel only Pencil gestures on the PDF drawing surface and buttons. Native
// form controls, fingers, keyboard activation, and assistive clicks pass through.
export function useStylusTouchGuard(
  root: HTMLElement | null,
  enabled: boolean,
  writing: boolean,
) {
  const current = useRef({ enabled, writing });
  current.current = { enabled, writing };
  useEffect(() => {
    if (!root) return;
    const ids = new Set<number>();
    let tap: {
      id: number;
      button: HTMLButtonElement;
      x: number;
      y: number;
    } | null = null;
    let activated: { button: HTMLButtonElement; at: number } | null = null;
    const editable = (target: Element) =>
      target.closest("input,textarea,select,[contenteditable=true]");
    const begin = (event: TouchEvent) => {
      if (!current.current.enabled) return;
      const pencil = Array.from(event.changedTouches).find(isStylusTouch);
      // A new finger gesture is intentional, even immediately after a Pencil
      // tap. Only suppress the compatibility click from the Pencil itself.
      if (!pencil && !ids.size) activated = null;
      const target = event.target as Element;
      if (editable(target)) return;
      const button = target.closest<HTMLButtonElement>("button");
      const drawing = current.current.writing && !!target.closest(".pdf-page");
      if (!button && !drawing) return;
      if (!pencil && !ids.size) return;
      if (event.cancelable) event.preventDefault();
      if (!pencil) return; // A palm during a Pencil stroke cannot start a tap.
      ids.add(pencil.identifier);
      tap =
        button && !button.disabled
          ? {
              id: pencil.identifier,
              button,
              x: pencil.screenX,
              y: pencil.screenY,
            }
          : null;
    };
    const move = (event: TouchEvent) => {
      if (!current.current.enabled || !ids.size) return;
      if (event.cancelable) event.preventDefault();
      const touch =
        tap &&
        Array.from(event.changedTouches).find((t) => t.identifier === tap!.id);
      if (
        tap &&
        touch &&
        Math.hypot(touch.screenX - tap.x, touch.screenY - tap.y) > 10
      )
        tap = null;
    };
    const end = (event: TouchEvent) => {
      if (!current.current.enabled) return;
      const pencil = Array.from(event.changedTouches).find((t) =>
        ids.has(t.identifier),
      );
      if (!pencil) return;
      if (event.cancelable) event.preventDefault();
      ids.delete(pencil.identifier);
      const previous = tap;
      tap = null;
      if (
        event.type === "touchcancel" ||
        !previous ||
        previous.id !== pencil.identifier ||
        previous.button.disabled ||
        !previous.button.isConnected
      )
        return;
      if (
        Math.hypot(pencil.screenX - previous.x, pencil.screenY - previous.y) >
        10
      )
        return;
      const hit = document
        .elementFromPoint(pencil.clientX, pencil.clientY)
        ?.closest("button");
      if (hit !== previous.button) return;
      activated = { button: previous.button, at: performance.now() };
      previous.button.click();
    };
    const click = (event: MouseEvent) => {
      if (
        "pointerType" in event &&
        event.pointerType &&
        event.pointerType !== "pen"
      )
        return;
      const pointerClick =
        event.detail > 0 ||
        ("pointerType" in event && event.pointerType === "pen");
      if (!pointerClick) return;
      const button = (event.target as Element).closest("button");
      if (
        button &&
        (tap?.button === button ||
          (activated?.button === button &&
            performance.now() - activated.at < 650))
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const blur = () => {
      ids.clear();
      tap = null;
      activated = null;
    };
    root.addEventListener("touchstart", begin, {
      capture: true,
      passive: false,
    });
    root.addEventListener("touchmove", move, { capture: true, passive: false });
    root.addEventListener("touchend", end, { capture: true, passive: false });
    root.addEventListener("touchcancel", end, {
      capture: true,
      passive: false,
    });
    root.addEventListener("click", click, true);
    window.addEventListener("blur", blur);
    return () => {
      root.removeEventListener("touchstart", begin, true);
      root.removeEventListener("touchmove", move, true);
      root.removeEventListener("touchend", end, true);
      root.removeEventListener("touchcancel", end, true);
      root.removeEventListener("click", click, true);
      window.removeEventListener("blur", blur);
    };
  }, [root]);
}
