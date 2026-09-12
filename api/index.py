import sys
from pathlib import Path

# Add project root to sys.path so backend package is discoverable
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from backend.main import app

# Handler for Vercel Serverless Function
handler = app
