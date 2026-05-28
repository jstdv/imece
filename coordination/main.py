from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from coordination.api import nodes, tasks, tokens, grid, inference
from coordination.config import settings
from coordination.db import get_db, check_connection, SessionLocal
from coordination.ledger.ledger import ledger
from coordination.core.shard_registry import registry
from coordination.models.db_models import NodeDB

app = FastAPI(
    title=       settings.APP_NAME,
    version=     settings.VERSION,
    description= (
        "Coordination Layer for the imece framework. "
        "Manages contributor nodes, dispatches compute tasks, "
        "issues FLOP-denominated tokens, and maintains the token ledger."
    ),
    docs_url=    "/docs",
    redoc_url=   "/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=  ["*"],
    allow_methods=  ["*"],
    allow_headers=  ["*"],
)

app.include_router(nodes.router)
app.include_router(tasks.router)
app.include_router(tokens.router)
app.include_router(grid.router)
app.include_router(inference.router)


def _make_node_lookup():
    """
    Returns a node lookup callable that the shard registry uses inside
    get_online_shards() to validate that each shard's owning node is
    active and not in quarantine.

    Opens and closes its own DB session on every call so it is safe to
    call from any thread, including inside the registry's RLock sections.
    """
    def _lookup(node_id: str):
        db = SessionLocal()
        try:
            return db.query(NodeDB).filter(NodeDB.id == node_id).first()
        except Exception:
            return None
        finally:
            db.close()
    return _lookup


@app.on_event("startup")
def on_startup():
    """
    Wire the node lookup function into the shard registry on startup.
    Must run before any shard registers so get_online_shards can validate
    node status. FastAPI guarantees on_event("startup") runs before the
    first request is served.
    """
    registry._node_lookup = _make_node_lookup()


@app.get("/", tags=["Info"])
def root():
    return {
        "name":       settings.APP_NAME,
        "version":    settings.VERSION,
        "status":     "running",
        "docs":       "/docs",
        "token_mode": settings.TOKEN_MODE,
    }


@app.get("/health", tags=["Info"])
def health(db: Session = Depends(get_db)):
    db_ok = check_connection()
    return {
        "status":         "healthy" if db_ok else "degraded",
        "database":       "connected" if db_ok else "disconnected",
        "ledger_entries": ledger.total_entries(db),
        "ledger_valid":   ledger.verify_chain(db),
        "total_supply":   round(ledger.total_supply(db), 6),
    }