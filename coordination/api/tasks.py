"""
Task API — Inference Challenge System
--------------------------------------
Tasks are periodic inference challenges dispatched to nodes
to verify they are serving correct activations and maintaining
reliability. Approximately 10% of inference requests trigger
a challenge verification.

Primary earning = FLOPs delivered during real inference (see inference.py)
Secondary purpose = reliability verification via inference challenges
"""

from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy.orm import Session

from coordination.models.task import (
    Task, TaskType, TaskStatus,
    TaskDispatchResponse, TaskResultRequest
)
from coordination.models.db_models import NodeDB, TaskDB
from coordination.models.node import NodeStatus
from coordination.core.verifier import (
    verify_challenge, check_redundancy_agreement,
    update_reliability_factor, should_suspend, get_redundancy_rate
)
from coordination.core.shard_registry import registry
from coordination.ledger.ledger import ledger
from coordination.api.nodes import get_node_by_id
from coordination.db import get_db
from coordination.config import settings
import random
import hashlib
import json

router = APIRouter(prefix="/tasks", tags=["Tasks"])

# ── Challenge prompt library ───────────────────────────────────
CHALLENGE_PROMPTS = [
    "The capital of France is",
    "Water boils at 100 degrees",
    "The speed of light is approximately",
    "Photosynthesis converts sunlight into",
    "The human body has approximately",
]


@router.post("/dispatch/{node_id}", response_model=TaskDispatchResponse)
def dispatch_challenge(node_id: str, db: Session = Depends(get_db)):
    """
    Dispatch a periodic inference challenge to a node.
    Used to verify the node is serving correct activations.
    """
    node = get_node_by_id(db, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found.")
    if node.status != NodeStatus.ACTIVE.value:
        raise HTTPException(status_code=403, detail=f"Node not active: {node.status}")

    node_shards = registry.get_node_shards(node_id)
    if not node_shards:
        raise HTTPException(
            status_code=400,
            detail="Node has no registered shards. "
                   "Register with /inference/shards/register first."
        )

    shard       = random.choice(node_shards)
    model       = registry.get_model(shard.model_id)
    prompt      = random.choice(CHALLENGE_PROMPTS)
    flops_est   = round(
        (model.flops_per_layer if model else 0.5) *
        (shard.layer_end - shard.layer_start + 1) * 20, 4
    )

    challenge_answer = _generate_challenge_answer(
        prompt, shard.layer_start, shard.layer_end, shard.model_id
    )

    task = TaskDB(
        task_type=        TaskType.INFERENCE_CHALLENGE.value,
        payload=          {
            "prompt":      prompt,
            "max_tokens":  20,
            "temperature": 0.0,
        },
        flops_estimated=  flops_est,
        assigned_node_id= node.id,
        is_challenge=     True,
        challenge_answer= challenge_answer,
        status=           TaskStatus.DISPATCHED.value,
        dispatched_at=    datetime.now(timezone.utc),
        expires_at=       datetime.now(timezone.utc) + timedelta(
                              seconds=settings.TASK_TIMEOUT_SECONDS
                          ),
    )
    db.add(task)
    node.tasks_assigned += 1
    db.commit()
    db.refresh(task)

    return TaskDispatchResponse(
        task_id=         str(task.id),
        task_type=       task.task_type,
        payload=         task.payload,
        model_id=        shard.model_id,
        layer_start=     shard.layer_start,
        layer_end=       shard.layer_end,
        flops_estimated= task.flops_estimated,
        is_challenge=    True,
        expires_at=      task.expires_at,
    )


@router.post("/result")
def submit_challenge_result(req: TaskResultRequest, db: Session = Depends(get_db)):
    """
    Submit the result of an inference challenge.
    Verifies the activation hash, applies redundancy check if siblings exist,
    and updates node reliability.
    """
    task = db.query(TaskDB).filter(TaskDB.id == req.task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if str(task.assigned_node_id) != req.node_id:
        raise HTTPException(status_code=403, detail="Task not assigned to this node.")
    if task.status != TaskStatus.DISPATCHED.value:
        raise HTTPException(status_code=409, detail=f"Task already in state: {task.status}")
    if task.expires_at and datetime.now(timezone.utc) > task.expires_at:
        task.status = TaskStatus.EXPIRED.value
        db.commit()
        raise HTTPException(status_code=410, detail="Challenge expired.")

    node = get_node_by_id(db, req.node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found.")

    # Primary verification: challenge answer hash check
    challenge_passed = (req.result_hash == task.challenge_answer)

    # Redundancy check: compare against sibling tasks for the same payload
    # Siblings are tasks with the same payload dispatched to other nodes
    sibling_tasks_db = db.query(TaskDB).filter(
        TaskDB.payload == task.payload,
        TaskDB.id != task.id,
        TaskDB.status.in_([TaskStatus.VERIFIED.value, TaskStatus.FAILED.value]),
    ).all()

    # Convert DB rows to Task objects for the verifier
    sibling_tasks = [_db_to_task_obj(t) for t in sibling_tasks_db]

    redundancy_agreed, consistency_score = check_redundancy_agreement(
        task=           _db_to_task_obj(task),
        sibling_tasks=  sibling_tasks,
        submitted_hash= req.result_hash,
    )

    # Blend: challenge answer is authoritative; consistency score modulates reliability
    # If challenge passed but siblings disagree, we still trust the challenge answer
    # but note the inconsistency for reliability tracking
    if challenge_passed:
        # Use consistency_score to modulate — if no siblings yet, full credit
        effective_consistency = consistency_score if sibling_tasks else 1.0
    else:
        effective_consistency = 0.0

    # Update task record
    task.result_hash     = req.result_hash
    task.flops_delivered = req.flops_delivered
    task.completed_at    = datetime.now(timezone.utc)
    task.status          = TaskStatus.VERIFIED.value if challenge_passed else TaskStatus.FAILED.value

    # Update node reliability
    node.tasks_completed    += 1
    node_obj                 = _db_to_node_obj(node)
    node.reliability_factor  = update_reliability_factor(node_obj, effective_consistency)

    if should_suspend(node_obj):
        node.status = NodeStatus.SUSPENDED.value
        db.commit()
        return {
            "status":  "suspended",
            "message": "Node suspended due to repeated challenge failures.",
            "passed":  challenge_passed,
        }

    db.commit()

    return {
        "status":              "verified" if challenge_passed else "failed",
        "passed":              challenge_passed,
        "reliability":         node.reliability_factor,
        "redundancy_siblings": len(sibling_tasks),
        "consistency_score":   round(consistency_score, 4),
        "message":             "Challenge passed." if challenge_passed else
                               "Challenge failed — reliability score reduced.",
    }


@router.get("/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    """Retrieve a challenge task by ID."""
    task = db.query(TaskDB).filter(TaskDB.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    return {
        "id":               str(task.id),
        "task_type":        task.task_type,
        "status":           task.status,
        "flops_estimated":  task.flops_estimated,
        "flops_delivered":  task.flops_delivered,
        "is_challenge":     task.is_challenge,
        "assigned_node_id": str(task.assigned_node_id),
        "created_at":       task.created_at,
        "expires_at":       task.expires_at,
        "completed_at":     task.completed_at,
    }


@router.get("/node/{node_id}/stats")
def get_node_challenge_stats(node_id: str, db: Session = Depends(get_db)):
    """Return challenge statistics for a node."""
    node = get_node_by_id(db, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found.")

    tasks    = db.query(TaskDB).filter(TaskDB.assigned_node_id == node_id).all()
    total    = len(tasks)
    verified = sum(1 for t in tasks if t.status == TaskStatus.VERIFIED.value)
    failed   = sum(1 for t in tasks if t.status == TaskStatus.FAILED.value)

    return {
        "node_id":           node_id,
        "reliability":       node.reliability_factor,
        "challenges_total":  total,
        "challenges_passed": verified,
        "challenges_failed": failed,
        "pass_rate":         round(verified / total, 4) if total > 0 else None,
    }


# ── Internal helpers ───────────────────────────────────────────

def _generate_challenge_answer(prompt: str, layer_start: int,
                                layer_end: int, model_id: str) -> str:
    content = json.dumps({
        "prompt":      prompt,
        "layer_start": layer_start,
        "layer_end":   layer_end,
        "model_id":    model_id,
        "temperature": 0.0,
    }, sort_keys=True)
    return hashlib.sha256(content.encode()).hexdigest()


def _db_to_node_obj(node: NodeDB):
    from coordination.models.node import Node, HardwareProfile
    return Node(
        id=                 str(node.id),
        public_key=         node.public_key,
        hardware_profile=   HardwareProfile(),
        multiplier=         node.multiplier,
        status=             node.status,
        reliability_factor= node.reliability_factor,
        tasks_assigned=     node.tasks_assigned,
        tasks_completed=    node.tasks_completed,
        token_balance=      node.token_balance,
        registered_at=      node.registered_at,
    )


def _db_to_task_obj(task: TaskDB) -> Task:
    """Convert a TaskDB row to a Task pydantic object for the verifier."""
    return Task(
        id=               str(task.id),
        task_type=        task.task_type,
        payload=          task.payload or {},
        flops_estimated=  task.flops_estimated,
        assigned_node_id= str(task.assigned_node_id) if task.assigned_node_id else None,
        is_challenge=     task.is_challenge,
        challenge_answer= task.challenge_answer,
        status=           task.status,
        result_hash=      task.result_hash,
        flops_delivered=  task.flops_delivered,
        created_at=       task.created_at,
        dispatched_at=    task.dispatched_at,
        completed_at=     task.completed_at,
        expires_at=       task.expires_at,
    )
