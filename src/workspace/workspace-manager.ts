/**
 * Workspace Manager — WorkspaceManager class (AEGOX_multisession, Module 05).
 *
 * Manages workspaces in memory with a persisted copy in storage. Workspaces
 * are an organizational layer above Session Core (Module 02) and Profile
 * Manager (Module 03): they group profiles, sessions and shortcuts into
 * named working environments.
 *
 * Workspaces store only stable references (IDs) to profiles and sessions —
 * never copies of the underlying data. Deleting a workspace never deletes
 * profiles or sessions.
 *
 * Pure TypeScript: persistence is delegated to a provided `StorageAreaLike`.
 */

import {
  generateProfileId,
  type ProfileId,
} from "../profiles/profile-manager/profile";
import {
  type SessionId,
  generateSessionId,
} from "../core/session-manager/session";
import type { StorageAreaLike } from "../engine/storage/storage-area";
import {
  ACTIVE_WORKSPACE_KEY,
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_WORKSPACE_ICON,
  DEFAULT_WORKSPACE_PREFERENCES,
  MAX_WORKSPACE_DESCRIPTION,
  MAX_WORKSPACE_NAME,
  MAX_WORKSPACE_TAG_LENGTH,
  MAX_WORKSPACE_TAGS,
  type Workspace,
  type WorkspaceContextMenu,
  type WorkspaceCreated,
  type WorkspaceDuplicateCheck,
  type WorkspaceDuplicateGroup,
  type WorkspaceExpiryEvaluation,
  type WorkspaceExport,
  type WorkspaceId,
  type WorkspaceImportValidation,
  type WorkspaceMembership,
  type WorkspacePatch,
  type WorkspacePreferences,
  type WorkspacePreferencesPatch,
  type WorkspaceShortcut,
  type WorkspaceState,
  type WorkspaceSwitchMode,
  type WorkspaceSwitchResult,
  type WorkspaceValidation,
  type ContextMenuWorkspaceItem,
  WORKSPACE_MENU_ID_PREFIX,
  WORKSPACE_MENU_PARENT_ID,
  WORKSPACE_MEMBERSHIPS_KEY,
  WORKSPACE_PREFERENCES_KEY,
  WORKSPACE_SHORTCUTS_KEY,
  WORKSPACES_KEY,
  type WorkspaceOrigin,
  type WorkspaceCreateInput,
  type WorkspaceMetadata,
  TEMPORARY_WARNING_WINDOW_MS,
} from "./workspace";
import {
  defaultWorkspacePreferences,
  normalizeWorkspacePreferences,
  patchWorkspacePreferences,
  resolveWorkspacePreferences,
  validateWorkspacePreferencesPatch,
} from "./workspace-preferences";
import type { DashboardPreferences } from "../ui-system/preferences";

/** Error thrown by the workspace manager. */
export class WorkspaceError extends Error {}

/** Options for the workspace manager. */
export interface WorkspaceManagerOptions {
  /** Now function (ms). Default Date.now. */
  now?: () => number;
  /** Random function for ID generation. Default Math.random. */
  random?: () => number;
}

/** Normalized workspace stored in memory. */
interface StoredWorkspace extends Workspace {
  metadata: WorkspaceMetadata & { createdAt: number };
}

/** Options accepted by `createProfile`-style factory. */
interface WorkspaceFactoryOptions {
  id?: WorkspaceId;
  origin?: WorkspaceOrigin;
  state?: WorkspaceState;
  expiresAt?: number | null;
  tags?: string[];
  order?: number;
  exclusive?: boolean;
  preferences?: WorkspacePreferences;
  random?: () => number;
}

/** Sanitizes raw user input for a workspace name while typing. */
export function sanitizeWorkspaceNameInput(raw: string, max: number = MAX_WORKSPACE_NAME): string {
  const kept = Array.from(raw)
    .filter((ch) => ch.codePointAt(0)! > 0x1f && !(ch.codePointAt(0)! >= 0x7f && ch.codePointAt(0)! <= 0x9f))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(kept).slice(0, max).join("");
}

/** Normalizes tags for a workspace. */
export function normalizeWorkspaceTags(raw: unknown): string[] {
  const tags: string[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const tag = item
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[,\n\r]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_WORKSPACE_TAG_LENGTH);
      if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
        tags.push(tag);
      }
      if (tags.length >= MAX_WORKSPACE_TAGS) break;
    }
  }
  return tags;
}

/** Validates workspace metadata as the user types. */
export function validateWorkspaceMetadata(
  raw: Pick<
    WorkspaceCreateInput,
    "name" | "color" | "icon" | "description" | "isDefault" | "tags"
  >,
  existingNames: readonly string[],
  ownName?: string,
  options: { allowDuplicateName?: boolean } = {},
): WorkspaceValidation {
  const name = sanitizeWorkspaceNameInput(typeof raw.name === "string" ? raw.name : "");
  if (name.length < 1) {
    return { ok: false, message: "Give the workspace a name." };
  }
  if (Array.from(name).length > MAX_WORKSPACE_NAME) {
    return { ok: false, message: `Use at most ${MAX_WORKSPACE_NAME} characters.` };
  }

  const lower = name.toLowerCase();
  const ownLower =
    ownName === undefined ? undefined : sanitizeWorkspaceNameInput(ownName).toLowerCase();
  if (
    !options.allowDuplicateName &&
    existingNames.some(
      (n) => sanitizeWorkspaceNameInput(n).toLowerCase() === lower && lower !== ownLower,
    )
  ) {
    return { ok: false, message: `A workspace named “${name}” already exists.` };
  }

  if (
    raw.color !== undefined &&
    raw.color !== null &&
    !/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(raw.color).trim().toLowerCase())
  ) {
    return { ok: false, message: "Use a color like #5b3fd6." };
  }
  if (
    raw.icon !== undefined &&
    raw.icon !== null &&
    typeof raw.icon !== "string"
  ) {
    return { ok: false, message: "Icon must be a text value." };
  }
  if (
    raw.description !== undefined &&
    raw.description !== null &&
    typeof raw.description !== "string"
  ) {
    return { ok: false, message: "Description must be a text value." };
  }

  const description =
    typeof raw.description === "string"
      ? Array.from(raw.description.trim()).slice(0, MAX_WORKSPACE_DESCRIPTION).join("") || null
      : null;

  const tags = normalizeWorkspaceTags(raw.tags);

  return {
    ok: true,
    metadata: {
      name,
      color:
        typeof raw.color === "string" &&
        /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw.color.trim().toLowerCase())
          ? raw.color.trim().toLowerCase()
          : DEFAULT_WORKSPACE_COLOR,
      icon:
        typeof raw.icon === "string" && raw.icon.trim() !== ""
          ? raw.icon.trim().slice(0, 32)
          : DEFAULT_WORKSPACE_ICON,
      description,
      createdAt: Date.now(),
      lastUsedAt: null,
      isDefault: raw.isDefault === true,
    },
    tags,
  };
}

/** Creates a fresh `Workspace` from validated metadata. */
export function createWorkspace(
  metadata: WorkspaceMetadata,
  options: WorkspaceFactoryOptions = {},
): Workspace {
  return {
    id: options.id ?? generateWorkspaceId(options.random),
    state: options.state ?? "active",
    metadata: { ...metadata },
    origin: options.origin ?? "manual",
    expiresAt: options.expiresAt ?? null,
    tags: [...(options.tags ?? [])],
    order: options.order ?? 0,
    exclusive: options.exclusive ?? false,
  };
}

/** Generates a UUID v4 identifier for workspaces. */
export function generateWorkspaceId(random: () => number = Math.random): WorkspaceId {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(random() * 256) & 0xff;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Checks whether a workspace's metadata looks like a duplicate of another. */
export function isDuplicateWorkspace(a: Workspace, b: Workspace): boolean {
  return (
    a.metadata.name.toLowerCase() === b.metadata.name.toLowerCase() ||
    (a.metadata.color === b.metadata.color &&
      a.metadata.description === b.metadata.description &&
      a.metadata.description !== null)
  );
}

/**
 * `WorkspaceManager` — the core class for workspace CRUD, membership and
 * preference management.
 */
export class WorkspaceManager {
  private workspaces = new Map<WorkspaceId, Workspace>();
  private memberships = new Map<string, WorkspaceMembership[]>();
  private shortcuts = new Map<string, WorkspaceShortcut>();
  private preferences = new Map<WorkspaceId, WorkspacePreferences>();
  private writing: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(
    private readonly area: StorageAreaLike,
    options: WorkspaceManagerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  /* ==================== LOAD / PERSIST ==================== */

  /** Loads workspaces, memberships and preferences from storage. */
  async load(): Promise<void> {
    const stored = await this.area.get([
      WORKSPACES_KEY,
      WORKSPACE_MEMBERSHIPS_KEY,
      WORKSPACE_SHORTCUTS_KEY,
      WORKSPACE_PREFERENCES_KEY,
    ]);

    this.workspaces = new Map();
    const rawWorkspaces = stored[WORKSPACES_KEY];
    if (Array.isArray(rawWorkspaces)) {
      for (const item of rawWorkspaces) {
        const workspace = normalizeStoredWorkspace(item);
        if (workspace) this.workspaces.set(workspace.id, workspace);
      }
    }

    this.memberships = new Map();
    const rawMemberships = stored[WORKSPACE_MEMBERSHIPS_KEY];
    if (typeof rawMemberships === "object" && rawMemberships !== null) {
      const record = rawMemberships as Record<string, unknown>;
      for (const [workspaceId, value] of Object.entries(record)) {
        if (Array.isArray(value)) {
          const list: WorkspaceMembership[] = [];
          for (const entry of value) {
            if (
              typeof entry === "object" &&
              entry !== null &&
              "type" in entry &&
              "itemId" in entry
            ) {
              list.push(entry as WorkspaceMembership);
            }
          }
          this.memberships.set(workspaceId, list);
        }
      }
    }

    this.shortcuts = new Map();
    const rawShortcuts = stored[WORKSPACE_SHORTCUTS_KEY];
    if (typeof rawShortcuts === "object" && rawShortcuts !== null) {
      const record = rawShortcuts as Record<string, unknown>;
      for (const [workspaceId, value] of Object.entries(record)) {
        if (Array.isArray(value)) {
          for (const entry of value) {
            if (
              typeof entry === "object" &&
              entry !== null &&
              "id" in entry &&
              "label" in entry &&
              "target" in entry
            ) {
              const shortcut = entry as WorkspaceShortcut;
              this.shortcuts.set(`${workspaceId}:${shortcut.id}`, shortcut);
            }
          }
        }
      }
    }

    this.preferences = new Map();
    const rawPreferences = stored[WORKSPACE_PREFERENCES_KEY];
    if (typeof rawPreferences === "object" && rawPreferences !== null) {
      const record = rawPreferences as Record<string, unknown>;
      for (const [workspaceId, value] of Object.entries(record)) {
        if (typeof value === "object" && value !== null) {
          this.preferences.set(
            workspaceId,
            normalizeWorkspacePreferences(value),
          );
        }
      }
    }

    // Drop memberships that reference deleted workspaces.
    for (const workspaceId of this.memberships.keys()) {
      if (!this.workspaces.has(workspaceId)) {
        this.memberships.delete(workspaceId);
      }
    }
  }

  private async persist(): Promise<void> {
    this.writing = this.writing.then(async () => {
      const workspaces = [...this.workspaces.values()].map((w) => ({ ...w }));
      const memberships: Record<string, WorkspaceMembership[]> = {};
      for (const [workspaceId, list] of this.memberships) {
        memberships[workspaceId] = [...list];
      }
      const shortcuts: Record<string, WorkspaceShortcut[]> = {};
      for (const [key, shortcut] of this.shortcuts) {
        const parts = key.split(":");
        const workspaceId = parts[0];
        if (workspaceId) {
          if (!shortcuts[workspaceId]) shortcuts[workspaceId] = [];
          shortcuts[workspaceId].push(shortcut);
        }
      }
      const prefs: Record<string, WorkspacePreferences> = {};
      for (const [workspaceId, p] of this.preferences) {
        prefs[workspaceId] = { ...p };
      }
      await this.area.set({
        [WORKSPACES_KEY]: workspaces,
        [WORKSPACE_MEMBERSHIPS_KEY]: memberships,
        [WORKSPACE_SHORTCUTS_KEY]: shortcuts,
        [WORKSPACE_PREFERENCES_KEY]: prefs,
      });
    });
    await this.writing;
  }

  /* ==================== CRUD ==================== */

  /** Returns a copy of all workspaces. */
  list(): Workspace[] {
    return [...this.workspaces.values()].map((w) => ({ ...w }));
  }

  /** Returns a workspace by ID, or undefined. */
  get(id: WorkspaceId): Workspace | undefined {
    const found = this.workspaces.get(id);
    return found ? { ...found } : undefined;
  }

  /** Returns true if the workspace exists. */
  has(id: WorkspaceId): boolean {
    return this.workspaces.has(id);
  }

  /** Finds a workspace by exact ID first, then by case-insensitive name. */
  resolve(ref: string): Workspace | undefined {
    return this.get(ref) ?? this.findByName(ref);
  }

  /** Finds a workspace by case-insensitive name (first match). */
  findByName(name: string): Workspace | undefined {
    const wanted = sanitizeWorkspaceNameInput(name).toLowerCase();
    const found = [...this.workspaces.values()].find(
      (w) => sanitizeWorkspaceNameInput(w.metadata.name).toLowerCase() === wanted,
    );
    return found ? { ...found } : undefined;
  }

  /** Returns the names of all existing workspaces (for uniqueness checks). */
  existingNames(): string[] {
    return [...this.workspaces.values()].map((w) => w.metadata.name);
  }

  /** Returns the default workspace: `isDefault`, else the first active one. */
  getDefault(): Workspace | undefined {
    const all = [...this.workspaces.values()];
    const flagged = all.find(
      (w) => w.metadata.isDefault && w.state === "active",
    );
    const fallback = all.find((w) => w.state === "active");
    return flagged ? { ...flagged } : fallback ? { ...fallback } : undefined;
  }

  /** Returns all unique tags across workspaces, sorted. */
  allTags(): string[] {
    const tags = new Set<string>();
    for (const workspace of this.workspaces.values()) {
      for (const tag of workspace.tags) tags.add(tag);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }

  /** Creates a new workspace from validated metadata. */
  async create(input: WorkspaceCreateInput = {}): Promise<WorkspaceCreated> {
    // Allow duplicate names for create (validated with allowDuplicateName: true)
    const validation = validateWorkspaceMetadata(input, this.existingNames(), undefined, { allowDuplicateName: true });
    if (!validation.ok) throw new WorkspaceError(validation.message);

    const state = validWorkspaceState(input.state) ? input.state : "active";
    const origin: WorkspaceOrigin = input.origin === "automatic" ? "automatic" : "manual";
    const expiresAt =
      state === "temporary" && typeof input.expiresAt === "number"
        ? input.expiresAt
        : null;
    const exclusive = typeof input.exclusive === "boolean" ? input.exclusive : false;

    const workspace = createWorkspace(
      { ...validation.metadata, createdAt: this.now() },
      {
        id: generateWorkspaceId(this.random),
        origin,
        state,
        expiresAt,
        tags: normalizeWorkspaceTags(input.tags),
        exclusive,
        order: this.workspaces.size,
      },
    );

    const duplicateDetected = checkWorkspaceDuplicate(
      workspace,
      [...this.workspaces.values()],
    ).isDuplicate;

    this.workspaces.set(workspace.id, workspace);
    this.preferences.set(workspace.id, { ...DEFAULT_WORKSPACE_PREFERENCES });
    await this.persist();
    return { workspace: { ...workspace }, duplicateDetected };
  }

  /** Creates a workspace under a given ID (restore/import). */
  async createWithId(input: {
    id: WorkspaceId;
    name: string;
    color?: string | null;
    icon?: string | null;
    description?: string | null;
    tags?: string[];
    state?: WorkspaceState;
    origin?: WorkspaceOrigin;
    expiresAt?: number | null;
    exclusive?: boolean;
  }): Promise<Workspace> {
    if (!/^[a-z0-9-]{1,64}$/.test(input.id)) {
      throw new WorkspaceError(`invalid workspace ID "${input.id}"`);
    }
    if (this.workspaces.has(input.id)) {
      throw new WorkspaceError(`a workspace "${input.id}" already exists`);
    }

    const validation = validateWorkspaceMetadata(
      {
        name: input.name,
        color: input.color,
        icon: input.icon,
        description: input.description,
        tags: input.tags,
        isDefault: false,
      },
      this.existingNames(),
      undefined,
      { allowDuplicateName: true },
    );
    if (!validation.ok) throw new WorkspaceError(validation.message);

    const state = validWorkspaceState(input.state) ? input.state : "active";
    const expiresAt =
      state === "temporary" && typeof input.expiresAt === "number"
        ? input.expiresAt
        : null;

    const workspace = createWorkspace(
      { ...validation.metadata, createdAt: this.now() },
      {
        id: input.id,
        origin: input.origin ?? "automatic",
        state,
        expiresAt,
        tags: normalizeWorkspaceTags(input.tags),
        exclusive: input.exclusive ?? false,
      },
    );

    this.workspaces.set(workspace.id, workspace);
    this.preferences.set(workspace.id, { ...DEFAULT_WORKSPACE_PREFERENCES });
    await this.persist();
    return { ...workspace };
  }

  /** Updates workspace metadata by ID. */
  async update(id: WorkspaceId, patch: WorkspacePatch): Promise<Workspace> {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new WorkspaceError(`no workspace "${id}"`);

    if (patch.name !== undefined) {
      const existing = this.existingNames();
      const validation = validateWorkspaceMetadata(
        { name: patch.name },
        existing,
        workspace.metadata.name,
      );
      if (!validation.ok) throw new WorkspaceError(validation.message);
      workspace.metadata.name = validation.metadata.name;
    }
    if (patch.color !== undefined) {
      workspace.metadata.color = patch.color;
    }
    if (patch.icon !== undefined) {
      workspace.metadata.icon = patch.icon;
    }
    if (patch.description !== undefined) {
      workspace.metadata.description = patch.description;
    }
    if (patch.tags !== undefined) {
      workspace.tags = normalizeWorkspaceTags(patch.tags);
    }
    if (patch.state !== undefined) {
      workspace.state = patch.state;
    }
    if (patch.expiresAt !== undefined) {
      workspace.expiresAt = patch.expiresAt;
    }
    if (patch.exclusive !== undefined) {
      workspace.exclusive = patch.exclusive;
    }
    await this.persist();
    return { ...workspace };
  }

  /** Changes only the lifecycle state of a workspace. */
  async setState(id: WorkspaceId, state: WorkspaceState): Promise<Workspace> {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new WorkspaceError(`no workspace "${id}"`);
    workspace.state = state;
    await this.persist();
    return { ...workspace };
  }

  /** Archives a workspace (soft delete; memberships are untouched). */
  async archive(id: WorkspaceId): Promise<Workspace> {
    return this.setState(id, "archived");
  }

  /** Unarchives a workspace. */
  async unarchive(id: WorkspaceId): Promise<Workspace> {
    return this.setState(id, "active");
  }

  /** Marks a workspace as deleted (soft delete). Memberships are untouched. */
  async delete(id: WorkspaceId): Promise<boolean> {
    const workspace = this.workspaces.get(id);
    if (!workspace) return false;
    workspace.state = "deleted";
    await this.persist();
    return true;
  }

  /** Restores a deleted workspace to active state. */
  async restore(id: WorkspaceId): Promise<Workspace> {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new WorkspaceError(`no workspace "${id}"`);
    if (workspace.state !== "deleted") {
      throw new WorkspaceError(`workspace "${id}" is not deleted`);
    }
    workspace.state = "active";
    await this.persist();
    return { ...workspace };
  }

  /** Records that a workspace was used now. */
  async touch(id: WorkspaceId): Promise<Workspace> {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new WorkspaceError(`no workspace "${id}"`);
    workspace.metadata.lastUsedAt = this.now();
    await this.persist();
    return { ...workspace };
  }

  /* ==================== MEMBERSHIPS ==================== */

  /** Returns all memberships for a workspace. */
  listMemberships(workspaceId: WorkspaceId): WorkspaceMembership[] {
    return [...(this.memberships.get(workspaceId) ?? [])];
  }

  /** Returns profile IDs assigned to a workspace. */
  listProfileIds(workspaceId: WorkspaceId): WorkspaceId[] {
    return this.listMemberships(workspaceId)
      .filter((m) => m.type === "profile")
      .map((m) => m.itemId as WorkspaceId);
  }

  /** Returns session IDs assigned to a workspace. */
  listSessionIds(workspaceId: WorkspaceId): SessionId[] {
    return this.listMemberships(workspaceId)
      .filter((m) => m.type === "session")
      .map((m) => m.itemId as SessionId);
  }

  /** Returns shortcuts assigned to a workspace. */
  listShortcuts(workspaceId: WorkspaceId): WorkspaceShortcut[] {
    const shortcuts: WorkspaceShortcut[] = [];
    for (const [key, shortcut] of this.shortcuts) {
      if (key.startsWith(`${workspaceId}:`)) {
        shortcuts.push(shortcut);
      }
    }
    return shortcuts.sort((a, b) => a.order - b.order);
  }

  /** Assigns a profile to a workspace. */
  async assignProfile(
    workspaceId: WorkspaceId,
    profileId: ProfileId,
  ): Promise<void> {
    if (!this.workspaces.has(workspaceId)) {
      throw new WorkspaceError(`no workspace "${workspaceId}"`);
    }
    const list = this.listMemberships(workspaceId);
    if (list.some((m) => m.type === "profile" && m.itemId === profileId)) {
      return; // already assigned
    }
    const membership: WorkspaceMembership = {
      type: "profile",
      itemId: profileId,
      createdAt: this.now(),
      order: list.length,
    };
    this.memberships.set(workspaceId, [...list, membership]);
    await this.persist();
  }

  /** Unassigns a profile from a workspace. */
  async unassignProfile(
    workspaceId: WorkspaceId,
    profileId: ProfileId,
  ): Promise<boolean> {
    const list = this.listMemberships(workspaceId);
    const filtered = list.filter(
      (m) => !(m.type === "profile" && m.itemId === profileId),
    );
    if (filtered.length === list.length) return false;
    this.memberships.set(workspaceId, filtered);
    await this.persist();
    return true;
  }

  /** Assigns a session to a workspace. */
  async assignSession(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
  ): Promise<void> {
    if (!this.workspaces.has(workspaceId)) {
      throw new WorkspaceError(`no workspace "${workspaceId}"`);
    }
    const list = this.listMemberships(workspaceId);
    if (list.some((m) => m.type === "session" && m.itemId === sessionId)) {
      return; // already assigned
    }
    const membership: WorkspaceMembership = {
      type: "session",
      itemId: sessionId,
      createdAt: this.now(),
      order: list.length,
    };
    this.memberships.set(workspaceId, [...list, membership]);
    await this.persist();
  }

  /** Unassigns a session from a workspace. */
  async unassignSession(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
  ): Promise<boolean> {
    const list = this.listMemberships(workspaceId);
    const filtered = list.filter(
      (m) => !(m.type === "session" && m.itemId === sessionId),
    );
    if (filtered.length === list.length) return false;
    this.memberships.set(workspaceId, filtered);
    await this.persist();
    return true;
  }

  /** Assigns a shortcut to a workspace. */
  async assignShortcut(
    workspaceId: WorkspaceId,
    shortcut: WorkspaceShortcut,
  ): Promise<void> {
    if (!this.workspaces.has(workspaceId)) {
      throw new WorkspaceError(`no workspace "${workspaceId}"`);
    }
    const list = this.listMemberships(workspaceId);
    if (list.some((m) => m.type === "shortcut" && m.itemId === shortcut.id)) {
      return; // already assigned
    }
    const membership: WorkspaceMembership = {
      type: "shortcut",
      itemId: shortcut.id,
      createdAt: this.now(),
      order: shortcut.order,
    };
    this.memberships.set(workspaceId, [...list, membership]);
    this.shortcuts.set(`${workspaceId}:${shortcut.id}`, shortcut);
    await this.persist();
  }

  /** Unassigns a shortcut from a workspace. */
  async unassignShortcut(
    workspaceId: WorkspaceId,
    shortcutId: string,
  ): Promise<boolean> {
    const list = this.listMemberships(workspaceId);
    const filtered = list.filter(
      (m) => !(m.type === "shortcut" && m.itemId === shortcutId),
    );
    if (filtered.length === list.length) return false;
    this.memberships.set(workspaceId, filtered);
    this.shortcuts.delete(`${workspaceId}:${shortcutId}`);
    await this.persist();
    return true;
  }

  /* ==================== PREFERENCES ==================== */

  /** Returns workspace-specific preferences (defaults if none set). */
  getPreferences(workspaceId: WorkspaceId): WorkspacePreferences {
    return this.preferences.get(workspaceId) ?? { ...DEFAULT_WORKSPACE_PREFERENCES };
  }

  /** Sets workspace-specific preferences. */
  async setPreferences(
    workspaceId: WorkspaceId,
    patch: WorkspacePreferencesPatch,
  ): Promise<WorkspacePreferences> {
    const validation = validateWorkspacePreferencesPatch(patch);
    if (!validation.ok) throw new WorkspaceError(validation.message);

    const current = this.getPreferences(workspaceId);
    const next = patchWorkspacePreferences(current, patch);
    this.preferences.set(workspaceId, next);
    await this.persist();
    return next;
  }

  /** Resolves workspace preferences against global dashboard preferences. */
  resolvePreferences(
    workspaceId: WorkspaceId,
    globalPrefs: DashboardPreferences,
  ): ReturnType<typeof resolveWorkspacePreferences> {
    return resolveWorkspacePreferences(this.getPreferences(workspaceId), globalPrefs);
  }

  /** Resets workspace preferences to defaults. */
  async resetPreferences(workspaceId: WorkspaceId): Promise<WorkspacePreferences> {
    this.preferences.set(workspaceId, { ...DEFAULT_WORKSPACE_PREFERENCES });
    await this.persist();
    return { ...DEFAULT_WORKSPACE_PREFERENCES };
  }

  /* ==================== DUPLICATE DETECTION ==================== */

  /** Checks whether a candidate workspace duplicates any existing workspace. */
  checkWorkspaceDuplicate(
    candidate: Workspace,
    existing: readonly Workspace[],
  ): WorkspaceDuplicateCheck {
    for (const existingWorkspace of existing) {
      if (existingWorkspace.id === candidate.id) continue;
      if (isDuplicateWorkspace(candidate, existingWorkspace)) {
        return {
          isDuplicate: true,
          existing: existingWorkspace,
          reason: `A workspace named "${candidate.metadata.name}" already exists.`,
        };
      }
    }
    return { isDuplicate: false };
  }

  /** Groups workspaces by duplicate key (name + color). */
  findDuplicateGroups(): WorkspaceDuplicateGroup[] {
    const groups = new Map<string, Workspace[]>();
    for (const workspace of this.workspaces.values()) {
      const key = `${sanitizeWorkspaceNameInput(workspace.metadata.name).toLowerCase()}|${
        workspace.metadata.color ?? "none"
      }`;
      const list = groups.get(key) ?? [];
      list.push(workspace);
      groups.set(key, list);
    }
    const out: WorkspaceDuplicateGroup[] = [];
    for (const [key, list] of groups) {
      if (list.length > 1) {
        out.push({
          key,
          workspaces: [...list],
          reason: `${list.length} workspaces share the name "${
            list[0]!.metadata.name
          }" and color.`,
        });
      }
    }
    return out;
  }

  /* ==================== CONTEXT MENU ==================== */

  /** Context-menu items, with the active workspace first. */
  getContextMenuItems(activeWorkspaceId: WorkspaceId | null): ContextMenuWorkspaceItem[] {
    return this.list()
      .filter((w) => w.state !== "deleted")
      .map((w) => ({
        workspaceId: w.id,
        title: w.metadata.name,
        active: w.id === activeWorkspaceId,
        available: w.state === "active" || w.state === "temporary",
      }))
      .sort((a, b) => Number(b.active) - Number(a.active));
  }

  /** Builds the context-menu tree. Register it with `chrome.contextMenus`. */
  buildContextMenu(activeWorkspaceId: WorkspaceId | null): WorkspaceContextMenu {
    return {
      id: WORKSPACE_MENU_PARENT_ID,
      title: "Workspaces",
      contexts: ["page", "action"],
      children: this.getContextMenuItems(activeWorkspaceId).map((item) => ({
        id: `${WORKSPACE_MENU_ID_PREFIX}${item.workspaceId}`,
        title: item.title,
        enabled: item.available,
        type: "radio" as const,
        checked: item.active,
      })),
    };
  }

  /** True when a context-menu ID belongs to this module. */
  ownsMenuId(menuItemId: string): boolean {
    return menuItemId.startsWith(WORKSPACE_MENU_ID_PREFIX);
  }

  /** Handles a context-menu click. Returns null for IDs this module does not own. */
  async handleContextMenuClick(
    menuItemId: string,
  ): Promise<WorkspaceSwitchResult | null> {
    if (!this.ownsMenuId(menuItemId)) return null;
    const workspaceId = menuItemId.slice(WORKSPACE_MENU_ID_PREFIX.length);
    if (workspaceId === "") return { ok: false, error: "Empty workspace ID." };
    // Switching is handled by WorkspaceNavigation
    return { ok: false, error: "Use WorkspaceNavigation.switchTo for switching." };
  }

  /* ==================== TEMPORARY WORKSPACES ==================== */

  /** Returns all temporary workspaces. */
  listTemporary(): Workspace[] {
    return this.list().filter((w) => w.state === "temporary");
  }

  /** Evaluates which temporary workspaces have reached or are approaching expiry. */
  evaluateExpiry(now: number = Date.now()): WorkspaceExpiryEvaluation {
    const expired: Workspace[] = [];
    const expiringSoon: Workspace[] = [];
    for (const workspace of this.listTemporary()) {
      if (workspace.expiresAt !== null && workspace.expiresAt <= now) {
        expired.push(workspace);
      } else if (
        workspace.expiresAt !== null &&
        workspace.expiresAt - now <= TEMPORARY_WARNING_WINDOW_MS
      ) {
        expiringSoon.push(workspace);
      }
    }
    return { expired, expiringSoon };
  }

  /** Converts a temporary workspace to permanent (clears expiry). */
  async convertToPermanent(id: WorkspaceId): Promise<Workspace> {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new WorkspaceError(`no workspace "${id}"`);
    workspace.expiresAt = null;
    if (workspace.state === "temporary") workspace.state = "active";
    await this.persist();
    return { ...workspace };
  }

  /* ==================== EXPORT / IMPORT ==================== */

  /** Exports a workspace to a serializable package (no secrets). */
  exportWorkspace(workspaceId: WorkspaceId): WorkspaceExport | null {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;

    const shortcuts = this.listShortcuts(workspaceId);

    return {
      version: 1,
      format: "aegox.workspace.v1",
      exportedAt: this.now(),
      workspace: { ...workspace },
      memberships: this.listMemberships(workspaceId),
      shortcuts,
      preferences: this.getPreferences(workspaceId),
    };
  }

  /** Validates an import package without applying it. */
  validateImportPackage(
    pkg: unknown,
    availableProfileIds: readonly string[] = [],
    availableSessionIds: readonly string[] = [],
  ): WorkspaceImportValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (
      typeof pkg !== "object" ||
      pkg === null ||
      Array.isArray(pkg)
    ) {
      return { valid: false, errors: ["Invalid import package."], warnings };
    }
    const record = pkg as Record<string, unknown>;

    if (record.format !== "aegox.workspace.v1") {
      errors.push(`Unsupported format: ${String(record.format ?? "<missing>")}`);
    }
    if (record.version !== 1) {
      errors.push(`Unsupported version: ${String(record.version ?? "<missing>")}`);
    }

    const ws = record.workspace;
    if (
      typeof ws !== "object" ||
      ws === null ||
      Array.isArray(ws) ||
      typeof (ws as { id: string; metadata?: { name: unknown } }).id !== "string" ||
      typeof (ws as { id: string; metadata?: { name: unknown } }).metadata?.name !== "string"
    ) {
      errors.push("Invalid or missing workspace metadata in import package.");
    } else {
      const workspaceRecord = ws as { metadata: { name: string } };
      const name = String(workspaceRecord.metadata.name);
      if (name.length < 1) {
        errors.push("Workspace name cannot be empty.");
      }
      if (Array.from(name).length > MAX_WORKSPACE_NAME) {
        errors.push(`Workspace name exceeds ${MAX_WORKSPACE_NAME} characters.`);
      }
    }

    const memberships = record.memberships;
    if (memberships !== undefined && memberships !== null) {
      if (!Array.isArray(memberships)) {
        errors.push("memberships must be an array.");
      } else {
        const profileSet = new Set(availableProfileIds);
        const sessionSet = new Set(availableSessionIds);
        for (const m of memberships as unknown[]) {
          if (
            typeof m !== "object" ||
            m === null ||
            Array.isArray(m) ||
            (m as Record<string, unknown>).type !== "profile" &&
            (m as Record<string, unknown>).type !== "session" &&
            (m as Record<string, unknown>).type !== "shortcut"
          ) {
            errors.push("Invalid membership entry in import package.");
            continue;
          }
          const membership = m as Record<string, unknown>;
          if (membership.type === "profile") {
            const id = membership.itemId;
            if (typeof id !== "string" || !profileSet.has(id)) {
              warnings.push(`Referenced profile "${String(id)}" is not available.`);
            }
          }
          if (membership.type === "session") {
            const id = membership.itemId;
            if (typeof id !== "string" || !sessionSet.has(id)) {
              warnings.push(`Referenced session "${String(id)}" is not available.`);
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /** Imports a workspace from a validated package. */
  async importWorkspace(
    pkg: WorkspaceExport,
    options: { allowDuplicateName?: boolean } = {},
  ): Promise<Workspace> {
    const validation = this.validateImportPackage(pkg);
    if (!validation.valid) {
      throw new WorkspaceError(validation.errors.join("; "));
    }

    const ws = pkg.workspace as Workspace;
    const validation2 = validateWorkspaceMetadata(
      {
        name: ws.metadata.name,
        color: ws.metadata.color,
        icon: ws.metadata.icon,
        description: ws.metadata.description,
        tags: ws.tags ?? [],
        isDefault: false,
      },
      this.existingNames(),
      undefined,
      { allowDuplicateName: options.allowDuplicateName ?? true },
    );
    if (!validation2.ok) throw new WorkspaceError(validation2.message);

    const workspace = createWorkspace(
      { ...validation2.metadata, createdAt: this.now() },
      {
        id: ws.id,
        origin: "automatic",
        state: ws.state,
        expiresAt: ws.expiresAt,
        tags: validation2.tags ? [...validation2.tags] : [],
        exclusive: ws.exclusive,
        order: this.workspaces.size,
      },
    );

    this.workspaces.set(workspace.id, workspace);
    this.preferences.set(workspace.id, { ...pkg.preferences });

    for (const m of pkg.memberships) {
      this.memberships.set(workspace.id, [
        ...(this.memberships.get(workspace.id) ?? []),
        { ...m },
      ]);
    }

    for (const shortcut of pkg.shortcuts ?? []) {
      this.shortcuts.set(`${workspace.id}:${shortcut.id}`, shortcut);
    }

    await this.persist();
    return { ...workspace };
  }

  /** Duplicates a workspace (creates a new workspace with copied memberships). */
  async duplicate(
    workspaceId: WorkspaceId,
    newName?: string,
  ): Promise<Workspace> {
    const original = this.workspaces.get(workspaceId);
    if (!original) throw new WorkspaceError(`no workspace "${workspaceId}"`);

    const name = newName
      ? sanitizeWorkspaceNameInput(newName)
      : `${original.metadata.name} (Copy)`;
    const validation = validateWorkspaceMetadata(
      { name },
      this.existingNames(),
      original.metadata.name,
    );
    if (!validation.ok) throw new WorkspaceError(validation.message);

    const duplicate = createWorkspace(
      { ...validation.metadata, createdAt: this.now() },
      {
        id: generateWorkspaceId(this.random),
        origin: "manual",
        state: "active",
        tags: [...original.tags],
        exclusive: original.exclusive,
        order: this.workspaces.size,
      },
    );

    this.workspaces.set(duplicate.id, duplicate);
    this.preferences.set(duplicate.id, { ...this.getPreferences(workspaceId) });

    for (const m of this.listMemberships(workspaceId)) {
      this.memberships.set(duplicate.id, [
        ...(this.memberships.get(duplicate.id) ?? []),
        { ...m, createdAt: this.now() },
      ]);
    }

    await this.persist();
    return { ...duplicate };
  }

  /* ==================== HELPERS ==================== */

  /** Returns the current time. */
  nowMs(): number {
    return this.now();
  }
}

/** Validates a workspace state value. */
function validWorkspaceState(state: unknown): state is WorkspaceState {
  return (
    typeof state === "string" &&
    (state === "active" || state === "archived" || state === "temporary" || state === "deleted")
  );
}

/** Normalizes a stored workspace object. */
function normalizeStoredWorkspace(raw: unknown): Workspace | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string") return null;
  if (
    typeof record.metadata !== "object" ||
    record.metadata === null ||
    Array.isArray(record.metadata)
  ) {
    return null;
  }
  const metadata = record.metadata as Record<string, unknown>;
  if (typeof metadata.name !== "string") return null;
  return {
    id: record.id as string,
    state:
      typeof record.state === "string" &&
      (record.state === "active" ||
        record.state === "archived" ||
        record.state === "temporary" ||
        record.state === "deleted")
        ? (record.state as WorkspaceState)
        : "active",
    metadata: {
      name: metadata.name as string,
      color:
        typeof metadata.color === "string"
          ? metadata.color
          : DEFAULT_WORKSPACE_COLOR,
      icon:
        typeof metadata.icon === "string"
          ? metadata.icon
          : DEFAULT_WORKSPACE_ICON,
      description:
        typeof metadata.description === "string" || metadata.description === null
          ? metadata.description
          : null,
      createdAt:
        typeof metadata.createdAt === "number" && Number.isFinite(metadata.createdAt)
          ? metadata.createdAt
          : Date.now(),
      lastUsedAt:
        metadata.lastUsedAt === null ||
        (typeof metadata.lastUsedAt === "number" && Number.isFinite(metadata.lastUsedAt))
          ? (metadata.lastUsedAt as number | null)
          : null,
      isDefault: metadata.isDefault === true,
    },
    origin:
      typeof record.origin === "string" &&
      (record.origin === "manual" || record.origin === "automatic")
        ? (record.origin as WorkspaceOrigin)
        : "manual",
    expiresAt:
      record.expiresAt === null ||
      (typeof record.expiresAt === "number" && Number.isFinite(record.expiresAt))
        ? (record.expiresAt as number | null)
        : null,
    tags: Array.isArray(record.tags)
      ? record.tags.filter((t): t is string => typeof t === "string")
      : [],
    order:
      typeof record.order === "number" && Number.isFinite(record.order)
        ? Math.floor(record.order)
        : 0,
    exclusive: record.exclusive === true,
  };
}

/** Checks whether a candidate workspace duplicates any existing workspace. */
export function checkWorkspaceDuplicate(
  candidate: Workspace,
  existing: readonly Workspace[],
): WorkspaceDuplicateCheck {
  for (const existingWorkspace of existing) {
    if (existingWorkspace.id === candidate.id) continue;
    if (isDuplicateWorkspace(candidate, existingWorkspace)) {
      return {
        isDuplicate: true,
        existing: existingWorkspace,
        reason: `A workspace named "${candidate.metadata.name}" already exists.`,
      };
    }
  }
  return { isDuplicate: false };
}
