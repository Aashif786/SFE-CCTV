"use client";

import { useState, useMemo } from "react";
import {
  SlidersHorizontal,
  Plus,
  Pencil,
  Trash2,
  Search,
  Wifi,
  WifiOff,
  Loader2,
  AlertTriangle,
  Camera,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { useCameras, useCameraActions } from "@/hooks/useCameras";
import CameraFormModal from "@/components/cameras/CameraFormModal";
import type { CameraInfo } from "@/hooks/useCameras";

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
        enabled
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
          : "bg-gray-500/10 text-gray-500 dark:text-gray-400 border border-gray-500/20"
      }`}
    >
      {enabled ? (
        <>
          <CheckCircle2 className="w-3 h-3" /> Enabled
        </>
      ) : (
        <>
          <XCircle className="w-3 h-3" /> Disabled
        </>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CameraManagementPage() {
  const { cameras, loading, error, refetch } = useCameras();
  const { deleteCamera, updateCamera, restartStream } = useCameraActions();

  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editCamera, setEditCamera] = useState<CameraInfo | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CameraInfo | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return cameras;
    const q = search.toLowerCase();
    return cameras.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.ip_address.toLowerCase().includes(q) ||
        (c.location || "").toLowerCase().includes(q) ||
        (c.camera_brand || "").toLowerCase().includes(q)
    );
  }, [cameras, search]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAdd = () => {
    setEditCamera(null);
    setModalOpen(true);
  };

  const handleEdit = (cam: CameraInfo) => {
    setEditCamera(cam);
    setModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setActionLoading(deleteConfirm.id);
    try {
      await deleteCamera(deleteConfirm.id);
      showToast(true, `Camera "${deleteConfirm.name}" deleted`);
      refetch();
    } catch (e: any) {
      showToast(false, e.message || "Delete failed");
    } finally {
      setActionLoading(null);
      setDeleteConfirm(null);
    }
  };

  const handleToggleEnabled = async (cam: CameraInfo) => {
    setActionLoading(cam.id);
    try {
      await updateCamera(cam.id, { enabled: !cam.enabled });
      showToast(true, `Camera "${cam.name}" ${cam.enabled ? "disabled" : "enabled"}`);
      refetch();
    } catch (e: any) {
      showToast(false, e.message || "Toggle failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaved = () => {
    showToast(true, editCamera ? "Camera updated" : "Camera added");
    refetch();
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[hsl(var(--text-primary))] flex items-center gap-2.5">
            <SlidersHorizontal className="w-6 h-6 text-emerald-500" />
            Camera Management
          </h2>
          <p className="text-sm text-[hsl(var(--text-muted))] mt-1">
            Configure and manage CCTV cameras
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm self-start"
        >
          <Plus className="w-4 h-4" />
          Add Camera
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[hsl(var(--text-muted))]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cameras…"
          className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg pl-10 pr-4 py-2.5 text-sm text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-placeholder))] focus:outline-none focus:border-emerald-500 transition-colors"
        />
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`flex items-center gap-2 text-sm px-4 py-3 rounded-lg border transition-all ${
            toast.ok
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
              : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
          }`}
        >
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-[hsl(var(--text-secondary))]">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading cameras…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 px-5 py-4 rounded-xl">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-medium">Failed to load cameras</p>
            <p className="text-sm opacity-80 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Table */}
      {!loading && filtered.length > 0 && (
        <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[hsl(var(--bg-table-head))] border-b border-[hsl(var(--border))]">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">Camera</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">Location</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">IP Address</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">Brand</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">Stream</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-[hsl(var(--text-muted))] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]/60">
                {filtered.map((cam) => (
                  <tr
                    key={cam.id}
                    className="hover:bg-[hsl(var(--bg-table-head))]/40 transition-colors"
                  >
                    {/* Camera name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                          <Camera className="w-4 h-4 text-emerald-500" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-[hsl(var(--text-primary))] truncate">{cam.name}</div>
                          {cam.description && cam.description !== cam.name && (
                            <div className="text-[11px] text-[hsl(var(--text-muted))] truncate">{cam.description}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Location */}
                    <td className="px-4 py-3">
                      <div className="text-[hsl(var(--text-secondary))]">{cam.location || "—"}</div>
                      {(cam.zone || cam.door_name) && (
                        <div className="text-[11px] text-[hsl(var(--text-muted))]">
                          {[cam.zone, cam.door_name].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>

                    {/* IP */}
                    <td className="px-4 py-3">
                      <code className="text-[hsl(var(--text-secondary))] text-xs bg-[hsl(var(--bg-code))] px-1.5 py-0.5 rounded font-mono">
                        {cam.ip_address}:{cam.rtsp_port}
                      </code>
                    </td>

                    {/* Brand */}
                    <td className="px-4 py-3 text-[hsl(var(--text-secondary))]">
                      {cam.camera_brand || "—"}
                    </td>

                    {/* Stream type */}
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium bg-[hsl(var(--bg-table-head))] text-[hsl(var(--text-secondary))] px-2 py-0.5 rounded border border-[hsl(var(--border))]">
                        {cam.stream_type}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      <StatusBadge enabled={cam.enabled} />
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleToggleEnabled(cam)}
                          disabled={actionLoading === cam.id}
                          className={`p-1.5 rounded-lg transition-colors ${
                            cam.enabled
                              ? "text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                              : "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                          } disabled:opacity-50`}
                          title={cam.enabled ? "Disable" : "Enable"}
                        >
                          {actionLoading === cam.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : cam.enabled ? (
                            <WifiOff className="w-4 h-4" />
                          ) : (
                            <Wifi className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleEdit(cam)}
                          className="p-1.5 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(cam)}
                          className="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div className="px-4 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-table-head))]/40">
            <span className="text-xs text-[hsl(var(--text-muted))]">
              {filtered.length} camera{filtered.length !== 1 ? "s" : ""}
              {search && ` matching "${search}"`}
              {" · "}
              {cameras.filter((c) => c.enabled).length} enabled
            </span>
          </div>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && cameras.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[hsl(var(--bg-table-head))] flex items-center justify-center mb-4">
            <Camera className="w-8 h-8 text-[hsl(var(--text-muted))]" />
          </div>
          <h3 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-1">
            No cameras yet
          </h3>
          <p className="text-sm text-[hsl(var(--text-muted))] max-w-sm mb-4">
            Add your first camera to start monitoring.
          </p>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Camera
          </button>
        </div>
      )}

      {/* No search results */}
      {!loading && !error && cameras.length > 0 && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="w-10 h-10 text-[hsl(var(--text-muted))] mb-3" />
          <h3 className="text-base font-semibold text-[hsl(var(--text-primary))] mb-1">No results</h3>
          <p className="text-sm text-[hsl(var(--text-muted))]">No cameras match &quot;{search}&quot;</p>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
          <div
            className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[hsl(var(--text-primary))]">Delete Camera</h3>
                <p className="text-sm text-[hsl(var(--text-muted))]">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-[hsl(var(--text-secondary))] mb-6">
              Are you sure you want to delete <strong className="text-[hsl(var(--text-primary))]">{deleteConfirm.name}</strong> ({deleteConfirm.ip_address})?
              The stream will be stopped and the camera configuration will be permanently removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-table-head))] border border-[hsl(var(--border))] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading === deleteConfirm.id}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
              >
                {actionLoading === deleteConfirm.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form Modal */}
      <CameraFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        camera={editCamera}
      />
    </div>
  );
}
