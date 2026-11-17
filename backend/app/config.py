import base64
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"

SNOWFLAKE_KEYS = (
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_USER",
    "SNOWFLAKE_PASSWORD",
    "SNOWFLAKE_WAREHOUSE",
    "SNOWFLAKE_DATABASE",
    "SNOWFLAKE_SCHEMA",
    "SNOWFLAKE_ROLE",
)

AVERY_ID = "avery"
# A city is much larger than a block. 400 is the within-city radius on the block grid.
DISTANCE_LIMIT = 400
LOAN_BUFFER_MINUTES = 30


def load_env() -> None:
    for path in (ENV_PATH, ENV_PATH.parent.parent / ".env.local"):
        _load_env_file(path)


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def snowflake_settings() -> dict[str, str] | None:
    values = {key: os.environ.get(key, "").strip() for key in SNOWFLAKE_KEYS}
    if any(not value for value in values.values()):
        return None
    return values


def clerk_issuer() -> str:
    explicit = os.environ.get("CLERK_ISSUER", "").strip()
    if explicit:
        return explicit
    for name in ("CLERK_PUBLISHABLE_KEY", "VITE_CLERK_PUBLISHABLE_KEY"):
        derived = issuer_from_publishable_key(os.environ.get(name, ""))
        if derived:
            return derived
    return ""


def issuer_from_publishable_key(key: str) -> str:
    encoded = key.strip()
    for prefix in ("pk_test_", "pk_live_"):
        if encoded.startswith(prefix):
            encoded = encoded[len(prefix):]
            break
    else:
        return ""
    padded = encoded + "=" * (-len(encoded) % 4)
    try:
        host = base64.b64decode(padded).decode("utf-8")
    except Exception:
        return ""
    host = host.rstrip("$").strip()
    if not host or any(mark in host for mark in ("\x00", " ", "/")) or "." not in host:
        return ""
    return f"https://{host}"


def clerk_secret_key() -> str:
    return os.environ.get("CLERK_SECRET_KEY", "").strip()


def gemini_api_key() -> str:
    return os.environ.get("GEMINI_API_KEY", "").strip()


def gemini_model() -> str:
    return os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"


def ollama_host() -> str:
    """Base URL of a local Ollama server, or empty when OLLAMA_HOST is not set."""
    raw = os.environ.get("OLLAMA_HOST", "").strip().rstrip("/")
    if not raw:
        return ""
    return raw if "://" in raw else f"http://{raw}"


def ollama_model() -> str:
    return os.environ.get("OLLAMA_MODEL", "llama3.2").strip() or "llama3.2"


def backboard_api_key() -> str:
    return os.environ.get("BACKBOARD_API_KEY", "").strip()


def backboard_model() -> str:
    return os.environ.get("BACKBOARD_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"


def admin_user_ids() -> set[str]:
    """Clerk user ids allowed to use /api/admin, from RELAY_ADMIN_USER_IDS (comma separated)."""
    raw = os.environ.get("RELAY_ADMIN_USER_IDS", "")
    return {part.strip() for part in raw.split(",") if part.strip()}
