import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Crop,
  Maximize2,
  X,
  Check,
  AlertTriangle,
  Lightbulb,
  ExternalLink
} from 'lucide-react';
import { useSopStore } from '../../store/useSopStore';
import { CalloutType } from '../../types/sop';

type DotState = 'collapsed' | 'mini_preview' | 'in_place_note';

interface FloatingDotProps {
  onTriggerCapture?: () => Promise<string | null>;
}

export const FloatingDot: React.FC<FloatingDotProps> = ({ onTriggerCapture }) => {
  const {
    activeProject,
    activeStepId,
    recentCapture,
    setRecentCapture,
    addStep,
    updateStep,
    retakeStepImage,
    retakeStepId,
    setRetakeStepId,
    setActiveView,
    setActiveStepId
  } = useSopStore();

  const [dotState, setDotState] = useState<DotState>('collapsed');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [quickCallout, setQuickCallout] = useState<CalloutType | 'none'>('none');
  const [progressWidth, setProgressWidth] = useState(100);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  // Sync retakeStepId from IPC if changed externally
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.onRetakeStepIdChanged) {
      const unsub = window.electronAPI.onRetakeStepIdChanged((id) => {
        setRetakeStepId(id);
      });
      return unsub;
    }
  }, [setRetakeStepId]);

  const stepCount = activeProject?.steps.length || 0;
  const currentStep = activeProject?.steps.find((s) => s.id === activeStepId);
  const retakeStep = activeProject?.steps.find((s) => s.id === retakeStepId);
  const isRetakeMode = Boolean(retakeStepId && retakeStep);

  // Update overlay window size via Electron IPC
  const notifyElectronSize = (mode: DotState) => {
    if (typeof window !== 'undefined' && window.electronAPI?.setOverlaySize) {
      if (mode === 'collapsed') {
        window.electronAPI.setOverlaySize('collapsed');
      } else if (mode === 'mini_preview') {
        window.electronAPI.setOverlaySize('preview');
      } else {
        window.electronAPI.setOverlaySize('expanded');
      }
    }
  };

  // Trigger mini preview when recentCapture changes
  useEffect(() => {
    if (recentCapture) {
      triggerMiniPreview();
    }
  }, [recentCapture]);

  const triggerMiniPreview = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);

    setDotState('mini_preview');
    notifyElectronSize('mini_preview');
    setProgressWidth(100);

    const startTime = Date.now();
    const duration = 3000;

    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgressWidth(remaining);
    }, 50);

    // Auto-collapses silently after 3s
    timerRef.current = setTimeout(() => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setDotState('collapsed');
      notifyElectronSize('collapsed');
      setRecentCapture(null);
    }, duration);
  };

  const handleOpenStudioForStep = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);

    setDotState('collapsed');
    notifyElectronSize('collapsed');
    setRecentCapture(null);

    // Ensure the latest step is set as activeStepId in store
    const currentProj = useSopStore.getState().activeProject;
    if (currentProj && currentProj.steps.length > 0) {
      const latestStep = currentProj.steps[currentProj.steps.length - 1];
      setActiveStepId(latestStep.id);
    }

    if (typeof window !== 'undefined' && window.electronAPI?.restoreStudio) {
      window.electronAPI.restoreStudio();
    }
    setActiveView('studio');
  };

  const handleDismissPreview = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);

    setDotState('collapsed');
    notifyElectronSize('collapsed');
    setRecentCapture(null);
  };

  const handleSnapFullScreen = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    await doCapture('fullscreen');
  };

  const handleSnapSelection = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    await doCapture('selection');
  };

  const doCapture = async (mode: 'fullscreen' | 'selection') => {
    const isRetaking = Boolean(retakeStepId);
    const targetRetakeId = retakeStepId;

    if (typeof window !== 'undefined' && window.electronAPI?.triggerCapture) {
      try {
        const imagePath = await window.electronAPI.triggerCapture(isRetaking, mode);
        if (imagePath) {
          if (isRetaking && targetRetakeId) {
            retakeStepImage(targetRetakeId, imagePath);
            setRetakeStepId(null);
            setActiveStepId(targetRetakeId);
            if (typeof window !== 'undefined' && window.electronAPI?.restoreStudio) {
              window.electronAPI.restoreStudio();
            }
            setActiveView('studio');
            return;
          }

          setRecentCapture(imagePath);
          setQuickNote('');
          return;
        }
      } catch (err) {
        console.warn('Capture failed:', err);
      }
    }

    if (onTriggerCapture) {
      const path = await onTriggerCapture();
      if (path) {
        if (isRetaking && targetRetakeId) {
          retakeStepImage(targetRetakeId, path);
          setRetakeStepId(null);
          setActiveStepId(targetRetakeId);
          if (typeof window !== 'undefined' && window.electronAPI?.restoreStudio) {
            window.electronAPI.restoreStudio();
          }
          setActiveView('studio');
          return;
        }

        const newStep = addStep(path);
        setRecentCapture(path);
        setQuickTitle(newStep.title);
        setQuickNote('');
        return;
      }
    }

    // Fallback: mock capture step
    const mockStep = addStep(
      `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" fill="%231e293b"><rect width="960" height="540" fill="%230f172a"/><text x="480" y="270" font-family="system-ui" font-size="28" fill="%23f8fafc" text-anchor="middle">Step ${stepCount + 1} Captured</text></svg>`
    );
    setRecentCapture(mockStep.image?.originalImagePath || null);
    setQuickTitle(mockStep.title);
    setQuickNote('');
  };

  const handleSaveQuickNote = () => {
    const targetStep = currentStep || activeProject?.steps[activeProject.steps.length - 1];
    if (targetStep) {
      updateStep(targetStep.id, {
        title: quickTitle,
        description: quickNote,
        callout:
          quickCallout !== 'none'
            ? {
                type: quickCallout,
                text: targetStep?.callout?.text || quickNote.slice(0, 80)
              }
            : undefined
      });
    }
    setDotState('collapsed');
    notifyElectronSize('collapsed');
    setRecentCapture(null);
  };

  const handleRestoreStudio = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRetakeStepId(null);
    if (typeof window !== 'undefined' && window.electronAPI?.restoreStudio) {
      window.electronAPI.restoreStudio();
    }
    setActiveView('studio');
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-3 select-none font-sans bg-transparent">
      {/* 1. COLLAPSED STATE: Distinct Glowing Capsule Dot with Unclipped Radial Aura */}
      {dotState === 'collapsed' && (
        <div
          onDoubleClick={handleRestoreStudio}
          className={`titlebar-drag group flex items-center gap-1.5 px-3 py-1.5 bg-zinc-950/95 text-white rounded-full transition-all cursor-grab active:cursor-grabbing ${
            isRetakeMode
              ? 'border border-amber-500/80 shadow-[0_0_14px_rgba(245,158,11,0.7),0_0_24px_rgba(245,158,11,0.35),0_0_3px_#f59e0b] hover:shadow-[0_0_18px_rgba(245,158,11,0.85),0_0_30px_rgba(245,158,11,0.5),0_0_5px_#f59e0b]'
              : 'border border-blue-500/80 shadow-[0_0_14px_rgba(59,130,246,0.7),0_0_24px_rgba(59,130,246,0.35),0_0_3px_#3b82f6] hover:shadow-[0_0_18px_rgba(59,130,246,0.85),0_0_30px_rgba(59,130,246,0.5),0_0_5px_#3b82f6]'
          }`}
          title="Drag to reposition • Double-click or click [↗] to open Studio"
        >
          {/* Glowing Pulse Indicator & Step Count / Retake Badge */}
          <div
            className="titlebar-no-drag flex items-center gap-1.5 px-0.5 cursor-pointer"
            onClick={handleRestoreStudio}
            title={
              isRetakeMode && retakeStep
                ? `Retaking Step ${retakeStep.order} • Click to cancel & return to Studio`
                : 'Step count • Click to open Studio'
            }
          >
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  isRetakeMode ? 'bg-amber-400' : 'bg-blue-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isRetakeMode
                    ? 'bg-amber-500 shadow-[0_0_6px_#f59e0b]'
                    : 'bg-blue-500 shadow-[0_0_6px_#3b82f6]'
                }`}
              />
            </span>
            <span
              className={`font-mono text-xs font-bold tracking-tight ${
                isRetakeMode ? 'text-amber-300' : 'text-white'
              }`}
            >
              {isRetakeMode && retakeStep ? `Retake #${retakeStep.order}` : stepCount}
            </span>
          </div>

          <div className="h-3.5 w-px bg-zinc-700/80 mx-0.5" />

          {/* Quick Action Buttons */}
          <div className="titlebar-no-drag flex items-center gap-1">
            <button
              type="button"
              onClick={handleSnapFullScreen}
              className={`p-1 rounded-full hover:bg-zinc-800 active:bg-zinc-700 transition-colors cursor-pointer ${
                isRetakeMode ? 'text-amber-300 hover:text-white' : 'text-blue-400 hover:text-white'
              }`}
              title={
                isRetakeMode && retakeStep
                  ? `Retake full screen for Step ${retakeStep.order} (Cmd+Shift+S)`
                  : 'Full screen capture (Cmd+Shift+S)'
              }
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleSnapSelection}
              className="p-1 rounded-full hover:bg-zinc-800 active:bg-zinc-700 text-amber-400 hover:text-white transition-colors cursor-pointer"
              title={
                isRetakeMode && retakeStep
                  ? `Retake selected area for Step ${retakeStep.order} (Cmd+Shift+A)`
                  : 'Capture selected area (Cmd+Shift+A)'
              }
            >
              <Crop className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleRestoreStudio}
              className="p-1 rounded-full hover:bg-zinc-800 active:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              title={isRetakeMode ? 'Cancel retake & return to Studio' : 'Expand & Open Studio'}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 2. MINI-PREVIEW PILL UPON CAPTURE (3-second auto-collapsing) */}
      {dotState === 'mini_preview' && (
        <div
          className="titlebar-no-drag group relative bg-zinc-950/95 text-white rounded-xl p-2.5 border border-blue-500/80 shadow-[0_0_22px_rgba(59,130,246,0.7),0_0_8px_#3b82f6] w-[295px] cursor-pointer hover:border-blue-400 transition-all overflow-hidden"
          onClick={handleOpenStudioForStep}
          title="Click to open this screenshot in the editor"
        >
          {/* Top auto-collapse timer progress bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-zinc-800">
            <div
              className="h-full bg-blue-500 transition-all duration-75"
              style={{ width: `${progressWidth}%` }}
            />
          </div>

          <div className="flex items-center gap-2.5 mt-1">
            {/* Thumbnail with hover icon */}
            <div className="relative w-14 h-10 rounded-md bg-zinc-900 overflow-hidden shrink-0 border border-zinc-700/80 group-hover:border-blue-400 transition-colors flex items-center justify-center">
              {recentCapture || currentStep?.image?.originalImagePath ? (
                <img
                  src={recentCapture || currentStep?.image?.originalImagePath}
                  alt="Captured screenshot"
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <Camera className="w-5 h-5 text-zinc-400" />
              )}
              <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/25 transition-colors flex items-center justify-center">
                <Maximize2 className="w-3.5 h-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-400 truncate">
                  Step {stepCount} Captured
                </span>
                <span className="text-[10px] text-zinc-400 font-mono ml-1">
                  {Math.ceil(progressWidth * 0.03)}s
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 font-medium truncate mt-0.5 group-hover:text-white transition-colors">
                Click image to edit in Studio →
              </p>
            </div>

            {/* Quick Actions: Dismiss */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleDismissPreview}
                className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Dismiss preview"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. IN-PLACE QUICK-ANNOTATION / NOTES OVERLAY */}
      {dotState === 'in_place_note' && (
        <div
          className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded-xl shadow-2xl border border-zinc-300 dark:border-zinc-700 w-[310px] p-3.5 overflow-hidden transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="titlebar-drag flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800 mb-2.5 cursor-grab">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_6px_#3b82f6]" />
              <span className="text-xs font-semibold">
                Quick Note — Step {currentStep?.order || stepCount}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setDotState('collapsed');
                notifyElectronSize('collapsed');
              }}
              className="titlebar-no-drag p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Form */}
          <div className="titlebar-no-drag space-y-2">
            <div>
              <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Step Title
              </label>
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="What action did you take?"
                className="w-full px-2.5 py-1 text-xs rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Instructions / Key Notes
              </label>
              <textarea
                rows={2}
                value={quickNote}
                onChange={(e) => setQuickNote(e.target.value)}
                placeholder="Add instructions, context, or shortcuts..."
                className="w-full px-2.5 py-1.5 text-xs rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none leading-relaxed"
              />
            </div>

            {/* Quick Callout Type */}
            <div>
              <label className="block text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
                Callout
              </label>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => setQuickCallout('none')}
                  className={`py-1 text-[10px] rounded border font-medium ${
                    quickCallout === 'none'
                      ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-transparent'
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                  }`}
                >
                  None
                </button>
                <button
                  type="button"
                  onClick={() => setQuickCallout('tip')}
                  className={`py-1 text-[10px] rounded border font-medium flex items-center justify-center gap-1 ${
                    quickCallout === 'tip'
                      ? 'bg-emerald-600 text-white border-transparent'
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                  }`}
                >
                  <Lightbulb className="w-2.5 h-2.5" />
                  <span>Tip</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQuickCallout('warning')}
                  className={`py-1 text-[10px] rounded border font-medium flex items-center justify-center gap-1 ${
                    quickCallout === 'warning'
                      ? 'bg-amber-600 text-white border-transparent'
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                  }`}
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  <span>Warn</span>
                </button>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={handleRestoreStudio}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Open in Studio</span>
              </button>

              <button
                type="button"
                onClick={handleSaveQuickNote}
                className="inline-flex items-center gap-1 px-3 py-1 rounded bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-medium transition-colors"
              >
                <Check className="w-3 h-3" />
                <span>Save</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
