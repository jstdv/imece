"""
Shard Registry
--------------
Maintains the registry of which contributor nodes are serving
which layers of which models. Enables the shard scheduler to
find complete inference pipelines across volunteer nodes.

A shard is defined as a contiguous range of transformer layers
for a specific model hosted by a specific node.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict
import threading

from coordination.models.node import NodeStatus
from coordination.core.quarantine import is_in_quarantine


# ───────────────────────────────────────────────────────────────
# Data structures
# ───────────────────────────────────────────────────────────────

@dataclass
class TransportDeclaration:
    transport: str
    version:   str = ""
    port:      int = 0
    priority:  int = 1


@dataclass
class ModelConfig:
    model_id:         str
    friendly_name:    str
    total_layers:     int
    hidden_size:      int
    flops_per_layer:  float
    min_nodes:        int = 2
    optimal_nodes:    int = 4


@dataclass
class ShardRegistration:
    node_id:        str
    model_id:       str
    layer_start:    int
    layer_end:      int
    vram_gb:        float
    region:         str
    host:           str
    port:           int
    registered_at:  datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_heartbeat: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    is_online:      bool = True
    requests_served: int = 0
    flops_delivered: float = 0.0
    transports:      list = field(default_factory=lambda: [
        TransportDeclaration(transport="http", priority=1)
    ])

    @property
    def layer_count(self) -> int:
        return self.layer_end - self.layer_start + 1

    @property
    def covers(self) -> range:
        return range(self.layer_start, self.layer_end + 1)


@dataclass
class InferencePipeline:
    model_id:   str
    shards:     List[ShardRegistration]
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def is_complete(self) -> bool:
        if not self.shards:
            return False
        sorted_shards = sorted(self.shards, key=lambda s: s.layer_start)
        if sorted_shards[0].layer_start != 0:
            return False
        for i in range(len(sorted_shards) - 1):
            if sorted_shards[i].layer_end + 1 != sorted_shards[i+1].layer_start:
                return False
        return True

    @property
    def node_ids(self) -> List[str]:
        return [s.node_id for s in self.shards]

    @property
    def total_flops_per_token(self) -> float:
        if not self.shards:
            return 0.0
        return sum(s.layer_count for s in self.shards)


# ───────────────────────────────────────────────────────────────
# Registry
# ───────────────────────────────────────────────────────────────

class ShardRegistry:
    """
    Central registry of all active shard registrations.
    Thread-safe — multiple requests may query simultaneously.
    """

    HEARTBEAT_TIMEOUT = 120  # seconds

    def __init__(self):
        self._shards: Dict[str, ShardRegistration] = {}
        self._models: Dict[str, ModelConfig] = {}
        self._lock = threading.RLock()

        # Node lookup callback (injected by coordination layer)
        self._node_lookup = None

        # Runtime metrics: node_id → metrics dict
        self._runtime_metrics: Dict[str, dict] = {}

        self._register_default_models()

    # ───────────────────────────────────────────────────────────
    # Node lookup
    # ───────────────────────────────────────────────────────────

    def register_node_lookup(self, fn):
        self._node_lookup = fn

    # ───────────────────────────────────────────────────────────
    # Model registration
    # ───────────────────────────────────────────────────────────

    def register_model(self, config: ModelConfig):
        with self._lock:
            self._models[config.model_id] = config
            self._models[config.friendly_name] = config

    def get_model(self, model_id: str) -> Optional[ModelConfig]:
        with self._lock:
            return self._models.get(model_id)

    def list_models(self) -> List[ModelConfig]:
        with self._lock:
            seen = set()
            result = []
            for m in self._models.values():
                if m.model_id not in seen:
                    seen.add(m.model_id)
                    result.append(m)
            return result

    # ───────────────────────────────────────────────────────────
    # Shard registration
    # ───────────────────────────────────────────────────────────

    def register_shard(self, shard: ShardRegistration) -> str:
        shard_id = f"{shard.node_id}:{shard.model_id}:{shard.layer_start}-{shard.layer_end}"
        with self._lock:
            if shard.model_id not in self._models:
                raise ValueError(f"Unknown model: {shard.model_id}")

            model = self._models[shard.model_id]

            if shard.layer_start < 0 or shard.layer_end >= model.total_layers:
                raise ValueError(
                    f"Invalid layer range [{shard.layer_start}, {shard.layer_end}] "
                    f"for model with {model.total_layers} layers."
                )
            if shard.layer_start > shard.layer_end:
                raise ValueError("layer_start must be <= layer_end.")

            self._shards[shard_id] = shard

        return shard_id

    def deregister_shard(self, node_id: str, model_id: str):
        with self._lock:
            keys = [k for k, s in self._shards.items()
                    if s.node_id == node_id and s.model_id == model_id]
            for k in keys:
                del self._shards[k]

    # ───────────────────────────────────────────────────────────
    # Heartbeat & accounting
    # ───────────────────────────────────────────────────────────

    def heartbeat(self, node_id: str):
        now = datetime.now(timezone.utc)
        with self._lock:
            for shard in self._shards.values():
                if shard.node_id == node_id:
                    shard.last_heartbeat = now
                    shard.is_online = True

    def mark_offline(self, node_id: str):
        with self._lock:
            for shard in self._shards.values():
                if shard.node_id == node_id:
                    shard.is_online = False

    def record_request(self, node_id: str, model_id: str, flops: float):
        with self._lock:
            for shard in self._shards.values():
                if shard.node_id == node_id and shard.model_id == model_id:
                    shard.requests_served += 1
                    shard.flops_delivered += flops

    # ───────────────────────────────────────────────────────────
    # Runtime metrics
    # ───────────────────────────────────────────────────────────

    def record_latency(self, node_id: str, latency_ms: float):
        now = datetime.now(timezone.utc)
        with self._lock:
            m = self._runtime_metrics.setdefault(node_id, {})
            m["latency_ms"] = latency_ms
            m["updated_at"] = now

    def record_queue_depth(self, node_id: str, depth: int):
        now = datetime.now(timezone.utc)
        with self._lock:
            m = self._runtime_metrics.setdefault(node_id, {})
            m["queue_depth"] = depth
            m["updated_at"] = now

    def record_gpu_utilization(self, node_id: str, util: float):
        now = datetime.now(timezone.utc)
        with self._lock:
            m = self._runtime_metrics.setdefault(node_id, {})
            m["gpu_utilization"] = util
            m["updated_at"] = now

    def get_runtime_metrics(self, node_id: str) -> Optional[dict]:
        with self._lock:
            m = self._runtime_metrics.get(node_id)
            return dict(m) if m else None

    # ───────────────────────────────────────────────────────────
    # Query
    # ───────────────────────────────────────────────────────────

    def get_online_shards(self, model_id: str, include_metrics: bool = False) -> List[ShardRegistration]:
            timeout = timedelta(seconds=self.HEARTBEAT_TIMEOUT)
            now     = datetime.now(timezone.utc)

            model    = self._models.get(model_id)
            full_id  = model.model_id      if model else model_id
            friendly = model.friendly_name if model else model_id

            with self._lock:
                shards = []
                for s in self._shards.values():
                    # Model ID must match full ID or friendly name
                    if s.model_id not in (full_id, friendly):
                        continue

                    # Must have a heartbeat timestamp
                    if not s.last_heartbeat:
                        continue

                    # Make heartbeat timezone-aware if it isn't
                    hb = s.last_heartbeat
                    if hb.tzinfo is None:
                        hb = hb.replace(tzinfo=timezone.utc)

                    # Must not have timed out
                    if (now - hb) >= timeout:
                        s.is_online = False
                        continue

                    # Must be marked online
                    if not s.is_online:
                        continue

                    # If node lookup is wired up, validate node status
                    # If not wired up, allow the shard through (backwards compatible)
                    if self._node_lookup:
                        node = self._node_lookup(s.node_id)
                        if not node:
                            continue
                        if node.status != NodeStatus.ACTIVE.value:
                            continue
                        if is_in_quarantine(node.quarantine_until):
                            continue

                    shards.append(s)

                shards_sorted = sorted(shards, key=lambda s: s.layer_start)

                if not include_metrics:
                    return shards_sorted

                for s in shards_sorted:
                    s.runtime_metrics = self._runtime_metrics.get(s.node_id)
                return shards_sorted
    # ───────────────────────────────────────────────────────────
    # Misc
    # ───────────────────────────────────────────────────────────

    def get_node_shards(self, node_id: str) -> List[ShardRegistration]:
        with self._lock:
            return [s for s in self._shards.values() if s.node_id == node_id]

    def get_registry_summary(self) -> dict:
        with self._lock:
            summary = {}
            for shard in self._shards.values():
                mid = shard.model_id
                if mid not in summary:
                    summary[mid] = {"online": 0, "offline": 0, "layers_covered": set()}
                if shard.is_online:
                    summary[mid]["online"] += 1
                else:
                    summary[mid]["offline"] += 1
                for l in shard.covers:
                    summary[mid]["layers_covered"].add(l)

            for mid in summary:
                summary[mid]["layers_covered"] = len(summary[mid]["layers_covered"])
                model = self._models.get(mid)
                summary[mid]["total_layers"] = model.total_layers if model else "unknown"

            return summary

    def check_stale_shards(self):
        timeout = timedelta(seconds=self.HEARTBEAT_TIMEOUT)
        now = datetime.now(timezone.utc)
        with self._lock:
            for shard in self._shards.values():
                if shard.is_online and (now - shard.last_heartbeat) > timeout:
                    shard.is_online = False

    # ───────────────────────────────────────────────────────────
    # Default models
    # ───────────────────────────────────────────────────────────

    def _register_default_models(self):
        defaults = [
            ModelConfig(
                model_id="meta-llama/Meta-Llama-3-8B",
                friendly_name="llama3-8b",
                total_layers=32,
                hidden_size=4096,
                flops_per_layer=0.42,
                min_nodes=1,
                optimal_nodes=2,
            ),
            ModelConfig(
                model_id="meta-llama/Meta-Llama-3-70B",
                friendly_name="llama3-70b",
                total_layers=80,
                hidden_size=8192,
                flops_per_layer=1.68,
                min_nodes=2,
                optimal_nodes=4,
            ),
            ModelConfig(
                model_id="mistralai/Mistral-7B-v0.1",
                friendly_name="mistral-7b",
                total_layers=32,
                hidden_size=4096,
                flops_per_layer=0.37,
                min_nodes=1,
                optimal_nodes=2,
            ),
            ModelConfig(
                model_id="mistralai/Mixtral-8x7B-v0.1",
                friendly_name="mixtral-8x7b",
                total_layers=32,
                hidden_size=4096,
                flops_per_layer=0.74,
                min_nodes=2,
                optimal_nodes=4,
            ),
        ]
        for model in defaults:
            self.register_model(model)


# Singleton instance
registry = ShardRegistry()
