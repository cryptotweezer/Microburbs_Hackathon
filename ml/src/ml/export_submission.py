"""Validate the serialized CSV before atomically publishing it."""
from pathlib import Path
import tempfile
from .check_submission import check_submission


def export_submission(frame, path, input_ids, expected_rows=65777):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix='.csv', delete=False) as handle:
        temporary = Path(handle.name)
    try:
        frame.to_csv(temporary, index=False, encoding='utf-8')
        result = check_submission(temporary, input_ids, expected_rows)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return result


if __name__ == '__main__':
    from .make_submission import main
    main()
