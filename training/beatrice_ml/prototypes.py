"""Cosine prototypes, tau adaptation, deterministic 5-shot evaluation.

Pure-numpy library — no CLI, no I/O, no model inference. Consumes L2-normalized
embeddings + a plain meta dict (keys ``labels``, ``participants``, ``roles``,
``instrument4``) and produces class prototypes, a per-user adaptation rule, and
a deterministic few-shot evaluator.

Namespacing agnostic: ``labels`` are the class strings (e.g. "kick"/"snare"/
"hihat"); the caller maps embed_all's ``instrument3`` -> ``labels`` etc. AVP
hihat support pools hhc+hho automatically because the label is already the
3-way instrument class.
"""
from __future__ import annotations

import math

import numpy as np

_EPS = 1e-12


def _normalize(v: np.ndarray) -> np.ndarray:
    """L2 normalize a vector (or rows of a matrix along the last axis)."""
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, _EPS)


def factory_prototypes(emb: np.ndarray, labels, participants) -> dict:
    """Participant-balanced class prototypes.

    Per-participant per-class centroid -> L2 normalize -> mean over participants
    -> L2 normalize. Returns ``dict[label, np.ndarray]`` of unit vectors.
    """
    emb = np.asarray(emb, dtype=np.float64)
    labels = np.asarray(labels)
    participants = np.asarray(participants)

    protos: dict = {}
    for cls in sorted(set(labels.tolist())):
        cls_mask = labels == cls
        cls_parts = sorted(set(participants[cls_mask].tolist()))
        per_participant = []
        for p in cls_parts:
            sel = cls_mask & (participants == p)
            centroid = emb[sel].mean(axis=0)
            per_participant.append(_normalize(centroid))
        proto = np.mean(np.stack(per_participant), axis=0)
        protos[cls] = _normalize(proto).astype(np.float64)
    return protos


def adapt(proto: np.ndarray, user_emb: np.ndarray, tau: float) -> np.ndarray:
    """Adapt a factory prototype toward the user's support embeddings.

    ``normalize(tau * proto + user_emb.sum(0))``. With ``tau == 0`` the result
    is the pure user centroid; with an empty support set it collapses back to
    the factory prototype.
    """
    proto = np.asarray(proto, dtype=np.float64)
    user_emb = np.asarray(user_emb, dtype=np.float64)
    if user_emb.size == 0:
        user_sum = np.zeros_like(proto)
    else:
        user_sum = user_emb.reshape(-1, proto.shape[-1]).sum(axis=0)
    return _normalize(tau * proto + user_sum)


def five_shot_eval(emb_bank, meta, target_participant, prototypes, tau,
                   k=5, draws=100, seed=None,
                   classes=("kick", "snare", "hihat")) -> dict:
    """Deterministic few-shot evaluation for a single held-out participant.

    Support is drawn ONLY from the participant's ``role == "isolated"``
    recordings, per class, without replacement, ``k = min(k, available)``.
    Queries are ALL the participant's ``role == "improvisation"`` events (the
    embedding bank is already originals-only). Each query is classified by
    cosine similarity (dot product, embeddings are unit-norm) to the adapted
    prototypes. Averaged over ``draws`` independent support draws.

    Deterministic given ``seed``: each draw uses
    ``np.random.default_rng([seed, draw])`` so the same seed yields an identical
    result dict. Returns plain Python floats/dicts:
    ``{"per_class_recall": {cls: recall}, "macro_accuracy": float,
    "event_accuracy": float}`` over the classes present in the queries.
    """
    emb_bank = np.asarray(emb_bank, dtype=np.float64)
    labels = np.asarray(meta["labels"])
    participants = np.asarray(meta["participants"])
    roles = np.asarray(meta["roles"])

    part_mask = participants == target_participant
    # Candidate classes for classification: those with a factory prototype.
    cand = [c for c in classes if c in prototypes]
    proto_stack = {c: np.asarray(prototypes[c], dtype=np.float64) for c in cand}

    # Support pools per class (isolated recordings only).
    support_idx = {}
    for c in cand:
        pool = np.flatnonzero(part_mask & (roles == "isolated") & (labels == c))
        support_idx[c] = pool

    # Queries: all improvisation events for this participant (originals only).
    query_idx = np.flatnonzero(part_mask & (roles == "improvisation"))
    query_emb = emb_bank[query_idx]
    query_true = labels[query_idx]

    present = [c for c in cand if np.any(query_true == c)]

    if query_idx.size == 0 or not present:
        return {"per_class_recall": {}, "macro_accuracy": 0.0,
                "event_accuracy": 0.0}

    recall_accum = {c: 0.0 for c in present}
    macro_accum = 0.0
    event_accum = 0.0

    for draw in range(draws):
        rng = np.random.default_rng([seed, draw])
        adapted = np.empty((len(cand), emb_bank.shape[1]), dtype=np.float64)
        for i, c in enumerate(cand):
            pool = support_idx[c]
            kk = min(k, pool.size)
            if kk > 0:
                chosen = rng.choice(pool, size=kk, replace=False)
                user = emb_bank[chosen]
            else:
                user = np.zeros((0, emb_bank.shape[1]), dtype=np.float64)
            adapted[i] = adapt(proto_stack[c], user, tau)

        # Cosine similarity == dot product (all unit-norm) -> argmax class.
        sims = query_emb @ adapted.T                       # (n_query, n_cand)
        pred = np.array([cand[j] for j in sims.argmax(axis=1)])

        per_class = {}
        for c in present:
            c_mask = query_true == c
            per_class[c] = float(np.mean(pred[c_mask] == c))
            recall_accum[c] += per_class[c]
        macro_accum += float(np.mean([per_class[c] for c in present]))
        event_accum += float(np.mean(pred == query_true))

    per_class_recall = {c: recall_accum[c] / draws for c in present}
    return {
        "per_class_recall": per_class_recall,
        "macro_accuracy": macro_accum / draws,
        "event_accuracy": event_accum / draws,
    }


def select_tau(inner_folds_results: dict) -> float:
    """Pick the tau maximizing mean macro accuracy across inner-fold results.

    ``inner_folds_results`` maps ``tau -> list[macro_accuracy]``. Ties are
    broken by the smallest tau for determinism.
    """
    best_tau, best_mean = None, -math.inf
    for tau in sorted(inner_folds_results):
        vals = inner_folds_results[tau]
        mean = float(np.mean(vals)) if len(vals) else -math.inf
        if mean > best_mean + 1e-12:
            best_mean, best_tau = mean, tau
    return float(best_tau)


def fit_temperature(logits: np.ndarray, labels: np.ndarray) -> float:
    """Scalar temperature by NLL minimization via golden-section search.

    Minimizes the cross-entropy of ``softmax(logits / T)`` against integer
    ``labels`` over ``T in [0.05, 20]``.
    """
    logits = np.asarray(logits, dtype=np.float64)
    labels = np.asarray(labels).astype(int)
    n = logits.shape[0]
    row = np.arange(n)

    def nll(t: float) -> float:
        z = logits / t
        z = z - z.max(axis=1, keepdims=True)
        logsumexp = np.log(np.sum(np.exp(z), axis=1))
        logp = z[row, labels] - logsumexp
        return float(-np.mean(logp))

    lo, hi = 0.05, 20.0
    inv_phi = (math.sqrt(5.0) - 1.0) / 2.0            # 1/phi
    inv_phi2 = (3.0 - math.sqrt(5.0)) / 2.0           # 1/phi^2
    c = lo + inv_phi2 * (hi - lo)
    d = lo + inv_phi * (hi - lo)
    fc, fd = nll(c), nll(d)
    for _ in range(100):
        if hi - lo < 1e-5:
            break
        if fc < fd:
            hi, d, fd = d, c, fc
            c = lo + inv_phi2 * (hi - lo)
            fc = nll(c)
        else:
            lo, c, fc = c, d, fd
            d = lo + inv_phi * (hi - lo)
            fd = nll(d)
    return float((lo + hi) / 2.0)
