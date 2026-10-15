import type { MetadataRoute } from "next";

// Lets the booth be installed as an app and launched full-screen in kiosk mode.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI DJ Mixer",
    short_name: "AI DJ",
    description: "Plug-and-play auto-DJ for clubs",
    start_url: "/booth",
    display: "fullscreen",
    background_color: "#07070b",
    theme_color: "#07070b",
    // Drawn by scripts/make-icons.mjs (also app/icon.svg, app/apple-icon.png, app/favicon.ico).
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
