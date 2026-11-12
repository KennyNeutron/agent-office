import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Native dialogs make the background inert and contain keyboard focus. */
export function Modal({ children, close, busy = false, labelledBy, wide = false }: {
  children: ReactNode;
  /** A wider dialog, for content such as the knowledge graph. */
  wide?: boolean;
  close: () => void;
  busy?: boolean;
  labelledBy: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      dialog.close();
      if (opener?.isConnected && !opener.matches(':disabled')) opener.focus();
      else document.getElementById('main-content')?.focus();
    };
  }, []);
  return createPortal(<dialog ref={ref} role="dialog" className="modal-dialog" aria-labelledby={labelledBy} aria-modal="true" aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button,input,textarea,select,a[href],[tabindex]')]
        .filter(item => !item.matches(':disabled') && item.tabIndex >= 0 && item.getClientRects().length > 0);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <div className={wide ? 'modal modal-wide' : 'modal'}>{children}</div>
  </dialog>, document.body);
}
