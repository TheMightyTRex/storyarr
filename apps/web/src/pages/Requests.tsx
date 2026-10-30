import { lazy, Suspense } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  CircleCheck,
  CircleX,
  Clock,
  Download,
  FileSearch,
  History,
  ListOrdered,
  Undo2,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import ContentSkeleton from "../components/ContentSkeleton";
import HeaderSubmenu from "../components/HeaderSubmenu";
import { useRequestCounts } from "../hooks/useRequestCounts";
import {
  requestFilter,
  requestTab,
  tabFilters,
  type RequestFilter,
  type RequestTab,
} from "./requestFilters";

const SavedRequests = lazy(() => import("./ActivityRequests"));

const tabs: { id: RequestTab; title: string; icon: LucideIcon }[] = [
  { id: "queue", title: "Queue", icon: ListOrdered },
  { id: "pending", title: "Wanted", icon: Clock },
  { id: "history", title: "History", icon: History },
];
const filterLabels: Record<RequestFilter, { title: string; icon: LucideIcon }> =
  {
    queue: { title: "All", icon: ListOrdered },
    downloading: { title: "Downloading", icon: Download },
    review: { title: "Needs review", icon: FileSearch },
    pending: { title: "All", icon: Clock },
    yours: { title: "Your requests", icon: UserRound },
    history: { title: "All", icon: History },
    library: { title: "In library", icon: CircleCheck },
    declined: { title: "Declined", icon: CircleX },
    withdrawn: { title: "Withdrawn", icon: Undo2 },
  };

export default function Requests({
  admin,
  canRequest,
  canApprove,
}: {
  admin: boolean;
  canRequest: boolean;
  canApprove: boolean;
}) {
  const { hash, search } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const selected = requestFilter(hash, params.get("status"));
  const sort = params.get("sort") === "title" ? "title" : "newest";
  const counts = useRequestCounts().data;
  // Needs review is for admins; Your requests only narrows the list for people who see everyone's.
  const allowed = (filter: RequestFilter) =>
    (filter !== "review" || admin) && (filter !== "yours" || canApprove);
  const status = allowed(selected) ? selected : "queue";
  const tab = requestTab(status);
  const filters = tabFilters[tab].filter(allowed);
  const tabCount: Partial<Record<RequestTab, number>> = {
    queue: counts?.downloading ?? 0,
    pending: counts?.pending ?? 0,
  };
  const countLabel: Partial<Record<RequestTab, string>> = {
    queue: "downloading",
    pending: "waiting for approval",
  };
  const filterCount: Partial<Record<RequestFilter, number>> = {
    downloading: counts?.downloading ?? 0,
    review: counts?.review ?? 0,
  };

  function queryFor(nextStatus: RequestFilter, nextSort = sort) {
    const next = new URLSearchParams(search);
    if (nextStatus === "queue") next.delete("status");
    else next.set("status", nextStatus);
    if (nextSort === "newest") next.delete("sort");
    else next.set("sort", nextSort);
    const query = next.toString();
    return query ? `/requests?${query}` : "/requests";
  }

  const cleared = new URLSearchParams(search);
  cleared.delete("q");
  return (
    <div className="requests-page">
      <h1 className="workspace-title">Requests</h1>
      <div className="page-tabs-bar">
        <HeaderSubmenu
          label="Activity"
          items={tabs.map((item) => ({
            to: queryFor(item.id),
            label: item.title,
            icon: item.icon,
            current: tab === item.id,
            count: tabCount[item.id],
            countLabel: countLabel[item.id],
          }))}
          classic={
            <nav className="page-tabs" aria-label="Activity">
              {tabs.map((item) => (
                <Link
                  key={item.id}
                  to={queryFor(item.id)}
                  aria-current={tab === item.id ? "page" : undefined}
                >
                  {item.title}
                  {!!tabCount[item.id] && (
                    <span className="requests-tab-count">
                      {tabCount[item.id]}
                      <span className="sr-only"> {countLabel[item.id]}</span>
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          }
        />
        <div className="page-tabs-tools">
          <label className="request-sort">
            <span className="sr-only">Sort</span>
            <select
              aria-label="Sort requests"
              value={sort}
              onChange={(event) =>
                navigate(
                  queryFor(
                    status,
                    event.target.value === "title" ? "title" : "newest",
                  ),
                )
              }
            >
              <option value="newest">Newest</option>
              <option value="title">Title</option>
            </select>
          </label>
          {admin && (
            <Link className="button-link" to="/organization/inspections">
              Import local files
            </Link>
          )}
          <Link className="page-view-action" to="/discover">
            Find books
          </Link>
        </div>
      </div>
      {filters.length > 1 && (
        <nav
          className="activity-filters"
          aria-label={`${tabs.find((item) => item.id === tab)!.title} filters`}
        >
          {filters.map((filter) => {
            const { title, icon: Icon } = filterLabels[filter];
            return (
              <Link
                key={filter}
                to={queryFor(filter)}
                aria-current={status === filter ? "page" : undefined}
              >
                <Icon size={15} aria-hidden="true" />
                {title}
                {!!filterCount[filter] && (
                  <span className="requests-tab-count">
                    {filterCount[filter]}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      )}
      <form
        className="request-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams(search);
          const q = String(
            new FormData(event.currentTarget).get("q") || "",
          ).trim();
          if (q) next.set("q", q);
          else next.delete("q");
          navigate(`/requests?${next}`);
        }}
      >
        <input
          type="search"
          name="q"
          aria-label="Search requests"
          placeholder="Search requests by title or author…"
          defaultValue={params.get("q") || ""}
          key={params.get("q") || ""}
          maxLength={200}
        />
        <button>Search requests</button>
        {params.get("q") && (
          <Link to={`/requests?${cleared}`}>Clear search</Link>
        )}
      </form>
      <Suspense fallback={<ContentSkeleton />}>
        <SavedRequests
          canManage={canRequest}
          status={status}
          sort={sort}
          q={params.get("q") || ""}
        />
      </Suspense>
    </div>
  );
}
