"""
imece — Shard Activation Server
--------------------------------
Serves transformer layer activations AND self-registers with the coordinator.
Persists node_id to disk so restarts reuse the same identity instead of
creating a new node every time.
"""

import os
import sys
import json
import time
import socket
import random
import threading
import requests
from pathlib import Path
from typing import Optional, List, Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# ── Config ─────────────────────────────────────────────────────
COORD_URL   = os.getenv("COORD_URL",             "http://coordination:8000")
NODE_LABEL  = os.getenv("SHARD_NODE_ID",         "unknown-node")
SHARD_PORT  = int(os.getenv("SHARD_PORT",        "8010"))
LAYER_START = int(os.getenv("SHARD_LAYER_START", "0"))
LAYER_END   = int(os.getenv("SHARD_LAYER_END",   "15"))
REGION      = os.getenv("SHARD_REGION",          "US-NY")
MODEL_ID    = os.getenv("SHARD_MODEL_ID",        "meta-llama/Meta-Llama-3-8B")
FLOPS_PER_LAYER = 0.5

# Node identity is persisted here so restarts reuse the same node
IDENTITY_FILE = Path(f"/app/{NODE_LABEL}-identity.json")

_registered_node_id: Optional[str] = None
_stop = threading.Event()


# ── Identity persistence ───────────────────────────────────────

def _load_identity() -> Optional[dict]:
    """Load persisted node identity from disk."""
    try:
        if IDENTITY_FILE.exists():
            data = json.loads(IDENTITY_FILE.read_text())
            return data
    except Exception:
        pass
    return None


def _save_identity(node_id: str, public_key: str) -> None:
    """Persist node identity to disk."""
    try:
        IDENTITY_FILE.parent.mkdir(parents=True, exist_ok=True)
        IDENTITY_FILE.write_text(json.dumps({
            "node_id":    node_id,
            "public_key": public_key,
            "node_label": NODE_LABEL,
        }))
    except Exception:
        pass


# ── Host detection ─────────────────────────────────────────────

def _host() -> str:
    override = os.getenv("SHARD_HOST")
    if override:
        return override
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return socket.gethostname()


# ── Registration ───────────────────────────────────────────────

def _verify_node_exists(node_id: str) -> bool:
    """Check if a node ID still exists and is active in the coordinator."""
    try:
        r = requests.get(f"{COORD_URL}/nodes/{node_id}", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def register_node(max_attempts: int = 30) -> tuple[str, str]:
    """
    Register node and return (node_id, public_key).

    On restart:
      1. Load persisted identity from disk
      2. Verify that node_id still exists in coordinator DB
      3. If yes — reuse it, skip registration
      4. If no — register fresh and save new identity
    """
    # Try to reuse existing identity
    identity = _load_identity()
    if identity:
        node_id    = identity["node_id"]
        public_key = identity["public_key"]
        if _verify_node_exists(node_id):
            return node_id, public_key

    # Fresh registration
    public_key = os.getenv("NODE_PUBLIC_KEY", f"dev-key-{NODE_LABEL}-{int(time.time())}")

    payload = {
        "public_key": public_key,
        "hardware_profile": {
            "gpu_model":      "simulated-gpu",
            "gpu_memory_gb":  0,
            "cpu_model":      "simulated-cpu",
            "cpu_cores":      4,
            "ram_gb":         8,
            "matmul_score":   0.0,
            "memory_score":   0.0,
            "latency_score":  0.0,
            "fingerprint":    NODE_LABEL,
        },
        "availability_start":  "00:00",
        "availability_end":    "23:59",
        "max_gpu_utilization": 0.8,
        "protocol_version":    "0.1",
        "tore4_node_id":       NODE_LABEL,
    }

    for attempt in range(1, max_attempts + 1):
        if _stop.is_set():
            sys.exit(0)
        try:
            r = requests.post(f"{COORD_URL}/nodes/register", json=payload, timeout=5)

            if r.status_code == 201:
                data    = r.json()
                node_id = data.get("id") or data.get("node_id")
                _save_identity(node_id, public_key)
                return node_id, public_key

            if r.status_code == 409:
                # Key collision — generate a new unique key and retry
                public_key = f"dev-key-{NODE_LABEL}-{int(time.time())}"
                payload["public_key"] = public_key
                time.sleep(1)
                continue

        except requests.exceptions.ConnectionError:
            pass
        except Exception:
            pass

        time.sleep(3)

    sys.exit(1)


def assign_region(node_id: str) -> None:
    try:
        requests.post(
            f"{COORD_URL}/grid/nodes/{node_id}/region",
            params={"region": REGION},
            timeout=5,
        )
    except Exception:
        pass


def register_shard(node_id: str, max_attempts: int = 30) -> bool:
    host = _host()
    payload = {
        "node_id":     node_id,
        "model_id":    MODEL_ID,
        "layer_start": LAYER_START,
        "layer_end":   LAYER_END,
        "vram_gb":     0,
        "region":      REGION,
        "host":        host,
        "port":        SHARD_PORT,
        "transports": [{
            "transport": "http",
            "version":   "1.1",
            "port":      SHARD_PORT,
            "priority":  1,
        }],
    }

    for attempt in range(1, max_attempts + 1):
        if _stop.is_set():
            sys.exit(0)
        try:
            r = requests.post(
                f"{COORD_URL}/inference/shards/register",
                json=payload,
                timeout=5,
            )
            if r.status_code == 200:
                return True
        except requests.exceptions.ConnectionError:
            pass
        except Exception:
            pass
        time.sleep(3)

    return False


# ── Heartbeat loops ────────────────────────────────────────────

def _node_heartbeat(node_id: str) -> None:
    while not _stop.is_set():
        try:
            requests.post(f"{COORD_URL}/nodes/{node_id}/heartbeat", timeout=3)
        except Exception:
            pass
        _stop.wait(10)


def _shard_heartbeat(node_id: str) -> None:
    while not _stop.is_set():
        try:
            r = requests.post(
                f"{COORD_URL}/inference/shards/heartbeat/{node_id}",
                timeout=3,
            )
            if r.status_code == 404:
                register_shard(node_id)
        except Exception:
            pass
        _stop.wait(10)


def start_heartbeats(node_id: str) -> None:
    threading.Thread(target=_node_heartbeat,  args=(node_id,), daemon=True).start()
    threading.Thread(target=_shard_heartbeat, args=(node_id,), daemon=True).start()


# ── Bootstrap ──────────────────────────────────────────────────

def _bootstrap() -> None:
    global _registered_node_id
    node_id, _ = register_node()
    assign_region(node_id)
    if not register_shard(node_id):
        sys.exit(1)
    _registered_node_id = node_id
    start_heartbeats(node_id)


# ── Simulation helpers ─────────────────────────────────────────

def _tokenize(text: str) -> List[int]:
    return [abs(hash(t)) % 50000 for t in text.strip().split()]

def _detokenize(ids: List[int]) -> str:
    words = ["the", "a", "is", "of", "and", "to", "in", "that",
             "it", "was", "for", "on", "are", "as", "with", "they",
             "Paris", "France", "model", "layer", "token", "output"]
    random.seed(sum(ids) if ids else 42)
    return " ".join(random.choice(words) for _ in range(len(ids)))

def _simulate_activations(input_ids: List[int]) -> List[float]:
    random.seed(sum(input_ids) + LAYER_START * 1000 + LAYER_END)
    return [random.gauss(0, 1) for _ in range(64)]

def _flops(token_count: int) -> float:
    return round(FLOPS_PER_LAYER * (LAYER_END - LAYER_START + 1) * token_count, 4)


# ── Request / Response models ───────────────────────────────────

class TokenizeRequest(BaseModel):
    prompt:     str
    request_id: str = ""
    model_id:   str = ""

class TokenizeResponse(BaseModel):
    input_ids:   List[int]
    token_count: int
    node_id:     str

class ForwardRequest(BaseModel):
    input_ids:       Optional[List[int]]   = None
    activations:     Optional[List[float]] = None
    past_key_values: Optional[Any]         = None
    is_first_shard:  bool                  = False
    is_last_shard:   bool                  = False
    max_new_tokens:  int                   = 0
    temperature:     float                 = 0.7
    request_id:      str                   = ""
    model_id:        str                   = ""

class ForwardResponse(BaseModel):
    activations:     Optional[List[float]] = None
    past_key_values: Optional[Any]         = None
    output_ids:      Optional[List[int]]   = None
    text:            Optional[str]         = None
    flops_delivered: float                 = 0.0
    node_id:         str                   = ""
    layer_start:     int                   = LAYER_START
    layer_end:       int                   = LAYER_END
    latency_ms:      float                 = 0.0


# ── App ─────────────────────────────────────────────────────────

app = FastAPI(title="imece — Shard Activation Server", version="0.1.0")

@app.on_event("startup")
def on_startup():
    threading.Thread(target=_bootstrap, daemon=True).start()

@app.get("/")
def root():
    return {
        "name":    "imece Shard Activation Server",
        "node_id": _registered_node_id or "registering...",
        "status":  "ready" if _registered_node_id else "bootstrapping",
        "layers":  f"{LAYER_START}-{LAYER_END}",
        "port":    SHARD_PORT,
    }

@app.get("/health")
def health():
    return {
        "status":      "ready" if _registered_node_id else "bootstrapping",
        "node_id":     _registered_node_id or "registering...",
        "layer_start": LAYER_START,
        "layer_end":   LAYER_END,
    }

@app.get("/models")
def list_models():
    return {"models": [
        {"id": MODEL_ID,     "flops_per_token": 0.5,  "precision": "fp16"},
        {"id": "llama3-8b",  "flops_per_token": 0.5,  "precision": "fp16"},
        {"id": "mistral-7b", "flops_per_token": 0.45, "precision": "fp16"},
    ]}

@app.post("/shard/tokenize", response_model=TokenizeResponse)
def tokenize(req: TokenizeRequest):
    if not req.prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")
    input_ids = _tokenize(req.prompt)
    return TokenizeResponse(
        input_ids=   input_ids,
        token_count= len(input_ids),
        node_id=     _registered_node_id or NODE_LABEL,
    )

@app.post("/shard/forward", response_model=ForwardResponse)
def forward(req: ForwardRequest):
    import time as _time
    start     = _time.perf_counter()
    input_ids = req.input_ids or []

    if req.is_last_shard and req.max_new_tokens > 0:
        generated_ids = [
            abs(hash(f"gen_{i}_{sum(input_ids)}")) % 50000
            for i in range(req.max_new_tokens)
        ]
        return ForwardResponse(
            output_ids=      generated_ids,
            text=            _detokenize(generated_ids),
            flops_delivered= _flops(len(input_ids) + req.max_new_tokens),
            node_id=         _registered_node_id or NODE_LABEL,
            latency_ms=      round((_time.perf_counter() - start) * 1000, 2),
        )

    return ForwardResponse(
        activations=     _simulate_activations(input_ids),
        flops_delivered= _flops(max(len(input_ids), 1)),
        node_id=         _registered_node_id or NODE_LABEL,
        latency_ms=      round((_time.perf_counter() - start) * 1000, 2),
    )