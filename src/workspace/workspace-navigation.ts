/**
 * Workspace Manager — Workspace navigation (AEGOX_multisession, Module 05).
 *
 * Manages the active workspace and navigation models derived from it.
 * Provides switching between workspaces through the dashboard, extension
 * popup, quick selector and keyboard shortcuts.
 *
 * Pure TypeScript: persistence is delegated to a provided `StorageAreaLike`.
 */

import type { StorageAreaLike } from "../engine/storage/storage-area";
import type { Workspace, WorkspaceId } from "./workspace";
import type { WorkspaceManager } from "./workspace-manager";

/** `chrome.storage.local` key holding the active workspace ID. */
export const ACTIVE_WORKSPACE_KEY = "aegox.activeWorkspaceId.v1";

/** Result of switching to a workspace. */
export interface WorkspaceSwitchResult {
  /** True if the switch succeeded. */
  ok: boolean;
  /** The workspace after switching, or undefined on failure. */
  workspace?: Workspace;
  /** Human-readable error when the switch failed. */
  error?: string;
}

/** One context-menu entry for workspace switching. */
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

/** Manages the active workspace and navigation models derived from it. */
export class WorkspaceNavigation {
  private activeWorkspaceId: WorkspaceId | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly area: StorageAreaLike,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /** Loads the persisted active workspace; invalid references are cleared. */
  async load(): Promise<void> {
    const stored = (await this.area.get(ACTIVE_WORKSPACE_KEY))[ACTIVE_WORKSPACE_KEY];
    if (typeof stored !== "string") {
      this.activeWorkspaceId = null;
      return;
    }
    const workspace = this.workspaceManager.get(stored);
    this.activeWorkspaceId =
      workspace && workspace.state !== "deleted" && workspace.state !== "archived"
        ? workspace.id
        : null;
  }

  /** Returns the active workspace ID, or null. */
  getActiveWorkspaceId(): WorkspaceId | null {
    return this.activeWorkspaceId;
  }

  /** Returns the active workspace, or undefined. */
  getActiveWorkspace(): Workspace | undefined {
    if (!this.activeWorkspaceId) return undefined;
    return this.workspaceManager.get(this.activeWorkspaceId);
  }

  /** Sets (and persists) the active workspace. Pass null to clear it. */
  async setActiveWorkspace(workspaceId: WorkspaceId | null): Promise<void> {
    if (workspaceId !== null) {
      const workspace = this.workspaceManager.get(workspaceId);
      if (!workspace) throw new Error(`Workspace "${workspaceId}" not found.`);
      if (workspace.state === "archived" || workspace.state === "deleted") {
        throw new Error(`Workspace "${workspaceId}" is ${workspace.state}.`);
      }
    }
    this.activeWorkspaceId = workspaceId;
    this.writing = this.writing.then(() =>
      workspaceId === null
        ? this.area.remove(ACTIVE_WORKSPACE_KEY)
        : this.area.set({ [ACTIVE_WORKSPACE_KEY]: workspaceId }),
    );
    await this.writing;
  }

  /** Switches to a workspace, validating availability and recording last use. */
  async switchTo(workspaceId: WorkspaceId): Promise<WorkspaceSwitchResult> {
    const workspace = this.workspaceManager.get(workspaceId);
    if (!workspace) {
      return { ok: false, error: `Workspace "${workspaceId}" not found.` };
    }
    if (workspace.state === "archived") {
      return { ok: false, error: `Workspace "${workspaceId}" is archived.` };
    }
    if (workspace.state === "deleted") {
      return { ok: false, error: `Workspace "${workspaceId}" is deleted.` };
    }

    try {
      await this.setActiveWorkspace(workspaceId);
      const updated = await this.workspaceManager.touch(workspaceId);
      return { ok: true, workspace: updated };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Context-menu items, with the active workspace first. */
  getContextMenuItems(): ContextMenuWorkspaceItem[] {
    return this.workspaceManager
      .list()
      .filter((workspace) => workspace.state !== "deleted")
      .map((workspace) => ({
        workspaceId: workspace.id,
        title: workspace.metadata.name,
        active: workspace.id === this.activeWorkspaceId,
        available:
          workspace.state === "active" || workspace.state === "temporary",
      }))
      .sort((a, b) => Number(b.active) - Number(a.active));
  }

  /** Compact list for the popup: available workspaces, active first. */
  getQuickSwitchWorkspaces(): Workspace[] {
    return this.workspaceManager
      .list()
      .filter(
        (workspace) =>
          workspace.state === "active" || workspace.state === "temporary",
      )
      .sort(
        (a, b) =>
          Number(b.id === this.activeWorkspaceId) -
          Number(a.id === this.activeWorkspaceId),
      );
  }

  /** Workspaces that have been used recently (by lastUsedAt), newest first. */
  getRecentWorkspaces(limit = 5): Workspace[] {
    return this.workspaceManager
      .list()
      .filter(
        (workspace) =>
          workspace.state !== "deleted" && workspace.metadata.lastUsedAt !== null,
      )
      .sort(
        (a, b) =>
          (b.metadata.lastUsedAt ?? 0) - (a.metadata.lastUsedAt ?? 0),
      )
      .slice(0, Math.max(0, limit));
  }

  /** Workspaces marked as default (isDefault). */
  getDefaultWorkspaces(): Workspace[] {
    return this.workspaceManager
      .list()
      .filter(
        (workspace) => workspace.metadata.isDefault && workspace.state !== "deleted",
      );
  }

  /** Builds the context-menu tree. Register it with `chrome.contextMenus`. */
  buildContextMenu(): WorkspaceContextMenu {
    return {
      id: "aegox-workspaces",
      title: "Workspaces",
      contexts: ["page", "action"],
      children: this.getContextMenuItems().map((item) => ({
        id: `aegox-workspace:${item.workspaceId}`,
        title: item.title,
        enabled: item.available,
        type: "radio" as const,
        checked: item.active,
      })),
    };
  }

  /** Records the current time for callers that build their own models. */
  nowMs(): number {
    return this.now();
  }
}
