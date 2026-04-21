"""AIDEN Brain SDK - Python client for the AIDEN Brain API v2."""

from .client import AIDENBrain
from .models import (
    ChatResponse,
    PhantomFired,
    Collision,
    ThinkingMode,
    GenerationResult,
    WorkflowState,
    UsageReport,
    FeedbackResponse,
)
from .exceptions import (
    AIDENBrainError,
    AuthenticationError,
    RateLimitError,
    InsufficientTokensError,
    ValidationError,
)

__version__ = "0.1.0"
__all__ = [
    "AIDENBrain",
    "ChatResponse",
    "PhantomFired",
    "Collision",
    "ThinkingMode",
    "GenerationResult",
    "WorkflowState",
    "UsageReport",
    "FeedbackResponse",
    "AIDENBrainError",
    "AuthenticationError",
    "RateLimitError",
    "InsufficientTokensError",
    "ValidationError",
]
