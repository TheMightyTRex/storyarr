import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const APP = "Storyarr";

function pageHeading() {
  const heading = document.querySelector("main h1");
  return heading?.textContent?.replace(/\s+/g, " ").trim() || "";
}

/**
 * Names the browser tab after the page's main heading, such as "My library · Storyarr", so each
 * page has its own title for tabs, history and screen readers. Pages load their heading after
 * their data, so it follows the heading as it changes.
 */
export default function PageTitle() {
  const location = useLocation();
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const heading = pageHeading();
        const title = heading && heading !== APP ? `${heading} · ${APP}` : APP;
        if (document.title !== title) document.title = title;
      });
    };
    update();
    const main = document.querySelector("main") || document.body;
    const observer = new MutationObserver(update);
    observer.observe(main, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [location.pathname, location.search]);
  return null;
}
