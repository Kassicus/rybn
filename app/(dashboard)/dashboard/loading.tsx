// Mirrors app/(dashboard)/dashboard/page.tsx. If that layout changes, this has
// to change with it: a skeleton that describes a page which no longer exists
// makes the load feel like a redesign flashing past.
export default function DashboardLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      {/* Hero. Bars are tinted hero ink, not bg-muted -- a cream bar on a
          cream page is invisible once it sits on the evergreen block. */}
      <div className="rounded-xl border border-hero-line bg-hero p-8 md:p-10">
        <div className="flex flex-col gap-7">
          <div className="flex flex-col gap-2">
            <div className="h-9 w-72 max-w-full rounded bg-hero-ink/20" />
            <div className="h-6 w-96 max-w-full rounded bg-hero-ink/15" />
          </div>
          <div className="flex flex-wrap gap-x-10 gap-y-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="h-8 w-10 rounded bg-hero-ink/20" />
                <div className="h-4 w-28 rounded bg-hero-ink/15" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Five navigation cards across three columns. */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex flex-col items-start gap-5 rounded-lg border border-light-border bg-light-background p-6"
          >
            <div className="h-12 w-12 rounded-md bg-muted" />
            <div className="flex w-full flex-col gap-1.5">
              <div className="h-6 w-32 rounded bg-muted" />
              <div className="h-5 w-24 rounded bg-muted" />
            </div>
            <div className="flex w-full items-center justify-between gap-3">
              <div className="h-5 w-20 rounded bg-muted" />
              <div className="h-5 w-24 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>

      {/* Featured exchange */}
      <div className="flex flex-col gap-4">
        <div className="h-7 w-40 rounded bg-muted" />
        <div className="rounded-lg border border-light-border bg-light-background p-5">
          <div className="mb-3 h-6 w-48 rounded bg-muted" />
          <div className="mb-2 h-4 w-full rounded bg-muted" />
          <div className="h-4 w-3/4 rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
