import { Show, SignInButton } from "@clerk/nextjs";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { api } from "@/convex/_generated/api";
import { card, primaryButton } from "@/lib/ui";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-4 py-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-emerald-700">LendLoop</h1>
        <p className="text-lg text-zinc-600">Borrow what you need. Lend what you don’t.</p>
        <Suspense>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button type="button" className={primaryButton}>
                Sign in to lend or borrow
              </button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <Link href="/tools" className={`${primaryButton} inline-block`}>
              Browse tools
            </Link>
          </Show>
        </Suspense>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Available now</h2>
        <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
          <PublicTools />
        </Suspense>
      </section>
    </div>
  );
}

// ponytail: rendered on the server per request (so it shows without JS) but not live;
// switch to preloadQuery + usePreloadedQuery if the landing list must update in place.
async function PublicTools() {
  await connection();
  const tools = await fetchQuery(api.tools.listPublic);
  if (tools.length === 0) return <p className="text-zinc-500">No tools available right now.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {tools.map((tool) => (
        <li key={tool._id} className={card}>
          <p className="font-medium">{tool.name}</p>
          <p className="text-sm capitalize text-zinc-500">{tool.category}</p>
        </li>
      ))}
    </ul>
  );
}
