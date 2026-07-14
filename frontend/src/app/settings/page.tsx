"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

const API = "http://localhost:8000";

function sliderToThreshold(slider: number): number {
  return 0.15 - (slider / 100) * (0.15 - 0.005);
}
function thresholdToSlider(threshold: number): number {
  return Math.round(((0.15 - threshold) / (0.15 - 0.005)) * 100);
}

export default function SettingsPage() {
  const [idleThreshold, setIdleThreshold] = useState(10);
  const [sensitivitySlider, setSensitivitySlider] = useState(50);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then((r) => r.json())
      .then((data) => {
        setIdleThreshold(data.idle_threshold_seconds);
        setSensitivitySlider(thresholdToSlider(data.movement_sensitivity));
      })
      .catch(() => setError("Could not reach backend. Is it running?"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`${API}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idle_threshold_seconds: idleThreshold,
          movement_sensitivity: sliderToThreshold(sensitivitySlider),
        }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 sm:p-8 space-y-8 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-[hsl(var(--text-primary))]">Settings</h2>

      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-6">Detection Configuration</h3>

        {loading ? (
          <div className="flex items-center gap-2 text-[hsl(var(--text-secondary))]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading settings from backend…</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Idle Threshold */}
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--text-secondary))] mb-1.5">
                Idle Time Threshold (seconds)
              </label>
              <input
                id="idle-threshold"
                type="number"
                min={3}
                max={120}
                value={idleThreshold}
                onChange={(e) => setIdleThreshold(Number(e.target.value))}
                className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))]
                  rounded-lg px-4 py-2.5 text-[hsl(var(--text-primary))]
                  placeholder:text-[hsl(var(--text-placeholder))]
                  focus:outline-none focus:border-emerald-500 transition-colors text-sm"
              />
              <p className="text-xs text-[hsl(var(--text-muted))] mt-1.5">
                Triggers an alert when a worker is idle for longer than{" "}
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{idleThreshold}s</span>.
              </p>
            </div>

            {/* Movement Sensitivity */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-sm font-medium text-[hsl(var(--text-secondary))]">
                  Movement Sensitivity
                </label>
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {sensitivitySlider}%
                </span>
              </div>
              <input
                id="movement-sensitivity"
                type="range"
                min={0}
                max={100}
                value={sensitivitySlider}
                onChange={(e) => setSensitivitySlider(Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-xs text-[hsl(var(--text-muted))] mt-1">
                <span>Low (large movements only)</span>
                <span>High (micro-movements)</span>
              </div>
              <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                Internal threshold:{" "}
                <span className="text-[hsl(var(--text-secondary))] font-mono">
                  {sliderToThreshold(sensitivitySlider).toFixed(4)}
                </span>
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Save */}
            <div className="flex justify-end items-center gap-3 pt-2 border-t border-[hsl(var(--border))]">
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" /> Settings saved!
                </span>
              )}
              <button
                id="save-settings-btn"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500
                  disabled:opacity-50 disabled:cursor-not-allowed
                  text-white px-5 py-2 rounded-lg font-medium transition-colors"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? "Saving…" : "Save Settings"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
