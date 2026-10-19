import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { IpcBridge, SopProject } from '../src/types/sop';

const electronAPI: IpcBridge = {
  // Capture & Hotkeys
  triggerCapture: (isRetake?: boolean, mode: 'fullscreen' | 'selection' = 'fullscreen'): Promise<string | null> => {
    return ipcRenderer.invoke('trigger-capture', isRetake, mode);
  },
  onCaptureCompleted: (callback: (imagePath: string) => void): (() => void) => {
    const subscription = (_event: IpcRendererEvent, imagePath: string) => {
      callback(imagePath);
    };
    ipcRenderer.on('capture-completed', subscription);
    return () => {
      ipcRenderer.removeListener('capture-completed', subscription);
    };
  },

  // Window Management
  minimizeToOverlay: (anchor?: { x: number; y: number }): void => {
    ipcRenderer.send('minimize-to-overlay', anchor);
  },
  restoreStudio: (): void => {
    ipcRenderer.send('restore-studio');
  },
  closeOverlay: (): void => {
    ipcRenderer.send('close-overlay');
  },
  setOverlaySize: (mode: 'collapsed' | 'expanded' | 'preview'): void => {
    ipcRenderer.send('set-overlay-size', mode);
  },
  onStudioRestored: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('studio-restored', handler);
    return () => {
      ipcRenderer.removeListener('studio-restored', handler);
    };
  },
  syncActiveProject: (project: SopProject | null): void => {
    ipcRenderer.send('sync-active-project', project);
  },
  onActiveProjectSynced: (callback: (project: SopProject | null) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, project: SopProject | null) => {
      callback(project);
    };
    ipcRenderer.on('active-project-synced', handler);
    return () => {
      ipcRenderer.removeListener('active-project-synced', handler);
    };
  },
  getActiveProject: (): Promise<SopProject | null> => {
    return ipcRenderer.invoke('get-active-project');
  },
  setRetakeStepId: (stepId: string | null): void => {
    ipcRenderer.send('set-retake-step-id', stepId);
  },
  onRetakeStepIdChanged: (callback: (stepId: string | null) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, stepId: string | null) => {
      callback(stepId);
    };
    ipcRenderer.on('retake-step-id-changed', handler);
    return () => {
      ipcRenderer.removeListener('retake-step-id-changed', handler);
    };
  },

  // Project I/O
  listProjects: (): Promise<SopProject[]> => {
    return ipcRenderer.invoke('list-projects');
  },
  saveProject: (project: SopProject): Promise<boolean> => {
    return ipcRenderer.invoke('save-project', project);
  },
  loadProject: (id: string): Promise<SopProject | null> => {
    return ipcRenderer.invoke('load-project', id);
  },
  deleteProject: (id: string): Promise<boolean> => {
    return ipcRenderer.invoke('delete-project', id);
  },
  onProjectFileChanged: (
    callback: (data: { id: string; action: 'save' | 'delete'; project?: SopProject }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      data: { id: string; action: 'save' | 'delete'; project?: SopProject }
    ) => {
      callback(data);
    };
    ipcRenderer.on('project-file-changed', handler);
    return () => {
      ipcRenderer.removeListener('project-file-changed', handler);
    };
  },

  // Workspace & Shared Storage
  getWorkspacePath: (): Promise<{ path: string; isCustom: boolean; defaultPath: string }> => {
    return ipcRenderer.invoke('get-workspace-path');
  },
  changeWorkspacePath: (): Promise<{ success: boolean; canceled?: boolean; newPath?: string; error?: string }> => {
    return ipcRenderer.invoke('change-workspace-path');
  },
  resetWorkspacePath: (): Promise<{ success: boolean; defaultPath: string }> => {
    return ipcRenderer.invoke('reset-workspace-path');
  },
  openWorkspaceFolder: (): Promise<void> => {
    return ipcRenderer.invoke('open-workspace-folder');
  },
  onWorkspacePathChanged: (
    callback: (data: { path: string; isCustom: boolean; defaultPath: string }) => void
  ): (() => void) => {
    const handler = (
      _event: IpcRendererEvent,
      data: { path: string; isCustom: boolean; defaultPath: string }
    ) => {
      callback(data);
    };
    ipcRenderer.on('workspace-path-changed', handler);
    return () => {
      ipcRenderer.removeListener('workspace-path-changed', handler);
    };
  },

  // Portable Bundles (.stepflow archive)
  exportProjectBundle: (
    project: SopProject
  ): Promise<{ success: boolean; canceled?: boolean; filePath?: string; error?: string }> => {
    return ipcRenderer.invoke('export-project-bundle', project);
  },
  importProjectBundle: (): Promise<{ success: boolean; canceled?: boolean; project?: SopProject; error?: string }> => {
    return ipcRenderer.invoke('import-project-bundle');
  },

  // Exporting
  exportPptx: (project: SopProject, fileData?: ArrayBuffer | Uint8Array | string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    return ipcRenderer.invoke('export-pptx', project, fileData);
  },
  exportPdf: (project: SopProject, fileData?: ArrayBuffer | Uint8Array | string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    return ipcRenderer.invoke('export-pdf', project, fileData);
  },
  exportHtml: (project: SopProject, htmlContent?: string): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    return ipcRenderer.invoke('export-html', project, htmlContent);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
