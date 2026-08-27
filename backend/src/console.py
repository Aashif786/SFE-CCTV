"""
CALVISION Terminal UI
"""

import os
import sys
import time
import shutil
import ctypes
import threading
from datetime import datetime
from typing import Optional, Any, Dict, Tuple


# Ensure UTF-8 output encoding on Windows
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


# Enable ANSI / VT100 virtual terminal processing on Windows
def _enable_windows_vt():
    if os.name == 'nt':
        try:
            kernel32 = ctypes.windll.kernel32
            hStdOut = kernel32.GetStdHandle(-11)
            mode = ctypes.c_ulong()
            kernel32.GetConsoleMode(hStdOut, ctypes.byref(mode))
            mode.value |= 0x0004  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
            kernel32.SetConsoleMode(hStdOut, mode)
        except Exception:
            pass


_enable_windows_vt()


# ── ANSI Color & Style Constants ─────────────────────────────────────────────

CLR_RESET  = "\033[0m"
CLR_BOLD   = "\033[1m"
CLR_DIM    = "\033[2m"
CLR_BORDER = "\033[38;5;242m"  # Subtle slate-gray box border


# ── Badge Formatters (Fixed Visual Widths) ────────────────────────────────────

def badge_category(cat: str) -> str:
    """Returns inverted pill badge with EXACTLY 10 visible characters, left-aligned."""
    c = cat.lower().strip()
    colors = {
        "system": "48;5;238;37",
        "stream": "48;5;24;37",
        "acs": "48;5;214;30",
        "identity": "48;5;30;37",
        "error": "48;5;196;37",
        "success": "48;5;28;37",
    }
    col = colors.get(c, "48;5;238;37")
    tag = f"[{c[:8]}]"
    pill = f"\033[{col}m{tag}\033[0m"
    pad = " " * max(0, 10 - len(tag))
    return f"{pill}{pad}"


def badge_status(st: str) -> str:
    """Returns status badge with EXACTLY 11 visible characters, left-aligned."""
    s = st.lower().strip()
    if s in ("granted", "matched", "success", "online", "ready"):
        col = "48;5;34;30"
    elif s in ("denied", "offline", "expired", "error", "failed", "auth_fail"):
        col = "48;5;160;37"
    elif s in ("queued", "retry", "warn", "warning"):
        col = "48;5;240;33"
    elif s in ("startup", "start", "started", "database"):
        col = "48;5;24;37"
    elif s in ("closed", "stopped"):
        col = "48;5;236;246"
    else:
        col = "48;5;238;37"

    display_text = "auth_fail" if s == "auth_fail" else s[:8]
    pill = f"\033[{col}m {display_text} \033[0m"
    vis_len = len(display_text) + 2
    pad = " " * max(0, 11 - vis_len)
    return f"{pill}{pad}"


def badge_dir(d: str) -> str:
    """Returns direction badge with EXACTLY 7 visible characters, left-aligned."""
    d_l = d.lower().strip()
    if "entry" in d_l or "in" in d_l:
        pill = "\033[48;5;31;30m entry \033[0m"
        pad = ""
    elif "exit" in d_l or "out" in d_l:
        pill = "\033[48;5;127;37m exit \033[0m"
        pad = " "
    else:
        pill = "\033[90m ----- \033[0m"
        pad = ""
    return f"{pill}{pad}"


# ── Console Orchestrator & Live Status Panel ─────────────────────────────────

class Console:
    _lock = threading.Lock()
    _running = True
    _ticker_started = False
    _panel_rendered = False
    _status_text = "● ONLINE"

    @classmethod
    def start_status_bar(cls):
        """Starts the background 1Hz status panel ticker thread."""
        if cls._ticker_started:
            return
        cls._ticker_started = True
        t = threading.Thread(target=cls._status_bar_worker, daemon=True, name="console-status-bar")
        t.start()

    @classmethod
    def _get_system_metrics(cls) -> Tuple[float, float, float]:
        """Gets live CPU%, GPU%, RAM% metrics."""
        cpu = 0.0
        gpu = 0.0
        ram = 0.0
        try:
            from .api.resources import _cached_resources, _ensure_sampler_started
            _ensure_sampler_started()
            cpu = max(0.0, float(_cached_resources.get("cpu_percent", 0.0) or 0.0))
            ram = max(0.0, float(_cached_resources.get("memory_percent", 0.0) or _cached_resources.get("ram_percent", 0.0) or 0.0))
            gpu_data = _cached_resources.get("gpu", {})
            gpu = max(0.0, float(gpu_data.get("utilization_percent", 0.0) or 0.0))
        except Exception:
            try:
                import psutil
                cpu = psutil.cpu_percent(interval=None)
                ram = psutil.virtual_memory().percent
            except Exception:
                pass
        return cpu, gpu, ram

    @classmethod
    def _render_panel(cls) -> Tuple[str, str, str]:
        """Constructs the 3-line framed status dashboard panel."""
        cols = shutil.get_terminal_size((80, 24)).columns
        now_str = datetime.now().strftime("%H:%M:%S")
        cpu, gpu, ram = cls._get_system_metrics()

        box_w = max(60, min(cols, 100))
        inner_w = box_w - 2

        # Metric color thresholds
        c_cpu = "\033[1;31m" if cpu > 85 else ("\033[1;33m" if cpu > 65 else "\033[1;32m")
        c_gpu = "\033[1;31m" if gpu > 85 else ("\033[1;33m" if gpu > 70 else "\033[1;36m")
        c_ram = "\033[1;31m" if ram > 85 else ("\033[1;33m" if ram > 75 else "\033[1;32m")

        top = f"{CLR_BORDER}┌" + ("─" * inner_w) + f"┐{CLR_RESET}"
        bot = f"{CLR_BORDER}└" + ("─" * inner_w) + f"┘{CLR_RESET}"

        # Segment contents (ANSI-formatted)
        seg_brand = "  \033[1;36m● CALVISION\033[0m   "
        seg_time  = f"{CLR_BORDER}│\033[0m  \033[1;37m{now_str}\033[0m  "
        seg_cpu   = f"{CLR_BORDER}│\033[0m  CPU {c_cpu}{int(round(cpu)):2d}%\033[0m  "
        seg_gpu   = f"{CLR_BORDER}│\033[0m  GPU {c_gpu}{int(round(gpu)):2d}%\033[0m  "
        seg_ram   = f"{CLR_BORDER}│\033[0m  RAM {c_ram}{int(round(ram)):2d}%\033[0m  "
        seg_stat  = f"{CLR_BORDER}│\033[0m  \033[48;5;28;37;1m {cls._status_text} \033[0m  "

        # Plaintext equivalents for visual width calculation
        vis_brand = "  ● CALVISION   "
        vis_time  = f"│  {now_str}  "
        vis_cpu   = f"│  CPU {int(round(cpu)):2d}%  "
        vis_gpu   = f"│  GPU {int(round(gpu)):2d}%  "
        vis_ram   = f"│  RAM {int(round(ram)):2d}%  "
        vis_stat  = f"│   {cls._status_text}   "

        raw_content = seg_brand + seg_time + seg_cpu + seg_gpu + seg_ram + seg_stat
        vis_total = len(vis_brand + vis_time + vis_cpu + vis_gpu + vis_ram + vis_stat)

        pad = " " * max(0, inner_w - vis_total)
        mid = f"{CLR_BORDER}│\033[0m{raw_content}{pad}{CLR_BORDER}│{CLR_RESET}"

        return top, mid, bot

    @classmethod
    def _status_bar_worker(cls):
        while cls._running:
            try:
                if sys.stdout.isatty():
                    with cls._lock:
                        if cls._panel_rendered:
                            top, mid, bot = cls._render_panel()
                            # Move cursor up 2 lines to start of box, clear each line, and redraw in place
                            sys.stdout.write(f"\033[2A\r\033[K{top}\n\033[K{mid}\n\033[K{bot}")
                            sys.stdout.flush()
            except Exception:
                pass
            time.sleep(1.0)

    @classmethod
    def write(cls, line: str):
        """Prints a log line cleanly above the sticky bottom status dashboard."""
        cls.start_status_bar()
        with cls._lock:
            if sys.stdout.isatty():
                top, mid, bot = cls._render_panel()
                if cls._panel_rendered:
                    # Move cursor up 2 lines and clear to bottom of screen
                    sys.stdout.write("\033[2A\r\033[J")
                
                sys.stdout.write(f"{line}\n")
                sys.stdout.write(f"{top}\n{mid}\n{bot}")
                sys.stdout.flush()
                cls._panel_rendered = True
            else:
                # Non-interactive / pipe mode: clean plaintext rows
                sys.stdout.write(f"{line}\n")
                sys.stdout.flush()

    # ── Category Formatters ──────────────────────────────────────────────────

    @classmethod
    def _extract_clean_time(cls, ts_val: Optional[str] = None) -> str:
        """Extracts clean HH:MM:SS from ACS timestamp or current system time."""
        if not ts_val:
            return datetime.now().strftime("%H:%M:%S")
        s = ts_val.strip()
        if "T" in s:
            t_part = s.split("T")[1]
            return t_part[:8]
        elif " " in s:
            return s.split(" ")[1][:8]
        elif len(s) >= 8 and ":" in s:
            return s[:8]
        return datetime.now().strftime("%H:%M:%S")

    @classmethod
    def acs(
        cls,
        timestamp: Optional[str],
        status: str,           # "GRANTED" | "DENIED"
        direction: str,        # "ENTRY" | "EXIT"
        emp_id: str,
        emp_name: str,
        card_no: str,
        door: str,
        auth_type: str,
        major: int = 5,
        minor: int = 75,
    ):
        """
        Formats and prints an ACS hardware access punch in fixed-width columns.
        Layout:
        HH:MM:SS  [  ACS   ]  GRANTED   ENTRY   HK002     LAKSHMI         Card: 2334562886    main Door (192.168.1.231)       Card Swipe [5:1]
        """
        t_str = cls._extract_clean_time(timestamp)
        f_t = f"\033[90m{t_str[:8]:<8}\033[0m"
        f_cat = badge_category("ACS")
        f_st = badge_status(status)
        f_dir = badge_dir(direction)

        clean_id = (emp_id or "N/A").strip()
        f_id = f"\033[1;37m{clean_id[:8]:<8}\033[0m"
        clean_name = (emp_name or "Unknown").strip()
        f_name = f"\033[37m{clean_name[:14]:<14}\033[0m"

        card_val = (card_no or "").strip()
        card_label = f"Card: {card_val}" if card_val and card_val != "N/A" and card_val != clean_id else "Card: ---"
        if "Card:" in card_label and "---" not in card_label:
            f_card = f"\033[36m{card_label[:18]:<18}\033[0m"
        else:
            f_card = f"\033[90m{card_label[:18]:<18}\033[0m"

        clean_door = (door or "Door").strip()
        f_door = f"\033[1;34m{clean_door[:30]:<30}\033[0m"
        auth_info = f"{auth_type} [{major}:{minor}]" if (major or minor) else auth_type
        f_auth = f"\033[90m{auth_info}\033[0m"

        line = f"{f_t} {f_cat} {f_st} {f_dir} {f_id} {f_name} {f_card} {f_door} {f_auth}"
        cls.write(line)

    @classmethod
    def identity(
        cls,
        status: str,           # "QUEUED" | "MATCHED" | "CLOSED" | "EXPIRED"
        direction: str,        # "ENTRY" | "EXIT"
        emp_id: str,
        emp_name: str,
        location: str,
        details: str,
        timestamp: Optional[str] = None,
    ):
        """
        Formats and prints an Identity correlation event in fixed-width columns.
        Layout:
        HH:MM:SS [identity]  matched     entry  HK002     LAKSHMI         Camera 1 (ai-1)           Track: ai-1:104 | Delay: 0.8s
        """
        t_str = cls._extract_clean_time(timestamp)
        f_t = f"\033[90m{t_str[:8]:<8}\033[0m"
        f_cat = badge_category("IDENTITY")
        f_st = badge_status(status)
        f_dir = badge_dir(direction)

        clean_id = (emp_id or "N/A").strip()
        f_id = f"\033[1;37m{clean_id[:8]:<8}\033[0m"
        clean_name = (emp_name or "Unknown").strip()
        f_name = f"\033[37m{clean_name[:14]:<14}\033[0m"

        clean_loc = (location or "").strip()
        f_loc = f"\033[1;34m{clean_loc[:24]:<24}\033[0m"
        f_det = f"\033[90m{details}\033[0m"

        line = f"{f_t} {f_cat} {f_st} {f_dir} {f_id} {f_name} {f_loc} {f_det}"
        cls.write(line)

    @classmethod
    def stream(cls, status: str, message: str, camera_id: Optional[str] = None):
        """
        Formats and prints a camera stream lifecycle log.
        Layout:
        HH:MM:SS [stream]    online      -----  Camera 17  RTSP stream connected (192.168.1.117)
        """
        t_str = datetime.now().strftime("%H:%M:%S")
        f_t = f"\033[90m{t_str[:8]:<8}\033[0m"
        f_cat = badge_category("STREAM")
        f_st = badge_status(status)
        f_dir = badge_dir("---")
        cam_prefix = f"\033[1;34mCamera {camera_id:<2}\033[0m  " if camera_id else ""

        line = f"{f_t} {f_cat} {f_st} {f_dir} {cam_prefix}\033[37m{message}\033[0m"
        cls.write(line)

    @classmethod
    def system(cls, action: str, message: str):
        """
        Formats and prints a system lifecycle or operational log.
        Layout:
        HH:MM:SS [system]    startup     -----  Initializing CALVISION core services...
        """
        t_str = datetime.now().strftime("%H:%M:%S")
        f_t = f"\033[90m{t_str[:8]:<8}\033[0m"
        f_cat = badge_category("SYSTEM")
        f_st = badge_status(action)
        f_dir = badge_dir("---")

        line = f"{f_t} {f_cat} {f_st} {f_dir} \033[37m{message}\033[0m"
        cls.write(line)

    @classmethod
    def error(cls, component: str, message: str):
        """
        Formats and prints an error log.
        Layout:
        HH:MM:SS [error]     error       -----  [stream] Camera 3 (192.168.1.103) RTSP connection timed out
        """
        t_str = datetime.now().strftime("%H:%M:%S")
        f_t = f"\033[90m{t_str[:8]:<8}\033[0m"
        f_cat = badge_category("ERROR")
        f_st = badge_status("ERROR")
        f_dir = badge_dir("---")
        comp_tag = f"\033[1;31m[{component.lower()}]\033[0m " if component else ""

        line = f"{f_t} {f_cat} {f_st} {f_dir} {comp_tag}\033[37m{message}\033[0m"
        cls.write(line)


# Global console instance
console = Console
