import torch
from beatrice_ml.model import Encoder

def test_forward_shapes_and_l2norm():
    m = Encoder(n_syllables=49)
    x = torch.randn(4, 1, 64, 13)
    emb, logits = m(x)
    assert emb.shape == (4, 64) and logits.shape == (4, 49)
    assert torch.allclose(emb.norm(dim=1), torch.ones(4), atol=1e-5)

def test_param_budget():
    m = Encoder(n_syllables=49)
    n = sum(p.numel() for p in m.parameters() if p.requires_grad)
    assert n < 60_000   # ~34K conv/linear + BN + syll head

def test_variable_time_frames():
    m = Encoder(n_syllables=49)
    emb, _ = m(torch.randn(2, 1, 64, 28))   # ablation crop C
    assert emb.shape == (2, 64)

def test_overfits_tiny_batch():
    torch.manual_seed(1729)
    m = Encoder(n_syllables=4)
    x, y = torch.randn(16, 1, 64, 13), torch.arange(16) % 4
    opt = torch.optim.AdamW(m.parameters(), lr=3e-3)
    for _ in range(200):
        opt.zero_grad()
        _, logits = m(x)
        loss = torch.nn.functional.cross_entropy(logits, y)
        loss.backward(); opt.step()
    assert loss.item() < 0.1
