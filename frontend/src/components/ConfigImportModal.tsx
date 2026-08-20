"use client";

import { useState, useRef, ChangeEvent, DragEvent } from "react";
import {
  X,
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Check,
  RefreshCw,
  Code,
  FileUp,
} from "lucide-react";

const API = typeof window === "undefined" ? "http://localhost:8000" : `http://${window.location.hostname}:8000`;

interface ConfigImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  configType: "all" | "cameras" | "doors" | "spatial_handoff" | "camera_zones" | "settings" | "employees";
  endpointUrl?: string;
  onSuccess?: () => void;
}

export default function ConfigImportModal({
  isOpen,
  onClose,
  title,
  configType,
  endpointUrl,
  onSuccess,
}: ConfigImportModalProps) {
  const [activeTab, setActiveTab] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const targetEndpoint = endpointUrl || `${API}/api/system/import/${configType}`;

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (!selected.name.endsWith(".json")) {
        setError("Please select a valid .json file");
        return;
      }
      setFile(selected);
      setError(null);
      setResult(null);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selected = e.dataTransfer.files[0];
      if (!selected.name.endsWith(".json")) {
        setError("Please drop a valid .json file");
        return;
      }
      setFile(selected);
      setError(null);
      setResult(null);
    }
  };

  const handleImport = async () => {
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      let res: Response;

      if (activeTab === "file") {
        if (!file) {
          setError("Please select a .json file to import");
          setLoading(false);
          return;
        }

        const formData = new FormData();
        formData.append("file", file);
        const url = `${targetEndpoint}?mode=${importMode}`;

        res = await fetch(url, {
          method: "POST",
          body: formData,
        });
      } else {
        if (!jsonText.trim()) {
          setError("Please paste valid JSON text");
          setLoading(false);
          return;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(jsonText);
        } catch (e: any) {
          setError(`Invalid JSON syntax: ${e.message}`);
          setLoading(false);
          return;
        }

        const url = `${targetEndpoint}?mode=${importMode}`;
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Failed to import configuration");
      }

      setResult(data);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      setError(err.message || "Failed to import configuration");
    } finally {
      setLoading(false);
    }
  };

  const resetModal = () => {
    setFile(null);
    setJsonText("");
    setError(null);
    setResult(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-[hsl(var(--border))] flex items-center justify-between bg-[hsl(var(--bg-table-head))]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[hsl(var(--text-primary))]">{title}</h3>
              <p className="text-xs text-[hsl(var(--text-muted))]">
                Restore or update configuration from JSON
              </p>
            </div>
          </div>
          <button
            onClick={resetModal}
            className="p-1.5 rounded-lg text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-hover))] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Tabs */}
          <div className="flex items-center gap-2 p-1 bg-[hsl(var(--bg-input))] rounded-xl border border-[hsl(var(--border))]">
            <button
              onClick={() => { setActiveTab("file"); setError(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                activeTab === "file"
                  ? "bg-[hsl(var(--bg-card))] text-emerald-600 dark:text-emerald-400 shadow-sm border border-[hsl(var(--border))]"
                  : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              }`}
            >
              <FileUp className="w-4 h-4" />
              Upload .JSON File
            </button>
            <button
              onClick={() => { setActiveTab("paste"); setError(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                activeTab === "paste"
                  ? "bg-[hsl(var(--bg-card))] text-emerald-600 dark:text-emerald-400 shadow-sm border border-[hsl(var(--border))]"
                  : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              }`}
            >
              <Code className="w-4 h-4" />
              Paste JSON
            </button>
          </div>

          {/* Mode Selector */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[hsl(var(--bg-input))] border border-[hsl(var(--border))] text-xs">
            <div>
              <span className="font-semibold text-[hsl(var(--text-primary))] block">Import Strategy</span>
              <span className="text-[hsl(var(--text-muted))]">
                {importMode === "merge"
                  ? "Upsert / merge with existing items"
                  : "Replace all existing configurations"}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-[hsl(var(--bg-card))] p-1 rounded-lg border border-[hsl(var(--border))]">
              <button
                type="button"
                onClick={() => setImportMode("merge")}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  importMode === "merge"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold"
                    : "text-[hsl(var(--text-muted))]"
                }`}
              >
                Merge
              </button>
              <button
                type="button"
                onClick={() => setImportMode("replace")}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  importMode === "replace"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold"
                    : "text-[hsl(var(--text-muted))]"
                }`}
              >
                Replace
              </button>
            </div>
          </div>

          {/* Tab 1: File Upload */}
          {activeTab === "file" && (
            <div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  dragOver
                    ? "border-emerald-500 bg-emerald-500/5 scale-[0.99]"
                    : file
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-[hsl(var(--border-strong))] hover:border-emerald-500/50 hover:bg-[hsl(var(--bg-hover))]"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-500">
                      <FileText className="w-8 h-8" />
                    </div>
                    <p className="text-sm font-bold text-[hsl(var(--text-primary))]">{file.name}</p>
                    <p className="text-xs text-[hsl(var(--text-muted))] font-mono">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                    <span className="mt-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full">
                      Ready to import • Click to change
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="p-3 rounded-2xl bg-[hsl(var(--bg-input))] text-[hsl(var(--text-muted))]">
                      <Upload className="w-8 h-8" />
                    </div>
                    <p className="text-sm font-bold text-[hsl(var(--text-primary))]">
                      Choose a JSON file or drag it here
                    </p>
                    <p className="text-xs text-[hsl(var(--text-muted))]">
                      Accepts exported .json files
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Paste Raw JSON */}
          {activeTab === "paste" && (
            <div>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder="Paste raw JSON configuration here..."
                rows={8}
                className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-xl p-3.5 text-[hsl(var(--text-primary))] text-xs font-mono focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Result */}
          {result && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>{result.message || "Configuration imported successfully!"}</span>
              </div>
              {result.report && (
                <div className="mt-2 pt-2 border-t border-emerald-500/20 font-mono text-[11px] text-[hsl(var(--text-secondary))] space-y-1">
                  {Object.entries(result.report).map(([k, v]: [string, any]) => (
                    <div key={k} className="flex justify-between">
                      <span className="capitalize">{k.replace("_", " ")}:</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {v?.status === "success" ? "✓ Done" : JSON.stringify(v)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[hsl(var(--border))] flex items-center justify-end gap-3 bg-[hsl(var(--bg-table-head))]">
          <button
            type="button"
            onClick={resetModal}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-hover))] transition-colors"
          >
            {result ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={loading || (activeTab === "file" && !file) || (activeTab === "paste" && !jsonText.trim())}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md shadow-emerald-500/10"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Importing...
              </>
            ) : result ? (
              <>
                <Check className="w-4 h-4" />
                Import Again
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Apply Configuration
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
