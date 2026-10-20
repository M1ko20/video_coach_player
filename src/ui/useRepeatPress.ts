import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

const INITIAL_DELAY_MS = 380;
const REPEAT_INTERVAL_MS = 90;

/**
 * Button behaviour that fires once on press and then repeats while held, like
 * a held key. Used for frame stepping, where moving several frames by holding
 * the button is quicker than clicking repeatedly.
 */
export function useRepeatPress(action: () => void) {
  const actionRef = useRef(action);
  const delayRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    actionRef.current = action;
  }, [action]);

  const stop = useCallback(() => {
    clearTimeout(delayRef.current);
    clearInterval(intervalRef.current);
  }, []);

  useEffect(() => stop, [stop]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || event.currentTarget.disabled) return;
      stop();
      actionRef.current();
      delayRef.current = setTimeout(() => {
        intervalRef.current = setInterval(() => actionRef.current(), REPEAT_INTERVAL_MS);
      }, INITIAL_DELAY_MS);
    },
    [stop],
  );

  // Pointer presses are handled above. A click with no pointer behind it comes
  // from the keyboard or assistive technology and should act once.
  const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) actionRef.current();
  }, []);

  return { onPointerDown, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop, onClick };
}
