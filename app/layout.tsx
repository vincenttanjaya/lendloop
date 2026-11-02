import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { EnsureUser } from "@/components/ensure-user";
import { Nav } from "@/components/nav";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LendLoop",
  description: "Borrow what you need. Lend what you don’t.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-50 font-sans text-zinc-900">
        <Providers>
          <Nav />
          <EnsureUser />
          <main className="mx-auto w-full max-w-3xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
