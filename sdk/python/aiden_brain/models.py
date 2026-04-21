"""AIDEN Brain SDK data models."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PhantomFired:
    """A phantom that was activated during response generation."""
    shorthand: str
    score: float
    source: str  # 'base' | 'agency' | 'pack' | 'user'


@dataclass
class Collision:
    """A creative tension detected between opposing phantoms."""
    phantom_a: str
    phantom_b: str
    tension: str


@dataclass
class ThinkingMode:
    """The cognitive mode used for response generation."""
    mode: str
    label: str
    description: str


@dataclass
class ChatResponse:
    """Response from the chat endpoint."""
    content: str
    conversation_id: str
    phantoms_fired: list[PhantomFired]
    collisions: list[Collision]
    thinking_mode: ThinkingMode
    maturity_stage: str


@dataclass
class GenerationResult:
    """Result from structured generation endpoints."""
    job_id: str
    status: str  # 'pending' | 'processing' | 'completed' | 'failed'
    result: dict[str, Any] | None = None
    error: str | None = None


@dataclass
class WorkflowState:
    """State of a workflow pipeline."""
    workflow_id: str
    current_step: str
    steps_completed: list[str]
    steps_remaining: list[str]
    outputs: dict[str, Any] = field(default_factory=dict)


@dataclass
class UsageReport:
    """Usage report for the current billing period."""
    total_requests: int
    total_tokens: int
    period_start: str
    period_end: str
    breakdown: dict[str, int] = field(default_factory=dict)


@dataclass
class FeedbackResponse:
    """Response from the feedback endpoint."""
    feedback_type: str
    weight_changes: int
    flagged_for_review: list[str]


@dataclass
class PhantomInfo:
    """Information about a phantom."""
    shorthand: str
    feeling_seed: str
    influence: str
    weight: float
    quality_score: float | None = None


@dataclass
class PhantomStats:
    """Aggregated phantom statistics."""
    total_phantoms: int
    avg_weight: float
    top_phantoms: list[dict[str, Any]]
    alliances: list[dict[str, Any]]
