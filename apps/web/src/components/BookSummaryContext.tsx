import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import BookSummary, { type SummaryBook } from "./BookSummary";

type Summary = {
  /** Opens the Summary slide-out for a book; pressing the same book again closes it. */
  open: (book: SummaryBook) => void;
  close: () => void;
  /** The book whose Summary is open, by its page address. */
  current?: string;
};

const SummaryContext = createContext<Summary>({
  open: () => {},
  close: () => {},
});

/** One Summary slide-out for the whole app, so every cover opens a book the same way (UX-42). */
export function BookSummaryProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<SummaryBook | null>(null);
  const { pathname } = useLocation();
  // A new page closes the Summary (its "Open book page" link, or any other link inside it).
  useEffect(() => setBook(null), [pathname]);
  const open = useCallback(
    (next: SummaryBook) =>
      setBook((now) => (now?.to === next.to ? null : next)),
    [],
  );
  const close = useCallback(() => setBook(null), []);
  const value = useMemo(
    () => ({ open, close, current: book?.to }),
    [open, close, book?.to],
  );
  return (
    <SummaryContext.Provider value={value}>
      {children}
      {book && <BookSummary key={book.to} book={book} close={close} />}
    </SummaryContext.Provider>
  );
}

export function useBookSummary() {
  return useContext(SummaryContext);
}
