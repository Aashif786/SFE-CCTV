"use client";
import { useEffect, useState } from "react";
import { 
  CheckCircle2, Loader2, Cpu, Eye, EyeOff, Sliders, Shield, HelpCircle, Network
} from "lucide-react";

const API = "http://localhost:8000";

// Helper functions for movement sensitivity scaling (retained from original)
function sliderToSensitivity(slider: number): number {
  return 0.15 - (slider / 100) * (0.15 - 0.005);
}
function sensitivityToSlider(threshold: number): number {
  return Math.round(((0.15 - threshold) / (0.15 - 0.005)) * 100);
}

// General helpers for 0.0 - 1.0 decimals
const toPercent = (val: number) => Math.round((val || 0) * 100);
const fromPercent = (pct: number) => Number((pct / 100).toFixed(4));

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"ai" | "tracker" | "identity" | "server">("ai");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // --- Configuration State ---
  // 1. Core / AI
  const [idleThreshold, setIdleThreshold] = useState(10);
  const [sensitivitySlider, setSensitivitySlider] = useState(50);
  const [confidenceThreshold, setConfidenceThreshold] = useState(50);
  const [yoloModel, setYoloModel] = useState("yolo11m-pose.pt");
  const [yoloConf, setYoloConf] = useState(30);
  const [yoloIou, setYoloIou] = useState(90);
  const [yoloImgsz, setYoloImgsz] = useState(960);
  const [emaAlpha, setEmaAlpha] = useState(80);
  const [maxTrackedPeople, setMaxTrackedPeople] = useState(10);

  // 2. Tracker (BoT-SORT)
  const [trackHighThresh, setTrackHighThresh] = useState(30);
  const [trackLowThresh, setTrackLowThresh] = useState(10);
  const [newTrackThresh, setNewTrackThresh] = useState(50);
  const [trackBuffer, setTrackBuffer] = useState(120);
  const [matchThresh, setMatchThresh] = useState(80);
  const [fuseScore, setFuseScore] = useState(true);
  const [gmcMethod, setGmcMethod] = useState("none");
  const [withReid, setWithReid] = useState(true);
  const [proximityThresh, setProximityThresh] = useState(0);
  const [appearanceThresh, setAppearanceThresh] = useState(75);

  // 3. Identity
  const [identityProvider, setIdentityProvider] = useState("REST_SIMULATOR");
  const [correlationWindow, setCorrelationWindow] = useState(5);
  const [hikvisionUsername, setHikvisionUsername] = useState("admin");
  const [hikvisionPassword, setHikvisionPassword] = useState("");

  // 4. Server & Streaming
  const [rtspPort, setRtspPort] = useState(554);
  const [streamTransport, setStreamTransport] = useState("tcp");
  const [streamTimeout, setStreamTimeout] = useState(30);
  const [reconnectInterval, setReconnectInterval] = useState(5);
  const [frameBufferSize, setFrameBufferSize] = useState(5);
  const [maxCameras, setMaxCameras] = useState(50);
  const [classifierVelocityThreshold, setClassifierVelocityThreshold] = useState(0.05);

  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then((r) => {
        if (!r.ok) throw new Error("Backend response error");
        return r.json();
      })
      .then((data) => {
        // AI / Core
        setIdleThreshold(data.idle_threshold_seconds ?? 10);
        setSensitivitySlider(sensitivityToSlider(data.movement_sensitivity ?? 0.05));
        setConfidenceThreshold(toPercent(data.confidence_threshold ?? 0.50));
        setYoloModel(data.yolo_model ?? "yolo11m-pose.pt");
        setYoloConf(toPercent(data.yolo_conf ?? 0.30));
        setYoloIou(toPercent(data.yolo_iou ?? 0.90));
        setYoloImgsz(data.yolo_imgsz ?? 960);
        setEmaAlpha(toPercent(data.ema_alpha ?? 0.80));
        setMaxTrackedPeople(data.max_tracked_people ?? 10);

        // Tracker
        setTrackHighThresh(toPercent(data.tracker_track_high_thresh ?? 0.30));
        setTrackLowThresh(toPercent(data.tracker_track_low_thresh ?? 0.1));
        setNewTrackThresh(toPercent(data.tracker_new_track_thresh ?? 0.50));
        setTrackBuffer(data.tracker_track_buffer ?? 120);
        setMatchThresh(toPercent(data.tracker_match_thresh ?? 0.8));
        setFuseScore(data.tracker_fuse_score ?? true);
        setGmcMethod(data.tracker_gmc_method ?? "none");
        setWithReid(data.tracker_with_reid ?? true);
        setProximityThresh(toPercent(data.tracker_proximity_thresh ?? 0.0));
        setAppearanceThresh(toPercent(data.tracker_appearance_thresh ?? 0.75));

        // Identity
        setIdentityProvider(data.identity_provider ?? "REST_SIMULATOR");
        setCorrelationWindow(data.correlation_window_seconds ?? 5);
        setHikvisionUsername(data.hikvision_username ?? "admin");
        setHikvisionPassword(data.hikvision_password ?? "");

        // Streaming / Server
        setRtspPort(data.default_rtsp_port ?? 554);
        setStreamTransport(data.default_stream_transport ?? "tcp");
        setStreamTimeout(data.stream_timeout ?? 30);
        setReconnectInterval(data.stream_reconnect_interval ?? 5);
        setFrameBufferSize(data.frame_buffer_size ?? 5);
        setMaxCameras(data.max_cameras ?? 50);
        setClassifierVelocityThreshold(data.classifier_velocity_threshold ?? 0.05);
      })
      .catch(() => setError("Could not reach backend settings API. Ensure backend is active."))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const payload = {
        idle_threshold_seconds: idleThreshold,
        movement_sensitivity: sliderToSensitivity(sensitivitySlider),
        confidence_threshold: fromPercent(confidenceThreshold),
        correlation_window_seconds: correlationWindow,
        identity_provider: identityProvider,

        // YOLO
        yolo_model: yoloModel,
        yolo_conf: fromPercent(yoloConf),
        yolo_iou: fromPercent(yoloIou),
        yolo_imgsz: yoloImgsz,
        ema_alpha: fromPercent(emaAlpha),
        max_tracked_people: maxTrackedPeople,

        // Tracker
        tracker_track_high_thresh: fromPercent(trackHighThresh),
        tracker_track_low_thresh: fromPercent(trackLowThresh),
        tracker_new_track_thresh: fromPercent(newTrackThresh),
        tracker_track_buffer: trackBuffer,
        tracker_match_thresh: fromPercent(matchThresh),
        tracker_fuse_score: fuseScore,
        tracker_gmc_method: gmcMethod,
        tracker_with_reid: withReid,
        tracker_proximity_thresh: fromPercent(proximityThresh),
        tracker_appearance_thresh: fromPercent(appearanceThresh),

        // Classifier
        classifier_velocity_threshold: Number(classifierVelocityThreshold),

        // Environment / Creds
        default_rtsp_port: rtspPort,
        default_stream_transport: streamTransport,
        stream_timeout: streamTimeout,
        stream_reconnect_interval: reconnectInterval,
        frame_buffer_size: frameBufferSize,
        max_cameras: maxCameras,
        hikvision_username: hikvisionUsername,
        hikvision_password: hikvisionPassword
      };

      const res = await fetch(`${API}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
    <div className="p-6 sm:p-8 space-y-8 max-w-5xl mx-auto">
      {/* Title Header */}
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-extrabold text-[hsl(var(--text-primary))] tracking-tight">System Settings</h2>
        <p className="text-sm text-[hsl(var(--text-secondary))]">
          Tune deep neural network thresholds, camera streaming intervals, identity correlation engines, and security credentials.
        </p>
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-[hsl(var(--border))] gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab("ai")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg transition-all whitespace-nowrap ${
            activeTab === "ai"
              ? "border-b-2 border-emerald-500 text-emerald-500"
              : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          }`}
        >
          <Cpu className="w-4 h-4" /> Detection & AI
        </button>
        <button
          onClick={() => setActiveTab("tracker")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg transition-all whitespace-nowrap ${
            activeTab === "tracker"
              ? "border-b-2 border-emerald-500 text-emerald-500"
              : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          }`}
        >
          <Sliders className="w-4 h-4" /> BoT-SORT Tracker
        </button>
        <button
          onClick={() => setActiveTab("identity")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg transition-all whitespace-nowrap ${
            activeTab === "identity"
              ? "border-b-2 border-emerald-500 text-emerald-500"
              : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          }`}
        >
          <Shield className="w-4 h-4" /> Identity Integration
        </button>
        <button
          onClick={() => setActiveTab("server")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg transition-all whitespace-nowrap ${
            activeTab === "server"
              ? "border-b-2 border-emerald-500 text-emerald-500"
              : "text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          }`}
        >
          <Network className="w-4 h-4" /> Streaming & Server
        </button>
      </div>

      {/* Main Settings Card */}
      <div className="bg-[hsl(var(--bg-card))] border border-[hsl(var(--border))] rounded-2xl p-6 sm:p-8 shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-16 text-[hsl(var(--text-secondary))]">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <span className="text-sm font-medium">Loading settings from backend…</span>
          </div>
        ) : (
          <div className="space-y-8">
            {/* TABS CONTENT */}

            {/* TAB 1: AI & DETECTION */}
            {activeTab === "ai" && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-[hsl(var(--text-primary))] border-b border-[hsl(var(--border))] pb-2">
                  Detection & Pose Hyperparameters
                </h3>

                {/* YOLO Model */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      YOLO Model Checkpoint
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Choose neural network size. Larger models improve detection at a distance but demand more GPU.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <select
                      id="yolo-model-select"
                      value={yoloModel}
                      onChange={(e) => setYoloModel(e.target.value)}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    >
                      <option value="yolo11n-pose.pt">YOLO11 Nano Pose (Fastest, lightest)</option>
                      <option value="yolo11s-pose.pt">YOLO11 Small Pose (Medium speed & size)</option>
                      <option value="yolo11m-pose.pt">YOLO11 Medium Pose (Balanced accuracy & speed)</option>
                      <option value="yolo11l-pose.pt">YOLO11 Large Pose (Highly accurate, heavy)</option>
                      <option value="yolo11x-pose.pt">YOLO11 Extra Large Pose (Maximum accuracy, slow)</option>
                    </select>
                  </div>
                </div>

                {/* YOLO imgsz */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Inference Image Resolution
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Target frame size for neural network resize. Larger values detect smaller objects but latency increases.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <select
                      id="yolo-imgsz-select"
                      value={yoloImgsz}
                      onChange={(e) => setYoloImgsz(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    >
                      <option value={640}>640px (Low resolution - Fast)</option>
                      <option value={960}>960px (Standard optimized)</option>
                      <option value={1280}>1280px (High definition - Distant detection)</option>
                    </select>
                  </div>
                </div>

                {/* Max Tracked People */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Max Tracked People per Feed
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Maximum number of people to track and display skeletons for in a single camera feed.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      id="max-tracked-people"
                      type="number"
                      min={1}
                      max={50}
                      value={maxTrackedPeople}
                      onChange={(e) => setMaxTrackedPeople(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    />
                  </div>
                </div>

                {/* YOLO Conf */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Detection Confidence Threshold
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Min score to keep bounding boxes. Lower values recover hidden workers but increase noise.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="yolo-conf-slider"
                      type="range"
                      min={10}
                      max={90}
                      value={yoloConf}
                      onChange={(e) => setYoloConf(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {yoloConf}%
                    </span>
                  </div>
                </div>

                {/* YOLO IoU */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      NMS IoU Overlap Gating
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Non-maximum suppression threshold. Higher values prevent merging close-proximity workers.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="yolo-iou-slider"
                      type="range"
                      min={40}
                      max={95}
                      value={yoloIou}
                      onChange={(e) => setYoloIou(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {yoloIou}%
                    </span>
                  </div>
                </div>

                {/* EMA Alpha */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Skeleton Temporal Smoothing (EMA Alpha)
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Exponential Moving Average factor. High value matches fast movement; low value reduces noise/jitter.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="ema-alpha-slider"
                      type="range"
                      min={10}
                      max={95}
                      value={emaAlpha}
                      onChange={(e) => setEmaAlpha(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {emaAlpha}%
                    </span>
                  </div>
                </div>

                {/* Idle Threshold */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Idle Alert Timeout (seconds)
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Seconds of movement absence before generating an official idle warning.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      id="idle-threshold"
                      type="number"
                      min={3}
                      max={300}
                      value={idleThreshold}
                      onChange={(e) => setIdleThreshold(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    />
                  </div>
                </div>

                {/* Movement Sensitivity */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Movement Classification Sensitivity
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Internal change detection threshold. Higher sensitivity classifies tiny shifts as active.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="movement-sensitivity"
                      type="range"
                      min={0}
                      max={100}
                      value={sensitivitySlider}
                      onChange={(e) => setSensitivitySlider(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {sensitivitySlider}%
                    </span>
                  </div>
                </div>

                {/* Landmark Visibility Confidence */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Landmark Confidence Filter
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Min visibility average of major joints to label skeleton details as verified.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="confidence-threshold"
                      type="range"
                      min={10}
                      max={90}
                      value={confidenceThreshold}
                      onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {confidenceThreshold}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: TRACKER */}
            {activeTab === "tracker" && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-[hsl(var(--text-primary))] border-b border-[hsl(var(--border))] pb-2">
                  BoT-SORT Multi-Object Tracking Settings
                </h3>

                {/* Track High Thresh */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      First-Stage Association Threshold
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Detections exceeding this score trigger visual Re-ID features matching first.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="track-high-thresh"
                      type="range"
                      min={10}
                      max={90}
                      value={trackHighThresh}
                      onChange={(e) => setTrackHighThresh(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {trackHighThresh}%
                    </span>
                  </div>
                </div>

                {/* Track Low Thresh */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Second-Stage Spatial Threshold
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Detections below high thresh but above this are matched strictly via overlapping IoU.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="track-low-thresh"
                      type="range"
                      min={5}
                      max={40}
                      value={trackLowThresh}
                      onChange={(e) => setTrackLowThresh(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {trackLowThresh}%
                    </span>
                  </div>
                </div>

                {/* New Track Confirmation */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      New Track Confirmation
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Minimum score required to instantiate a persistent worker identity. Prevents tracking background noise.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="new-track-thresh"
                      type="range"
                      min={20}
                      max={80}
                      value={newTrackThresh}
                      onChange={(e) => setNewTrackThresh(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {newTrackThresh}%
                    </span>
                  </div>
                </div>

                {/* Track Buffer (Max Age) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Lost Track Frame Buffer
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Frames to hold a missing track in memory. At 5 FPS, 120 frames preserves IDs for 24s.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      id="track-buffer"
                      type="number"
                      min={10}
                      max={400}
                      value={trackBuffer}
                      onChange={(e) => setTrackBuffer(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    />
                  </div>
                </div>

                {/* Association Similarity */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Hungarian Assignment Gate
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Permissiveness threshold. Higher values allow matching during high velocity movement or frame drops.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="match-thresh"
                      type="range"
                      min={40}
                      max={95}
                      value={matchThresh}
                      onChange={(e) => setMatchThresh(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {matchThresh}%
                    </span>
                  </div>
                </div>

                {/* Fuse Detection Score */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Fuse Score with Motion
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Multiplies spatial distances with prediction scores. Enhances track stability on noisy feeds.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        id="fuse-score-toggle"
                        type="checkbox"
                        checked={fuseScore}
                        onChange={(e) => setFuseScore(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                </div>

                {/* Re-ID Feature Toggle */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Appearance Feature Matching (Re-ID)
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Extracts visual features to identify same workers after occlusions. Disable to use purely spatial tracking.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        id="with-reid-toggle"
                        type="checkbox"
                        checked={withReid}
                        onChange={(e) => setWithReid(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                </div>

                {/* Re-ID Proximity Gate */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Re-ID Spatial overlap gate
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Minimum spatial overlap (IoU) to allow visual features evaluation. 0% runs Re-ID globally across frames.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="proximity-thresh-slider"
                      type="range"
                      min={0}
                      max={60}
                      value={proximityThresh}
                      onChange={(e) => setProximityThresh(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {proximityThresh}%
                    </span>
                  </div>
                </div>

                {/* Re-ID Similarity Gate */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Re-ID Similarity Gate
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Cosine similarity match requirement. Prevents swapping worker identities in uniforms.
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4">
                    <input
                      id="appearance-thresh-slider"
                      type="range"
                      min={50}
                      max={90}
                      value={appearanceThresh}
                      onChange={(e) => setAppearanceThresh(Number(e.target.value))}
                      className="flex-1 accent-emerald-500 cursor-pointer"
                    />
                    <span className="w-12 text-sm font-semibold text-emerald-600 dark:text-emerald-400 text-right">
                      {appearanceThresh}%
                    </span>
                  </div>
                </div>

                {/* GMC */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Camera Motion Compensation (GMC)
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Compensates for panning/tilting feeds. Set to None for static CCTV to minimize CPU overhead.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <select
                      id="gmc-method-select"
                      value={gmcMethod}
                      onChange={(e) => setGmcMethod(e.target.value)}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    >
                      <option value="none">None (Optimized for static cameras)</option>
                      <option value="sparseOptFlow">Sparse Optical Flow (PTZ active compensation)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: IDENTITY INTEGRATION */}
            {activeTab === "identity" && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-[hsl(var(--text-primary))] border-b border-[hsl(var(--border))] pb-2">
                  Access Control & Identity Modules
                </h3>

                {/* Provider Type */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Active Identity Provider
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Select how entry scanning events are loaded. HIKVISION_ISAPI listens directly to physical doors.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <select
                      id="identity-provider-select"
                      value={identityProvider}
                      onChange={(e) => setIdentityProvider(e.target.value)}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    >
                      <option value="REST_SIMULATOR">REST Simulator API (Simulated RFID tags)</option>
                      <option value="HIKVISION_ISAPI">Hikvision ISAPI Door Controllers (Physical Hardware)</option>
                    </select>
                  </div>
                </div>

                {/* Correlation Window */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Event Correlation Window (seconds)
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Max time gap between worker swipe event and detection in frame to associate identity.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      id="correlation-window"
                      type="number"
                      min={1}
                      max={60}
                      value={correlationWindow}
                      onChange={(e) => setCorrelationWindow(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    />
                  </div>
                </div>

                {/* Hikvision Global Credentials */}
                <div className="border-t border-[hsl(var(--border))] pt-4 space-y-4">
                  <h4 className="text-sm font-bold text-[hsl(var(--text-primary))]">Hikvision Controller Global Credentials</h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    <label className="text-sm text-[hsl(var(--text-secondary))]">Global Access Username</label>
                    <div className="md:col-span-2">
                      <input
                        id="hikvision-username"
                        type="text"
                        value={hikvisionUsername}
                        onChange={(e) => setHikvisionUsername(e.target.value)}
                        className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    <label className="text-sm text-[hsl(var(--text-secondary))]">Global Access Password</label>
                    <div className="md:col-span-2 relative">
                      <input
                        id="hikvision-password"
                        type={showPassword ? "text" : "password"}
                        value={hikvisionPassword}
                        onChange={(e) => setHikvisionPassword(e.target.value)}
                        className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 pr-10 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: STREAMING & SERVER */}
            {activeTab === "server" && (
              <div className="space-y-6">
                <h3 className="text-xl font-bold text-[hsl(var(--text-primary))] border-b border-[hsl(var(--border))] pb-2">
                  Streaming Engine & RTSP Feeds
                </h3>

                {/* RTSP Port */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Default RTSP Port
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Port used for RTSP streaming connections (standard: 554).
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      id="rtsp-port"
                      type="number"
                      value={rtspPort}
                      onChange={(e) => setRtspPort(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    />
                  </div>
                </div>

                {/* RTSP Transport */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      RTSP Stream Transport
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      TCP guarantees packet arrival preventing artifacts. UDP offers lower latency but may drop frames.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <select
                      id="rtsp-transport-select"
                      value={streamTransport}
                      onChange={(e) => setStreamTransport(e.target.value)}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    >
                      <option value="tcp">TCP (Reliable, high quality)</option>
                      <option value="udp">UDP (Lowest latency, error-prone)</option>
                    </select>
                  </div>
                </div>

                {/* Stream Timeout */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Stream Connection Timeout (seconds)
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Max seconds to wait before marking camera connection as dead.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      id="stream-timeout"
                      type="number"
                      value={streamTimeout}
                      onChange={(e) => setStreamTimeout(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    />
                  </div>
                </div>

                {/* Reconnect Interval */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Reconnection Retry Interval (seconds)
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Wait interval before trying to reconnect a broken RTSP connection.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      id="reconnect-interval"
                      type="number"
                      value={reconnectInterval}
                      onChange={(e) => setReconnectInterval(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    />
                  </div>
                </div>

                {/* Frame Buffer Size */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Frame Buffer Size (frames)
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Number of raw frames to buffer in memory. Lower buffer matches live feed closer; higher buffer prevents drops.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      id="frame-buffer-size"
                      type="number"
                      value={frameBufferSize}
                      onChange={(e) => setFrameBufferSize(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    />
                  </div>
                </div>

                {/* Max Camera Streams limit */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Max Camera Limit
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Hard limit of parallel RTSP camera stream threads.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      id="max-cameras"
                      type="number"
                      value={maxCameras}
                      onChange={(e) => setMaxCameras(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    />
                  </div>
                </div>

                {/* Velocity Threshold */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-t border-[hsl(var(--border))] pt-4">
                  <div>
                    <label className="block text-sm font-semibold text-[hsl(var(--text-primary))]">
                      Classifier Velocity Threshold
                    </label>
                    <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                      Joint velocity threshold (coordinate delta) to classify a worker as walking instead of idle.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      id="classifier-velocity-threshold"
                      type="number"
                      step={0.005}
                      min={0.005}
                      max={0.5}
                      value={classifierVelocityThreshold}
                      onChange={(e) => setClassifierVelocityThreshold(Number(e.target.value))}
                      className="w-full bg-[hsl(var(--bg-input))] border border-[hsl(var(--border-strong))] rounded-lg px-4 py-2 text-[hsl(var(--text-primary))] text-sm focus:outline-none focus:border-emerald-500 border-solid"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-xl transition-all">
                {error}
              </div>
            )}

            {/* Form Actions footer */}
            <div className="flex justify-end items-center gap-3 pt-6 border-t border-[hsl(var(--border))]">
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 font-semibold animate-pulse">
                  <CheckCircle2 className="w-4 h-4" /> Configurations updated successfully!
                </span>
              )}
              <button
                id="save-settings-btn"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500
                  disabled:opacity-50 disabled:cursor-not-allowed
                  text-white px-6 py-2.5 rounded-xl font-semibold transition-all shadow-sm"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? "Saving Changes…" : "Apply Configurations"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
