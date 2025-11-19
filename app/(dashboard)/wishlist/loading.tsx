export default function WishlistLoading() {
  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-9 bg-gray-200 rounded w-40 mb-2" />
          <div className="h-4 bg-gray-200 rounded w-64" />
        </div>
        <div className="h-10 bg-gray-200 rounded w-36" />
      </div>

      {/* Wishlist Items Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="p-4 rounded-lg border border-light-border bg-white">
            <div className="flex gap-4">
              {/* Image skeleton */}
              <div className="w-24 h-24 bg-gray-200 rounded-md flex-shrink-0" />

              {/* Content skeleton */}
              <div className="flex-1 min-w-0 space-y-2">
                <div className="h-5 bg-gray-200 rounded w-full" />
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />

                <div className="flex items-center gap-2">
                  <div className="h-3 bg-gray-200 rounded w-16" />
                  <div className="h-3 bg-gray-200 rounded w-12" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
