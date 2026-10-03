import os
import subprocess
import sys
import time
import uuid
import httpx

tools_dir = os.path.abspath("tools")
pgsql_bin = os.path.join(tools_dir, "pgsql", "bin")
data_dir = os.path.join(tools_dir, "pgsql_data")
port = 5433
db_url_psycopg = f"postgresql+psycopg://postgres@127.0.0.1:{port}/aeromesh"
db_url_render_style = f"postgresql://postgres@127.0.0.1:{port}/aeromesh"

print("\n" + "=" * 80)
print("AEROMESH PERSISTENCE & POSTGRESQL RESTORATION VERIFICATION")
print("=" * 80)

# 1. Initialize cluster if not already initialized
if not os.path.exists(os.path.join(data_dir, "PG_VERSION")):
    print("[PostgreSQL] Initializing PostgreSQL cluster in tools/pgsql_data...")
    initdb_cmd = [
        os.path.join(pgsql_bin, "initdb.exe"),
        "-U", "postgres",
        "-A", "trust",
        "-E", "UTF8",
        data_dir,
    ]
    res = subprocess.run(initdb_cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[PostgreSQL] initdb error: {res.stderr}")
        sys.exit(1)
    print("[PostgreSQL] Cluster initialized successfully.")

# 2. Start PostgreSQL daemon on port 5433
print(f"[PostgreSQL] Starting PostgreSQL daemon on port {port}...")
pg_proc = subprocess.Popen(
    [os.path.join(pgsql_bin, "postgres.exe"), "-D", data_dir, "-p", str(port)],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)

# Wait for postgres to be ready
connected = False
for _ in range(30):
    time.sleep(0.5)
    try:
        import psycopg
        conn = psycopg.connect(f"postgresql://postgres@127.0.0.1:{port}/postgres", connect_timeout=1)
        conn.close()
        connected = True
        break
    except Exception:
        pass

if not connected:
    print("[PostgreSQL] Failed to connect to PostgreSQL daemon.")
    pg_proc.kill()
    sys.exit(1)
print(f"[PostgreSQL] PostgreSQL daemon is listening on port {port}.")

# 3. Create database if needed
createdb_cmd = [
    os.path.join(pgsql_bin, "createdb.exe"),
    "-h", "127.0.0.1",
    "-p", str(port),
    "-U", "postgres",
    "aeromesh",
]
subprocess.run(createdb_cmd, capture_output=True)

# 4. Run Alembic migrations
print("[PostgreSQL] Executing Alembic migrations against PostgreSQL...")
env = os.environ.copy()
env["DATABASE_URL"] = db_url_psycopg
env["AEROMESH_POSTGIS"] = "0"
alembic_cmd = [
    sys.executable,
    "-m", "alembic",
    "upgrade", "head",
]
alembic_res = subprocess.run(alembic_cmd, env=env, capture_output=True, text=True)
print(f"[PostgreSQL] Alembic migrations result: returncode={alembic_res.returncode}")
if alembic_res.returncode != 0:
    print(f"[PostgreSQL] Migration stdout: {alembic_res.stdout}")
    print(f"[PostgreSQL] Migration stderr: {alembic_res.stderr}")

# 5. Start Server #1 with Render-style postgresql:// URL and ENVIRONMENT=production
print("\n[Server 1] Launching uvicorn with ENVIRONMENT=production and DATABASE_URL...")
server_env = os.environ.copy()
server_env["ENVIRONMENT"] = "production"
server_env["DATABASE_URL"] = db_url_render_style
server_env["PORT"] = "8000"
server_env["PIPELINE_ENABLED"] = "false"
server_env["AEROMESH_POSTGIS"] = "0"

server_proc1 = None
server_proc2 = None
try:
    server_proc1 = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", "8000", "--host", "127.0.0.1"],
        env=server_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    client = httpx.Client(base_url="http://127.0.0.1:8000", timeout=10.0)

    def wait_for_server(proc, label):
        for i in range(25):
            if proc.poll() is not None:
                stdout, stderr = proc.communicate()
                raise RuntimeError(f"{label} died unexpectedly with code {proc.returncode}!\nStdout: {stdout}\nStderr: {stderr}")
            try:
                res = client.get("/api/v1/health")
                if res.status_code == 200:
                    return res
            except Exception:
                pass
            time.sleep(0.5)
        stdout, stderr = proc.communicate(timeout=2)
        raise RuntimeError(f"Timed out waiting for {label} to start!\nStdout: {stdout}\nStderr: {stderr}")

    health_res = wait_for_server(server_proc1, "Server 1")
    print(f"[Server 1] /api/v1/health response: {health_res.json()}")
    assert health_res.status_code == 200
    assert health_res.json().get("db") == "postgres", f"Expected db: postgres, got {health_res.json().get('db')}"

    # Register user and create mission on Server 1
    test_email = f"postgres_user_{uuid.uuid4().hex[:8]}@aeromesh.org"
    test_pass = "SecurePass1234!"
    reg_res = client.post("/api/v1/auth/register", json={"email": test_email, "password": test_pass, "role": "operator"})
    assert reg_res.status_code in (200, 201), f"Registration failed ({reg_res.status_code}): {reg_res.text}"
    token = reg_res.json().get("access_token")

    mission_res = client.post("/api/v1/missions", params={"name": "Persistent Mission Alpha"}, headers={"Authorization": f"Bearer {token}"})
    assert mission_res.status_code == 200
    mission_id = mission_res.json()["mission"]["id"]
    print(f"[Server 1] Created user {test_email} and mission ID: {mission_id}")

    # 6. Shut down Server #1 (Simulate Restart)
    print("\n[Restart] Terminating Server 1 process...")
    server_proc1.terminate()
    server_proc1.wait(timeout=5)
    server_proc1 = None

    # 7. Start Server #2 (Post-Restart)
    print("[Server 2] Starting Server 2 process on same PostgreSQL cluster...")
    server_proc2 = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", "8000", "--host", "127.0.0.1"],
        env=server_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    # Check health on Server 2
    health_res2 = wait_for_server(server_proc2, "Server 2")
    print(f"[Server 2] /api/v1/health response: {health_res2.json()}")
    assert health_res2.json().get("db") == "postgres"

    # Authenticate with existing credentials on Server 2
    login_res = client.post("/api/v1/auth/login", json={"email": test_email, "password": test_pass})
    assert login_res.status_code == 200, f"Login failed: {login_res.text}"
    new_token = login_res.json().get("access_token")
    print(f"[Server 2] Account authentication succeeded! User survived restart.")

    # Retrieve mission on Server 2
    get_mission_res = client.get(f"/api/v1/missions/{mission_id}", headers={"Authorization": f"Bearer {new_token}"})
    assert get_mission_res.status_code == 200
    assert get_mission_res.json()["mission"]["name"] == "Persistent Mission Alpha"
    print(f"[Server 2] Mission '{get_mission_res.json()['mission']['name']}' retrieved successfully! Mission survived restart.")

    # 8. Run smoke_prod.py against the running production server
    print("\n[Smoke Test] Running scripts/smoke_prod.py against production server...")
    smoke_res = subprocess.run(
        [sys.executable, "scripts/smoke_prod.py", "http://127.0.0.1:8000"],
        text=True,
    )
    assert smoke_res.returncode == 0, "Smoke test suite encountered failures!"

    print("\n" + "=" * 80)
    print("PERSISTENCE & SMOKE VERIFICATION COMPLETED SUCCESSFULLY [PASS]")
    print("=" * 80 + "\n")
finally:
    if server_proc1 and server_proc1.poll() is None:
        server_proc1.terminate()
        server_proc1.wait(timeout=5)
    if server_proc2 and server_proc2.poll() is None:
        server_proc2.terminate()
        server_proc2.wait(timeout=5)
    if pg_proc and pg_proc.poll() is None:
        pg_proc.terminate()
        pg_proc.wait(timeout=5)
