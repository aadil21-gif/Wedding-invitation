import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SeeFar",
    short_name: "SeeFar",
    description: "A voice-first assistant for low vision: see, ask, remember, navigate.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b4ea2",
    orientation: "portrait",
    categories: ["productivity", "utilities", "education"],
    shortcuts: [
      { name: "French with Pierre", short_name: "French", url: "/?open=french", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
