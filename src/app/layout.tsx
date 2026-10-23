import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible } from "next/font/google";
import "./globals.css";
import { SettingsProvider, NO_FLASH_SCRIPT } from "@/components/SettingsProvider";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

// Atkinson Hyperlegible is designed for readability at low acuity —
// chosen per the brief's accessibility requirements, not for style.
const bodyFont = Atkinson_Hyperlegible({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "SeeFar",
  description: "A voice-first assistant for low vision: see, ask, remember, navigate.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SeeFar",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bodyFont.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Runs before paint so the stored theme/text-size apply with no flash. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <SettingsProvider>{children}</SettingsProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
