export default function GiftsLoading() {
  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-9 bg-muted rounded w-48 mb-2" />
          <div className="h-4 bg-muted rounded w-64" />
        </div>
        <div className="h-10 bg-muted rounded w-40" />
      </div>

      {/* Active Group Gifts Skeleton */}
      <div className="space-y-4">
        <div className="h-7 bg-muted rounded w-40 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-5 rounded-lg border border-light-border bg-light-background">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-12 h-12 bg-muted rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-5 bg-muted rounded w-3/4" />
                    <div className="h-4 bg-muted rounded w-1/2" />
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div className="h-4 bg-muted rounded w-full" />
                <div className="h-2 bg-muted rounded-full w-full" />
              </div>

              <div className="flex items-center gap-4 pt-3 border-t border-light-border">
                <div className="h-4 bg-muted rounded w-20" />
                <div className="h-4 bg-muted rounded w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
