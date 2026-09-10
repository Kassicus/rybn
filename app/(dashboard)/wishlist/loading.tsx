// Mirrors app/(dashboard)/wishlist/page.tsx: a max-w-4xl column of full-width
// item cards, not the max-w-6xl three-column grid this used to describe.
export default function WishlistLoading() {
  return (
    <div className="mx-auto flex max-w-4xl animate-pulse flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="h-9 w-44 rounded bg-muted" />
          <div className="h-5 w-64 max-w-full rounded bg-muted" />
        </div>
        <div className="h-10 w-32 rounded bg-muted" />
      </div>

      <div className="flex flex-col gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-light-border bg-light-background p-4"
          >
            <div className="flex gap-4">
              <div className="h-24 w-24 shrink-0 rounded-md bg-muted" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="h-6 w-1/2 rounded bg-muted" />
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="flex flex-wrap gap-4 pt-1">
                  <div className="h-4 w-20 rounded bg-muted" />
                  <div className="h-4 w-16 rounded bg-muted" />
                  <div className="h-4 w-28 rounded bg-muted" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
