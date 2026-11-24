import { shownDetails } from "@/lib/wishlist/details";

/**
 * An item's details, read only, for whoever can see the item.
 *
 * `lines` is a labelled line per detail (a description list, so a screen reader hears each label then its text).
 * `line` is one line of plain text, each detail as its label and its text separated by " · ", cut off with an
 * ellipsis by CSS when it runs long. With no details it draws nothing and leaves no space.
 */
export function ItemDetailLines({
  details,
  variant,
}: {
  details: unknown;
  variant: "lines" | "line";
}) {
  const shown = shownDetails(details);
  if (shown.length === 0) return null;

  if (variant === "line") {
    return (
      <p className="mb-2 truncate text-sm text-light-text-secondary">
        {shown.map((d) => `${d.label} ${d.value}`).join(" · ")}
      </p>
    );
  }

  return (
    <dl className="space-y-1">
      {shown.map((d, i) => (
        <div key={i} className="flex flex-wrap gap-x-2">
          <dt className="text-sm text-light-text-secondary">{d.label}</dt>
          <dd>{d.value}</dd>
        </div>
      ))}
    </dl>
  );
}
