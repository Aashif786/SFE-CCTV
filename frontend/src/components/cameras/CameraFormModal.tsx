"use client";

import { useState, useEffect } from "react";
import {
  X,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Eye,
  EyeOff,
} from "lucide-react";
import type { CameraInfo, CameraFormData, TestResult } from "@/hooks/useCameras";
import { useCameraActions } from "@/hooks/useCameras";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CameraFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  camera?: CameraInfo | null;     // null = create mode, object = edit mode
  initialValues?: Partial<CameraFormData> | null; // prefilled form values for create mode
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BRANDS = ["Hikvision", "Dahua", "Uniview", "Axis", "Hanwha", "Other"];
const STREAM_TYPES = ["Main", "Sub"];

const EMPTY_FORM: CameraFormData = {
  name: "",
  description: "",
  location: "",
  building: "",
  floor: "",
  zone: "",
  door_name: "",
  ip_address: "",
  rtsp_port: 554,
  stream_path: "/Streaming/Channels/101",
  username: "admin",
  password: "",
  camera_brand: "Hikvision",
  stream_type: "Main",
  enabled: true,
  recording_enabled: false,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CameraFormModal({
  isOpen,
  onClose,
  onSaved,
  camera,
  initialValues,
}: CameraFormModalProps) {
  const isEdit = !!camera;
  const { createCamera, updateCamera, testConnection } = useCameraActions();

  const [form, setForm] = useState<CameraFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Populate form for edit mode or create mode with initial values
  useEffect(() => {
    if (isOpen) {
      if (camera) {
        setForm({
          name: camera.name || "",
          description: camera.description || "",
          location: camera.location || "",
          building: camera.building || "",
          floor: camera.floor || "",
          zone: camera.zone || "",
          door_name: camera.door_name || "",
          ip_address: camera.ip_address || "",
          rtsp_port: camera.rtsp_port || 554,
          stream_path: camera.stream_path || "/Streaming/Channels/101",
          username: camera.username || "admin",
          password: "",  // never pre-filled
          camera_brand: camera.camera_brand || "Hikvision",
          stream_type: camera.stream_type || "Main",
          enabled: camera.enabled,
          recording_enabled: camera.recording_enabled,
        });
      } else if (initialValues) {
        setForm({
          ...EMPTY_FORM,
          ...initialValues,
        });
      } else {
        setForm(EMPTY_FORM);
      }
      setTestResult(null);
      setError(null);
      setShowPassword(false);
    }
  }, [isOpen, camera, initialValues]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked
        : type === "number" ? Number(value)
        : value,
    }));
  };

  const handleToggle = (field: keyof CameraFormData) => {
    setForm((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (isEdit && camera) {
        const payload: any = { ...form };
        // Only send password if user entered a new one
        if (!payload.password) delete payload.password;
        await updateCamera(camera.id, payload);
      } else {
        if (!form.password) {
          setError("Password is required for new cameras");
          setSaving(false);
          return;
        }
        await createCamera(form);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save camera");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!camera && !isEdit) return; // Can only test existing cameras
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(camera!.id);
      setTestResult(result);
    } catch (e: any) {
      setTestResult({ status: "failed", message: e.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) return null;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))] sticky top-0 bg-[hsl(var(--bg-card))] z-10 rounded-t-xl">
          <h3 className="text-lg font-bold text-[hsl(var(--text-primary))]">
            {isEdit ? "Edit Camera" : "Add Camera"}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-table-head))] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* ── Basic Info ──────────────────────────────────────────── */}
          <SectionTitle>Basic Information</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Camera Name *" required>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                placeholder="e.g. Reception 01"
                className={inputClass}
              />
            </FormField>
            <FormField label="Camera Brand">
              <select name="camera_brand" value={form.camera_brand} onChange={handleChange} className={inputClass}>
                {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="Description">
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={2}
              placeholder="Optional description"
              className={inputClass + " resize-none"}
            />
          </FormField>

          {/* ── Location ───────────────────────────────────────────── */}
          <SectionTitle>Location</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Location">
              <input name="location" value={form.location} onChange={handleChange} placeholder="Block A" className={inputClass} />
            </FormField>
            <FormField label="Building">
              <input name="building" value={form.building} onChange={handleChange} placeholder="Main Building" className={inputClass} />
            </FormField>
            <FormField label="Floor">
              <input name="floor" value={form.floor} onChange={handleChange} placeholder="Ground Floor" className={inputClass} />
            </FormField>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Zone">
              <input name="zone" value={form.zone} onChange={handleChange} placeholder="Entrance" className={inputClass} />
            </FormField>
            <FormField label="Door Name">
              <input name="door_name" value={form.door_name} onChange={handleChange} placeholder="Main Door" className={inputClass} />
            </FormField>
          </div>

          {/* ── Connection ─────────────────────────────────────────── */}
          <SectionTitle>Connection</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="IP Address *" required>
              <input
                name="ip_address"
                value={form.ip_address}
                onChange={handleChange}
                required
                placeholder="192.168.1.202"
                pattern="^[\d\.]+$"
                className={inputClass}
              />
            </FormField>
            <FormField label="RTSP Port">
              <input
                name="rtsp_port"
                type="number"
                value={form.rtsp_port}
                onChange={handleChange}
                min={1}
                max={65535}
                className={inputClass}
              />
            </FormField>
            <FormField label="Stream Type">
              <select name="stream_type" value={form.stream_type} onChange={handleChange} className={inputClass}>
                {STREAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="Stream Path">
            <input
              name="stream_path"
              value={form.stream_path}
              onChange={handleChange}
              placeholder="/Streaming/Channels/101"
              className={inputClass}
            />
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
              Hikvision: /Streaming/Channels/101 (main), /Streaming/Channels/102 (sub)
            </p>
          </FormField>

          {/* ── Credentials ────────────────────────────────────────── */}
          <SectionTitle>Credentials</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Username *" required>
              <input name="username" value={form.username} onChange={handleChange} required className={inputClass} />
            </FormField>
            <FormField label={isEdit ? "Password (leave blank to keep)" : "Password *"} required={!isEdit}>
              <div className="relative">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={handleChange}
                  required={!isEdit}
                  placeholder={isEdit ? "••••••••" : "Enter password"}
                  className={inputClass + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </FormField>
          </div>

          {/* ── Toggles ────────────────────────────────────────────── */}
          <SectionTitle>Options</SectionTitle>
          <div className="flex items-center gap-6">
            <ToggleSwitch
              label="Enabled"
              checked={form.enabled}
              onChange={() => handleToggle("enabled")}
            />
            <ToggleSwitch
              label="Recording"
              checked={form.recording_enabled}
              onChange={() => handleToggle("recording_enabled")}
            />
          </div>

          {/* ── Test Connection ─────────────────────────────────────── */}
          {isEdit && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 px-4 py-2 rounded-lg transition-all disabled:opacity-50"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                Test Connection
              </button>
              {testResult && (
                <div
                  className={`flex items-start gap-2 text-sm p-3 rounded-lg border ${
                    testResult.status === "success"
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                      : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
                  }`}
                >
                  {testResult.status === "success" ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Error ──────────────────────────────────────────────── */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-lg">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* ── Actions ────────────────────────────────────────────── */}
          <div className="flex justify-end items-center gap-3 pt-4 border-t border-[hsl(var(--border))]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] bg-[hsl(var(--bg-table-head))] hover:bg-[hsl(var(--bg-input))] border border-[hsl(var(--border))] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Saving…" : isEdit ? "Update Camera" : "Add Camera"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const inputClass = `w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
  rounded-lg px-3 py-2 text-sm text-[hsl(var(--text-primary))]
  placeholder:text-[hsl(var(--text-placeholder))]
  focus:outline-none focus:border-emerald-500 transition-colors`;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--text-muted))] border-b border-[hsl(var(--border))] pb-2">
      {children}
    </h4>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[hsl(var(--text-secondary))] mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function ToggleSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <div
        onClick={onChange}
        className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
          checked ? "bg-emerald-500" : "bg-gray-400 dark:bg-gray-600"
        }`}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </div>
      <span className="text-sm text-[hsl(var(--text-secondary))]">{label}</span>
    </label>
  );
}
