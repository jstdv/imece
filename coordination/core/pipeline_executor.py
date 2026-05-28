"""
Pipeline Executor
-----------------
Orchestrates an inference request across a complete shard pipeline.

Flow:
1. Receive tokenized input from the inference API
2. Send to the first shard node (layers 0..N)
3. First node processes layers, returns activations
4. Pass activations to next node
5. Continue until final node returns output logits
6. Decode output tokens
7. Report FLOPs per node to coordination layer for token issuance
"""

import time
import requests
import json
from typing import Optional
from coordination.core.shard_registry import InferencePipeline, ShardRegistration
from coordination.core.shard_registry import registry


class PipelineExecutionError(Exception):
    pass


class PipelineExecutor:
    """
    Executes an inference request across a distributed shard pipeline.
    Handles activation passing, timeout management, and FLOP accounting.
    """

    # Timeout per shard node in seconds
    NODE_TIMEOUT = 30

    # Global timeout for the entire pipeline in seconds
    PIPELINE_TIMEOUT = 120

    def execute(
        self,
        pipeline:       InferencePipeline,
        prompt:         str,
        max_new_tokens: int = 256,
        temperature:    float = 0.7,
        request_id:     str = "",
        pipeline_timeout: Optional[float] = None,
    ) -> dict:
        """
        Execute a full inference request across the pipeline.

        Returns:
            {
                "text":            generated text,
                "tokens":          number of output tokens,
                "flops_per_node":  {node_id: flops},
                "latency_ms":      total latency,
                "node_latencies":  {node_id: latency_ms},
                "pipeline":        list of node_ids used,
            }

        Raises PipelineExecutionError if any node fails or times out.
        """
        if not pipeline.is_complete:
            raise PipelineExecutionError("Incomplete pipeline — cannot execute.")

        start_time = time.perf_counter()
        timeout_budget = pipeline_timeout or self.PIPELINE_TIMEOUT
        deadline = start_time + timeout_budget

        # Step 1: Tokenize input at the first node
        first_shard = pipeline.shards[0]
        tokenize_result, _ = self._call_node(
            shard=    first_shard,
            endpoint= "tokenize",
            payload=  {"prompt": prompt, "request_id": request_id, "model_id": pipeline.model_id},
            deadline= deadline,
        )
        if not tokenize_result:
            raise PipelineExecutionError(
                f"Tokenization failed at node {first_shard.node_id}"
            )

        input_ids  = tokenize_result["input_ids"]
        input_len  = len(input_ids)

        # Step 2: Forward pass through each shard
        flops_per_node   = {}
        node_latencies   = {}
        current_payload = {
            "input_ids":       input_ids,
            "past_key_values": None,
            "is_first_shard":  True,
            "request_id":      request_id,
            "model_id":        pipeline.model_id,
        }

        for i, shard in enumerate(pipeline.shards):
            # Check global deadline before each hop
            now = time.perf_counter()
            if now >= deadline:
                registry.mark_offline(shard.node_id)
                raise PipelineExecutionError(
                    f"Global pipeline timeout exceeded before node {shard.node_id}"
                )

            is_last = (i == len(pipeline.shards) - 1)

            result, node_latency_ms = self._call_node(
                shard=    shard,
                endpoint= "forward",
                payload=  {
                    **current_payload,
                    "max_new_tokens": max_new_tokens if is_last else 0,
                    "temperature":    temperature,
                    "is_last_shard":  is_last,
                },
                deadline= deadline,
            )

            if not result:
                registry.mark_offline(shard.node_id)
                raise PipelineExecutionError(
                    f"Forward pass failed at node {shard.node_id} "
                    f"(layers {shard.layer_start}-{shard.layer_end})"
                )

            node_latencies[shard.node_id] = node_latency_ms

            # Accumulate FLOPs for this node
            flops_per_node[shard.node_id] = result.get("flops_delivered", 0.0)

            # Record in registry (FLOPs + latency hook)
            registry.record_request(
                shard.node_id,
                shard.model_id,
                flops_per_node[shard.node_id],
            )
            # Optional: if you add this later
            # registry.record_latency(shard.node_id, node_latency_ms)

            if is_last:
                output_ids  = result.get("output_ids", [])
                output_text = result.get("text", "")
            else:
                current_payload = {
                    "activations":     result.get("activations"),
                    "past_key_values": result.get("past_key_values"),
                    "input_ids":       input_ids,
                    "is_first_shard":  False,
                }

        total_latency_ms = (time.perf_counter() - start_time) * 1000

        return {
            "text":           output_text,
            "tokens":         len(output_ids) if output_ids else 0,
            "input_tokens":   input_len,
            "flops_per_node": flops_per_node,
            "total_flops":    sum(flops_per_node.values()),
            "latency_ms":     round(total_latency_ms, 2),
            "node_latencies": {k: round(v, 2) for k, v in node_latencies.items()},
            "pipeline":       pipeline.node_ids,
        }

    def _call_node(
        self,
        shard:    ShardRegistration,
        endpoint: str,
        payload:  dict,
        deadline: Optional[float] = None,
    ) -> tuple[Optional[dict], float]:
        """
        Call an activation server endpoint on a shard node.
        Returns (parsed_response_or_None, latency_ms).
        Enforces both per-node timeout and global deadline.
        """
        url = f"http://{shard.host}:{shard.port}/shard/{endpoint}"

        # Compute effective timeout respecting global deadline
        per_node_timeout = self.NODE_TIMEOUT
        if deadline is not None:
            now = time.perf_counter()
            remaining = deadline - now
            if remaining <= 0:
                return None, 0.0
            per_node_timeout = min(per_node_timeout, remaining)

        start = time.perf_counter()
        try:
            resp = requests.post(
                url,
                json=    payload,
                timeout= per_node_timeout,
            )
            latency_ms = (time.perf_counter() - start) * 1000
            if resp.status_code == 200:
                return resp.json(), latency_ms
            return None, latency_ms
        except requests.exceptions.Timeout:
            return None, (time.perf_counter() - start) * 1000
        except requests.exceptions.ConnectionError:
            return None, (time.perf_counter() - start) * 1000
        except Exception:
            return None, (time.perf_counter() - start) * 1000


# Singleton instance
pipeline_executor = PipelineExecutor()
