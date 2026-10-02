'use client';

import { useLayoutEffect, useRef, useState } from 'react';

export interface SegmentedItem<T extends string | number> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}

interface Props<T extends string | number> {
  items: SegmentedItem<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  vertical?: boolean;
  className?: string;
}

/** Segmented control with a sliding indicator that follows the active option. */
export function Segmented<T extends string | number>({ items, value, onChange, label, size = 'md', vertical = false, className = '' }: Props<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = value === null ? undefined : refs.current.get(value);
      setBox(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, items.length]);

  useLayoutEffect(() => {
    const el = value === null ? undefined : refs.current.get(value);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [value]);

  return (
    <div className={`seg seg--${size}${vertical ? ' seg--vertical' : ''} ${className}`} role="radiogroup" aria-label={label}>
      {box && <span className="seg__thumb" style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }} aria-hidden="true" />}
      {items.map((it) => (
        <button
          key={String(it.value)}
          ref={(el) => {
            if (el) refs.current.set(it.value, el);
            else refs.current.delete(it.value);
          }}
          type="button"
          role="radio"
          aria-checked={it.value === value}
          aria-label={it.ariaLabel}
          data-tip={vertical ? it.ariaLabel : undefined}
          title={it.title}
          disabled={it.disabled}
          className={`seg__item${it.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(it.value)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
