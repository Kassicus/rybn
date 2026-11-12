import { notFound } from "next/navigation";

import { getDeveloperId } from "@/lib/auth/developer";

import { ApiExplorer } from "./ApiExplorer";

/**
 * Developer page. A Server Component, so that who may see it is decided on
 * the server before anything renders: a Clerk user id on DEVELOPER_USER_IDS
 * gets the explorer, and for everyone else this route is a 404.
 *
 * proxy.ts and app/(dashboard)/layout.tsx already require a session for
 * /admin/*; this is the check for WHICH signed-in person, and it lives here,
 * in the page, rather than in a layout.
 */
export default async function ApiExplorerPage() {
  if (!(await getDeveloperId())) {
    notFound();
  }

  return <ApiExplorer />;
}
