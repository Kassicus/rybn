import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Every signed-in surface, /admin included.
//
// /admin/* was missing here and its ONLY gate was the redirect in
// app/(dashboard)/layout.tsx -- a layout, i.e. a gate that holds because of
// where the routes happen to sit in the tree, not because anything declares
// them protected. That file's own comment flagged the arrangement as
// load-bearing by accident. It stays (a layout redirect is the better
// signed-out UX), but it is no longer the only thing standing there.
//
// /secret-santa(.*) was here and matched no route in the build -- there is no
// app/**/secret-santa. Sitting next to a genuinely missing entry, a pattern
// for a route that does not exist reads as coverage that is not there.
const isProtectedRoute = createRouteMatcher([
  "/admin(.*)",
  "/dashboard(.*)",
  "/groups(.*)",
  "/profile(.*)",
  "/wishlist(.*)",
  "/gifts(.*)",
  "/gift-tracker(.*)",
  "/gift-exchange(.*)",
  "/settings(.*)",
]);

export const proxy = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
