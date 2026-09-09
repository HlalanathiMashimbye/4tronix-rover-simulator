import type { Metadata } from "next";
import { Inter, Fredoka } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { EnvironmentBanner } from "@/components/layout/EnvironmentBanner";
import { ChromeHeight, PAGE_AREA_ID } from "@/components/layout/ChromeHeight";
import { MilestoneTracker } from "@/components/layout/MilestoneTracker";
import { LearnerProvider } from "@/contexts/LearnerContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SearchProvider } from "@/contexts/SearchContext";
import { PageTransition } from "@/components/layout/PageTransition";
import { PostHogAnalytics } from "@/components/analytics/PostHogAnalytics";
import { resolveAppUrl } from "@/infrastructure/config/appUrl";

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
  metadataBase: new URL(resolveAppUrl()),
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
      {/* Browser extensions (Grammarly, password managers, etc.) inject their
          own attributes onto body before React hydrates - data-gr-ext-installed
          and data-new-gr-c-s-check-loaded are Grammarly's. React sees those as
          a mismatch on every load for anyone running the extension, even
          though nothing is actually wrong. Same suppression as html above, for
          the same reason: the diff is real but not a bug to fix. */}
      <body className="min-h-full flex flex-col relative" suppressHydrationWarning>
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
        {/* One clipping layer for every decorative element.

            All of these bleed past the viewport on purpose - a starfield at
            -inset-[1200px], a 560px glow anchored beyond the bottom-right
            corner, shooting stars starting at 72vw. Nothing clipped them, so
            they grew the document's scroll width and a phone could be swiped
            26px sideways into empty space.

            The children are `absolute`, not `fixed`. A fixed element is
            positioned against the viewport rather than against an
            overflow-hidden ancestor, so the clip would simply never have
            applied. This layer is already viewport-sized, so absolute puts
            them in exactly the same place and makes them clippable.

            overflow-hidden here rather than on the body: this clips exactly
            the things that are meant to be clipped, and leaves a real content
            overflow still able to show itself rather than being silently
            swallowed. pointer-events-none is repeated on the children, but
            having it on the layer means nothing new added inside can
            accidentally intercept a tap. */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        >
          <div className="pointer-events-none absolute -inset-[1200px] -z-10 starfield opacity-40 animate-drift" />

          {/* Planets and shooting stars for a livelier backdrop */}
          <div className="pointer-events-none absolute top-12 left-8 -z-5 planet planet--small animate-orbit" />
          <div className="pointer-events-none absolute top-32 right-24 -z-5 planet planet--large" />
          <div className="pointer-events-none absolute -z-5">
            <div className="shooting-star animate-shoot" style={{ top: '14vh', left: '6vw', animationDelay: '0s' }} />
            <div className="shooting-star animate-shoot" style={{ top: '28vh', left: '40vw', animationDelay: '2s' }} />
            <div className="shooting-star animate-shoot" style={{ top: '8vh', left: '72vw', animationDelay: '4s' }} />
          </div>

          {/* One restrained Mars glow anchored in a corner for warmth (no neon). */}
          <div className="pointer-events-none absolute -bottom-72 -right-52 h-[560px] w-[560px] rounded-full bg-gradient-mars opacity-[0.14] blur-3xl" />
        </div>

        <PostHogAnalytics>
          <ThemeProvider>
            <LearnerProvider>
              {/* Wraps Navbar AND the page: the navbar renders the search UI
                  while each page publishes what is searchable. */}
              <SearchProvider>
              <EnvironmentBanner />
              <Navbar />
              {/* pb on mobile keeps content clear of the fixed bottom tab bar */}
              <div id={PAGE_AREA_ID} className="pb-16 md:pb-0">
                <PageTransition>{children}</PageTransition>
              </div>
              {/* Measures the id above and publishes it as --app-chrome, which
                  is what the full-height pages subtract from the viewport. */}
              <ChromeHeight />
              {/* Renders nothing; records which pages have been opened so the
                  Level 1 challenges can ask a learner to go and look at one. */}
              <MilestoneTracker />
              </SearchProvider>
            </LearnerProvider>
          </ThemeProvider>
        </PostHogAnalytics>
      </body>
    </html>
  );
}
