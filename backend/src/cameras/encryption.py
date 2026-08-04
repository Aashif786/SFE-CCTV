"""
Fernet-based encryption for camera passwords.

On first import, if ``CAMERA_ENCRYPTION_KEY`` is missing from the .env
file the module auto-generates a key and appends it.  The key is a
URL-safe base-64 Fernet key (44 chars).

Public API
----------
encrypt_password(plain: str) -> str
decrypt_password(token: str) -> str
"""

import os
import base64
from cryptography.fernet import Fernet

# ---------------------------------------------------------------------------
# Resolve the .env file path (backend/.env and root .env)
# ---------------------------------------------------------------------------
_ENV_PATH = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
_ROOT_ENV_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env")


def _read_key_from_env() -> str | None:
    """Read CAMERA_ENCRYPTION_KEY from the .env file (simple parser)."""
    for path in [_ROOT_ENV_PATH, _ENV_PATH]:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("CAMERA_ENCRYPTION_KEY="):
                        val = line.split("=", 1)[1].strip().strip("'\"")
                        if val:
                            return val
    return None


def _ensure_key() -> str:
    """Return the Fernet key, auto-generating and persisting if needed."""
    key = _read_key_from_env() or os.environ.get("CAMERA_ENCRYPTION_KEY")
    if key:
        return key

    # Generate a fresh Fernet key and append it to the appropriate .env
    key = Fernet.generate_key().decode()
    target_path = _ROOT_ENV_PATH if os.path.exists(_ROOT_ENV_PATH) else _ENV_PATH
    with open(target_path, "a", encoding="utf-8") as f:
        f.write(f"\n# Auto-generated encryption key for camera passwords\n")
        f.write(f"CAMERA_ENCRYPTION_KEY={key}\n")
    print(f"[Cameras] Generated new CAMERA_ENCRYPTION_KEY and saved to {target_path}")
    return key


# Module-level singleton
_KEY: str = _ensure_key()
_fernet: Fernet = Fernet(_KEY.encode() if isinstance(_KEY, str) else _KEY)


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def encrypt_password(plain: str) -> str:
    """Encrypt a plaintext password → Fernet token (URL-safe base-64)."""
    return _fernet.encrypt(plain.encode()).decode()


def decrypt_password(token: str) -> str:
    """Decrypt a Fernet token back to the plaintext password."""
    try:
        return _fernet.decrypt(token.encode()).decode()
    except Exception as e:
        print(f"[Cameras] Decryption failed (possibly due to key mismatch): {e}. Returning empty string.")
        return ""
