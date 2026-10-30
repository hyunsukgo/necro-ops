#!/usr/bin/env bash
# Run tasks in order, stopping at the first failure.
# Usage: scripts/kiro-all.sh            # all remaining tasks
#        scripts/kiro-all.sh 2.1 2.5    # range (inclusive) by list position
set -euo pipefail

ORDER=(1 2.1 2.2 2.3 2.4 2.5 3.1 3.2 3.3 4.1 4.2 5.1 5.2 5.3
       6.1 6.2 6.3 6.4 7.1 7.2 7.3 8.1 8.2 8.3 8.4 9.1 9.2 9.3)

FROM="${1:-${ORDER[0]}}"; TO="${2:-${ORDER[-1]}}"
run=false
for id in "${ORDER[@]}"; do
  [[ "$id" == "$FROM" ]] && run=true
  $run && scripts/kiro-task.sh "$id"
  [[ "$id" == "$TO" ]] && break
done
echo "✔ finished ($FROM → $TO)"
