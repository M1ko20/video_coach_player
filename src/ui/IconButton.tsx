import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';

export type TooltipSide = 'top' | 'bottom' | 'right' | 'left';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Accessible name; also shown in the tooltip. */
  label: string;
  /** Keyboard shortcut shown after the label in the tooltip. */
  shortcut?: string;
  tooltipSide?: TooltipSide;
  /** Marks a toggle or the chosen option in a group. */
  active?: boolean;
  variant?: 'default' | 'danger' | 'primary';
  children: ReactNode;
}

/** Keeps keyboard focus where it was when a control is clicked with the mouse. */
export function keepFocus(event: MouseEvent) {
  event.preventDefault();
}

/**
 * Icon-only button with a tooltip. Clicking with a pointer does not move
 * keyboard focus onto it, so shortcuts such as Space keep controlling the
 * video (and an open text editor keeps its focus) after a toolbar click.
 */
export function IconButton({
  label,
  shortcut,
  tooltipSide = 'top',
  active,
  variant = 'default',
  className,
  children,
  ...rest
}: IconButtonProps) {
  const classes = ['icon-button', `icon-button--${variant}`, active ? 'is-active' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={classes}
      aria-label={label}
      aria-pressed={active}
      data-tooltip={shortcut ? `${label}  ·  ${shortcut}` : label}
      data-tooltip-side={tooltipSide}
      onMouseDown={keepFocus}
      {...rest}
    >
      {children}
    </button>
  );
}
