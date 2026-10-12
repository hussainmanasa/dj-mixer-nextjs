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
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
