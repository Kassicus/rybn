export default function SettingsLoading() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 p-6">
      <div className="animate-pulse space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <div className="h-8 bg-muted rounded w-1/4"></div>
          <div className="h-4 bg-muted rounded w-1/2"></div>
        </div>

        {/* Privacy Section */}
        <div className="space-y-4">
          <div className="h-6 bg-muted rounded w-1/3"></div>
          <div className="h-32 bg-muted rounded"></div>
        </div>

        {/* Email Notifications Section */}
        <div className="space-y-4">
          <div className="h-6 bg-muted rounded w-1/3"></div>
          <div className="space-y-3">
            <div className="h-20 bg-muted rounded"></div>
            <div className="h-20 bg-muted rounded"></div>
            <div className="h-20 bg-muted rounded"></div>
            <div className="h-20 bg-muted rounded"></div>
            <div className="h-20 bg-muted rounded"></div>
          </div>
        </div>

        {/* Button */}
        <div className="h-10 bg-muted rounded w-32"></div>
      </div>
    </div>
  );
}
