import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Plus,
  MoreVertical,
  Clock,
  Layers,
  Trash2,
  Copy,
  Edit2,
  FolderOpen,
  ArrowRight,
  FileText,
  Sparkles,
  Check,
  Bot,
  X,
  FolderSync,
  UploadCloud,
  Package,
  ExternalLink,
  HardDrive,
  AlertTriangle,
} from 'lucide-react';
import { useSopStore } from '../../store/useSopStore';
import { SopProject, ErrorFaqItem } from '../../types/sop';
import { ErrorKnowledgeBaseView } from '../faq/ErrorKnowledgeBaseView';
import { ErrorSearchModal } from '../faq/ErrorSearchModal';
import { ErrorFaqEditorModal } from '../faq/ErrorFaqEditorModal';

export const ProjectLibrary: React.FC = () => {
  const {
    projects,
    selectProject,
    createProject,
    deleteProject,
    duplicateProject,
    updateProjectById,
    loadProjects,
    errorFaqItems,
    loadErrorFaq,
  } = useSopStore();

  const [libraryTab, setLibraryTab] = useState<'sop' | 'error_faq'>('sop');
  const [showSearchHud, setShowSearchHud] = useState(false);
  const [editorItem, setEditorItem] = useState<ErrorFaqItem | null>(null);
  const [showEditorModal, setShowEditorModal] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newAuthor, setNewAuthor] = useState('');

  // Dropdown / Rename Modal state
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [renamingProject, setRenamingProject] = useState<SopProject | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Workspace & Shared Storage state
  const [workspaceInfo, setWorkspaceInfo] = useState<{ path: string; isCustom: boolean; defaultPath: string } | null>(null);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // MCP Integration Modal state
  const [showMcpModal, setShowMcpModal] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const mcpServerPath = '/Users/joeyaipassa/Coding/Projects/SOP_creator/dist-electron/electron/mcp-server.js';
  const mcpConfigJson = JSON.stringify(
    {
      mcpServers: {
        stepflow: {
          command: 'node',
          args: [mcpServerPath]
        }
      }
    },
    null,
    2
  );

  const handleCopySnippet = () => {
    navigator.clipboard.writeText(mcpConfigJson);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  // Load workspace path info on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.getWorkspacePath) {
      window.electronAPI.getWorkspacePath().then(setWorkspaceInfo).catch(console.error);
    }
    loadErrorFaq();
  }, [loadErrorFaq]);

  // Global search HUD shortcut listener (Ctrl+Shift+F)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.onOpenSearchHud) {
      const unsub = window.electronAPI.onOpenSearchHud(() => {
        setShowSearchHud(true);
      });
      return unsub;
    }
  }, []);

  const showFeedback = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 3500);
  };

  const handleImportBundle = async () => {
    if (!window.electronAPI?.importProjectBundle) return;
    try {
      const res = await window.electronAPI.importProjectBundle();
      if (res.success && res.project) {
        showFeedback(`Imported "${res.project.name}" successfully!`);
        await loadProjects();
        selectProject(res.project.id);
      } else if (!res.canceled && res.error) {
        showFeedback(`Import failed: ${res.error}`);
      }
    } catch (err) {
      showFeedback('Failed to import bundle');
    }
  };

  const handleExportBundle = async (project: SopProject) => {
    if (!window.electronAPI?.exportProjectBundle) return;
    try {
      showFeedback(`Packaging "${project.name}"...`);
      const res = await window.electronAPI.exportProjectBundle(project);
      if (res.success) {
        showFeedback(`Exported "${project.name}" bundle!`);
      } else if (!res.canceled && res.error) {
        showFeedback(`Export failed: ${res.error}`);
      }
    } catch (err) {
      showFeedback('Failed to export bundle');
    }
  };

  const handleChangeWorkspace = async () => {
    if (!window.electronAPI?.changeWorkspacePath) return;
    try {
      const res = await window.electronAPI.changeWorkspacePath();
      if (res.success && res.newPath) {
        const info = await window.electronAPI.getWorkspacePath();
        setWorkspaceInfo(info);
        await loadProjects();
        showFeedback('Workspace folder updated! Projects synced.');
      }
    } catch (err) {
      showFeedback('Failed to change workspace folder');
    }
  };

  const handleResetWorkspace = async () => {
    if (!window.electronAPI?.resetWorkspacePath) return;
    try {
      const res = await window.electronAPI.resetWorkspacePath();
      if (res.success) {
        const info = await window.electronAPI.getWorkspacePath();
        setWorkspaceInfo(info);
        await loadProjects();
        showFeedback('Workspace reset to default local storage.');
      }
    } catch (err) {
      showFeedback('Failed to reset workspace');
    }
  };

  const handleOpenFolder = async () => {
    if (!window.electronAPI?.openWorkspaceFolder) return;
    await window.electronAPI.openWorkspaceFolder();
  };

  // Dismiss dropdown menu on scroll or window resize
  useEffect(() => {
    const handleDismiss = () => {
      setActiveMenuId(null);
      setMenuPosition(null);
    };
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    return () => {
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, []);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        p.author.toLowerCase().includes(q)
    );
  }, [projects, searchQuery]);

  const handleCreateNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    createProject(newTitle.trim(), newDescription.trim(), newAuthor.trim() || undefined);
    setShowNewModal(false);
    setNewTitle('');
    setNewDescription('');
    setNewAuthor('');
  };

  const handleSaveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (renamingProject && renameValue.trim()) {
      updateProjectById(renamingProject.id, { name: renameValue.trim() });
      setRenamingProject(null);
    }
  };

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).format(date);
    } catch {
      return isoString;
    }
  };

  const getStatusBadge = (status: SopProject['status']) => {
    switch (status) {
      case 'published':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
            Published
          </span>
        );
      case 'in_review':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60">
            In Review
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
            Draft
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="titlebar-drag h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-20 pr-6 flex items-center justify-between select-none">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center text-white dark:text-zinc-950 font-bold text-sm shadow-sm">
              SF
            </div>
            <div>
              <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-none">
                StepFlow
              </h1>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                SOP &amp; Workflow Documentation
              </p>
            </div>
          </div>

          {/* Module Tab Switcher */}
          <div className="titlebar-no-drag flex items-center bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setLibraryTab('sop')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                libraryTab === 'sop'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>SOP Procedures</span>
              <span className="text-[10px] opacity-75 font-mono">({projects.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setLibraryTab('error_faq')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                libraryTab === 'error_faq'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              <span>Error &amp; FAQ Base</span>
              <span className="text-[10px] opacity-75 font-mono">({errorFaqItems.length})</span>
            </button>
          </div>
        </div>

        <div className="titlebar-no-drag flex items-center gap-2.5">
          {libraryTab === 'sop' ? (
            <>
              <button
                onClick={() => setShowWorkspaceModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 text-xs font-medium transition-colors shadow-xs cursor-pointer"
                title="Configure Workspace Folder (Google Drive, OneDrive, Dropbox, or Local Storage)"
              >
                <FolderSync className={`w-3.5 h-3.5 ${workspaceInfo?.isCustom ? 'text-emerald-500' : 'text-zinc-400'}`} />
                <span>{workspaceInfo?.isCustom ? 'Shared Workspace' : 'Workspace'}</span>
              </button>

              <button
                onClick={handleImportBundle}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 text-xs font-medium transition-colors shadow-xs cursor-pointer"
                title="Import an SOP Procedure Bundle (.stepflow or .zip)"
              >
                <UploadCloud className="w-3.5 h-3.5 text-indigo-500" />
                <span>Import SOP</span>
              </button>

              <button
                onClick={() => setShowMcpModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 text-xs font-medium transition-colors shadow-xs cursor-pointer"
                title="Connect Claude Desktop via Model Context Protocol (MCP)"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                <span>Claude MCP</span>
              </button>

              <button
                onClick={() => setShowNewModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-950 text-xs font-medium transition-colors shadow-sm cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New SOP Project</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowSearchHud(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 text-xs font-medium transition-colors shadow-xs cursor-pointer"
                title="Open Spotlight Search HUD (Ctrl+Shift+F)"
              >
                <Search className="w-3.5 h-3.5 text-blue-500" />
                <span>Spotlight HUD</span>
                <span className="font-mono text-[10px] text-zinc-400">Ctrl+Shift+F</span>
              </button>

              <button
                onClick={() => {
                  setEditorItem(null);
                  setShowEditorModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors shadow-sm cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Error Solution</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      {libraryTab === 'error_faq' ? (
        <ErrorKnowledgeBaseView onOpenSearchHud={() => setShowSearchHud(true)} />
      ) : (
        <main className="flex-1 max-w-6xl w-full mx-auto p-6 md:p-8 flex flex-col">
        {/* Search & Statistics Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search procedures by title, tag, or author..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 transition-all"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              {filteredProjects.length}{' '}
              {filteredProjects.length === 1 ? 'project' : 'projects'}
            </span>
          </div>
        </div>

        {/* Project List */}
        {filteredProjects.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-zinc-300 dark:border-zinc-800 rounded-lg p-12 text-center bg-white/50 dark:bg-zinc-900/40">
            <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 mb-3">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
              {searchQuery ? 'No matching SOPs found' : 'No SOP projects yet'}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mb-4">
              {searchQuery
                ? 'Try tweaking your search term or clear the filter.'
                : 'Create your first standard operating procedure or capture workflows with StepFlow.'}
            </p>
            {searchQuery ? (
              <button
                onClick={() => setSearchQuery('')}
                className="text-xs text-zinc-700 dark:text-zinc-300 underline font-medium cursor-pointer"
              >
                Clear search filter
              </button>
            ) : (
              <button
                onClick={() => setShowNewModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-950 text-xs font-medium transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create New SOP</span>
              </button>
            )}
          </div>
        ) : (
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th className="py-3 px-4 w-1/2">Procedure Name</th>
                    <th className="py-3 px-4 w-28">Status</th>
                    <th className="py-3 px-4 w-28">Steps</th>
                    <th className="py-3 px-4 w-36">Last Updated</th>
                    <th className="py-3 px-4 w-16 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
                  {filteredProjects.map((project) => (
                    <tr
                      key={project.id}
                      onClick={() => selectProject(project.id)}
                      className="group hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors flex-shrink-0 mt-0.5">
                            <Layers className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                {project.name}
                              </span>
                              <ArrowRight className="w-3.5 h-3.5 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            {project.description && (
                              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1 mt-0.5">
                                {project.description}
                              </p>
                            )}
                            {project.tags && project.tags.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                {project.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="px-1.5 py-0.2 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {getStatusBadge(project.status)}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-zinc-600 dark:text-zinc-400 font-mono text-[11px]">
                        {project.steps.length} {project.steps.length === 1 ? 'step' : 'steps'}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-zinc-500 dark:text-zinc-400 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-zinc-400" />
                          <span>{formatDate(project.updatedAt)}</span>
                        </div>
                      </td>
                      <td
                        className="py-3.5 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="relative inline-block text-left">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (activeMenuId === project.id) {
                                setActiveMenuId(null);
                                setMenuPosition(null);
                              } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const dropdownHeight = 150;
                                const openUpward = window.innerHeight - rect.bottom < dropdownHeight + 16;
                                setMenuPosition({
                                  top: openUpward ? Math.max(8, rect.top - dropdownHeight - 4) : rect.bottom + 4,
                                  right: Math.max(8, window.innerWidth - rect.right),
                                });
                                setActiveMenuId(project.id);
                              }
                            }}
                            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {activeMenuId === project.id && menuPosition && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveMenuId(null);
                                  setMenuPosition(null);
                                }}
                              />
                              <div
                                className="fixed w-44 rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl py-1 z-50 text-xs"
                                style={{
                                  top: `${menuPosition.top}px`,
                                  right: `${menuPosition.right}px`,
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    setMenuPosition(null);
                                    selectProject(project.id);
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 cursor-pointer"
                                >
                                  <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
                                  <span>Open Studio</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    setMenuPosition(null);
                                    setRenamingProject(project);
                                    setRenameValue(project.name);
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 cursor-pointer"
                                >
                                  <Edit2 className="w-3.5 h-3.5 text-zinc-400" />
                                  <span>Rename</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    setMenuPosition(null);
                                    duplicateProject(project.id);
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 cursor-pointer"
                                >
                                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
                                  <span>Duplicate</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    setMenuPosition(null);
                                    handleExportBundle(project);
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 cursor-pointer"
                                >
                                  <Package className="w-3.5 h-3.5 text-indigo-500" />
                                  <span>Export Bundle (.stepflow)</span>
                                </button>
                                <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMenuId(null);
                                    setMenuPosition(null);
                                    setDeleteConfirmId(project.id);
                                  }}
                                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
      )}

      {/* New Project Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl max-w-md w-full p-5 overflow-hidden">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              Create New SOP Procedure
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
              Enter procedure details to begin drafting your standardized workflow.
            </p>

            <form onSubmit={handleCreateNew} className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Procedure Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Employee Onboarding Security Setup"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Summary of the process purpose, target audience, and expected outcome..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Author / Department
                </label>
                <input
                  type="text"
                  placeholder="e.g. Operations Team"
                  value={newAuthor}
                  onChange={(e) => setNewAuthor(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-md bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim()}
                  className="px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-40"
                >
                  Create &amp; Open
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Dialog */}
      {renamingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl max-w-sm w-full p-5">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              Rename Procedure
            </h2>
            <form onSubmit={handleSaveRename} className="mt-3 space-y-3">
              <input
                type="text"
                required
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-md bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRenamingProject(null)}
                  className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!renameValue.trim()}
                  className="px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl max-w-sm w-full p-5">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              Delete SOP Project?
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
              This will permanently delete this procedure and all its captured steps. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteProject(deleteConfirmId);
                  setDeleteConfirmId(null);
                }}
                className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
              >
                Delete Procedure
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Claude & MCP Integration Modal */}
      {showMcpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Claude Desktop &amp; MCP Integration
                    </h2>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Server Ready
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Connect Claude on your work laptop to search, edit, and wireframe SOPs.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowMcpModal(false)}
                className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 my-4">
              {/* What Claude Can Do */}
              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-300 space-y-1.5">
                <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                  What Claude can do for you:
                </div>
                <ul className="list-disc list-inside space-y-1 pl-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                  <li><strong>Wireframe New SOPs</strong>: Claude creates the title, steps, warnings &amp; tips. You just snap screenshots in Studio.</li>
                  <li><strong>Update &amp; Polish</strong>: Ask Claude to update instructions, fix wording, or add callouts to existing SOPs.</li>
                  <li><strong>Query &amp; Search</strong>: Ask Claude any question about procedures stored on your computer.</li>
                  <li><strong>Live Sync</strong>: Any change made in Claude updates StepFlow in real-time.</li>
                </ul>
              </div>

              {/* Step 1: Config file snippet */}
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
                  1. Add to Claude Desktop Config
                </label>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1.5">
                  Paste this snippet into <code className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[10px]">~/Library/Application Support/Claude/claude_desktop_config.json</code>:
                </p>
                <div className="relative">
                  <pre className="p-3 rounded-lg bg-zinc-900 text-zinc-100 text-[11px] font-mono overflow-x-auto select-all">
{mcpConfigJson}
                  </pre>
                  <button
                    onClick={handleCopySnippet}
                    className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-medium transition-colors cursor-pointer"
                  >
                    {copiedSnippet ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Config</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Step 2: Example Prompts */}
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1">
                  2. Example Prompts in Claude Desktop
                </label>
                <div className="space-y-1.5">
                  <div className="p-2.5 rounded bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 text-[11px] text-zinc-700 dark:text-zinc-300">
                    💬 <em>&ldquo;Create an SOP wireframe for Requesting Production Access with 3 steps and a warning about session limits.&rdquo;</em>
                  </div>
                  <div className="p-2.5 rounded bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 text-[11px] text-zinc-700 dark:text-zinc-300">
                    💬 <em>&ldquo;Search my SOPs: what is our procedure for issuing customer refunds?&rdquo;</em>
                  </div>
                  <div className="p-2.5 rounded bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 text-[11px] text-zinc-700 dark:text-zinc-300">
                    💬 <em>&ldquo;Update Step 2 of &apos;Customer Refund Process&apos; to add a warning about dispute chargebacks.&rdquo;</em>
                  </div>
                  <div className="p-2.5 rounded bg-zinc-100/70 dark:bg-zinc-800/50 border border-zinc-200/60 dark:border-zinc-700/60 text-[11px] text-zinc-700 dark:text-zinc-300">
                    💬 <em>&ldquo;Export &apos;Customer Refund Process&apos; to Markdown so I can paste it into Notion.&rdquo;</em>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowMcpModal(false)}
                className="px-4 py-1.5 text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workspace & Shared Storage Modal */}
      {showWorkspaceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl max-w-lg w-full p-6 overflow-hidden">
            <div className="flex items-start justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
                  workspaceInfo?.isCustom
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/60 text-emerald-600 dark:text-emerald-400'
                    : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
                }`}>
                  <FolderSync className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Team Workspace &amp; Storage
                    </h2>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      workspaceInfo?.isCustom
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}>
                      {workspaceInfo?.isCustom ? 'Shared Cloud Sync' : 'Local Storage'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Choose where SOP procedures and screenshot assets are stored.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowWorkspaceModal(false)}
                className="p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 my-4">
              <div className="bg-zinc-50 dark:bg-zinc-950 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1 flex items-center justify-between">
                  <span>Current Storage Folder:</span>
                  <button
                    onClick={handleOpenFolder}
                    className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Open in Finder</span>
                  </button>
                </div>
                <div className="text-xs font-mono text-zinc-800 dark:text-zinc-200 break-all select-all bg-white dark:bg-zinc-900 p-2 rounded border border-zinc-200 dark:border-zinc-800">
                  {workspaceInfo?.path || 'Loading...'}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/80 text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                <p className="font-semibold mb-1 flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Team Collaboration &amp; Data Loss Prevention:</span>
                </p>
                Point this folder to a corporate <strong>Google Drive, Microsoft OneDrive, Dropbox, or company network folder (SMB)</strong>. 
                Any SOP you capture will automatically sync to company storage so documentation is never lost if a colleague leaves or a laptop changes.
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div>
                {workspaceInfo?.isCustom && (
                  <button
                    type="button"
                    onClick={handleResetWorkspace}
                    className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 underline cursor-pointer"
                  >
                    Reset to Default Folder
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowWorkspaceModal(false)}
                  className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleChangeWorkspace}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shadow-xs cursor-pointer"
                >
                  <FolderSync className="w-3.5 h-3.5" />
                  <span>Change Workspace Folder...</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Search Spotlight HUD Modal */}
      <ErrorSearchModal
        isOpen={showSearchHud}
        onClose={() => setShowSearchHud(false)}
        onAddNew={() => {
          setEditorItem(null);
          setShowEditorModal(true);
        }}
        onEditItem={(item) => {
          setEditorItem(item);
          setShowEditorModal(true);
        }}
      />

      {/* Error FAQ Editor Modal */}
      <ErrorFaqEditorModal
        isOpen={showEditorModal}
        itemToEdit={editorItem}
        onClose={() => {
          setShowEditorModal(false);
          setEditorItem(null);
        }}
        onSaved={() => {
          loadErrorFaq();
        }}
      />

      {/* Floating Action Feedback Toast */}
      {feedbackMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900/95 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xl border border-zinc-700/50 dark:border-zinc-300 text-xs font-medium animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Check className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />
          <span>{feedbackMessage}</span>
        </div>
      )}
    </div>
  );
};
