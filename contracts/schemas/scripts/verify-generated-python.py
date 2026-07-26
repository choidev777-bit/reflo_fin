from __future__ import annotations

import json
import sys
from pathlib import Path

from pydantic import ValidationError


REPOSITORY_DIR = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY_DIR / "workers" / "python"))

from reflo_contracts.generated.worker.v1.worker_result_boundary import (  # noqa: E402
    WORKER_RESULT_TYPES,
    WorkerResultEnvelope,
)


fixture_dir = REPOSITORY_DIR / "contracts" / "schemas" / "fixtures"
valid = json.loads(
    (fixture_dir / "valid" / "worker-result-file-scan-lightweight.json").read_text(
        encoding="utf-8"
    )
)
model = WorkerResultEnvelope.model_validate(valid)
assert model.model_dump(mode="json", exclude_unset=True) == valid
assert len(WORKER_RESULT_TYPES) == 21

multiple = json.loads(
    (fixture_dir / "invalid" / "worker-result-multiple-results.json").read_text(
        encoding="utf-8"
    )
)
try:
    WorkerResultEnvelope.model_validate(multiple)
except ValidationError:
    pass
else:
    raise AssertionError("Python boundary accepted multiple result references")

print("generated Python worker boundary valid: 21 result types")
