import { useEffect, useState, type CSSProperties } from "react";

/**
 * A logo drawn in one solid colour (UX-43, the shared library's `.logo-mask`): the image is only a
 * mask, so the logo follows the theme and High contrast. Its shape keeps the image's own ratio.
 */
export default function LogoMask({
  url,
  label,
  colour = "text",
  className = "",
}: {
  url: string;
  /** The accessible name, usually the series or show name. */
  label: string;
  colour?: "text" | "accent";
  className?: string;
}) {
  const ratio = useImageRatio(url);
  return (
    <span
      className={["logo-mask", className].filter(Boolean).join(" ")}
      role="img"
      aria-label={label}
      data-colour={colour}
      style={
        {
          "--logo": `url("${url.replace(/"/g, "%22")}")`,
          ...(ratio ? { "--logo-ratio": ratio } : {}),
        } as CSSProperties
      }
    />
  );
}

/** "640 / 120" once the image has loaded; SVG files without a size keep the default ratio. */
export function useImageRatio(url: string) {
  const [ratio, setRatio] = useState<{ url: string; value: string } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (live && image.naturalWidth && image.naturalHeight)
        setRatio({
          url,
          value: `${image.naturalWidth} / ${image.naturalHeight}`,
        });
    };
    image.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return ratio?.url === url ? ratio.value : null;
}
