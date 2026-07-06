"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

const API = "http://localhost:8000";

// Map slider 0→100 to a movement threshold:
//   slider=0   → threshold=0.15 (barely sensitive — large movements only)
//   slider=100 → threshold=0.005 (very sensitive — tiny twitches trigger active)
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

  // Load current settings from backend on mount
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
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-2xl font-bold text-white mb-6">Settings</h2>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-medium text-white mb-4">Detection Configuration</h3>

        {loading ? (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading settings from backend…</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Idle Threshold */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Idle Time Threshold (seconds)
              </label>
              <input
                id="idle-threshold"
                type="number"
                min={3}
                max={120}
                value={idleThreshold}
                onChange={(e) => setIdleThreshold(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors"
              />
              <p className="text-xs text-gray-500 mt-1">
                Triggers an alert when a worker is idle for longer than{" "}
                <span className="text-emerald-400 font-semibold">{idleThreshold}s</span>.
              </p>
            </div>

            {/* Movement Sensitivity */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium text-gray-400">
                  Movement Sensitivity
                </label>
                <span className="text-sm font-semibold text-emerald-400">{sensitivitySlider}%</span>
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
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Low (large movements only)</span>
                <span>High (micro-movements)</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Internal threshold:{" "}
                <span className="text-gray-300 font-mono">
                  {sliderToThreshold(sensitivitySlider).toFixed(4)}
                </span>
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-2 rounded-lg">
                {error}
              </div>
            )}

            {/* Save */}
            <div className="flex justify-end items-center gap-3 mt-2">
              {saved && (
                <span className="flex items-center gap-1 text-sm text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" /> Settings saved!
                </span>
              )}
              <button
                id="save-settings-btn"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium transition-colors"
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
