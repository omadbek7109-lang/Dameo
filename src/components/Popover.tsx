import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  button: (p: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement | null>; id: string }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  onOpen?: () => void;
  id: string;
}

/** Click-outside / Escape-aware dropdown. */
export function Popover({ button, children, align = 'right', onOpen, id }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => {
      if (!o) onOpen?.();
      return !o;
    });
  };
  return (
    <div className="popover" ref={wrap}>
      {button({ open, toggle, ref: btn, id })}
      {open && (
        <div id={id} className={`popover-panel popover-${align}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
