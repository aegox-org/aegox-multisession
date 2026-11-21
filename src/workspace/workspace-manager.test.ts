/**
 * Unit tests for `src/workspace/workspace-manager.ts`.
 * Uses in-memory storage area for fast, deterministic tests.
 */

import { describe, expect, it } from "vitest";

import {
  WorkspaceManager,
  WorkspaceError,
} from "./workspace-manager";
import type {
  Workspace,
  WorkspaceCreateInput,
  WorkspacePatch,
  WorkspacePreferencesPatch,
  WorkspaceShortcut,
} from "./workspace";
import { MemoryStorageArea } from "../engine/storage/storage-area";

const now = () => 1000000;

const createArea = () => new MemoryStorageArea();

const createManager = (area = createArea()) => new WorkspaceManager(area, { now });

const baseWorkspaceInput = (overrides: Partial<WorkspaceCreateInput> = {}): WorkspaceCreateInput => ({
  name: "Test Workspace",
  ...overrides,
});

describe("WorkspaceManager — CRUD", () => {
  it("creates a workspace with validated metadata", async () => {
    const mgr = createManager();
    const result = await mgr.create(baseWorkspaceInput({ name: "Personal" }));
    expect(result.workspace.metadata.name).toBe("Personal");
    expect(result.workspace.state).toBe("active");
    expect(result.workspace.origin).toBe("manual");
    expect(result.duplicateDetected).toBe(false);
    expect(result.workspace.id).toMatch(/^[a-z0-9-]{1,64}$/);
  });

  it("loads and lists workspaces", async () => {
    const area = createArea();
    const mgr = createManager(area);
    await mgr.create(baseWorkspaceInput({ name: "Personal" }));
    await mgr.create(baseWorkspaceInput({ name: "Work" }));

    const mgr2 = createManager(area);
    await mgr2.load();
    expect(mgr2.list().map((w) => w.metadata.name).sort()).toEqual(["Personal", "Work"]);
  });

  it("gets a workspace by ID", async () => {
    const mgr = createManager();
    const created = await mgr.create(baseWorkspaceInput({ name: "Dev" }));
    const found = mgr.get(created.workspace.id);
    expect(found?.metadata.name).toBe("Dev");
    expect(mgr.get("nonexistent")).toBeUndefined();
  });

  it("updates workspace metadata", async () => {
    const mgr = createManager();
    const created = await mgr.create(baseWorkspaceInput({ name: "Old" }));
    const updated = await mgr.update(created.workspace.id, { name: "New" });
    expect(updated.metadata.name).toBe("New");
    expect(mgr.get(created.workspace.id)?.metadata.name).toBe("New");
  });

  it("detects duplicate names on create but allows creation", async () => {
    const mgr = createManager();
    await mgr.create(baseWorkspaceInput({ name: "Unique" }));
    const result = await mgr.create(baseWorkspaceInput({ name: "Unique" }));
    expect(result.duplicateDetected).toBe(true);
    expect(result.workspace.metadata.name).toBe("Unique");
  });

  it("changes lifecycle state", async () => {
    const mgr = createManager();
    const created = await mgr.create(baseWorkspaceInput({ name: "Temp" }));
    const archived = await mgr.archive(created.workspace.id);
    expect(archived.state).toBe("archived");

    const unarchived = await mgr.unarchive(created.workspace.id);
    expect(unarchived.state).toBe("active");
  });

  it("soft-deletes a workspace without removing it", async () => {
    const mgr = createManager();
    const created = await mgr.create(baseWorkspaceInput({ name: "Gone" }));
    const deleted = await mgr.delete(created.workspace.id);
    expect(deleted).toBe(true);
    expect(mgr.get(created.workspace.id)?.state).toBe("deleted");
    // list() still includes it
    expect(mgr.list().some((w) => w.id === created.workspace.id)).toBe(true);
  });

  it("restores a deleted workspace", async () => {
    const mgr = createManager();
    const created = await mgr.create(baseWorkspaceInput({ name: "Back" }));
    await mgr.delete(created.workspace.id);
    const restored = await mgr.restore(created.workspace.id);
    expect(restored.state).toBe("active");
  });

  it("finds workspace by name", async () => {
    const mgr = createManager();
    await mgr.create(baseWorkspaceInput({ name: "Alpha" }));
    expect(mgr.findByName("alpha")?.metadata.name).toBe("Alpha");
    expect(mgr.findByName("nonexistent")).toBeUndefined();
  });

  it("returns all tags sorted", async () => {
    const mgr = createManager();
    await mgr.create(baseWorkspaceInput({ name: "A", tags: ["work", "urgent"] }));
    await mgr.create(baseWorkspaceInput({ name: "B", tags: ["work", "personal"] }));
    expect(mgr.allTags()).toEqual(["personal", "urgent", "work"]);
  });

  it("touches a workspace (records lastUsedAt)", async () => {
    const mgr = createManager();
    const created = await mgr.create(baseWorkspaceInput({ name: "Touched" }));
    expect(created.workspace.metadata.lastUsedAt).toBeNull();
    const touched = await mgr.touch(created.workspace.id);
    expect(touched.metadata.lastUsedAt).toBe(1000000);
  });
});

describe("WorkspaceManager — preferences", () => {
  it("provides default preferences for a new workspace", async () => {
    const mgr = createManager();
    const created = await mgr.create(baseWorkspaceInput({ name: "Prefs" }));
    const prefs = mgr.getPreferences(created.workspace.id);
    expect(prefs.theme).toBe("inherit");
    expect(prefs.exclusive).toBe(false);
    expect(prefs.restoreOnStartup).toBe(false);
  });

  it("sets workspace preferences", async () => {
    const mgr = createManager();
    const created = await mgr.create(baseWorkspaceInput({ name: "Prefs" }));
    const updated = await mgr.setPreferences(created.workspace.id, {
      theme: "dark",
      exclusive: true,
    });
    expect(updated.theme).toBe("dark");
    expect(updated.exclusive).toBe(true);
    expect(updated.sessionView).toBe("inherit");
  });

  it("rejects invalid preference patches", async () => {
    const mgr = createManager();
    const created = await mgr.create(baseWorkspaceInput({ name: "Prefs" }));
    await expect(
      mgr.setPreferences(created.workspace.id, { theme: "neon" } as unknown as WorkspacePreferencesPatch),
    ).rejects.toThrow(WorkspaceError);
  });

  it("resets preferences to defaults", async () => {
    const mgr = createManager();
    const created = await mgr.create(baseWorkspaceInput({ name: "Prefs" }));
    await mgr.setPreferences(created.workspace.id, { theme: "dark" });
    const reset = await mgr.resetPreferences(created.workspace.id);
    expect(reset.theme).toBe("inherit");
  });
});

describe("WorkspaceManager — memberships", () => {
  it("assigns and lists profiles", async () => {
    const mgr = createManager();
    const ws = await mgr.create(baseWorkspaceInput({ name: "Member" }));
    await mgr.assignProfile(ws.workspace.id, "profile-1");
    await mgr.assignProfile(ws.workspace.id, "profile-2");
    expect(mgr.listProfileIds(ws.workspace.id).sort()).toEqual(["profile-1", "profile-2"]);
  });

  it("does not duplicate profile assignments", async () => {
    const mgr = createManager();
    const ws = await mgr.create(baseWorkspaceInput({ name: "Member" }));
    await mgr.assignProfile(ws.workspace.id, "profile-1");
    await mgr.assignProfile(ws.workspace.id, "profile-1");
    expect(mgr.listProfileIds(ws.workspace.id)).toHaveLength(1);
  });

  it("unassigns a profile", async () => {
    const mgr = createManager();
    const ws = await mgr.create(baseWorkspaceInput({ name: "Member" }));
    await mgr.assignProfile(ws.workspace.id, "profile-1");
    const removed = await mgr.unassignProfile(ws.workspace.id, "profile-1");
    expect(removed).toBe(true);
    expect(mgr.listProfileIds(ws.workspace.id)).toHaveLength(0);
    const notRemoved = await mgr.unassignProfile(ws.workspace.id, "profile-1");
    expect(notRemoved).toBe(false);
  });

  it("assigns and lists sessions", async () => {
    const mgr = createManager();
    const ws = await mgr.create(baseWorkspaceInput({ name: "Member" }));
    await mgr.assignSession(ws.workspace.id, "session-1");
    expect(mgr.listSessionIds(ws.workspace.id)).toEqual(["session-1"]);
  });

  it("assigns shortcuts", async () => {
    const mgr = createManager();
    const ws = await mgr.create(baseWorkspaceInput({ name: "Member" }));
    const shortcut: WorkspaceShortcut = {
      id: "shortcut-1",
      label: "GitHub",
      target: "https://github.com",
      icon: null,
      order: 0,
    };
    await mgr.assignShortcut(ws.workspace.id, shortcut);
    const shortcuts = mgr.listShortcuts(ws.workspace.id);
    expect(shortcuts).toHaveLength(1);
    expect(shortcuts[0]?.label).toBe("GitHub");
  });

  it("unassigns a shortcut", async () => {
    const mgr = createManager();
    const ws = await mgr.create(baseWorkspaceInput({ name: "Member" }));
    const shortcut: WorkspaceShortcut = {
      id: "shortcut-1",
      label: "GitHub",
      target: "https://github.com",
      icon: null,
      order: 0,
    };
    await mgr.assignShortcut(ws.workspace.id, shortcut);
    const removed = await mgr.unassignShortcut(ws.workspace.id, "shortcut-1");
    expect(removed).toBe(true);
    expect(mgr.listShortcuts(ws.workspace.id)).toHaveLength(0);
  });
});

describe("WorkspaceManager — duplicate detection", () => {
  it("detects duplicate workspaces by name + color", async () => {
    const mgr = createManager();
    await mgr.create(baseWorkspaceInput({ name: "Work", color: "#5b3fd6" }));
    const result = await mgr.create(baseWorkspaceInput({ name: "Work", color: "#5b3fd6" }));
    expect(result.duplicateDetected).toBe(true);
  });

  it("does not flag different names as duplicates", async () => {
    const mgr = createManager();
    await mgr.create(baseWorkspaceInput({ name: "Work" }));
    const result = await mgr.create(baseWorkspaceInput({ name: "Personal" }));
    expect(result.duplicateDetected).toBe(false);
  });

  it("finds duplicate groups", async () => {
    const mgr = createManager();
    await mgr.create(baseWorkspaceInput({ name: "Dup", color: "#5b3fd6" }));
    await mgr.create(baseWorkspaceInput({ name: "Dup", color: "#5b3fd6" }));
    await mgr.create(baseWorkspaceInput({ name: "Other", color: "#1a1a1a" }));
    const groups = mgr.findDuplicateGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.workspaces.map((w) => w.metadata.name)).toEqual(["Dup", "Dup"]);
  });

  it("checks duplicate for a candidate", async () => {
    const mgr = createManager();
    await mgr.create(baseWorkspaceInput({ name: "Existing", color: "#5b3fd6" }));
    const existing = mgr.list();
    const candidate: Workspace = {
      ...existing[0]!,
      id: "candidate-id",
      metadata: { ...existing[0]!.metadata, createdAt: 999 },
    };
    const check = mgr.checkWorkspaceDuplicate(candidate, existing);
    expect(check.isDuplicate).toBe(true);
  });
});

describe("WorkspaceManager — temporary workspaces", () => {
  it("creates a temporary workspace with expiry", async () => {
    const mgr = createManager();
    const ws = await mgr.createWithId({
      id: "temp-ws",
      name: "Temporary",
      state: "temporary",
      expiresAt: 2000000,
    });
    expect(ws.state).toBe("temporary");
    expect(ws.expiresAt).toBe(2000000);
  });

  it("lists temporary workspaces", async () => {
    const mgr = createManager();
    await mgr.createWithId({ id: "t1", name: "Temp 1", state: "temporary", expiresAt: 2000000 });
    await mgr.createWithId({ id: "t2", name: "Temp 2", state: "active" });
    const temps = mgr.listTemporary();
    expect(temps.map((w) => w.id)).toEqual(["t1"]);
  });

  it("evaluates expiry correctly", async () => {
    const mgr = createManager();
    await mgr.createWithId({ id: "expired", name: "Expired", state: "temporary", expiresAt: 500000 });
    await mgr.createWithId({ id: "soon", name: "Soon", state: "temporary", expiresAt: 1000000 + 1000 });
    await mgr.createWithId({ id: "later", name: "Later", state: "temporary", expiresAt: 9999999999 });

    const evaluation = mgr.evaluateExpiry(1000000);
    expect(evaluation.expired.map((w) => w.id)).toEqual(["expired"]);
    expect(evaluation.expiringSoon.map((w) => w.id)).toEqual(["soon"]);
    expect(evaluation.expiringSoon.map((w) => w.id)).not.toContain("later");
  });

  it("converts temporary to permanent", async () => {
    const mgr = createManager();
    const ws = await mgr.createWithId({
      id: "temp",
      name: "Temp",
      state: "temporary",
      expiresAt: 2000000,
    });
    const converted = await mgr.convertToPermanent("temp");
    expect(converted.expiresAt).toBeNull();
    expect(converted.state).toBe("active");
  });
});

describe("WorkspaceManager — export / import", () => {
  it("exports a workspace without secrets", async () => {
    const mgr = createManager();
    const ws = await mgr.create(baseWorkspaceInput({ name: "Export" }));
    await mgr.assignProfile(ws.workspace.id, "profile-1");
    await mgr.assignSession(ws.workspace.id, "session-1");
    const exported = mgr.exportWorkspace(ws.workspace.id);
    expect(exported).not.toBeNull();
    expect(exported!.format).toBe("aegox.workspace.v1");
    expect(exported!.version).toBe(1);
    expect(exported!.workspace.metadata.name).toBe("Export");
    expect(exported!.memberships).toHaveLength(2);
    // No cookies, passwords, tokens
    const json = JSON.stringify(exported);
    expect(json).not.toContain("cookie");
    expect(json).not.toContain("password");
    expect(json).not.toContain("token");
  });

  it("returns null for missing workspace on export", async () => {
    const mgr = createManager();
    expect(mgr.exportWorkspace("nonexistent")).toBeNull();
  });

  it("validates a good import package", async () => {
    const mgr = createManager();
    const pkg = {
      version: 1,
      format: "aegox.workspace.v1",
      exportedAt: 1,
      workspace: {
        id: "imported-ws",
        metadata: { name: "Imported", color: null, icon: null, description: null, createdAt: 1, lastUsedAt: null, isDefault: false },
        state: "active",
        origin: "automatic",
        expiresAt: null,
        tags: [],
        order: 0,
        exclusive: false,
      },
      memberships: [],
      preferences: { theme: "inherit", sessionView: "inherit", exclusive: false, restoreOnStartup: false, openUrlsOnActivate: [] },
    };
    const validation = mgr.validateImportPackage(pkg);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("rejects a bad import package", async () => {
    const mgr = createManager();
    const validation = mgr.validateImportPackage({ format: "bad", version: 99 });
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it("imports a workspace (preserves ID, replaces existing)", async () => {
    const mgr = createManager();
    const ws = await mgr.create(baseWorkspaceInput({ name: "Original" }));
    const exported = mgr.exportWorkspace(ws.workspace.id)!;
    const imported = await mgr.importWorkspace(exported);
    expect(imported.metadata.name).toBe("Original");
    expect(imported.id).toBe(ws.workspace.id); // same ID preserved on import
    expect(mgr.list()).toHaveLength(1); // replaces existing with same ID
  });

  it("imports a workspace with new ID (allows duplicate)", async () => {
    const mgr = createManager();
    const ws = await mgr.create(baseWorkspaceInput({ name: "Original" }));
    const exported = mgr.exportWorkspace(ws.workspace.id)!;
    exported.workspace.id = "new-id";
    const imported = await mgr.importWorkspace(exported, { allowDuplicateName: true });
    expect(imported.metadata.name).toBe("Original");
    expect(imported.id).toBe("new-id");
    expect(mgr.list()).toHaveLength(2);
  });

  it("warns on missing referenced profiles/sessions during import", async () => {
    const mgr = createManager();
    const pkg: any = {
      version: 1,
      format: "aegox.workspace.v1",
      exportedAt: 1,
      workspace: {
        id: "imp",
        metadata: { name: "Imp", color: null, icon: null, description: null, createdAt: 1, lastUsedAt: null, isDefault: false },
        state: "active",
        origin: "automatic",
        expiresAt: null,
        tags: [],
        order: 0,
        exclusive: false,
      },
      memberships: [
        { type: "profile", itemId: "missing-profile", createdAt: 1, order: 0 },
        { type: "session", itemId: "missing-session", createdAt: 1, order: 0 },
      ],
      preferences: { theme: "inherit", sessionView: "inherit", exclusive: false, restoreOnStartup: false, openUrlsOnActivate: [] },
    };
    const validation = mgr.validateImportPackage(pkg);
    expect(validation.valid).toBe(true);
    expect(validation.warnings.length).toBe(2);
  });
});

describe("WorkspaceManager — duplication", () => {
  it("duplicates a workspace with memberships", async () => {
    const mgr = createManager();
    const ws = await mgr.create(baseWorkspaceInput({ name: "To Duplicate", tags: ["tag1"] }));
    await mgr.assignProfile(ws.workspace.id, "profile-1");
    const duplicate = await mgr.duplicate(ws.workspace.id, "Copy");
    expect(duplicate.metadata.name).toBe("Copy");
    expect(duplicate.id).not.toBe(ws.workspace.id);
    expect(duplicate.state).toBe("active");
    expect(mgr.listProfileIds(duplicate.id)).toEqual(["profile-1"]);
    expect(mgr.list()).toHaveLength(2);
  });

  it("rejects duplicate with taken name", async () => {
    const mgr = createManager();
    await mgr.create(baseWorkspaceInput({ name: "Original" }));
    await mgr.create(baseWorkspaceInput({ name: "Copy" }));
    await expect(mgr.duplicate("Original", "Copy")).rejects.toThrow(WorkspaceError);
  });
});

describe("WorkspaceManager — navigation integration", () => {
  it("builds context menu items", async () => {
    const mgr = createManager();
    const a = await mgr.create(baseWorkspaceInput({ name: "A" }));
    const b = await mgr.create(baseWorkspaceInput({ name: "B" }));
    const items = mgr.getContextMenuItems(a.workspace.id);
    expect(items[0]?.active).toBe(true);
    expect(items[1]?.active).toBe(false);
    expect(items.map((i) => i.title).sort()).toEqual(["A", "B"]);
  });
});
