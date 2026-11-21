/**
 * Workspace Manager — Workspace preferences (AEGOX_multisession, Module 05).
 *
 * Pure logic for resolving workspace-specific preferences against global
 * (Module 04) dashboard preferences. Workspace preferences can override
 * individual keys; anything set to "inherit" falls back to the global value.
 *
 * Pure TypeScript: no `chrome.*` references, no DOM.
 */

import type { DashboardPreferences } from "../ui-system/preferences";
import type {
  WorkspacePreferences,
  WorkspacePreferencesPatch,
} from "./workspace";
import { DEFAULT_WORKSPACE_PREFERENCES } from "./workspace";

/** Fully resolved workspace preferences (no "inherit" values remain). */
export interface ResolvedWorkspacePreferences {
  theme: "light" | "dark" | "system";
  sessionView: "compact" | "cards" | "table";
  exclusive: boolean;
  restoreOnStartup: boolean;
  openUrlsOnActivate: string[];
}

/** Resolves workspace preferences against global defaults.
 *
 * Resolution order (highest priority first):
 *   1. Workspace override (if not "inherit")
 *   2. Global dashboard preference
 *   3. Hard-coded default
 */
export function resolveWorkspacePreferences(
  workspacePrefs: WorkspacePreferences,
  globalPrefs: DashboardPreferences,
): ResolvedWorkspacePreferences {
  return {
    theme:
      workspacePrefs.theme !== "inherit"
        ? workspacePrefs.theme
        : globalPrefs.theme,
    sessionView:
      workspacePrefs.sessionView !== "inherit"
        ? workspacePrefs.sessionView
        : globalPrefs.sessionView,
    exclusive: workspacePrefs.exclusive,
    restoreOnStartup: workspacePrefs.restoreOnStartup,
    openUrlsOnActivate: [...workspacePrefs.openUrlsOnActivate],
  };
}

/** Creates default workspace preferences (all inherit from global). */
export function defaultWorkspacePreferences(): WorkspacePreferences {
  return { ...DEFAULT_WORKSPACE_PREFERENCES };
}

/** Applies a patch to workspace preferences, normalizing values. */
export function patchWorkspacePreferences(
  current: WorkspacePreferences,
  patch: WorkspacePreferencesPatch,
): WorkspacePreferences {
  return {
    theme:
      patch.theme === undefined
        ? current.theme
        : patch.theme,
    sessionView:
      patch.sessionView === undefined
        ? current.sessionView
        : patch.sessionView,
    exclusive:
      patch.exclusive === undefined
        ? current.exclusive
        : patch.exclusive,
    restoreOnStartup:
      patch.restoreOnStartup === undefined
        ? current.restoreOnStartup
        : patch.restoreOnStartup,
    openUrlsOnActivate:
      patch.openUrlsOnActivate === undefined
        ? current.openUrlsOnActivate
        : [...patch.openUrlsOnActivate],
  };
}

/** Validates a workspace preferences patch. */
export function validateWorkspacePreferencesPatch(
  patch: WorkspacePreferencesPatch,
): { ok: true } | { ok: false; message: string } {
  const validThemes: ReadonlyArray<WorkspacePreferences["theme"]> = [
    "inherit",
    "light",
    "dark",
    "system",
  ];
  const validViews: ReadonlyArray<WorkspacePreferences["sessionView"]> = [
    "inherit",
    "compact",
    "cards",
    "table",
  ];

  if (
    patch.theme !== undefined &&
    !validThemes.includes(patch.theme)
  ) {
    return { ok: false, message: "Invalid theme preference." };
  }
  if (
    patch.sessionView !== undefined &&
    !validViews.includes(patch.sessionView)
  ) {
    return { ok: false, message: "Invalid session view preference." };
  }
  if (
    patch.openUrlsOnActivate !== undefined &&
    !Array.isArray(patch.openUrlsOnActivate)
  ) {
    return { ok: false, message: "openUrlsOnActivate must be an array of URLs." };
  }
  return { ok: true };
}

/** Normalizes stored workspace preferences into a complete safe record. */
export function normalizeWorkspacePreferences(
  raw: unknown,
): WorkspacePreferences {
  const fallback = defaultWorkspacePreferences();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...fallback };
  }
  const record = raw as Record<string, unknown>;
  const validThemes: ReadonlyArray<string> = [
    "inherit",
    "light",
    "dark",
    "system",
  ];
  const validViews: ReadonlyArray<string> = [
    "inherit",
    "compact",
    "cards",
    "table",
  ];
  return {
    theme:
      typeof record.theme === "string" && validThemes.includes(record.theme)
        ? (record.theme as WorkspacePreferences["theme"])
        : fallback.theme,
    sessionView:
      typeof record.sessionView === "string" && validViews.includes(
        record.sessionView,
      )
        ? (record.sessionView as WorkspacePreferences["sessionView"])
        : fallback.sessionView,
    exclusive:
      typeof record.exclusive === "boolean"
        ? record.exclusive
        : fallback.exclusive,
    restoreOnStartup:
      typeof record.restoreOnStartup === "boolean"
        ? record.restoreOnStartup
        : fallback.restoreOnStartup,
    openUrlsOnActivate: Array.isArray(record.openUrlsOnActivate)
      ? record.openUrlsOnActivate
          .filter(
            (u): u is string => typeof u === "string" && u !== "",
          )
          .slice(0, 50)
      : fallback.openUrlsOnActivate,
  };
}
