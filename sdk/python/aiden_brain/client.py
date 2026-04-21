"""AIDEN Brain SDK - Main client class."""

import time
import json
from typing import Any, Generator
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from .models import (
    ChatResponse,
    PhantomFired,
    Collision,
    ThinkingMode,
    GenerationResult,
    WorkflowState,
    UsageReport,
    FeedbackResponse,
    PhantomInfo,
    PhantomStats,
)
from .exceptions import (
    AIDENBrainError,
    AuthenticationError,
    RateLimitError,
    InsufficientTokensError,
    ValidationError,
)


class AIDENBrain:
    """Client for the AIDEN Brain API v2.

    Example:
        brain = AIDENBrain(api_key="aiden_sk_...", base_url="https://brain.aiden.services")
        response = brain.chat("Write a bold creative strategy")
        print(response.content)
        print(f"Phantoms fired: {[p.shorthand for p in response.phantoms_fired]}")
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://brain.aiden.services",
        timeout: int = 60,
        max_poll_attempts: int = 30,
        poll_interval: float = 2.0,
    ):
        """Initialize the AIDEN Brain client.

        Args:
            api_key: Your AIDEN API key (starts with aiden_sk_)
            base_url: API base URL
            timeout: Request timeout in seconds
            max_poll_attempts: Max polling attempts for async jobs
            poll_interval: Seconds between poll attempts
        """
        if not api_key or not api_key.startswith("aiden_sk_"):
            raise AuthenticationError("API key must start with 'aiden_sk_'")

        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_poll_attempts = max_poll_attempts
        self.poll_interval = poll_interval

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Make an authenticated request to the API."""
        url = f"{self.base_url}/api/v1{path}"
        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        data = json.dumps(body).encode("utf-8") if body else None
        req = Request(url, data=data, headers=headers, method=method)

        try:
            with urlopen(req, timeout=self.timeout) as resp:
                response_data = json.loads(resp.read().decode("utf-8"))
                if not response_data.get("success", False):
                    raise AIDENBrainError(
                        response_data.get("error", "Unknown error"),
                        status_code=resp.status,
                    )
                return response_data.get("data", response_data)
        except HTTPError as e:
            body_text = e.read().decode("utf-8", errors="replace")
            try:
                error_data = json.loads(body_text)
                error_msg = error_data.get("error", str(e))
            except (json.JSONDecodeError, ValueError):
                error_msg = body_text or str(e)

            if e.code == 401:
                raise AuthenticationError(error_msg)
            elif e.code == 429:
                retry_after = int(e.headers.get("Retry-After", "60"))
                raise RateLimitError(retry_after=retry_after)
            elif e.code == 402:
                raise InsufficientTokensError(error_msg)
            elif e.code == 400:
                raise ValidationError(error_msg)
            else:
                raise AIDENBrainError(error_msg, status_code=e.code)

    def _poll_job(self, job_id: str) -> dict[str, Any]:
        """Poll an async job until completion."""
        for _ in range(self.max_poll_attempts):
            data = self._request("GET", f"/jobs/{job_id}/status")
            status = data.get("status", "unknown")

            if status == "completed":
                result = self._request("GET", f"/jobs/{job_id}/result")
                return result
            elif status == "failed":
                raise AIDENBrainError(
                    data.get("error", "Job failed"),
                    status_code=500,
                )

            time.sleep(self.poll_interval)

        raise AIDENBrainError("Job timed out after max poll attempts")

    # ── Chat ─────────────────────────────────────────────────────────────────

    def chat(
        self,
        message: str,
        conversation_id: str | None = None,
        personality_mode: str = "collaborator",
        model: str | None = None,
    ) -> ChatResponse:
        """Send a message to the brain and get a response.

        Args:
            message: The user message
            conversation_id: Optional conversation ID for continuity
            personality_mode: 'collaborator', 'challenger', or 'collaborative'
            model: Optional model override

        Returns:
            ChatResponse with content, phantoms fired, collisions, etc.
        """
        body: dict[str, Any] = {
            "message": message,
            "personality_mode": personality_mode,
            "stream": False,
        }
        if conversation_id:
            body["conversation_id"] = conversation_id
        if model:
            body["model"] = model

        data = self._request("POST", "/chat", body)

        return ChatResponse(
            content=data["content"],
            conversation_id=data["conversation_id"],
            phantoms_fired=[
                PhantomFired(
                    shorthand=p["shorthand"],
                    score=p["score"],
                    source=p["source"],
                )
                for p in data.get("phantoms_fired", [])
            ],
            collisions=[
                Collision(
                    phantom_a=c["phantomA"],
                    phantom_b=c["phantomB"],
                    tension=c["tension"],
                )
                for c in data.get("collisions", [])
            ],
            thinking_mode=ThinkingMode(
                mode=data["thinking_mode"]["mode"],
                label=data["thinking_mode"]["label"],
                description=data["thinking_mode"]["description"],
            ),
            maturity_stage=data.get("maturity_stage", "initial"),
        )

    def chat_stream(
        self,
        message: str,
        conversation_id: str | None = None,
        personality_mode: str = "collaborator",
    ) -> Generator[str, None, ChatResponse | None]:
        """Stream a chat response. Yields text chunks, returns metadata.

        Usage:
            gen = brain.chat_stream("Write something bold")
            for chunk in gen:
                print(chunk, end="")
        """
        body: dict[str, Any] = {
            "message": message,
            "personality_mode": personality_mode,
            "stream": True,
        }
        if conversation_id:
            body["conversation_id"] = conversation_id

        url = f"{self.base_url}/api/v1/chat"
        headers = {
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        data = json.dumps(body).encode("utf-8")
        req = Request(url, data=data, headers=headers, method="POST")

        with urlopen(req, timeout=self.timeout) as resp:
            for line in resp:
                line = line.decode("utf-8").strip()
                if line.startswith("data: "):
                    event = json.loads(line[6:])
                    if event["type"] == "text":
                        yield event["data"]
                    elif event["type"] == "done":
                        return None

    # ── Structured Generation ────────────────────────────────────────────────

    def generate_strategy(self, brief: str, **kwargs: Any) -> GenerationResult:
        """Generate a creative strategy from a brief (async, polls until done)."""
        data = self._request("POST", "/generate/strategy", {"brief": brief, **kwargs})
        job_id = data.get("job_id")
        if job_id:
            result = self._poll_job(job_id)
            return GenerationResult(job_id=job_id, status="completed", result=result)
        return GenerationResult(job_id="sync", status="completed", result=data)

    def generate_territories(self, brief: str, **kwargs: Any) -> GenerationResult:
        """Generate creative territories from a brief."""
        data = self._request("POST", "/generate/territories", {"brief": brief, **kwargs})
        job_id = data.get("job_id")
        if job_id:
            result = self._poll_job(job_id)
            return GenerationResult(job_id=job_id, status="completed", result=result)
        return GenerationResult(job_id="sync", status="completed", result=data)

    def generate_big_idea(self, brief: str, territories: list[str] | None = None, **kwargs: Any) -> GenerationResult:
        """Generate big ideas from a brief and optional territories."""
        body: dict[str, Any] = {"brief": brief, **kwargs}
        if territories:
            body["territories"] = territories
        data = self._request("POST", "/generate/big-idea", body)
        job_id = data.get("job_id")
        if job_id:
            result = self._poll_job(job_id)
            return GenerationResult(job_id=job_id, status="completed", result=result)
        return GenerationResult(job_id="sync", status="completed", result=data)

    def generate_copy_suite(self, brief: str, big_idea: str | None = None, **kwargs: Any) -> GenerationResult:
        """Generate a copy suite from a brief and optional big idea."""
        body: dict[str, Any] = {"brief": brief, **kwargs}
        if big_idea:
            body["big_idea"] = big_idea
        data = self._request("POST", "/generate/copy-suite", body)
        job_id = data.get("job_id")
        if job_id:
            result = self._poll_job(job_id)
            return GenerationResult(job_id=job_id, status="completed", result=result)
        return GenerationResult(job_id="sync", status="completed", result=data)

    # ── Workflow ─────────────────────────────────────────────────────────────

    def workflow(self, brief: str, **kwargs: Any) -> WorkflowState:
        """Start or continue a guided workflow pipeline."""
        data = self._request("POST", "/workflow", {"brief": brief, **kwargs})
        return WorkflowState(
            workflow_id=data.get("workflow_id", ""),
            current_step=data.get("current_step", ""),
            steps_completed=data.get("steps_completed", []),
            steps_remaining=data.get("steps_remaining", []),
            outputs=data.get("outputs", {}),
        )

    # ── Usage ────────────────────────────────────────────────────────────────

    def get_usage(self) -> UsageReport:
        """Get usage report for the current billing period."""
        data = self._request("GET", "/usage")
        return UsageReport(
            total_requests=data.get("total_requests", 0),
            total_tokens=data.get("total_tokens", 0),
            period_start=data.get("period_start", ""),
            period_end=data.get("period_end", ""),
            breakdown=data.get("breakdown", {}),
        )

    # ── Feedback ─────────────────────────────────────────────────────────────

    def submit_feedback(
        self,
        message_id: str,
        conversation_id: str,
        feedback_type: str,
        edited_content: str | None = None,
    ) -> FeedbackResponse:
        """Submit feedback for a message.

        Args:
            message_id: The message to give feedback on
            conversation_id: The conversation containing the message
            feedback_type: 'positive', 'negative', 'used', 'regenerated', or 'edited'
            edited_content: Optional edited content (for 'edited' type)

        Returns:
            FeedbackResponse with weight change info
        """
        body: dict[str, Any] = {
            "message_id": message_id,
            "conversation_id": conversation_id,
            "feedback_type": feedback_type,
        }
        if edited_content:
            body["edited_content"] = edited_content

        data = self._request("POST", "/feedback", body)
        return FeedbackResponse(
            feedback_type=data.get("feedback_type", feedback_type),
            weight_changes=data.get("weight_changes", 0),
            flagged_for_review=data.get("flagged_for_review", []),
        )

    # ── Phantom Management ───────────────────────────────────────────────────

    def list_phantoms(self) -> list[PhantomInfo]:
        """List active phantoms for the tenant."""
        data = self._request("GET", "/phantoms")
        return [
            PhantomInfo(
                shorthand=p["shorthand"],
                feeling_seed=p.get("feeling_seed", ""),
                influence=p.get("influence", ""),
                weight=p.get("weight", 3.0),
                quality_score=p.get("quality_score"),
            )
            for p in data.get("phantoms", [])
        ]

    def get_phantom_stats(self) -> PhantomStats:
        """Get phantom statistics including alliances."""
        data = self._request("GET", "/phantoms/stats")
        return PhantomStats(
            total_phantoms=data.get("total_phantoms", 0),
            avg_weight=data.get("avg_weight", 0),
            top_phantoms=data.get("top_phantoms", []),
            alliances=data.get("alliances", []),
        )
