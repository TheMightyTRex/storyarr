import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A shelf of books that scrolls sideways, from the shared library (`.shelf-scroller`, UX-30 option
 * A): no scroll bar; at each end the covers fade into the page with a 44px arrow over the fade, shown
 * only when there are more books that way. Each press moves one screen less one cover, or jumps with
 * Reduce motion on. Tabbing to a book scrolls it fully into view. On phones there are no arrows; the
 * fade alone shows there is more. Shelves that load more as they go keep doing so (ShelfPagination
 * watches the last book).
 */
export default function ShelfScroller({
  label,
  className = "",
  trackRef,
  children,
}: {
  /** The list itself, for a shelf that scrolls back to the start after a refresh. */
  trackRef?: React.RefObject<HTMLUListElement | null>;
  /** The shelf's name, for the list and the arrows ("More books in <label>"). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const track = useRef<HTMLUListElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ before: false, after: false });
  useLayoutEffect(() => {
    const element = track.current!;
    const update = () => {
      setMore({
        before: element.scrollLeft > 2,
        after:
          element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
      });
      // The arrows sit in the middle of the covers, whatever their size.
      const art = element.querySelector(".cover-card__art, .book-cover");
      if (art && box.current) {
        const top =
          art.getBoundingClientRect().top -
          box.current.getBoundingClientRect().top +
          art.getBoundingClientRect().height / 2;
        box.current.style.setProperty("--shelf-arrow-top", `${top}px`);
      }
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const added = new MutationObserver(update);
    added.observe(element, { childList: true });
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
      added.disconnect();
    };
  }, []);
  useEffect(() => {
    const element = track.current!;
    const focus = (event: FocusEvent) =>
      (event.target as HTMLElement)
        .closest(".shelf-track > *")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    element.addEventListener("focusin", focus);
    return () => element.removeEventListener("focusin", focus);
  }, []);
  function move(direction: -1 | 1) {
    const element = track.current!;
    const first = element.firstElementChild;
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
    const step = Math.max(
      element.clientWidth -
        (first ? first.getBoundingClientRect().width + gap : 0),
      100,
    );
    const still =
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.classList.contains("pref-motion");
    element.scrollBy({
      left: direction * step,
      behavior: still ? "instant" : "smooth",
    });
  }
  return (
    <div className="shelf-scroller" ref={box}>
      <ul
        ref={(node) => {
          track.current = node;
          if (trackRef) trackRef.current = node;
        }}
        className={`shelf-track discovery-shelf ${className}`}
        aria-label={label}
      >
        {children}
      </ul>
      <div className="shelf-edge shelf-edge--start" hidden={!more.before}>
        <button
          type="button"
          className="shelf-arrow"
          aria-label={`Earlier books in ${label}`}
          onClick={() => move(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
      </div>
      <div className="shelf-edge shelf-edge--end" hidden={!more.after}>
        <button
          type="button"
          className="shelf-arrow"
          aria-label={`More books in ${label}`}
          onClick={() => move(1)}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
