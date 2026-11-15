/**
 * The apple-app-site-association file the site serves at /.well-known/apple-app-site-association. It tells iOS that
 * the Rybn app (team 364X389QMX, bundle app.rybn.ios) opens the site's invitation links, /accept-invite, and no other
 * path.
 */
export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [{ appIDs: ["364X389QMX.app.rybn.ios"], components: [{ "/": "/accept-invite" }] }],
  },
} as const;
