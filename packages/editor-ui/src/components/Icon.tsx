import type { CSSProperties } from "react";

/**
 * A small, hand-drawn line-icon set (no external dependency, per CLAUDE.md:
 * 新しい依存は提案してから). Icons share one 24x24 grid and a 1.75 stroke so
 * the UI reads as one refined system (VSCode / Shopify Polaris 風). Colour comes
 * from `currentColor`, so an icon inherits the surrounding text colour and
 * active/hover states for free.
 */
export type IconName =
  // site navigation
  | "info"
  | "posts"
  | "pages"
  | "media"
  | "types"
  | "taxonomies"
  | "menus"
  | "forms"
  | "redirects"
  | "publish"
  | "theme"
  | "settings"
  // actions / glyphs
  | "grip"
  | "chevron-up"
  | "chevron-down"
  | "x"
  | "plus"
  | "folder"
  | "check"
  | "more";

interface IconProps {
  name: IconName;
  /** Pixel size of the square icon. Defaults to 1em so it tracks font size. */
  size?: number | string;
  className?: string;
  style?: CSSProperties;
}

/** Filled dots used by multi-dot glyphs (grip, more). */
function dots(points: [number, number][]) {
  return points.map(([cx, cy], i) => (
    <circle key={i} cx={cx} cy={cy} r={1.1} fill="currentColor" stroke="none" />
  ));
}

function paths(name: IconName) {
  switch (name) {
    case "info":
      return (
        <>
          <circle cx={12} cy={12} r={9} />
          <path d="M12 11v5" />
          <circle cx={12} cy={7.75} r={0.6} fill="currentColor" stroke="none" />
        </>
      );
    case "posts":
      return (
        <>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6" />
          <path d="M9 13h6M9 17h6" />
        </>
      );
    case "pages":
      return (
        <>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6" />
        </>
      );
    case "media":
      return (
        <>
          <rect x={3} y={3} width={18} height={18} rx={2.5} />
          <circle cx={8.5} cy={9} r={1.6} />
          <path d="M21 16.5 16 11l-8.5 8.5" />
        </>
      );
    case "types":
      return (
        <>
          <path d="M12 3 3 7.5l9 4.5 9-4.5z" />
          <path d="M3 16.5 12 21l9-4.5" />
          <path d="M3 12 12 16.5 21 12" />
        </>
      );
    case "taxonomies":
      return (
        <>
          <path d="M11.5 3H5a2 2 0 0 0-2 2v6.5a2 2 0 0 0 .6 1.4l7.5 7.5a2 2 0 0 0 2.8 0l6.1-6.1a2 2 0 0 0 0-2.8l-7.5-7.5A2 2 0 0 0 11.5 3z" />
          <circle cx={7.5} cy={7.5} r={0.8} fill="currentColor" stroke="none" />
        </>
      );
    case "menus":
      return (
        <>
          <path d="M8 6h13M8 12h13M8 18h13" />
          {dots([
            [3.5, 6],
            [3.5, 12],
            [3.5, 18],
          ])}
        </>
      );
    case "forms":
      return (
        <>
          <path d="M22 12h-5l-2 3H9l-2-3H2" />
          <path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z" />
        </>
      );
    case "redirects":
      return (
        <>
          <path d="M15 14l5-5-5-5" />
          <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
        </>
      );
    case "publish":
      return (
        <>
          <path d="M12 13v8" />
          <path d="m8 17 4-4 4 4" />
          <path d="M20.5 18a5 5 0 0 0-2.5-9.4h-1.3A7 7 0 1 0 5 16.3" />
        </>
      );
    case "theme":
      return (
        <>
          <path d="M12 21a9 9 0 1 1 0-18 8 8 0 0 1 8 8 4 4 0 0 1-4 4h-1.8a1.6 1.6 0 0 0-1.3 2.6 1.6 1.6 0 0 1-.9 2.4z" />
          {dots([
            [7.5, 11.5],
            [10, 7.5],
            [15, 7.5],
          ])}
        </>
      );
    case "settings":
      return (
        <>
          <path d="M5 21v-6M5 11V3M12 21v-9M12 8V3M19 21v-5M19 12V3" />
          <path d="M2 15h6M9 8h6M16 16h6" />
        </>
      );
    case "grip":
      return (
        <>
          {dots([
            [9, 5],
            [9, 12],
            [9, 19],
            [15, 5],
            [15, 12],
            [15, 19],
          ])}
        </>
      );
    case "chevron-up":
      return <path d="m18 15-6-6-6 6" />;
    case "chevron-down":
      return <path d="m6 9 6 6 6-6" />;
    case "x":
      return <path d="M18 6 6 18M6 6l12 12" />;
    case "plus":
      return <path d="M5 12h14M12 5v14" />;
    case "folder":
      return (
        <path d="M20 20a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7.1a2 2 0 0 1-1.7-.9L10.1 4.9A2 2 0 0 0 8.4 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z" />
      );
    case "check":
      return <path d="M20 6 9 17l-5-5" />;
    case "more":
      return (
        <>
          {dots([
            [5, 12],
            [12, 12],
            [19, 12],
          ])}
        </>
      );
  }
}

/** Inline SVG icon. `aria-hidden`: labels/titles carry the accessible name. */
export function Icon({ name, size = "1em", className, style }: IconProps) {
  return (
    <svg
      className={className ? `pcms-icon ${className}` : "pcms-icon"}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths(name)}
    </svg>
  );
}
