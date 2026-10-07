"""
AeroMesh Production Security Module
Phase 10 — Production Hardening, Security & Deployment

Implements:
- PBKDF2-HMAC-SHA256 password hashing and verification
- JWT issuance, signing, and validation
- Role-Based Access Control (RBAC: ADMIN, ANALYST, OPERATOR)
- Mission-level access authorization
- File upload sanitization, signature validation, and traversal protection
- In-memory rate limiting for sensitive endpoints
- HTTP security headers middleware
"""

import hashlib
import hmac
import os
import re
import secrets
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import jwt
from fastapi import Depends, Header, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.middleware.base import BaseHTTPMiddleware

# ============================================================================
# Configuration & Environment Variables
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

DEV_INSECURE_SECRET = "aeromesh-dev-insecure-secret-key-change-in-env"
SECRET_KEY = os.getenv("SECRET_KEY") or DEV_INSECURE_SECRET
is_prod_env = os.getenv("ENVIRONMENT", "").lower() in ("production", "prod") or os.getenv("ENV", "").lower() in ("production", "prod") or os.getenv("RENDER", "").lower() in ("true", "1")
if is_prod_env and (not os.getenv("SECRET_KEY") or os.getenv("SECRET_KEY") == DEV_INSECURE_SECRET):
    raise RuntimeError("PRODUCTION STARTUP HALTED: A secure, unique SECRET_KEY environment variable is required in production mode.")

JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_MINUTES = int(os.getenv("JWT_EXPIRATION_MINUTES", "720"))  # 12 hours (operational shift duration)
MAX_UPLOAD_SIZE_BYTES = min(
    int(os.getenv("MAX_UPLOAD_SIZE_BYTES", str(150 * 1024 * 1024))),
    150 * 1024 * 1024,
)  # Render-friendly hard cap: 150 MB

RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "120"))
AUTH_OPTIONAL_MODE = os.getenv("AEROMESH_AUTH_OPTIONAL", "0").lower() in ("1", "true", "yes")

# Supported Seed User Passwords (configurable via environment variables)
AEROMESH_ADMIN_PASSWORD = os.getenv("AEROMESH_DEMO_ADMIN_PASSWORD", "Admin123!")
AEROMESH_ANALYST_PASSWORD = os.getenv("AEROMESH_DEMO_ANALYST_PASSWORD", "Analyst123!")
AEROMESH_OPERATOR_PASSWORD = os.getenv("AEROMESH_DEMO_OPERATOR_PASSWORD", "Operator123!")

# Allowed Video Extensions and MIME types
ALLOWED_VIDEO_EXTENSIONS: Set[str] = {".mp4", ".mov", ".avi", ".mkv"}
ALLOWED_VIDEO_MIMES: Set[str] = {
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
    "video/x-matroska",
    "video/avi",
    "application/octet-stream",
}

# Supported User Roles
ROLE_ADMIN = "ADMIN"
ROLE_ANALYST = "ANALYST"
ROLE_OPERATOR = "OPERATOR"
ROLE_VIEWER = "VIEWER"
ALL_ROLES = {ROLE_ADMIN, ROLE_ANALYST, ROLE_OPERATOR, ROLE_VIEWER}

# Portal Types
PORTAL_GOV_ORG = "GOVERNMENT_ORG"
PORTAL_INDIVIDUAL = "INDIVIDUAL"
PORTAL_GUEST = "GUEST"
ALL_PORTALS = {PORTAL_GOV_ORG, PORTAL_INDIVIDUAL, PORTAL_GUEST}

# Role hierarchy: ADMIN includes all; ANALYST can inspect/measure/report; OPERATOR can create/upload; VIEWER is read-only
ROLE_HIERARCHY: Dict[str, Set[str]] = {
    ROLE_ADMIN: {ROLE_ADMIN, ROLE_ANALYST, ROLE_OPERATOR, ROLE_VIEWER},
    ROLE_ANALYST: {ROLE_ANALYST, ROLE_VIEWER},
    ROLE_OPERATOR: {ROLE_OPERATOR, ROLE_VIEWER},
    ROLE_VIEWER: {ROLE_VIEWER},
}


# ============================================================================
# Invite Code Management (Single-use, Expiring, Hashed for Government Signup)
# ============================================================================

INVITE_CODES_FILE: Path = Path(__file__).resolve().parent.parent / "data" / "invite_codes.json"
_INVITES_LOCK = Lock()


def load_invite_codes() -> Dict[str, Dict[str, Any]]:
    invites: Dict[str, Dict[str, Any]] = {}
    if INVITE_CODES_FILE.exists():
        try:
            import json
            with open(INVITE_CODES_FILE, "r", encoding="utf-8") as f:
                invites = json.load(f)
        except Exception:
            pass
    # Only load from explicit environment variable if provided by administrator
    env_token = os.getenv("ORG_INVITE_TOKEN", "").strip()
    if env_token:
        default_hash = hashlib.sha256(env_token.encode()).hexdigest()
        if default_hash not in invites:
            invites[default_hash] = {
                "code_hash": default_hash,
                "created_by": "admin@aeromesh.internal",
                "department": "Strategic Aerial Reconnaissance",
                "org_name": "Ministry of Defence",
                "created_at": "2026-01-01T00:00:00Z",
                "expires_at": "2030-01-01T00:00:00Z",
                "is_used": False,
                "used_by": None,
                "used_at": None,
            }
    return invites


def save_invite_code(code: str, created_by: str, department: Optional[str] = None, org_name: Optional[str] = None, expires_hours: int = 72) -> str:
    with _INVITES_LOCK:
        invites = load_invite_codes()
        code_hash = hashlib.sha256(code.strip().encode()).hexdigest()
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=expires_hours)).isoformat()
        invites[code_hash] = {
            "code_hash": code_hash,
            "created_by": created_by,
            "department": department,
            "org_name": org_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": expires_at,
            "is_used": False,
            "used_by": None,
            "used_at": None,
        }
        INVITE_CODES_FILE.parent.mkdir(parents=True, exist_ok=True)
        import json
        with open(INVITE_CODES_FILE, "w", encoding="utf-8") as f:
            json.dump(invites, f, indent=2)
        return code


def verify_and_consume_invite_code(code: str, redeeming_email: str) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    if not code or not code.strip():
        return False, "Government account registration requires a valid admin-issued invite code.", None
    
    code_hash = hashlib.sha256(code.strip().encode()).hexdigest()
    invites = load_invite_codes()
    if code_hash not in invites:
        return False, "Invalid or unrecognized government invite code.", None
    
    item = invites[code_hash]
    if item.get("is_used"):
        return False, "This government invite code has already been redeemed.", None
    
    if item.get("expires_at"):
        try:
            exp_str = item["expires_at"].replace("Z", "+00:00")
            exp = datetime.fromisoformat(exp_str)
            if datetime.now(timezone.utc) > exp:
                return False, "This government invite code has expired.", None
        except Exception:
            pass
    
    # Mark as used
    with _INVITES_LOCK:
        item["is_used"] = True
        item["used_by"] = redeeming_email
        item["used_at"] = datetime.now(timezone.utc).isoformat()
        INVITE_CODES_FILE.parent.mkdir(parents=True, exist_ok=True)
        import json
        with open(INVITE_CODES_FILE, "w", encoding="utf-8") as f:
            json.dump(invites, f, indent=2)
            
    return True, None, item


# ============================================================================
# Password Hashing & Verification (Argon2id + Bcrypt + PBKDF2 compatibility)
# ============================================================================

def hash_password(password: str) -> str:
    """Hash a password using modern Argon2id with cryptographically secure parameters."""
    if not password:
        raise ValueError("Password cannot be empty")
    try:
        from argon2 import PasswordHasher
        ph = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)
        return ph.hash(password)
    except Exception:
        try:
            import bcrypt
            return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        except Exception:
            salt = secrets.token_bytes(16)
            key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
            return f"pbkdf2_sha256$100000${salt.hex()}${key.hex()}"


def verify_password(password: str, hashed: str) -> bool:
    """Verify a plain password supporting Argon2id, Bcrypt, and PBKDF2-HMAC-SHA256."""
    if not password or not hashed or hashed.startswith("OAUTH_DISABLED_"):
        return False
    # 1. Argon2id / Argon2i
    if hashed.startswith("$argon2"):
        try:
            from argon2 import PasswordHasher
            return PasswordHasher().verify(hashed, password)
        except Exception:
            return False
    # 2. Bcrypt
    if hashed.startswith("$2a$") or hashed.startswith("$2b$") or hashed.startswith("$2y$"):
        try:
            import bcrypt
            return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
        except Exception:
            return False
    # 3. PBKDF2-HMAC-SHA256
    parts = hashed.split("$")
    if len(parts) == 4 and parts[0] == "pbkdf2_sha256":
        try:
            iterations = int(parts[1])
            salt = bytes.fromhex(parts[2])
            expected_key = bytes.fromhex(parts[3])
            candidate_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
            return hmac.compare_digest(candidate_key, expected_key)
        except Exception:
            return False
    return False


# ============================================================================
# User Records & Multi-Portal Store
# ============================================================================

@dataclass
class UserRecord:
    id: str
    email: str
    full_name: str
    role: str
    hashed_password: str
    portal_type: str = PORTAL_INDIVIDUAL
    organization_name: Optional[str] = None
    department: Optional[str] = None
    employee_id: Optional[str] = None
    mfa_enabled: bool = False
    mfa_secret: Optional[str] = None
    guest_expires_at: Optional[str] = None
    password_login_disabled: bool = False
    is_active: bool = True
    created_at: str = "2026-09-01T00:00:00Z"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "email": self.email,
            "full_name": self.full_name,
            "role": self.role,
            "portal_type": self.portal_type,
            "organization_name": self.organization_name,
            "department": self.department,
            "employee_id": self.employee_id,
            "mfa_enabled": self.mfa_enabled,
            "guest_expires_at": self.guest_expires_at,
            "password_login_disabled": self.password_login_disabled,
            "is_active": self.is_active,
            "created_at": self.created_at,
        }


DEV_ONLY = os.getenv("DEV_ONLY", "0").lower() in ("1", "true", "yes")

# Demo Users seeded only if explicit DEV_ONLY environment flag is enabled (defaults to False)
DEMO_USERS: Dict[str, UserRecord] = {}
if DEV_ONLY:
    DEMO_USERS = {
        "admin@aeromesh.internal": UserRecord(
            id="usr_admin_001",
            email="admin@aeromesh.internal",
            full_name="System Administrator",
            role=ROLE_ADMIN,
            portal_type=PORTAL_GOV_ORG,
            organization_name="Ministry of Defence",
            department="Strategic Aerial Reconnaissance",
            hashed_password=hash_password(AEROMESH_ADMIN_PASSWORD),
        ),
        "analyst@aeromesh.internal": UserRecord(
            id="usr_analyst_002",
            email="analyst@aeromesh.internal",
            full_name="Mission Analyst",
            role=ROLE_ANALYST,
            portal_type=PORTAL_GOV_ORG,
            organization_name="Ministry of Defence",
            department="Geospatial Intelligence Division",
            hashed_password=hash_password(AEROMESH_ANALYST_PASSWORD),
        ),
        "operator@aeromesh.internal": UserRecord(
            id="usr_operator_003",
            email="operator@aeromesh.internal",
            full_name="Drone Operator",
            role=ROLE_OPERATOR,
            portal_type=PORTAL_INDIVIDUAL,
            hashed_password=hash_password(AEROMESH_OPERATOR_PASSWORD),
        ),
    }

USERS_FILE: Path = Path(__file__).resolve().parent.parent / "data" / "users.json"
_USERS_LOCK = Lock()


def load_persistent_users() -> Dict[str, UserRecord]:
    """Load persistent users from data/users.json if present."""
    users: Dict[str, UserRecord] = {}
    if USERS_FILE.exists():
        try:
            import json
            with open(USERS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            for item in data:
                u = UserRecord(
                    id=item["id"],
                    email=item["email"].strip().lower(),
                    full_name=item.get("full_name", item["email"].split("@")[0].title()),
                    role=item.get("role", ROLE_OPERATOR),
                    portal_type=item.get("portal_type", PORTAL_INDIVIDUAL),
                    organization_name=item.get("organization_name"),
                    department=item.get("department"),
                    mfa_enabled=item.get("mfa_enabled", False),
                    mfa_secret=item.get("mfa_secret"),
                    guest_expires_at=item.get("guest_expires_at"),
                    hashed_password=item["hashed_password"],
                    is_active=item.get("is_active", True),
                    created_at=item.get("created_at", "2026-09-01T00:00:00Z"),
                )
                users[u.email] = u
        except Exception:
            pass
    return users


def save_persistent_user(user: UserRecord) -> None:
    """Save a user record to data/users.json for restart durability."""
    with _USERS_LOCK:
        try:
            import json
            USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
            existing = load_persistent_users()
            existing[user.email] = user
            serializable = [
                {
                    "id": u.id,
                    "email": u.email,
                    "full_name": u.full_name,
                    "role": u.role,
                    "portal_type": u.portal_type,
                    "organization_name": u.organization_name,
                    "department": u.department,
                    "mfa_enabled": u.mfa_enabled,
                    "mfa_secret": u.mfa_secret,
                    "guest_expires_at": u.guest_expires_at,
                    "hashed_password": u.hashed_password,
                    "is_active": u.is_active,
                    "created_at": u.created_at,
                }
                for u in existing.values()
            ]
            with open(USERS_FILE, "w", encoding="utf-8") as f:
                json.dump(serializable, f, indent=2)
            # Sync to in-memory map
            DEMO_USERS[user.email] = user
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Failed to save user to %s: %s", USERS_FILE, exc)


for _email, _usr in load_persistent_users().items():
    DEMO_USERS[_email] = _usr


def find_user_by_email(email: str) -> Optional[UserRecord]:
    """Look up a user record by email across persistent storage and demo accounts."""
    if not email:
        return None
    normalized = email.strip().lower()
    if normalized in DEMO_USERS:
        return DEMO_USERS[normalized]
    disk_users = load_persistent_users()
    if normalized in disk_users:
        DEMO_USERS[normalized] = disk_users[normalized]
        return disk_users[normalized]
    return None


# ============================================================================
# Dual-Token JWT (Access + Refresh) and httpOnly Cookies
# ============================================================================

REFRESH_TOKEN_EXPIRATION_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRATION_DAYS", "7"))


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Generate a signed JWT access token with claims and expiry."""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta if expires_delta else timedelta(minutes=JWT_EXPIRATION_MINUTES))
    to_encode.update({
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "type": "access",
        "iss": "aeromesh-auth",
    })
    return jwt.encode(to_encode, SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_refresh_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Generate a signed JWT refresh token with claims and expiry."""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta if expires_delta else timedelta(days=REFRESH_TOKEN_EXPIRATION_DAYS))
    to_encode.update({
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
        "type": "refresh",
        "iss": "aeromesh-auth",
    })
    return jwt.encode(to_encode, SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT access token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM], issuer="aeromesh-auth")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    """Set secure httpOnly cookies for session storage."""
    is_prod = os.getenv("ENVIRONMENT", "").lower() == "production"
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=is_prod,
        samesite="lax",
        max_age=JWT_EXPIRATION_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=is_prod,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRATION_DAYS * 86400,
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    """Clear session httpOnly cookies."""
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/")


# ============================================================================
# FastAPI Authentication & Authorization Dependencies
# ============================================================================

bearer_security = HTTPBearer(auto_error=False)


def get_current_user_optional(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_security),
) -> Optional[UserRecord]:
    """Extract authenticated user from Bearer header or httpOnly cookie."""
    token = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    elif request and request.cookies.get("access_token"):
        token = request.cookies.get("access_token")

    if not token:
        return None

    try:
        payload = decode_access_token(token)
    except HTTPException:
        return None

    email = payload.get("sub") or payload.get("email")
    if not email:
        return None

    user = find_user_by_email(email)
    if user:
        return user

    return UserRecord(
        id=payload.get("user_id", f"usr_{hashlib.sha256(email.encode()).hexdigest()[:8]}"),
        email=email,
        full_name=payload.get("name", email.split("@")[0].title()),
        role=payload.get("role", ROLE_OPERATOR),
        portal_type=payload.get("portal_type", PORTAL_INDIVIDUAL),
        organization_name=payload.get("organization_name"),
        department=payload.get("department"),
        hashed_password="",
        is_active=True,
    )


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_security),
) -> UserRecord:
    """Enforce authenticated user requirement."""
    user = get_current_user_optional(request, credentials)
    if user is not None:
        return user

    if AUTH_OPTIONAL_MODE and "admin@aeromesh.internal" in DEMO_USERS:
        return DEMO_USERS["admin@aeromesh.internal"]

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_roles(*allowed_roles: str) -> Callable:
    """Enforce role-based access control."""
    def role_checker(user: UserRecord = Depends(get_current_user)) -> UserRecord:
        if user.role == ROLE_ADMIN:
            return user
        if user.role in allowed_roles:
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied. Required role: {', '.join(allowed_roles)} (current role: {user.role})",
        )
    return role_checker


def check_mission_access(
    mission_id: str,
    user: Optional[UserRecord] = None,
    mission_owner: Optional[str] = None,
    mission_org: Optional[str] = None,
) -> bool:
    """
    Enforce per-user and per-organization data isolation.
    - Admins and Operators have cross-mission access.
    - If AUTH_OPTIONAL_MODE is True (demo/dev/hackathon), all missions are accessible.
    - Government/Org users can access any mission shared within their organization.
    - Individual and Guest users can access their own missions.
    """
    if os.environ.get("AEROMESH_DISABLE_AUTH") == "1":
        return True

    # Demo mode may admit anonymous visitors, but an authenticated account must
    # still be scoped to its own missions and organization.
    if AUTH_OPTIONAL_MODE and user is None:
        return True

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    if user.role == ROLE_ADMIN:
        return True

    # Government/Org portal sharing
    if user.portal_type == PORTAL_GOV_ORG and user.organization_name and mission_org:
        if user.organization_name.strip().lower() == mission_org.strip().lower():
            return True

    # Direct owner match
    if mission_owner:
        owner_str = str(mission_owner).strip().lower()
        user_identifiers = [
            str(user.id).strip().lower() if user.id else "",
            str(user.email).strip().lower() if user.email else "",
            str(user.full_name).strip().lower() if user.full_name else "",
        ]
        if owner_str in user_identifiers or any(uid and uid in owner_str for uid in user_identifiers):
            return True

    # Default fallback when mission has no explicit owner
    if not mission_owner:
        return True

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Access denied: mission '{mission_id}' is isolated to another account or organization.",
    )


# ============================================================================
# File Upload Validation & Path Traversal Guards
# ============================================================================

def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent directory traversal and injection attacks."""
    if not filename:
        return f"upload_{int(time.time())}.mp4"

    # Normalize separators so Windows paths are handled properly across POSIX and Windows
    normalized = filename.replace("\\", "/")

    # Reject traversal patterns
    if ".." in normalized or "/" in normalized:
        # Extract base name only
        clean_name = Path(normalized).name
        clean_name = clean_name.replace("..", "").replace("/", "")
    else:
        clean_name = normalized

    # Remove dangerous characters
    clean_name = re.sub(r"[^a-zA-Z0-9._-]", "_", clean_name)
    if not clean_name or clean_name.startswith("."):
        clean_name = f"video_{int(time.time())}.mp4"
    return clean_name


def validate_uploaded_file(
    filename: str,
    content: bytes,
    max_size_bytes: int = MAX_UPLOAD_SIZE_BYTES,
    size_bytes: Optional[int] = None,
) -> Tuple[bool, Optional[str]]:
    """Inspect file name, size, extension, and binary signature (magic bytes)."""
    measured_size = len(content) if size_bytes is None else int(size_bytes)
    # 1. Size check
    if measured_size == 0:
        return False, "Uploaded file is empty"
    if measured_size > max_size_bytes:
        max_mb = max_size_bytes // (1024 * 1024)
        return False, f"File size ({measured_size // (1024 * 1024)} MB) exceeds maximum allowed size ({max_mb} MB)"

    # 2. Extension check
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        return False, f"Invalid file extension '{ext}'. Allowed extensions: {', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))}"

    # 3. Path traversal detection in filename
    if ".." in filename or "/" in filename or "\\" in filename:
        return False, "Dangerous path traversal characters detected in filename"

    # 4. Binary signature verification
    # MP4 / MOV: usually contains 'ftyp' within first 16 bytes, or 'moov' / 'mdat'
    # AVI: starts with 'RIFF' and contains 'AVI '
    # MKV: starts with 0x1A 0x45 0xDF 0xA3
    is_valid_signature = False
    head = content[:64]

    if b"ftyp" in head or b"moov" in head or b"mdat" in head or b"wide" in head or b"free" in head:
        is_valid_signature = True
    elif head.startswith(b"RIFF") or b"AVI " in head or b"WAVE" in head:
        is_valid_signature = True
    elif head.startswith(b"\x1a\x45\xdf\xa3") or b"matroska" in head or b"webm" in head:
        is_valid_signature = True
    elif ext in (".mp4", ".mov", ".avi", ".mkv", ".webm") and len(content) >= 16:
        # Check that it is binary (not ASCII text / HTML / scripts)
        text_chars = bytearray({7, 8, 9, 10, 12, 13, 27} | set(range(0x20, 0x100)) - {0x7F})
        is_ascii_text = bool(all(b in text_chars for b in content[:min(len(content), 128)]))
        if not is_ascii_text and not (head.startswith(b"MZ") or head.startswith(b"#!/") or head.startswith(b"<?php") or head.startswith(b"<html")):
            is_valid_signature = True

    if not is_valid_signature:
        return False, "File content does not match a valid video file signature (corrupt or non-video stream)"

    return True, None


# ============================================================================
# In-Memory Rate Limiter (Token Bucket / Sliding Window)
# ============================================================================

class RateLimiter:
    """Thread-safe in-memory rate limiter per client IP address."""

    def __init__(self, requests_per_minute: int = RATE_LIMIT_PER_MINUTE):
        self.rpm = requests_per_minute
        self.window_seconds = 60.0
        self.records: Dict[str, List[float]] = defaultdict(list)
        self.lock = Lock()

    def is_allowed(self, client_ip: str) -> Tuple[bool, int]:
        """Check whether client IP is allowed. Returns (allowed, retry_after_seconds)."""
        now = time.time()
        with self.lock:
            history = self.records[client_ip]
            # Prune records older than 1 window
            cutoff = now - self.window_seconds
            while history and history[0] < cutoff:
                history.pop(0)

            if len(history) < self.rpm:
                history.append(now)
                return True, 0

            # Rate limit exceeded
            oldest = history[0]
            retry_after = max(1, int(self.window_seconds - (now - oldest)))
            return False, retry_after


global_rate_limiter = RateLimiter()


def rate_limit_dependency(request: Request):
    """FastAPI dependency to rate limit sensitive endpoints."""
    client_ip = request.client.host if request.client else "unknown"
    allowed, retry_after = global_rate_limiter.is_allowed(client_ip)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Please retry after {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )


# ============================================================================
# HTTP Security Headers Middleware
# ============================================================================

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Injects essential production HTTP security headers into every response."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response
