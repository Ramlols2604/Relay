"""Move a loan's return time into the past so the overdue flow can be tested.

Usage (from backend/): python ../flows/age_loan.py <loan_id> <minutes_ago>
Uses DATABASE_URL, so it edits the same database the API server is using.
"""

import sys
from datetime import timedelta

from app.clock import now
from app.db import session_scope
from app.models import Loan

loan_id, minutes_ago = sys.argv[1], int(sys.argv[2])
with session_scope() as session:
    loan = session.get(Loan, loan_id)
    if loan is None:
        raise SystemExit(f"no loan {loan_id}")
    loan.window_end = now() - timedelta(minutes=minutes_ago)
    session.add(loan)
    session.commit()
