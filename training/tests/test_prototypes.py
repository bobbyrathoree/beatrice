# training/tests/test_prototypes.py
import numpy as np
from beatrice_ml.prototypes import factory_prototypes, adapt, five_shot_eval

def _bank():
    rng = np.random.default_rng(1729)
    centers = {"kick": np.eye(64)[0], "snare": np.eye(64)[1], "hihat": np.eye(64)[2]}
    emb, labels, parts, roles, inst4 = [], [], [], [], []
    for p in [1, 2, 3]:
        for cls in centers:
            for i in range(12):
                v = centers[cls] + 0.05 * rng.standard_normal(64)
                emb.append(v / np.linalg.norm(v))
                labels.append(cls); parts.append(p)
                roles.append("isolated" if i < 6 else "improvisation")
                inst4.append({"kick": "kd", "snare": "sd", "hihat": "hhc"}[cls])
    return (np.array(emb), np.array(labels), np.array(parts),
            np.array(roles), np.array(inst4))

def test_factory_prototypes_participant_balanced():
    emb, labels, parts, _, _ = _bank()
    protos = factory_prototypes(emb, labels, parts)
    assert set(protos) == {"kick", "snare", "hihat"}
    for v in protos.values():
        assert np.isclose(np.linalg.norm(v), 1.0)
    assert protos["kick"] @ np.eye(64)[0] > 0.95

def test_adapt_tau_zero_is_pure_user():
    proto = np.eye(64)[0]
    user = np.tile(np.eye(64)[5], (5, 1))
    a = adapt(proto, user, tau=0.0)
    assert a @ np.eye(64)[5] > 0.99

def test_five_shot_eval_separable_bank_is_perfect():
    emb, labels, parts, roles, inst4 = _bank()
    protos = factory_prototypes(emb, labels, parts)
    r = five_shot_eval(emb, dict(labels=labels, participants=parts, roles=roles,
                                 instrument4=inst4), target_participant=3,
                       prototypes=protos, tau=5.0, draws=10, seed=1729)
    assert r["macro_accuracy"] > 0.99
    assert set(r["per_class_recall"]) == {"kick", "snare", "hihat"}

def test_draws_are_deterministic():
    emb, labels, parts, roles, inst4 = _bank()
    protos = factory_prototypes(emb, labels, parts)
    meta = dict(labels=labels, participants=parts, roles=roles, instrument4=inst4)
    a = five_shot_eval(emb, meta, 2, protos, 5.0, draws=5, seed=42)
    b = five_shot_eval(emb, meta, 2, protos, 5.0, draws=5, seed=42)
    assert a == b
