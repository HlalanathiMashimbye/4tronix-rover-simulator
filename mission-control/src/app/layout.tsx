import type { Metadata } from "next";
import { Inter, Fredoka } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { LearnerProvider } from "@/contexts/LearnerContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SearchProvider } from "@/contexts/SearchContext";
import { PageTransition } from "@/components/layout/PageTransition";

// Runs before hydration (next/script's beforeInteractive: "injected into the
// initial HTML from the server, downloaded before any Next.js module" -
// exactly what avoids a flash of the wrong theme). Decides once, synchronously,
// what data-theme starts as: a saved choice if the learner picked one, else
// the OS preference. ThemeContext reads this same attribute back on mount
// rather than re-deriving it, so the two can't disagree.
const THEME_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
})();
`;

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const fredoka = Fredoka({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const APP_TITLE = "Mission Control · Mars Mission Platform";
// Describes what the platform actually does. The previous line promised a
// rover called Sparky and mission patches to earn; neither exists anywhere in
// the codebase, and this string is what a shared link shows to someone who has
// never seen the site.
const APP_DESCRIPTION =
  "Write a rover mission in blocks or Python, send it to a real Mars rover at the yard, and watch the video of your code driving it.";

export const metadata: Metadata = {
  // Absolute base for the og:image URL. Open Graph requires an absolute URL,
  // and a crawler resolving a relative one against its own host gets nothing,
  // so a shared link shows no image at all. Falls back to localhost for dev.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: APP_TITLE,
  description: APP_DESCRIPTION,

  // The tab icon and the link preview both come from app/ file conventions:
  // icon.png, apple-icon.png, favicon.ico and opengraph-image.jpg. All four
  // are the SAME centre crop of public/rover-hero.jpg that the navbar renders
  // top-left, so the rover in the tab is the rover on the page.
  openGraph: {
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    type: "website",
    siteName: "Mission Control",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_TITLE,
    description: APP_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fredoka.variable} h-full antialiased`}
      // data-theme and style are set by the beforeInteractive script above,
      // before hydration - server-rendered HTML never has them, so React
      // correctly sees a diff here on every load. That is the whole point of
      // this technique (decide the theme before paint, without knowing it at
      // build time), so the mismatch is expected rather than a real bug.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col relative">
        {/* Per next/script's own docs: beforeInteractive scripts are placed
            in the component tree (body is the documented location for the
            App Router - Next hoists it into <head> at build time regardless
            of where it's written; there's no hand-authored <head> in the App
            Router the way Pages Router's _document.js has one). */}
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>

        {/* Clean starfield backdrop: a single drifting layer of distant stars,
            kept subtle so the UI reads like a punchy video feed, not a glow.
            Hidden under light mode - see [data-theme="light"] .starfield in
            globals.css. */}
        <div className="pointer-events-none fixed -inset-[1200px] -z-10 starfield opacity-40 animate-drift" />

        {/* Planets and shooting stars for a livelier backdrop */}
        <div className="pointer-events-none fixed top-12 left-8 -z-5 planet planet--small animate-orbit" />
        <div className="pointer-events-none fixed top-32 right-24 -z-5 planet planet--large" />
        <div className="pointer-events-none fixed -z-5">
          <div className="shooting-star animate-shoot" style={{ top: '14vh', left: '6vw', animationDelay: '0s' }} />
          <div className="shooting-star animate-shoot" style={{ top: '28vh', left: '40vw', animationDelay: '2s' }} />
          <div className="shooting-star animate-shoot" style={{ top: '8vh', left: '72vw', animationDelay: '4s' }} />
        </div>

        {/* One restrained Mars glow anchored in a corner for warmth (no neon). */}
        <div className="pointer-events-none fixed -bottom-72 -right-52 h-[560px] w-[560px] rounded-full bg-gradient-mars opacity-[0.14] blur-3xl" />

        <ThemeProvider>
          <LearnerProvider>
            {/* Wraps Navbar AND the page: the navbar renders the search UI
                while each page publishes what is searchable. */}
            <SearchProvider>
            <Navbar />
            {/* pb on mobile keeps content clear of the fixed bottom tab bar */}
            <div className="pb-16 md:pb-0">
              <PageTransition>{children}</PageTransition>
            </div>
            </SearchProvider>
          </LearnerProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
