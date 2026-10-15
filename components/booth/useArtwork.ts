"use client";

import { useEffect, useState } from "react";
import { artworkUrl } from "@/lib/library/artwork";
import type { Track } from "@/lib/types";
import { useLibrary } from "@/store/library";

/** The song's cover art (object URL), or null while loading or when it has none. */
export function useArtwork(track: Track | null): string | null {
  const getFile = useLibrary((s) => s.getFile);
  const [art, setArt] = useState<{ id: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!track) return;
    let live = true;
    void artworkUrl(track, getFile).then((url) => {
      if (live) setArt({ id: track.id, url });
    });
    return () => {
      live = false;
    };
  }, [track, getFile]);
  return track && art?.id === track.id ? art.url : null;
}
