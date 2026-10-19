import React, { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useSopStore } from '../../store/useSopStore';
import { ErrorFaqItem } from '../../types/sop';
import { RichInstructionsEditor } from '../studio/RichInstructionsEditor';

interface ErrorFaqEditorModalProps {
  isOpen: boolean;
  itemToEdit?: ErrorFaqItem | null;
  initialData?: {
    title?: string;
    errorCode?: string;
    rawOcrText?: string;
    imagePath?: string;
    solution?: string;
  };
  onClose: () => void;
  onSaved?: (savedItem: ErrorFaqItem) => void;
}

export const ErrorFaqEditorModal: React.FC<ErrorFaqEditorModalProps> = ({
  isOpen,
  itemToEdit,
  initialData,
  onClose,
  onSaved,
}) => {
  const { saveErrorFaqItem } = useSopStore();

  const [title, setTitle] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [solution, setSolution] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [rawOcrText, setRawOcrText] = useState('');
  const [imagePath, setImagePath] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (itemToEdit) {
        setTitle(itemToEdit.title || '');
        setErrorCode(itemToEdit.errorCode || '');
        setSolution(itemToEdit.solution || '');
        setTagsInput(itemToEdit.tags?.join(', ') || '');
        setRawOcrText(itemToEdit.rawOcrText || '');
        setImagePath(itemToEdit.imagePath || '');
      } else {
        setTitle(initialData?.title || '');
        setErrorCode(initialData?.errorCode || '');
        setSolution(initialData?.solution || '');
        setTagsInput('');
        setRawOcrText(initialData?.rawOcrText || '');
        setImagePath(initialData?.imagePath || '');
      }
    }
  }, [isOpen, itemToEdit, initialData]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!title.trim()) {
      alert('Please enter an error title');
      return;
    }

    setIsSaving(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const id = itemToEdit?.id || `faq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date().toISOString();

      const item: ErrorFaqItem = {
        id,
        title: title.trim(),
        errorCode: errorCode.trim() ? errorCode.trim().toUpperCase() : undefined,
        rawOcrText: rawOcrText.trim() || title.trim(),
        imagePath: imagePath || '',
        solution: solution.trim() || 'No solution provided yet.',
        tags,
        createdAt: itemToEdit?.createdAt || now,
        updatedAt: now,
        matchCount: itemToEdit?.matchCount || 0,
      };

      const success = await saveErrorFaqItem(item);
      if (success) {
        onSaved?.(item);
        onClose();
      } else {
        alert('Failed to save error solution.');
      }
    } catch (err) {
      console.error('Error saving FAQ item:', err);
      alert('An error occurred while saving.');
    } finally {
      setIsSaving(false);
    }
  };

  const formatAssetUrl = (path?: string) => {
    if (!path) return '';
    if (path.startsWith('data:') || path.startsWith('http')) return path;
    return `stepflow-asset://${path}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] text-zinc-900 dark:text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {itemToEdit ? 'Edit Error Solution' : 'New Error Solution'}
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Title & Code in 2 columns */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-md bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Error Code
              </label>
              <input
                type="text"
                value={errorCode}
                onChange={(e) => setErrorCode(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono uppercase rounded-md bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-amber-600 dark:text-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Tags
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-md bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600"
            />
          </div>

          {/* Screenshot Reference (if attached) */}
          {imagePath && (
            <div className="space-y-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                  Screenshot
                </span>
                <button
                  type="button"
                  onClick={() => setImagePath('')}
                  className="text-red-500 hover:text-red-600 dark:text-red-400 text-[10px] flex items-center gap-1 cursor-pointer font-medium"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove image</span>
                </button>
              </div>
              <div className="rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 p-1 max-h-32 flex items-center justify-center">
                <img
                  src={formatAssetUrl(imagePath)}
                  alt="Error screenshot reference"
                  className="max-h-28 object-contain rounded"
                />
              </div>
            </div>
          )}

          {/* Solution Editor */}
          <div>
            <RichInstructionsEditor
              value={solution}
              onChange={setSolution}
              label="Solution"
              placeholder=""
              rows={6}
              minHeight="140px"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !title.trim()}
            className="px-4 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 disabled:opacity-50 text-white dark:text-zinc-950 text-xs font-medium shadow-xs transition-all cursor-pointer"
          >
            {isSaving ? 'Saving...' : 'Save Solution'}
          </button>
        </div>
      </div>
    </div>
  );
};
