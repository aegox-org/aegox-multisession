/**
 * Workspace Manager — Public entry point (AEGOX_multisession, Module 05).
 *
 * Import from `src/workspace` rather than reaching into subfolders. Every module
 * here is browser-neutral; browser wiring lives in the UI/background layer.
 */

// Types and constants from workspace.ts (the main types file)
export {
  type WorkspaceId,
  type WorkspaceState,
  type WorkspaceOrigin,
  type WorkspaceSwitchMode,
  type WorkspaceMembershipType,
  type WorkspaceMetadata,
  type WorkspaceShortcut,
  type WorkspaceMembership,
  type Workspace,
  type WorkspaceCreateInput,
  type WorkspaceCreated,
  type WorkspaceValidation,
  type WorkspacePatch,
  type WorkspacePreferences,
  type WorkspacePreferencesPatch,
  type WorkspaceDuplicateCheck,
  type WorkspaceDuplicateGroup,
  type WorkspaceExpiryEvaluation,
  type WorkspaceExport,
  type WorkspaceImportValidation,
  MAX_WORKSPACE_NAME,
  MAX_WORKSPACE_DESCRIPTION,
  MAX_WORKSPACE_TAGS,
  MAX_WORKSPACE_TAG_LENGTH,
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_WORKSPACE_ICON,
  DEFAULT_WORKSPACE_PREFERENCES,
  WORKSPACES_KEY,
  WORKSPACE_MEMBERSHIPS_KEY,
  WORKSPACE_SHORTCUTS_KEY,
  WORKSPACE_PREFERENCES_KEY,
  WORKSPACE_MENU_ID_PREFIX,
  WORKSPACE_MENU_PARENT_ID,
  TEMPORARY_WARNING_WINDOW_MS,
  WORKSPACE_PAGE_SIZE,
} from "./workspace";

// Functions from workspace-manager.ts (where they're actually defined)
export {
  generateWorkspaceId,
  sanitizeWorkspaceNameInput,
  normalizeWorkspaceTags,
  validateWorkspaceMetadata,
  createWorkspace,
  isDuplicateWorkspace,
  checkWorkspaceDuplicate,
} from "./workspace-manager";

// Manager
export { WorkspaceManager, WorkspaceError } from "./workspace-manager";

// Preferences
export {
  defaultWorkspacePreferences,
  normalizeWorkspacePreferences,
  patchWorkspacePreferences,
  resolveWorkspacePreferences,
  validateWorkspacePreferencesPatch,
  type ResolvedWorkspacePreferences,
} from "./workspace-preferences";

// Navigation
export { WorkspaceNavigation } from "./workspace-navigation";
export type {
  WorkspaceSwitchResult,
  ContextMenuWorkspaceItem,
  WorkspaceContextMenu,
} from "./workspace-navigation";
export { ACTIVE_WORKSPACE_KEY } from "./workspace-navigation";
