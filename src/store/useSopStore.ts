import { create } from 'zustand';
import {
  SopProject,
  SopStep,
  CalloutType,
  BeautifySettings,
  AnnotationItem,
  CoverPageSettings,
  DEFAULT_COVER_PAGE_SETTINGS,
  ErrorFaqItem,
  OcrAnalysisResult,
} from '../types/sop';
import { SAMPLE_PROJECT, DEFAULT_THEME } from './sampleData';

const LOCAL_STORAGE_KEY = 'stepflow_projects';
const ACTIVE_PROJECT_KEY = 'stepflow_active_project_id';

export interface SopState {
  // State
  projects: SopProject[];
  activeProject: SopProject | null;
  activeStepId: string | null;
  activeView: 'library' | 'studio' | 'overlay';
  isCapturing: boolean;
  recentCapture: string | null;
  lastDeletedStep: { step: SopStep; index: number } | null;
  retakeStepId: string | null;

  // Error FAQ State
  errorFaqItems: ErrorFaqItem[];
  activeErrorAnalysis: OcrAnalysisResult | null;
  isAnalyzingOcr: boolean;
  isSearchHudOpen: boolean;

  // Actions
  loadProjects: () => Promise<void>;
  loadErrorFaq: () => Promise<void>;
  saveErrorFaqItem: (item: ErrorFaqItem) => Promise<boolean>;
  deleteErrorFaqItem: (id: string) => Promise<boolean>;
  setActiveErrorAnalysis: (result: OcrAnalysisResult | null) => void;
  setIsAnalyzingOcr: (isAnalyzing: boolean) => void;
  setIsSearchHudOpen: (isOpen: boolean) => void;
  analyzeImageWithOcr: (imagePathOrBase64: string) => Promise<OcrAnalysisResult | null>;
  createProject: (name?: string, description?: string, author?: string) => SopProject;
  selectProject: (id: string | null) => void;
  syncActiveProjectFromExternal: (project: SopProject | null) => void;
  saveCurrentProject: () => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  duplicateProject: (id: string) => SopProject | null;
  updateProjectById: (id: string, updates: Partial<SopProject>) => void;
  updateProjectDetails: (details: Partial<SopProject>) => void;
  updateCoverPageSettings: (settings: Partial<CoverPageSettings>) => void;
  addStep: (imagePath?: string, title?: string, description?: string) => SopStep;
  addTextStep: (title?: string, description?: string) => SopStep;
  updateStep: (stepId: string, updates: Partial<SopStep>) => void;
  deleteStep: (stepId: string) => void;
  revertDeletedStep: () => void;
  clearLastDeletedStep: () => void;
  reorderSteps: (startIndex: number, endIndex: number) => void;
  retakeStepImage: (stepId: string, newImagePath: string) => void;
  setRetakeStepId: (stepId: string | null) => void;
  setStepAnnotations: (stepId: string, annotations: AnnotationItem[]) => void;
  setStepCallout: (stepId: string, callout?: { type: CalloutType; text: string }) => void;
  updateBeautifySettings: (settings: Partial<BeautifySettings>) => void;
  setActiveView: (view: 'library' | 'studio' | 'overlay') => void;
  setActiveStepId: (stepId: string | null) => void;
  setIsCapturing: (capturing: boolean) => void;
  setRecentCapture: (capture: string | null) => void;
}

// Helper to save projects to storage and IPC if present
function persistProjects(projects: SopProject[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(projects));
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
  }
}

function broadcastProjectUpdate(project: SopProject, projects: SopProject[]) {
  persistProjects(projects);
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
  } catch (err) {
    console.error('Failed to save active project id to localStorage:', err);
  }
  if (typeof window !== 'undefined' && window.electronAPI?.saveProject) {
    window.electronAPI.saveProject(project).catch(console.error);
  }
  if (typeof window !== 'undefined' && window.electronAPI?.syncActiveProject) {
    window.electronAPI.syncActiveProject(project);
  }
}

/**
 * Checks if a step title is a default/auto-generated title (e.g. "Step 10: Action", "Step 10", "Step 10: Important Notes")
 */
export function isDefaultStepTitle(title?: string | null): boolean {
  if (!title || !title.trim()) return true;
  const trimmed = title.trim();
  return (
    /^Step\s+\d+(\s*[:\-–—]\s*(Action|Important Notes|Visual Step|Documentation Step))?\s*:?$/i.test(trimmed) ||
    /^Step\s+\d+\s*Captured$/i.test(trimmed)
  );
}

/**
 * Updates step order and dynamically updates the default title to match the new order,
 * while leaving custom titles completely untouched.
 */
export function updateStepOrderAndTitle(step: SopStep, newOrder: number): SopStep {
  let newTitle = step.title;

  if (isDefaultStepTitle(step.title)) {
    if (!step.title || !step.title.trim()) {
      newTitle = step.type === 'text_only' ? `Step ${newOrder}: Important Notes` : `Step ${newOrder}: Action`;
    } else {
      newTitle = step.title.replace(/^Step\s+\d+/i, `Step ${newOrder}`);
    }
  }

  return {
    ...step,
    order: newOrder,
    title: newTitle
  };
}

/**
 * Normalizes all steps in a project so that order numbers are 1..N and any default titles
 * match their new order position.
 */
export function normalizeProjectSteps(project: SopProject): SopProject {
  const updatedSteps = project.steps.map((step, idx) => updateStepOrderAndTitle(step, idx + 1));
  return {
    ...project,
    steps: updatedSteps
  };
}

function loadInitialProjects(): { projects: SopProject[]; activeProject: SopProject | null } {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed.map(normalizeProjectSteps);
        const savedActiveId = localStorage.getItem(ACTIVE_PROJECT_KEY);
        const active = savedActiveId ? normalized.find((p: SopProject) => p.id === savedActiveId) || normalized[0] : normalized[0];
        return { projects: normalized, activeProject: active || null };
      }
    }
  } catch (err) {
    console.error('Failed to load from localStorage:', err);
  }
  // Fallback to sample project
  persistProjects([SAMPLE_PROJECT]);
  return { projects: [SAMPLE_PROJECT], activeProject: SAMPLE_PROJECT };
}

const { projects: initialProjects, activeProject: initialActiveProject } = loadInitialProjects();
const initialSavedActiveId = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_PROJECT_KEY) : null;

export const useSopStore = create<SopState>((set, get) => ({
  projects: initialProjects,
  activeProject: initialActiveProject,
  activeStepId: initialActiveProject?.steps[0]?.id || null,
  activeView: (initialActiveProject && initialSavedActiveId) ? 'studio' : 'library',
  isCapturing: false,
  recentCapture: null,
  lastDeletedStep: null,
  retakeStepId: null,

  // Error FAQ State
  errorFaqItems: [],
  activeErrorAnalysis: null,
  isAnalyzingOcr: false,
  isSearchHudOpen: false,

  loadProjects: async () => {
    try {
      let loadedProjects: SopProject[] = [];
      if (typeof window !== 'undefined' && window.electronAPI?.listProjects) {
        const ipcProjects = await window.electronAPI.listProjects();
        if (ipcProjects && ipcProjects.length > 0) {
          loadedProjects = ipcProjects;
        }
      }
      if (loadedProjects.length === 0) {
        const { projects } = loadInitialProjects();
        loadedProjects = projects;
      }
      loadedProjects = loadedProjects.map(normalizeProjectSteps);
      persistProjects(loadedProjects);

      const savedActiveId = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_PROJECT_KEY) : null;
      let active = loadedProjects.find((p) => p.id === savedActiveId);

      if (!active && typeof window !== 'undefined' && window.electronAPI?.getActiveProject) {
        const ipcActive = await window.electronAPI.getActiveProject();
        if (ipcActive) {
          active = loadedProjects.find((p) => p.id === ipcActive.id) || normalizeProjectSteps(ipcActive);
        }
      }

      if (active) {
        try {
          localStorage.setItem(ACTIVE_PROJECT_KEY, active.id);
        } catch {}
        set({
          projects: loadedProjects,
          activeProject: active,
          activeStepId: active.steps[0]?.id || null,
          activeView: 'studio'
        });
      } else {
        set({
          projects: loadedProjects,
          activeProject: null,
          activeStepId: null,
          activeView: 'library'
        });
      }
    } catch (err) {
      console.warn('Could not load projects via IPC, using local store:', err);
      const { projects, activeProject } = loadInitialProjects();
      set({
        projects,
        activeProject,
        activeStepId: activeProject?.steps[0]?.id || null
      });
    }
  },

  createProject: (name?: string, description?: string, author?: string) => {
    const newProject: SopProject = {
      id: `proj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: name?.trim() || 'Untitled SOP Project',
      description: description?.trim() || '',
      author: author?.trim() || 'Team Member',
      version: '1.0.0',
      tags: [],
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      theme: { ...DEFAULT_THEME },
      coverPage: {
        ...DEFAULT_COVER_PAGE_SETTINGS,
        title: name?.trim() || 'Standard Operating Procedure',
        subtitle: description?.trim() || ''
      },
      steps: []
    };

    const updatedProjects = [newProject, ...get().projects];
    broadcastProjectUpdate(newProject, updatedProjects);

    set({
      projects: updatedProjects,
      activeProject: newProject,
      activeStepId: null,
      activeView: 'studio'
    });

    return newProject;
  },

  selectProject: (id: string | null) => {
    if (!id) {
      try {
        localStorage.removeItem(ACTIVE_PROJECT_KEY);
      } catch {}
      if (typeof window !== 'undefined' && window.electronAPI?.syncActiveProject) {
        window.electronAPI.syncActiveProject(null);
      }
      set({
        activeProject: null,
        activeStepId: null,
        activeView: 'library'
      });
      return;
    }
    const found = get().projects.find((p) => p.id === id);
    if (found) {
      const normalized = normalizeProjectSteps(found);
      try {
        localStorage.setItem(ACTIVE_PROJECT_KEY, id);
      } catch {}
      if (typeof window !== 'undefined' && window.electronAPI?.syncActiveProject) {
        window.electronAPI.syncActiveProject(normalized);
      }
      set({
        activeProject: normalized,
        activeStepId: normalized.steps[0]?.id || null,
        activeView: 'studio'
      });
    }
  },

  syncActiveProjectFromExternal: (project: SopProject | null) => {
    if (!project) {
      set({ activeProject: null, activeStepId: null });
      return;
    }
    const normalized = normalizeProjectSteps(project);
    const { projects, activeStepId, retakeStepId } = get();
    const existingIndex = projects.findIndex((p) => p.id === normalized.id);
    let updatedProjects: SopProject[];
    if (existingIndex >= 0) {
      updatedProjects = projects.map((p) => (p.id === normalized.id ? normalized : p));
    } else {
      updatedProjects = [normalized, ...projects];
    }
    persistProjects(updatedProjects);
    try {
      localStorage.setItem(ACTIVE_PROJECT_KEY, normalized.id);
    } catch {}

    const targetId = retakeStepId || activeStepId;
    const exists = targetId
      ? targetId === 'cover' || targetId === 'index' || normalized.steps.some((s) => s.id === targetId)
      : false;
    const resolvedActiveStepId = exists
      ? targetId
      : (normalized.steps[normalized.steps.length - 1]?.id || null);

    set({
      activeProject: normalized,
      projects: updatedProjects,
      activeStepId: resolvedActiveStepId
    });
  },

  saveCurrentProject: async () => {
    const { activeProject, projects } = get();
    if (!activeProject) return;

    const updatedProject = {
      ...activeProject,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);

    set({
      activeProject: updatedProject,
      projects: updatedProjects
    });
  },

  deleteProject: async (id: string) => {
    const { projects, activeProject } = get();
    const updatedProjects = projects.filter((p) => p.id !== id);
    persistProjects(updatedProjects);

    if (typeof window !== 'undefined' && window.electronAPI?.deleteProject) {
      try {
        await window.electronAPI.deleteProject(id);
      } catch (err) {
        console.error('IPC deleteProject error:', err);
      }
    }

    const nextActive = activeProject?.id === id ? null : activeProject;
    if (nextActive) {
      try {
        localStorage.setItem(ACTIVE_PROJECT_KEY, nextActive.id);
      } catch {}
      if (typeof window !== 'undefined' && window.electronAPI?.syncActiveProject) {
        window.electronAPI.syncActiveProject(nextActive);
      }
    } else {
      try {
        localStorage.removeItem(ACTIVE_PROJECT_KEY);
      } catch {}
      if (typeof window !== 'undefined' && window.electronAPI?.syncActiveProject) {
        window.electronAPI.syncActiveProject(null);
      }
    }

    set({
      projects: updatedProjects,
      activeProject: nextActive,
      activeStepId: nextActive ? nextActive.steps[0]?.id || null : null,
      activeView: nextActive ? 'studio' : 'library'
    });
  },

  duplicateProject: (id: string) => {
    const { projects } = get();
    const target = projects.find((p) => p.id === id);
    if (!target) return null;

    const duplicated: SopProject = {
      ...JSON.parse(JSON.stringify(target)),
      id: `proj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: `${target.name} (Copy)`,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = [duplicated, ...projects];
    persistProjects(updatedProjects);
    if (typeof window !== 'undefined' && window.electronAPI?.saveProject) {
      window.electronAPI.saveProject(duplicated).catch(console.error);
    }

    set({ projects: updatedProjects });
    return duplicated;
  },

  updateProjectById: (id: string, updates: Partial<SopProject>) => {
    const { projects, activeProject } = get();
    const target = projects.find((p) => p.id === id);
    if (!target) return;

    const updatedProject: SopProject = {
      ...target,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    if (updates.name && (!updatedProject.coverPage?.title || updatedProject.coverPage.title === target.name)) {
      updatedProject.coverPage = {
        ...DEFAULT_COVER_PAGE_SETTINGS,
        ...(updatedProject.coverPage || {}),
        title: updates.name
      };
    }

    const updatedProjects = projects.map((p) =>
      p.id === id ? updatedProject : p
    );

    persistProjects(updatedProjects);
    if (typeof window !== 'undefined' && window.electronAPI?.saveProject) {
      window.electronAPI.saveProject(updatedProject).catch(console.error);
    }

    if (activeProject?.id === id) {
      broadcastProjectUpdate(updatedProject, updatedProjects);
      set({
        activeProject: updatedProject,
        projects: updatedProjects
      });
    } else {
      set({ projects: updatedProjects });
    }
  },

  updateProjectDetails: (details: Partial<SopProject>) => {
    const { activeProject, projects } = get();
    if (!activeProject) return;

    const updatedProject: SopProject = {
      ...activeProject,
      ...details,
      updatedAt: new Date().toISOString()
    };

    if (details.name && (!updatedProject.coverPage?.title || updatedProject.coverPage.title === activeProject.name)) {
      updatedProject.coverPage = {
        ...DEFAULT_COVER_PAGE_SETTINGS,
        ...(updatedProject.coverPage || {}),
        title: details.name
      };
    }

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects
    });
  },

  updateCoverPageSettings: (settings: Partial<CoverPageSettings>) => {
    const { activeProject, projects } = get();
    if (!activeProject) return;

    const currentCoverPage = activeProject.coverPage || DEFAULT_COVER_PAGE_SETTINGS;
    const updatedCoverPage: CoverPageSettings = {
      ...currentCoverPage,
      ...settings
    };

    const updatedProject: SopProject = {
      ...activeProject,
      coverPage: updatedCoverPage,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects
    });
  },

  addStep: (imagePath?: string, title?: string, description?: string) => {
    let currentProject = get().activeProject;
    
    // Auto-create project if none is active
    if (!currentProject) {
      currentProject = get().createProject('New Capture SOP');
    }

    const nextOrder = currentProject.steps.length + 1;
    const newStep: SopStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      order: nextOrder,
      type: 'screenshot',
      title: title || `Step ${nextOrder}: Action`,
      description: description || '',
      image: imagePath
        ? {
            originalImagePath: imagePath,
            dimensions: { width: 1280, height: 720 },
            annotations: []
          }
        : undefined
    };

    const updatedSteps = [...currentProject.steps, newStep];
    const updatedProject = {
      ...currentProject,
      steps: updatedSteps,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = get().projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects,
      activeStepId: newStep.id
    });

    return newStep;
  },

  addTextStep: (title?: string, description?: string) => {
    let currentProject = get().activeProject;
    if (!currentProject) {
      currentProject = get().createProject('New SOP Project');
    }

    const nextOrder = currentProject.steps.length + 1;
    const newStep: SopStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      order: nextOrder,
      type: 'text_only',
      title: title || `Step ${nextOrder}: Important Notes`,
      description: description || 'Write step instructions, prerequisites, or outcomes here...'
    };

    const updatedSteps = [...currentProject.steps, newStep];
    const updatedProject = {
      ...currentProject,
      steps: updatedSteps,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = get().projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects,
      activeStepId: newStep.id
    });

    return newStep;
  },

  updateStep: (stepId: string, updates: Partial<SopStep>) => {
    const { activeProject, projects } = get();
    if (!activeProject) return;

    const updatedSteps = activeProject.steps.map((s) =>
      s.id === stepId ? { ...s, ...updates } : s
    );

    const updatedProject: SopProject = {
      ...activeProject,
      steps: updatedSteps,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects
    });
  },

  deleteStep: (stepId: string) => {
    const { activeProject, projects, activeStepId } = get();
    if (!activeProject) return;

    const stepIndex = activeProject.steps.findIndex((s) => s.id === stepId);
    if (stepIndex === -1) return;
    const deletedStep = activeProject.steps[stepIndex];

    const remainingSteps = activeProject.steps
      .filter((s) => s.id !== stepId)
      .map((s, idx) => updateStepOrderAndTitle(s, idx + 1));

    let nextActiveStepId = activeStepId;
    if (activeStepId === stepId) {
      nextActiveStepId = remainingSteps[stepIndex]?.id || remainingSteps[stepIndex - 1]?.id || remainingSteps[0]?.id || null;
    }

    const updatedProject: SopProject = {
      ...activeProject,
      steps: remainingSteps,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects,
      activeStepId: nextActiveStepId,
      lastDeletedStep: { step: deletedStep, index: stepIndex }
    });
  },

  revertDeletedStep: () => {
    const { activeProject, projects, lastDeletedStep } = get();
    if (!activeProject || !lastDeletedStep) return;

    const { step, index } = lastDeletedStep;
    const reinsertedSteps = Array.from(activeProject.steps);
    const targetIndex = Math.max(0, Math.min(index, reinsertedSteps.length));
    reinsertedSteps.splice(targetIndex, 0, step);

    const renumberedSteps = reinsertedSteps.map((s, idx) => updateStepOrderAndTitle(s, idx + 1));

    const updatedProject: SopProject = {
      ...activeProject,
      steps: renumberedSteps,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects,
      activeStepId: step.id,
      lastDeletedStep: null
    });
  },

  clearLastDeletedStep: () => {
    set({ lastDeletedStep: null });
  },

  setRetakeStepId: (stepId: string | null) => {
    if (typeof window !== 'undefined' && window.electronAPI?.setRetakeStepId) {
      window.electronAPI.setRetakeStepId(stepId);
    }
    set({ retakeStepId: stepId });
  },

  reorderSteps: (startIndex: number, endIndex: number) => {
    const { activeProject, projects } = get();
    if (!activeProject) return;
    if (
      startIndex < 0 ||
      startIndex >= activeProject.steps.length ||
      endIndex < 0 ||
      endIndex >= activeProject.steps.length
    ) {
      return;
    }

    const reordered = Array.from(activeProject.steps);
    const [removed] = reordered.splice(startIndex, 1);
    reordered.splice(endIndex, 0, removed);

    const updatedSteps = reordered.map((step, idx) => updateStepOrderAndTitle(step, idx + 1));

    const updatedProject: SopProject = {
      ...activeProject,
      steps: updatedSteps,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects,
      activeStepId: removed.id
    });
  },

  retakeStepImage: (stepId: string, newImagePath: string) => {
    const { activeProject, projects } = get();
    if (!activeProject) return;

    const updatedSteps = activeProject.steps.map((s) => {
      if (s.id === stepId) {
        return {
          ...s,
          image: {
            originalImagePath: newImagePath,
            dimensions: s.image?.dimensions || { width: 1280, height: 720 },
            annotations: s.image?.annotations || []
          }
        };
      }
      return s;
    });

    const updatedProject: SopProject = {
      ...activeProject,
      steps: updatedSteps,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects
    });
  },

  setStepAnnotations: (stepId: string, annotations: AnnotationItem[]) => {
    const { activeProject, projects } = get();
    if (!activeProject) return;

    const updatedSteps = activeProject.steps.map((s) => {
      if (s.id === stepId && s.image) {
        return {
          ...s,
          image: {
            ...s.image,
            annotations
          }
        };
      }
      return s;
    });

    const updatedProject: SopProject = {
      ...activeProject,
      steps: updatedSteps,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects
    });
  },

  setStepCallout: (stepId: string, callout?: { type: CalloutType; text: string }) => {
    const { activeProject, projects } = get();
    if (!activeProject) return;

    const updatedSteps = activeProject.steps.map((s) =>
      s.id === stepId ? { ...s, callout } : s
    );

    const updatedProject: SopProject = {
      ...activeProject,
      steps: updatedSteps,
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects
    });
  },

  updateBeautifySettings: (settings: Partial<BeautifySettings>) => {
    const { activeProject, projects } = get();
    if (!activeProject) return;

    const updatedProject: SopProject = {
      ...activeProject,
      theme: {
        ...activeProject.theme,
        beautifySettings: {
          ...activeProject.theme.beautifySettings,
          ...settings
        }
      },
      updatedAt: new Date().toISOString()
    };

    const updatedProjects = projects.map((p) =>
      p.id === updatedProject.id ? updatedProject : p
    );

    broadcastProjectUpdate(updatedProject, updatedProjects);
    set({
      activeProject: updatedProject,
      projects: updatedProjects
    });
  },

  setActiveView: (view: 'library' | 'studio' | 'overlay') => {
    set({ activeView: view });
  },

  setActiveStepId: (stepId: string | null) => {
    set({ activeStepId: stepId });
  },

  setIsCapturing: (capturing: boolean) => {
    set({ isCapturing: capturing });
  },

  setRecentCapture: (capture: string | null) => {
    set({ recentCapture: capture });
  },

  loadErrorFaq: async () => {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.listErrorFaq) {
        const items = await window.electronAPI.listErrorFaq();
        set({ errorFaqItems: items || [] });
      }
    } catch (err) {
      console.error('Failed to load error FAQ items:', err);
    }
  },

  saveErrorFaqItem: async (item: ErrorFaqItem): Promise<boolean> => {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.saveErrorFaq) {
        const success = await window.electronAPI.saveErrorFaq(item);
        if (success) {
          const { errorFaqItems } = get();
          const existingIdx = errorFaqItems.findIndex((i) => i.id === item.id);
          let updated: ErrorFaqItem[];
          if (existingIdx >= 0) {
            updated = [...errorFaqItems];
            updated[existingIdx] = item;
          } else {
            updated = [item, ...errorFaqItems];
          }
          set({ errorFaqItems: updated });
        }
        return success;
      }
      return false;
    } catch (err) {
      console.error('Failed to save error FAQ item:', err);
      return false;
    }
  },

  deleteErrorFaqItem: async (id: string): Promise<boolean> => {
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.deleteErrorFaq) {
        const success = await window.electronAPI.deleteErrorFaq(id);
        if (success) {
          const { errorFaqItems } = get();
          set({ errorFaqItems: errorFaqItems.filter((i) => i.id !== id) });
        }
        return success;
      }
      return false;
    } catch (err) {
      console.error('Failed to delete error FAQ item:', err);
      return false;
    }
  },

  setActiveErrorAnalysis: (result: OcrAnalysisResult | null) => {
    set({ activeErrorAnalysis: result });
  },

  setIsAnalyzingOcr: (isAnalyzing: boolean) => {
    set({ isAnalyzingOcr: isAnalyzing });
  },

  setIsSearchHudOpen: (isOpen: boolean) => {
    set({ isSearchHudOpen: isOpen });
  },

  analyzeImageWithOcr: async (imagePathOrBase64: string): Promise<OcrAnalysisResult | null> => {
    set({ isAnalyzingOcr: true });
    try {
      if (typeof window !== 'undefined' && window.electronAPI?.analyzeErrorImage) {
        const result = await window.electronAPI.analyzeErrorImage(imagePathOrBase64);
        set({ activeErrorAnalysis: result, isAnalyzingOcr: false });
        return result;
      }
      set({ isAnalyzingOcr: false });
      return null;
    } catch (err) {
      console.error('Failed to analyze image with OCR:', err);
      set({ isAnalyzingOcr: false });
      return null;
    }
  }
}));
