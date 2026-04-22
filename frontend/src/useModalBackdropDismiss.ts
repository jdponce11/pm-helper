import { useCallback, useRef } from "react";
import type { MouseEvent, PointerEvent } from "react";

/**
 * Backdrop click-to-dismiss that ignores clicks synthesized after a drag
 * that started inside the dialog (e.g. text selection ending on the overlay).
 */
export function useModalBackdropDismiss(onDismiss: () => void) {
  const pointerDownOnBackdrop = useRef(false);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    pointerDownOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!pointerDownOnBackdrop.current) return;
      if (e.target !== e.currentTarget) return;
      onDismiss();
    },
    [onDismiss]
  );

  return { onPointerDown, onClick };
}
