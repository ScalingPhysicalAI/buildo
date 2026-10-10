// Fetches and caches the skill catalog, the user's own recording sessions,
// their apps, and the public app store, with mutation helpers that re-sync
// the relevant piece of state after a write (upload, start training, create
// app, certify, publish, install).

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { useAuth } from "./auth-context";
import {
  createApp as apiCreateApp,
  createCustomSkill as apiCreateCustomSkill,
  createSkillCollection as apiCreateSkillCollection,
  deleteApp as apiDeleteApp,
  deployApp as apiDeployApp,
  fetchAppStore as apiFetchAppStore,
  fetchApps as apiFetchApps,
  fetchSkillCatalog as apiFetchSkillCatalog,
  installApp as apiInstallApp,
  publishApp as apiPublishApp,
  startTraining as apiStartTraining,
  type AppCategory,
  type AppListing,
  type AppStoreListing,
  type SkillCatalogEntry,
  type SkillDefinition,
} from "./skills-api";

interface SkillsState {
  catalog: SkillCatalogEntry[];
  apps: AppListing[];
  appStore: AppStoreListing[];
  isLoading: boolean;
  refreshCatalog: () => Promise<void>;
  refreshApps: () => Promise<void>;
  refreshAppStore: () => Promise<void>;
  recordUpload: (skillSlug: string, fileName?: string, durationSec?: number) => Promise<void>;
  startTraining: (collectionId: string) => Promise<void>;
  createCustomSkill: (name: string) => Promise<SkillDefinition>;
  createApp: (input: {
    name: string;
    description?: string;
    category: AppCategory;
    skillCollectionIds: string[];
  }) => Promise<AppListing>;
  deployApp: (id: string) => Promise<AppListing>;
  publishApp: (id: string) => Promise<AppListing>;
  installApp: (id: string) => Promise<void>;
  deleteApp: (id: string) => Promise<void>;
}

const SkillsContext = createContext<SkillsState | null>(null);

export function SkillsProvider({ children }: { children: ReactNode }) {
  const { user, refresh: refreshUser } = useAuth();
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [apps, setApps] = useState<AppListing[]>([]);
  const [appStore, setAppStore] = useState<AppStoreListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refreshCatalog = useCallback(async () => {
    setCatalog(await apiFetchSkillCatalog());
  }, []);

  const refreshApps = useCallback(async () => {
    setApps(await apiFetchApps());
  }, []);

  const refreshAppStore = useCallback(async () => {
    setAppStore(await apiFetchAppStore());
  }, []);

  useEffect(() => {
    if (!user) {
      setCatalog([]);
      setApps([]);
      setAppStore([]);
      return;
    }
    setIsLoading(true);
    // Any one of these can fail on its own (e.g. the backend not deployed
    // yet) without taking the rest of the app down with an uncaught promise
    // rejection -- each screen that reads catalog/apps/appStore already
    // handles an empty array as "nothing yet", not an error state.
    Promise.allSettled([refreshCatalog(), refreshApps(), refreshAppStore()])
      .then((results) => {
        results.forEach((r) => {
          if (r.status === "rejected") console.warn("[skills] initial fetch failed:", r.reason);
        });
      })
      .finally(() => setIsLoading(false));
  }, [user, refreshCatalog, refreshApps, refreshAppStore]);

  async function recordUpload(skillSlug: string, fileName?: string, durationSec?: number) {
    // Uploading doesn't move the user's balance anymore -- a skill's reward
    // is only ever realized later, per install, once it's bundled into a
    // published app someone else installs.
    await apiCreateSkillCollection(skillSlug, fileName, durationSec);
    await refreshCatalog();
  }

  async function startTraining(collectionId: string) {
    await apiStartTraining(collectionId);
    await refreshCatalog();
  }

  async function createCustomSkill(name: string) {
    const skill = await apiCreateCustomSkill(name);
    await refreshCatalog();
    return skill;
  }

  async function createApp(input: {
    name: string;
    description?: string;
    category: AppCategory;
    skillCollectionIds: string[];
  }) {
    const app = await apiCreateApp(input);
    await refreshApps();
    return app;
  }

  async function deployApp(id: string) {
    const { app } = await apiDeployApp(id);
    await Promise.all([refreshApps(), refreshUser()]);
    return app;
  }

  async function publishApp(id: string) {
    const { app } = await apiPublishApp(id);
    await Promise.all([refreshApps(), refreshAppStore(), refreshUser()]);
    return app;
  }

  async function installApp(id: string) {
    await apiInstallApp(id);
    await refreshAppStore();
  }

  async function deleteApp(id: string) {
    await apiDeleteApp(id);
    await refreshApps();
  }

  return (
    <SkillsContext.Provider
      value={{
        catalog,
        apps,
        appStore,
        isLoading,
        refreshCatalog,
        refreshApps,
        refreshAppStore,
        recordUpload,
        startTraining,
        createCustomSkill,
        createApp,
        deployApp,
        publishApp,
        installApp,
        deleteApp,
      }}
    >
      {children}
    </SkillsContext.Provider>
  );
}

export function useSkills(): SkillsState {
  const ctx = useContext(SkillsContext);
  if (!ctx) throw new Error("useSkills must be used within SkillsProvider");
  return ctx;
}
