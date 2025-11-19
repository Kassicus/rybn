export default function DashboardLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      {/* Hero Banner Skeleton */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-8 mb-8 border border-primary/20">
        <div className="h-8 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="h-5 bg-gray-200 rounded w-2/3 mb-6" />
        <div className="flex gap-6">
          <div className="h-16 bg-gray-200 rounded w-32" />
          <div className="h-16 bg-gray-200 rounded w-32" />
          <div className="h-16 bg-gray-200 rounded w-32" />
        </div>
      </div>

      {/* Quick Actions Skeleton */}
      <div>
        <div className="h-7 bg-gray-200 rounded w-32 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
          ))}
        </div>
      </div>

      {/* 2x2 Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-8 rounded-2xl border border-light-border bg-light-background h-48">
            <div className="h-8 bg-gray-200 rounded w-24 mb-4" />
            <div className="h-6 bg-gray-200 rounded w-32 mb-6" />
            <div className="h-5 bg-gray-200 rounded w-20" />
          </div>
        ))}
      </div>

      {/* Featured Exchange Skeleton */}
      <div>
        <div className="h-7 bg-gray-200 rounded w-40 mb-4" />
        <div className="p-5 rounded-lg border border-light-border bg-light-background h-40">
          <div className="h-6 bg-gray-200 rounded w-48 mb-3" />
          <div className="h-4 bg-gray-200 rounded w-full mb-2" />
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </div>
      </div>
    </div>
  );
}
