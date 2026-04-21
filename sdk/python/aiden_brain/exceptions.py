"""AIDEN Brain SDK exceptions."""


class AIDENBrainError(Exception):
    """Base exception for all AIDEN Brain errors."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class AuthenticationError(AIDENBrainError):
    """Raised when API key is invalid or missing."""

    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, status_code=401)


class RateLimitError(AIDENBrainError):
    """Raised when rate limit is exceeded."""

    def __init__(self, retry_after: int = 60, window: str = "minute"):
        self.retry_after = retry_after
        self.window = window
        super().__init__(
            f"Rate limit exceeded ({window}). Retry after {retry_after}s.",
            status_code=429,
        )


class InsufficientTokensError(AIDENBrainError):
    """Raised when the tenant has exhausted their token allocation."""

    def __init__(self, message: str = "Insufficient tokens"):
        super().__init__(message, status_code=402)


class ValidationError(AIDENBrainError):
    """Raised when request validation fails."""

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message, status_code=400)
        self.details = details or {}
