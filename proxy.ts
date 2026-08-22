import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/groups(.*)",
  "/profile(.*)",
  "/wishlist(.*)",
  "/gifts(.*)",
  "/gift-tracker(.*)",
  "/gift-exchange(.*)",
  "/secret-santa(.*)",
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
