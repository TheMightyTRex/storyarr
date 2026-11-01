import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
// Every modal has the slide-out panels' header: the name in bold and the close button, on a white
// bar with a grey line under it (side-panel.css).
export default function BookDialog({
  title,
  close,
  children,
  className = "",
}: {
  className?: string;
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`book-dialog ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            close();
        }
      }}
    >
      <header className="book-dialog-heading side-panel-header">
        <h2 className="side-panel-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      <div className="book-dialog-content">{children}</div>
    </dialog>
  );
}
