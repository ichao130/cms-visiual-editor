import { useEffect, useRef, useState } from "react";

/** Logical width the thumbnail iframe renders at before being scaled to fit. */
const THUMB_BASE_WIDTH = 1200;

/**
 * A scaled, inert mini-render of a page. The iframe renders the page at a fixed
 * logical width and is scaled down to the container's width, so a card shows a
 * faithful preview rather than a placeholder. Shared by the site cards and the
 * theme cards.
 */
export function PreviewThumb({ html }: { html: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(THUMB_BASE_WIDTH ? 0.18 : 1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / THUMB_BASE_WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="pcms-card__preview" ref={ref} aria-hidden="true">
      {html ? (
        <iframe
          className="pcms-card__previewframe"
          srcDoc={html}
          sandbox=""
          scrolling="no"
          tabIndex={-1}
          title=""
          style={{ transform: `scale(${scale})` }}
        />
      ) : (
        <div className="pcms-card__previewempty" />
      )}
    </div>
  );
}
