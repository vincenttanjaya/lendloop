"use client";

import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { secondaryButton } from "@/lib/ui";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/tools", label: "Tools" },
  { href: "/my/listings", label: "My listings" },
  { href: "/my/requests", label: "My requests" },
  { href: "/my/incoming", label: "Incoming" },
];

export function Nav() {
  const me = useQuery(api.users.current);
  const pathname = usePathname();
  // UI convenience only: admin.* functions check the role again in Convex.
  const links = me?.role === "admin" ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;
  return (
    <header className="border-b border-zinc-200 bg-white">
      <nav className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
        <Link href="/" className="mr-2 text-base font-bold text-emerald-700">
          LendLoop
        </Link>
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            className="text-zinc-600 hover:text-zinc-900 aria-[current=page]:font-semibold aria-[current=page]:text-zinc-900"
          >
            {label}
          </Link>
        ))}
        <div className="ml-auto flex items-center">
          <Show when="signed-in">
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button type="button" className={secondaryButton}>
                Sign in
              </button>
            </SignInButton>
          </Show>
        </div>
      </nav>
    </header>
  );
}
