# beatrice-ml

Training pipeline for the Beatrice beatbox-classifier CNN.

## Local setup

```bash
uv sync
```

## Run tests

```bash
uv run pytest tests/test_splits.py -v
```

## EC2 / GPU

See `infra/` for the EC2 GPU training recipe.
