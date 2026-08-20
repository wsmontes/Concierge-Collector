from datetime import datetime, timezone

from app.services.consumer_auth_service import ConsumerPrincipal
from app.services.consumer_rate_limit import ConsumerRateLimitService


class Windows:
    def __init__(self):
        self.count = 0

    def find_one_and_update(self, _query, _update, **_kwargs):
        self.count += 1
        return {"requests": self.count}


class Database:
    def __init__(self):
        self.windows = Windows()

    def __getitem__(self, _name):
        return self.windows


def test_quota_success_and_rejection_use_the_same_rate_headers():
    service = ConsumerRateLimitService(Database())
    principal = ConsumerPrincipal("cred-1", "app-1", frozenset({"collection-1"}), 2)
    now = datetime(2026, 8, 20, 12, 0, 0, tzinfo=timezone.utc)
    first = service.consume(principal, now)
    second = service.consume(principal, now)
    rejected = service.consume(principal, now)

    for result in (first, second, rejected):
        assert set(result.headers) >= {"X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"}
    assert rejected.status_code == 429
    assert rejected.headers["Retry-After"] == "60"
