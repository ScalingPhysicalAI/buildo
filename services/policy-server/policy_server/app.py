"""The doc's page-7 contract, literally: BuildoObservation in (Arrow IPC,
raw POST body), BuildoActionChunk out (JSON). Plain HTTP -- no WebRTC yet,
that's Phase 9's concern, and would be over-engineering for a same-network
dev loop today.

Run: uvicorn policy_server.app:app --reload
"""

from __future__ import annotations

from buildo_schema import deserialize_observation, serialize_action_chunk
from fastapi import FastAPI, Request, Response

from .pick_and_place import MODEL_VERSION, PickAndPlacePolicy

app = FastAPI(title="Buildo Policy Server", description="Phase 3 stub -- see pick_and_place.py")

# One shared rollout for now -- no per-session/sequence_id tracking yet.
# Fine for a single-client dev loop (Phase 4's own use case); a real
# deployment serving multiple robots/sims needs a policy instance per
# session, keyed by something the client establishes on connect.
_policy = PickAndPlacePolicy()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model_version": MODEL_VERSION}


@app.post("/act")
async def act(request: Request) -> Response:
    observation_bytes = await request.body()
    obs = deserialize_observation(observation_bytes)
    chunk = _policy.act(obs)
    return Response(content=serialize_action_chunk(chunk), media_type="application/json")
