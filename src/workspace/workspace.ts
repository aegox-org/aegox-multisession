/**
 * Workspace Manager — Workspace types (AEGOX_multisession, Module 05).
 *
 * Pure data types: no `chrome.*` references. Workspaces are an organizational
 * layer above Session Core (Module 02) and Profile Manager (Module 03): a
 * workspace groups profiles, sessions, favorites and shortcuts into a named
 * working environment (e.g. "Personal", "Studies", "Development").
 *
 * Workspaces store only stable references (IDs) to profiles and sessions —
 * never copies of the underlying data. Deleting a workspace never deletes
 * profiles or sessions.
 *
 * Derived from SplitSession's container and tag patterns
 * (https://github.com/Misyuk-T/splitsession, MIT License).
 */

import type { ProfileId } from "../profiles/profile-manager/profile";
import type { SessionId } from "../core/session-manager/session";

/** Unique identifier for a workspace (UUID v4). Never changes during lifetime. */
export type WorkspaceId = string;

/** Lifecycle states for a workspace. */
export type WorkspaceState =
  | "active"
  | "archived"
  | "temporary"
  | "deleted";

/** How a workspace was created. */
export type WorkspaceOrigin = "manual" | "automatic";

/** Switching mode for workspace activation. */
export type WorkspaceSwitchMode = "flexible" | "exclusive";

/** Type of a membership link inside a workspace. */
export type WorkspaceMembershipType = "profile" | "session" | "shortcut";

/** Metadata associated with a workspace. */
export interface WorkspaceMetadata {
  /** Human-readable name, unique among non-imported workspaces. */
  name: string;
  /** Visual color (`#rgb`/`#rrggbb`/`#rrggbbaa`) or null. */
  color: string | null;
  /** Short icon identifier or emoji, or null. */
  icon: string | null;
  /** Optional description. */
  description: string | null;
  /** When the workspace was created (epoch ms). */
  createdAt: number;
  /** When the workspace was last used (epoch ms), or null. */
  lastUsedAt: number | null;
  /** Whether this is the default workspace for new contexts. */
  isDefault: boolean;
}

/** Quick-access shortcut inside a workspace. */
export interface WorkspaceShortcut {
  /** Unique shortcut ID within the workspace. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Target URL or internal reference. */
  target: string;
  /** Optional icon. */
  icon: string | null;
  /** Order position (lower comes first). */
  order: number;
}

/** One membership link: a profile, session or shortcut inside a workspace. */
export interface WorkspaceMembership {
  /** Type of the linked item. */
  type: WorkspaceMembershipType;
  /** ID of the linked item (profileId, sessionId or shortcutId). */
  itemId: string;
  /** When the link was created (epoch ms). */
  createdAt: number;
  /** Order position within the workspace (lower comes first). */
  order: number;
}

/** One workspace: a named grouping of profiles, sessions and shortcuts. */
export interface Workspace {
  /** Unique identifier (UUID). Never changes during lifetime. */
  id: WorkspaceId;
  /** Current lifecycle state. */
  state: WorkspaceState;
  /** Workspace metadata. */
  metadata: WorkspaceMetadata;
  /** Creation origin. */
  origin: WorkspaceOrigin;
  /** Optional expiration for temporary workspaces (epoch ms). */
  expiresAt: number | null;
  /** Tags/labels for organization and search. */
  tags: string[];
  /** Manual sort position (lower comes first). */
  order: number;
  /** Whether switching to this workspace is exclusive (one at a time). */
  exclusive: boolean;
}

/** Input accepted by `WorkspaceManager.create` (validated, then normalized). */
export interface WorkspaceCreateInput {
  name?: unknown;
  color?: unknown;
  icon?: unknown;
  description?: unknown;
  isDefault?: unknown;
  tags?: unknown;
  state?: unknown;
  origin?: unknown;
  expiresAt?: unknown;
  exclusive?: unknown;
}

/** Result of creating a workspace. */
export interface WorkspaceCreated {
  workspace: Workspace;
  /** True if another workspace looks very similar (not merged). */
  duplicateDetected: boolean;
}

/** Validation result for workspace metadata. */
export type WorkspaceValidation =
  | { ok: true; metadata: WorkspaceMetadata; tags: string[] }
  | { ok: false; message: string };

/** Maximum length for a workspace name. */
export const MAX_WORKSPACE_NAME = 64;

/** Maximum length for a workspace description. */
export const MAX_WORKSPACE_DESCRIPTION = 500;

/** Maximum number of tags per workspace. */
export const MAX_WORKSPACE_TAGS = 32;

/** Maximum length of one tag. */
export const MAX_WORKSPACE_TAG_LENGTH = 32;

/** Default workspace color. */
export const DEFAULT_WORKSPACE_COLOR = "#5b3fd6";

/** Default workspace icon. */
export const DEFAULT_WORKSPACE_ICON = "layout";

/** Default workspace settings; conservative and local-only. */
export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  theme: "inherit",
  sessionView: "inherit",
  exclusive: false,
  restoreOnStartup: false,
  openUrlsOnActivate: [],
};

/** Re-export for convenience. */
export { DEFAULT_WORKSPACE_PREFERENCES as defaultWorkspacePreferences };

/** Result of switching to a workspace. */
export interface WorkspaceSwitchResult {
  /** True if the switch succeeded. */
  ok: boolean;
  /** The workspace after switching, or undefined on failure. */
  workspace?: Workspace;
  /** Human-readable error when the switch failed. */
  error?: string;
}

/** Context-menu entry for workspace switching. */
export interface ContextMenuWorkspaceItem {
  /** Workspace ID. */
  workspaceId: WorkspaceId;
  /** Display name. */
  title: string;
  /** Whether this is the active workspace. */
  active: boolean;
  /** Whether the workspace can be switched to. */
  available: boolean;
}

/** Browser-agnostic context-menu tree for workspaces. */
export interface WorkspaceContextMenu {
  id: string;
  title: string;
  contexts: Array<"page" | "action">;
  children: Array<{
    id: string;
    title: string;
    enabled: boolean;
    type: "radio" | "normal";
    checked?: boolean;
  }>;
}

/** Result of duplicate detection between workspaces. */
export interface WorkspaceDuplicateCheck {
  /** True if a potential duplicate was found. */
  isDuplicate: boolean;
  /** The existing workspace that matches, if any. */
  existing?: Workspace;
  /** Reason for the duplicate determination. */
  reason?: string;
}

/** A duplicate group: workspaces that may be duplicates. */
export interface WorkspaceDuplicateGroup {
  /** Key identifying the group. */
  key: string;
  /** Workspaces in this group. */
  workspaces: Workspace[];
  /** Why they might be duplicates. */
  reason: string;
}

/** Workspace-specific preferences. `inherit` means "use the global default". */
export interface WorkspacePreferences {
  /** Theme: "inherit" | "light" | "dark" | "system". */
  theme: "inherit" | "light" | "dark" | "system";
  /** Session view: "inherit" | "compact" | "cards" | "table". */
  sessionView: "inherit" | "compact" | "cards" | "table";
  /** Whether switching to this workspace is exclusive. */
  exclusive: boolean;
  /** Reopen the workspace's sessions when the browser starts. */
  restoreOnStartup: boolean;
  /** URLs to open when activating this workspace. */
  openUrlsOnActivate: string[];
}

/** Patch accepted by `WorkspaceManager.update`. */
export interface WorkspacePatch {
  name?: string;
  color?: string | null;
  icon?: string | null;
  description?: string | null;
  tags?: string[];
  state?: WorkspaceState;
  expiresAt?: number | null;
  exclusive?: boolean;
}

/** Preferences patch for a workspace. */
export interface WorkspacePreferencesPatch {
  theme?: "inherit" | "light" | "dark" | "system";
  sessionView?: "inherit" | "compact" | "cards" | "table";
  exclusive?: boolean;
  restoreOnStartup?: boolean;
  openUrlsOnActivate?: string[];
}

/** Result of exporting a workspace. */
export interface WorkspaceExport {
  /** Schema version. */
  version: 1;
  /** Format identifier. */
  format: "aegox.workspace.v1";
  /** When the export was created (epoch ms). */
  exportedAt: number;
  /** The workspace metadata. */
  workspace: Omit<Workspace, "id"> & { id: WorkspaceId };
  /** Membership links (profiles, sessions, shortcuts). */
  memberships: WorkspaceMembership[];
  /** Shortcuts in the workspace. */
  shortcuts: WorkspaceShortcut[];
  /** Workspace-specific preferences. */
  preferences: WorkspacePreferences;
}

/** Validation result for an import package. */
export interface WorkspaceImportValidation {
  /** True when the package is valid. */
  valid: boolean;
  /** Human-readable error messages. */
  errors: string[];
  /** Human-readable warnings (non-fatal). */
  warnings: string[];
}

/** Result of evaluating temporary workspace expiry. */
export interface WorkspaceExpiryEvaluation {
  /** Workspaces that have reached their expiry. */
  expired: Workspace[];
  /** Workspaces approaching expiry (within warning window). */
  expiringSoon: Workspace[];
}

/** Storage key for workspaces. */
export const WORKSPACES_KEY = "aegox.workspaces.v1";

/** Storage key for workspace memberships. */
export const WORKSPACE_MEMBERSHIPS_KEY = "aegox.workspace.memberships.v1";

/** Storage key for workspace shortcuts. */
export const WORKSPACE_SHORTCUTS_KEY = "aegox.workspace.shortcuts.v1";

/** Storage key for workspace preferences. */
export const WORKSPACE_PREFERENCES_KEY = "aegox.workspace.preferences.v1";

/** Storage key for the active workspace ID. */
export const ACTIVE_WORKSPACE_KEY = "aegox.activeWorkspaceId.v1";

/** Context-menu prefix for workspace menu items. */
export const WORKSPACE_MENU_ID_PREFIX = "aegox-workspace:";

/** Parent context-menu item ID for workspaces. */
export const WORKSPACE_MENU_PARENT_ID = "aegox-workspaces";

/** Warning window for temporary workspace expiry (epoch ms). */
export const TEMPORARY_WARNING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Default page size for large workspace collections. */
export const WORKSPACE_PAGE_SIZE = 50;
