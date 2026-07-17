import torch
import torch.nn as nn
import torch.nn.functional as F

class DSBlock(nn.Module):
    def __init__(self, cin, cout):
        super().__init__()
        self.dw = nn.Conv2d(cin, cin, 3, stride=(2, 1), padding=1, groups=cin, bias=False)
        self.bn1 = nn.BatchNorm2d(cin)
        self.pw = nn.Conv2d(cin, cout, 1, bias=False)
        self.bn2 = nn.BatchNorm2d(cout)
    def forward(self, x):
        x = F.relu(self.bn1(self.dw(x)))
        return F.relu(self.bn2(self.pw(x)))

class Encoder(nn.Module):
    def __init__(self, n_syllables, channels=(24, 48, 64, 96, 128), embedding_dim=64):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(1, channels[0], 3, padding=1, bias=False),
            nn.BatchNorm2d(channels[0]), nn.ReLU(inplace=True))
        self.blocks = nn.Sequential(*[
            DSBlock(channels[i], channels[i + 1]) for i in range(len(channels) - 1)])
        self.proj = nn.Linear(channels[-1], embedding_dim)
        self.syll = nn.Linear(embedding_dim, n_syllables)
    def forward(self, x):
        h = self.blocks(self.stem(x))
        h = h.mean(dim=(2, 3))
        emb = F.normalize(self.proj(h), dim=1)
        return emb, self.syll(emb)
