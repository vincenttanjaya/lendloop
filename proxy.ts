import { clerkMiddleware } from "@clerk/nextjs/server";

// Sends signed-out visitors of the signed-in pages to sign-in before anything renders.
// This is a UX gate, not the security boundary: Next serves no protected data, and every Convex
// function re-checks identity and role. (A plain regex, because Clerk deprecated createRouteMatcher.)
const SIGNED_IN_ONLY = /^\/(tools|my|admin)(\/|$)/;

export default clerkMiddleware(async (auth, req) => {
  if (SIGNED_IN_ONLY.test(req.nextUrl.pathname)) await auth.protect();
});

export const config = {
  // Every page (the public one too, so `auth()` works there); skips Next internals and static files.
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)"],
};
