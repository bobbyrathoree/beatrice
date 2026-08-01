// themeColors — resolve a theme's on-screen colours from THEME DATA.
//
// The 3D scene used to hold two copies of a `switch (themeName)` colour table,
// which meant a newly added theme silently rendered a generic cyan default. The
// colours now live on the Rust `Theme.visuals` (see src-tauri/src/themes/types.rs)
// and arrive via `list_themes()`, so any theme in the registry is coloured by its
// own curated palette with no UI change required.
import type { ThemeVisuals } from "../../bindings";

export interface SceneColors {
  primary: string;
  emissive: string;
}

/**
 * Fallback used only when the theme summaries haven't loaded yet (first paint)
 * or a persisted run names a theme the backend no longer registers. This is the
 * ONE place a default colour is allowed to exist.
 */
export const FALLBACK_SCENE_COLORS: SceneColors = {
  primary: "#00FFFF",
  emissive: "#0088FF",
};

/** Map a theme's `visuals` (or nothing, pre-load) to scene colours. */
export function sceneColors(visuals?: ThemeVisuals | null): SceneColors {
  if (!visuals) return FALLBACK_SCENE_COLORS;
  return { primary: visuals.accent_hex, emissive: visuals.emissive_hex };
}
