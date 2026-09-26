"""Read-only staging availability load test.

This intentionally exercises the public health endpoint. The generation API
creates paid background jobs, so a scheduled load test must not call it.
"""

from locust import HttpUser, between, task


class HealthUser(HttpUser):
    wait_time = between(1, 3)

    @task
    def health(self) -> None:
        with self.client.get("/health", name="/health", catch_response=True) as response:
            if response.status_code != 200:
                response.failure(f"health returned HTTP {response.status_code}")
