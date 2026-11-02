import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ContextLink } from "./NavigationContinuity";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  CircleAlert,
  Download,
  Ellipsis,
  ExternalLink,
  Headphones,
  Info,
  ListPlus,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import { api, result, type Auth, type Work } from "../api/client";
import { Notice } from "../components";
import ListChoice from "../pages/ListChoice";
import BookCover, { resolveBookWork } from "./BookCover";
import BookDialog from "./BookDialog";
import { useBookSummary } from "./BookSummaryContext";
import { useQuickAdd, type Mode } from "./QuickAdd";
import { usePreferences } from "../hooks/usePreferences";

export type CoverActionsLayout = "on" | "beside";
type ProviderBook = { provider: string; external_id: string };

export type CoverCardProps = {
  title: string;
  authors?: string[];
  /** The line under the title; the authors by default. */
  meta?: ReactNode;
  work?: Work | null;
  providerBook?: ProviderBook;
  cover?: string | null;
  medium?: "any" | "ebook" | "audio";
  rating?: number | null;
  /** The book's own page, opened from the Summary and from More. */
  to: string;
  /**
   * The action column (true), none (false; the cover still opens the Summary), or one More button on
   * the cover's corner with the actions in words ("more", for small tiles: UX-44 B).
   */
  actions?: boolean | "more";
  /** The title and meta line under the cover; off where a row shows them beside it. */
  caption?: boolean;
  /** A fixed layout, for the examples in Settings; otherwise the person's saved choice. */
  layout?: CoverActionsLayout;
  /** Examples only: pressing does nothing. */
  example?: boolean;
  className?: string;
  children?: ReactNode;
};

/**
 * A cover with its title, from the shared library (`.media-card.cover-card`, UX-42): pressing the cover
 * or the title opens the book's Summary; a column of actions runs down the cover's right edge
 * (Details, Ebook, Audiobook, Add to a list, More), on the cover or beside it as the person chose in
 * Settings. Titles always take two lines of space, so covers line up.
 */
export default function CoverCard({
  title,
  authors = [],
  meta,
  work,
  providerBook,
  cover,
  medium = "any",
  rating,
  to,
  actions = true,
  caption = true,
  layout,
  example = false,
  className = "",
  children,
}: CoverCardProps) {
  const summary = useBookSummary();
  const saved = usePreferences().preferences?.cover_actions ?? "on";
  const [engaged, setEngaged] = useState(false);
  const open = () =>
    !example &&
    summary.open({
      title,
      authors,
      cover: cover ?? work?.cover_url,
      work,
      to,
      rating,
      providerBook,
    });
  return (
    <div
      className={`media-card cover-card ${className}`}
      data-actions={actions === "more" ? "more" : (layout ?? saved)}
      onPointerEnter={() => setEngaged(true)}
      onFocus={() => setEngaged(true)}
    >
      <button
        type="button"
        className="cover-card__open"
        aria-label={`${title}, details`}
        tabIndex={example ? -1 : undefined}
        onClick={open}
      />
      <div className="cover-card__art">
        <BookCover
          title={title}
          work={work}
          cover={cover}
          medium={medium}
          rating={rating}
          actions={false}
          badges={false}
        />
        {actions === "more" ? (
          <CoverMore
            title={title}
            work={work}
            providerBook={providerBook}
            to={to}
            engaged={engaged}
            openSummary={open}
          />
        ) : (
          actions && (
            <CoverActions
              title={title}
              work={work}
              providerBook={providerBook}
              to={to}
              engaged={engaged}
              example={example}
              openSummary={open}
            />
          )
        )}
      </div>
      {caption && (
        <>
          <h3 className="media-card__title" title={title}>
            {title}
          </h3>
          <span className="media-card__meta">
            {meta ?? (authors.join(", ") || "Author unknown")}
          </span>
        </>
      )}
      {children}
    </div>
  );
}

/**
 * A book in a list row (UX-44 A, the library's `.book-row`): pressing anywhere on the row opens the
 * book's Summary, and the same five actions as the cover column sit in a row at the end (under the
 * title on phones). `lead` comes first (a series position); `children` is the text, starting with
 * the title in `.book-row__title`. Links, buttons and check boxes in the text stay pressable.
 */
export function BookRow({
  title,
  authors = [],
  work,
  workId,
  owned,
  providerBook,
  cover,
  medium = "any",
  rating,
  to,
  lead,
  className = "",
  children,
}: {
  title: string;
  authors?: string[];
  work?: Work | null;
  workId?: string;
  owned?: { ebook?: boolean; audio?: boolean };
  providerBook?: ProviderBook;
  cover?: string | null;
  medium?: "any" | "ebook" | "audio";
  rating?: number | null;
  to: string;
  lead?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const summary = useBookSummary();
  const [engaged, setEngaged] = useState(false);
  const open = () =>
    summary.open({
      title,
      authors,
      cover: cover ?? work?.cover_url,
      work,
      workId,
      to,
      rating,
      providerBook,
    });
  return (
    <div
      className={`book-row${lead ? " book-row--lead" : ""} ${className}`}
      onPointerEnter={() => setEngaged(true)}
      onFocus={() => setEngaged(true)}
    >
      <button
        type="button"
        className="book-row__open"
        aria-label={`${title}, details`}
        onClick={open}
      />
      {lead}
      <div className="book-row__art">
        <BookCover
          title={title}
          work={work}
          cover={cover}
          medium={medium}
          rating={rating}
          actions={false}
          badges={false}
        />
      </div>
      <div className="book-row__text">{children}</div>
      <CoverActions
        row
        title={title}
        work={work}
        workId={workId}
        owned={owned}
        providerBook={providerBook}
        to={to}
        engaged={engaged}
        openSummary={open}
      />
    </div>
  );
}

function ActionButton({
  icon: Icon,
  name,
  tip,
  done = false,
  onClick,
  disabled = false,
  ...rest
}: {
  icon: LucideIcon;
  name: string;
  tip: string;
  done?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  tabIndex?: number;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const { buttonRef, tabIndex: _skip, ...aria } = rest;
  return (
    <button
      ref={buttonRef}
      type="button"
      className="cover-actions__btn"
      aria-label={name}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      tabIndex={rest.tabIndex}
      {...aria}
    >
      <Icon aria-hidden="true" />
      {done && (
        <span className="cover-actions__tick" aria-hidden="true">
          <Check />
        </span>
      )}
      <span className="cover-actions__tip" aria-hidden="true">
        {tip}
      </span>
    </button>
  );
}

/** What a cover's actions need to know about the book. */
type CoverBook = {
  title: string;
  work?: Work | null;
  /** The catalog work, when the page has its id but not the whole work (Following, the calendar). */
  workId?: string;
  /** Formats in the library, when the page has no whole work. */
  owned?: { ebook?: boolean; audio?: boolean };
  providerBook?: ProviderBook;
  to: string;
  engaged: boolean;
  example?: boolean;
  openSummary: () => void;
};

/**
 * The logic behind every set of cover actions (the column, the row and the More button): the
 * formats in the library, getting a format with Quick add, adding to a list and the More menu.
 */
function useCoverBook({
  title,
  work,
  workId,
  owned,
  providerBook,
  engaged,
  example = false,
  openSummary,
}: CoverBook) {
  const { data: session } = useQuery<Auth | null>({
    queryKey: ["session"],
    enabled: false,
  });
  const [listing, setListing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const id = work?.id ?? workId;
  const availability = work?.availability ?? owned;
  // Audible books are found through the book page; anything else can be added from its cover.
  const resolvable =
    !!session &&
    !!(id || providerBook) &&
    providerBook?.provider !== "audible";
  const resolveWork = providerBook
    ? () => resolveBookWork(providerBook)
    : undefined;
  const quick = useQuickAdd({
    workId: id,
    resolveWork,
    engaged: engaged && resolvable && !example,
    cover: true,
  });
  const canList = !!session && session.user.role !== "viewer" && resolvable;
  function format(kind: "ebook" | "audio") {
    const noun = kind === "audio" ? "Audiobook" : "Ebook";
    const have = !!availability?.[kind];
    const allowed =
      resolvable &&
      (kind === "audio" ? quick.audioDownload : quick.ebookDownload);
    if (have)
      return {
        name: `${noun} of ${title} in library`,
        tip: `${noun} in library`,
        done: true,
        onClick: openSummary,
      };
    if (!allowed)
      return {
        name: `${noun} of ${title} not in library`,
        tip: `${noun} not in library`,
        done: false,
        onClick: openSummary,
      };
    return {
      name: `Get the ${noun.toLowerCase()} of ${title}`,
      tip: `Get the ${noun.toLowerCase()}`,
      done: false,
      disabled: quick.busy,
      onClick: () => quick.choose(kind),
    };
  }
  const ebook = format("ebook");
  const audio = format("audio");
  const neither = !availability?.ebook && !availability?.audio;
  const extra: { label: string; icon: LucideIcon; mode: Mode }[] = [];
  if (resolvable && quick.eitherDownload && neither) {
    extra.push({ label: "Get both formats", icon: Download, mode: "both" });
    if (!quick.preferenceUnset)
      extra.push({
        label: `Quick add · ${quick.label}`,
        icon: Download,
        mode: undefined,
      });
  }
  const showStatus =
    !!quick.starting ||
    !!quick.feedbackError ||
    quick.missingPreference ||
    (engaged && !!quick.status.data);
  const busy = !!quick.starting || (quick.busy && !quick.feedbackError);
  const StatusIcon =
    quick.feedbackError || quick.coverNeedsReview
      ? CircleAlert
      : busy
        ? LoaderCircle
        : Check;
  const status = showStatus && (
    <p
      className="cover-card__status"
      role={quick.feedbackError ? "alert" : "status"}
      title={
        quick.feedbackError?.message ||
        quick.starting ||
        quick.status.data?.message
      }
    >
      <StatusIcon
        aria-hidden="true"
        className={busy ? "source-download-spinner" : undefined}
      />
      {quick.missingPreference ? (
        <>
          Format choice not set.{" "}
          <Link to="/settings#preferences">Set it here</Link>
        </>
      ) : quick.starting || quick.feedbackError ? (
        quick.coverStatus
      ) : (
        <Link
          to={
            quick.id && quick.coverNeedsReview
              ? `/books/${quick.id}?tab=sources`
              : quick.status.data?.request_id
                ? `/requests#request-${quick.status.data.request_id}`
                : "/requests"
          }
          aria-label={`${quick.coverStatus}: ${quick.coverNeedsReview && quick.id ? "review sources" : "view downloads"}`}
        >
          {quick.coverStatus}
        </Link>
      )}
    </p>
  );
  const extraItems = extra.map((item) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      disabled={quick.busy}
      onClick={() => quick.choose(item.mode)}
    >
      <item.icon size={18} aria-hidden="true" />
      {item.label}
    </button>
  ));
  const list = listing && (
    <AddToList
      title={title}
      workId={id}
      providerBook={providerBook}
      close={() => setListing(false)}
    />
  );
  return {
    id,
    ebook,
    audio,
    canList,
    status,
    extraItems,
    list,
    startListing: () => !example && setListing(true),
    menuOpen,
    setMenuOpen,
    more,
    menuId,
  };
}

/**
 * The five actions (Details, Ebook, Audiobook, Add to a list, More) as the column down a cover's
 * edge (UX-42), or as a row at the end of a list row (`row`, UX-44 A). Progress shows in a status
 * line straight after them.
 */
export function CoverActions({
  row = false,
  example = false,
  ...book
}: Omit<CoverBook, "example"> & {
  row?: boolean;
  example?: boolean;
}) {
  const { title, to } = book;
  const cover = useCoverBook({ ...book, example });
  const skip = example ? -1 : undefined;
  const { menuOpen, setMenuOpen, more, menuId } = cover;
  return (
    <>
      <div
        className={row ? "cover-actions cover-actions--row" : "cover-actions"}
        role="group"
        aria-label={`Actions for ${title}`}
      >
        <ActionButton
          tabIndex={skip}
          icon={Info}
          name={`Details of ${title}`}
          tip="Details"
          onClick={book.openSummary}
        />
        <ActionButton icon={BookOpen} tabIndex={skip} {...cover.ebook} />
        <ActionButton icon={Headphones} tabIndex={skip} {...cover.audio} />
        {cover.canList && (
          <ActionButton
            tabIndex={skip}
            icon={ListPlus}
            name={`Add ${title} to a list`}
            tip="Add to a list"
            onClick={cover.startListing}
          />
        )}
        <ActionButton
          tabIndex={skip}
          icon={Ellipsis}
          name={`More for ${title}`}
          tip="More"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          buttonRef={more}
          onClick={() => !example && setMenuOpen(!menuOpen)}
        />
      </div>
      {cover.status}
      {menuOpen && (
        <CoverMenu
          id={menuId}
          title={title}
          button={more}
          close={() => setMenuOpen(false)}
        >
          <ContextLink role="menuitem" to={to}>
            <ExternalLink size={18} aria-hidden="true" />
            Open the book page
          </ContextLink>
          {cover.extraItems}
        </CoverMenu>
      )}
      {cover.list}
    </>
  );
}

/**
 * One 44px More button for a small cover tile (UX-44 B): its menu says every action in words (View
 * details, Get the ebook, Get the audiobook, Add to a list, Open the book page).
 */
export function CoverMore(book: Omit<CoverBook, "example">) {
  const { title, to } = book;
  const cover = useCoverBook(book);
  const { menuOpen, setMenuOpen, more, menuId } = cover;
  return (
    <>
      <button
        ref={more}
        type="button"
        className="cover-card__more"
        aria-label={`More for ${title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <Ellipsis aria-hidden="true" />
      </button>
      {cover.status}
      {menuOpen && (
        <CoverMenu
          id={menuId}
          title={title}
          button={more}
          close={() => setMenuOpen(false)}
        >
          <button type="button" role="menuitem" onClick={book.openSummary}>
            <Info size={18} aria-hidden="true" />
            View details
          </button>
          {(
            [
              [cover.ebook, BookOpen],
              [cover.audio, Headphones],
            ] as const
          ).map(([action, Icon]) => (
            <button
              key={action.tip}
              type="button"
              role="menuitem"
              disabled={"disabled" in action && action.disabled}
              onClick={action.onClick}
            >
              {action.done ? (
                <Check size={18} aria-hidden="true" />
              ) : (
                <Icon size={18} aria-hidden="true" />
              )}
              {action.tip}
            </button>
          ))}
          {cover.canList && (
            <button
              type="button"
              role="menuitem"
              onClick={cover.startListing}
            >
              <ListPlus size={18} aria-hidden="true" />
              Add to a list
            </button>
          )}
          <ContextLink role="menuitem" to={to}>
            <ExternalLink size={18} aria-hidden="true" />
            Open the book page
          </ContextLink>
          {cover.extraItems}
        </CoverMenu>
      )}
      {cover.list}
    </>
  );
}

/**
 * The More menu: the library's `.menu`, fixed over the page under its button so a shelf that
 * scrolls sideways does not cut it off. Focus moves to the first item; arrow keys, Home and End move;
 * Escape closes and returns focus to More; Tab, a press outside, scrolling or choosing closes it.
 */
function CoverMenu({
  id,
  title,
  button,
  close,
  children,
}: {
  id: string;
  title: string;
  button: React.RefObject<HTMLButtonElement | null>;
  close: () => void;
  children: ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled])',
    ) ?? []),
  ];
  useLayoutEffect(() => {
    const element = menu.current!;
    const r = button.current!.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const below = r.bottom + 4 + height <= innerHeight;
    element.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - height - 4)}px`;
    element.style.left = `${Math.max(8, Math.min(r.right - width, innerWidth - width - 8))}px`;
    items()[0]?.focus();
  }, []);
  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target))
        close();
    };
    const away = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", close);
    };
  }, [close]);
  function keys(event: KeyboardEvent) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) =>
      list[(index + list.length) % list.length]?.focus();
    if (event.key === "Escape") {
      close();
      button.current?.focus();
    } else if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(list.length - 1);
    else if (event.key === "Tab") close();
    else return;
    if (event.key !== "Tab") event.preventDefault();
  }
  return createPortal(
    <div
      ref={menu}
      id={id}
      className="menu"
      role="menu"
      aria-label={`More for ${title}`}
      data-fixed=""
      onKeyDown={keys}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[role="menuitem"]')) {
          close();
          button.current?.focus();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Add to a list: the reading lists the person can edit, or a new one (as on the book page). */
function AddToList({
  title,
  workId,
  providerBook,
  close,
}: {
  title: string;
  workId?: string;
  providerBook?: ProviderBook;
  close: () => void;
}) {
  const cache = useQueryClient();
  const [listId, setListId] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      const work = workId || (await resolveBookWork(providerBook!));
      return result(
        await api.POST("/api/lists/{list_id}/entries", {
          params: { path: { list_id: listId } },
          body: { work_id: work },
        }),
      );
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ["lists"] }),
  });
  return (
    <BookDialog title="Add to a reading list" close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <h2>Add to a reading list</h2>
        <p className="muted book-dialog-book-title">{title}</p>
        <ListChoice
          value={listId}
          label="Reading list"
          disabled={add.isPending}
          onChange={(value) => {
            setListId(value);
            add.reset();
          }}
        />
        <Notice error={add.error} />
        <button className="primary" disabled={!listId || add.isPending}>
          {add.isPending ? "Adding…" : "Add to list"}
        </button>
        {add.isSuccess && (
          <p className="success" role="status">
            Added to your list.
          </p>
        )}
      </form>
    </BookDialog>
  );
}
