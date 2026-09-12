import sys
from pathlib import Path

# Add backend directory and parent workspace root to sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
workspace_dir = backend_dir.parent
if str(workspace_dir) not in sys.path:
    sys.path.insert(0, str(workspace_dir))

from backend.main import app

# Handler for Vercel Serverless Function / Service
handler = app
