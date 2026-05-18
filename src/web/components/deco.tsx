import type { FC, PropsWithChildren } from "hono/jsx";
import type { Banter } from "../lib/banter.js";

/**
 * Art Deco frame for a single panel on the Gatsby Pavilion.
 */
export const DecoFrame: FC<PropsWithChildren<{ index: number; title: string; kicker?: string }>> = ({
  index,
  title,
  kicker,
  children,
}) => (
  <section class="gatsby-frame">
    <header class="gatsby-frame__head">
      <span class="gatsby-frame__numeral">{romanNumeral(index)}</span>
      <div class="gatsby-frame__titles">
        {kicker ? <span class="gatsby-frame__kicker">{kicker}</span> : null}
        <h2 class="gatsby-frame__title">{title}</h2>
      </div>
      <DecoSunburst />
    </header>
    <DecoDivider />
    <div class="gatsby-frame__body">{children}</div>
  </section>
);

export const DecoCaption: FC<{ banter: Banter }> = ({ banter }) => (
  <figure class="gatsby-caption">
    <div class="gatsby-caption__rule" aria-hidden="true">
      <span /> <span class="gatsby-caption__diamond" aria-hidden="true">◆</span> <span />
    </div>
    <blockquote>
      <p class="gatsby-caption__headline">{banter.headline}</p>
      <p class="gatsby-caption__subtitle">{banter.subtitle}</p>
    </blockquote>
  </figure>
);

export const DecoDivider: FC = () => (
  <div class="gatsby-divider" aria-hidden="true">
    <span class="gatsby-divider__line" />
    <span class="gatsby-divider__diamond">◆</span>
    <span class="gatsby-divider__line" />
  </div>
);

const DecoSunburst: FC = () => (
  <svg viewBox="0 0 40 40" class="gatsby-sunburst" aria-hidden="true">
    <g stroke="currentColor" stroke-width="1" fill="none">
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i * Math.PI) / 6;
        const x1 = 20 + Math.cos(a) * 6;
        const y1 = 20 + Math.sin(a) * 6;
        const x2 = 20 + Math.cos(a) * 18;
        const y2 = 20 + Math.sin(a) * 18;
        return <line x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      <circle cx="20" cy="20" r="5" />
      <circle cx="20" cy="20" r="2" fill="currentColor" />
    </g>
  </svg>
);

function romanNumeral(n: number): string {
  const numerals: Array<[number, string]> = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let v = n;
  for (const [val, sym] of numerals) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out || "—";
}
